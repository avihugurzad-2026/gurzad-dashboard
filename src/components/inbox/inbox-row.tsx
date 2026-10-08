'use client';
import { report } from '@/lib/report';
import { submitWith } from '@/lib/submit';
import { useActionState, useMemo, useState, useTransition } from 'react';
import { FileText, Sparkles, Trash2 } from 'lucide-react';
import { classifyInbox, removeInbox, type ActionResult } from '@/app/actions';
import { Button, buttonClass } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { labelClass, selectClass } from '@/components/work/fields';
import { stamp } from '@/lib/format';
import { ENTITIES, categoriesFor, decodePlace, placeOptions } from '@/lib/places';
import type { InboxItem } from '@/server/entries';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/shell/session-context';

// 'note' stays only as a label for items sorted before; new items become a task, or a document when there is a file
const MODULES = [{ key: 'task', label: 'משימה' }, { key: 'note', label: 'הערה' }, { key: 'document', label: 'מסמך' }] as const;
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

// The four answers to "where does this belong?", then the finer place inside it
type Root = { key: string; label: string; prefix: string };
// From the registry (businesses and households are user data), built on each render
function rootsNow(): Root[] {
  return [
    { key: 'personal', label: 'אישי', prefix: 'personal|' },
    ...ENTITIES.filter(e => e.domain === 'household').map(e => ({ key: `household-${e.id}`, label: e.label, prefix: `household|${e.id}|` })),
    ...ENTITIES.filter(e => e.domain === 'business').map(e => ({ key: `business-${e.id}`, label: e.short || e.label, prefix: `business|${e.id}|` })),
    { key: 'ventures', label: 'יזמות', prefix: 'ventures|' },
  ];
}
const rootOf = (roots: Root[], place: string) => roots.find(r => place.startsWith(r.prefix))?.key ?? null;

// One unsorted item. A file asks right away "למה המסמך הזה שייך?"; text opens with "שייך".
// When an earlier item looked the same (same words in the name), its answers are pre-filled.
export function InboxRow({ item }: { item: InboxItem }) {
  const session = useSession();
  const [open, setOpen] = useState(Boolean(item.file));
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(classifyInbox, null);
  const [removing, startRemove] = useTransition();
  const options = useMemo(() => {
    const all = placeOptions();
    return session ? all.filter(o => session.places.includes(o.value)) : all;
  }, [session]);
  const sug = item.suggestion && options.some(o => o.value === item.suggestion!.place) ? item.suggestion : null;
  const [where, setWhere] = useState<string | null>(sug?.place ?? null);
  const choices = MODULES.filter(m => m.key === 'task' || (m.key === 'document' && item.file));
  const [module, setModule] = useState<string>(choices.some(m => m.key === sug?.module) ? sug!.module : (item.file ? 'document' : 'task'));
  const ROOTS = rootsNow();
  const root = where ? rootOf(ROOTS, where) : null;
  const domain = where ? decodePlace(where)?.domain ?? 'personal' : 'personal';
  const roots = ROOTS.filter(r => options.some(o => o.value.startsWith(r.prefix)));
  const inside = root ? options.filter(o => o.value.startsWith(ROOTS.find(r => r.key === root)!.prefix)) : [];

  return (
    <li className={cn('flex flex-col gap-3 py-4', removing && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {item.raw_text && <p className="whitespace-pre-wrap text-body text-ink"><bdi>{item.raw_text}</bdi></p>}
          {item.file && (
            <a href={`/api/v1/files/${item.file.id}`} className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-accent-ink hover:underline">
              <FileText className="size-4" aria-hidden /><bdi>{item.file.name}</bdi><span className="text-xs font-normal text-muted tabular">{kb(item.file.size)}</span>
            </a>
          )}
          <p className="text-xs text-muted">{stamp(item.created_at)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant={open ? 'ghost' : 'secondary'} onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? 'סגור' : 'שייך'}</Button>
          <button type="button" aria-label="מחק פריט" disabled={removing}
            onClick={() => { if (confirm('למחוק את הפריט?')) startRemove(async () => { report(await removeInbox(item.id)); }); }}
            className={buttonClass('ghost', 'icon', 'size-8 text-muted hover:text-critical-ink')}><Trash2 aria-hidden /></button>
        </div>
      </div>
      {open && (
        <form onSubmit={submitWith(action)} className="flex flex-col gap-4 rounded-lg border border-line bg-surface-2/40 p-4">
          <input type="hidden" name="id" value={item.id} />
          {where && <input type="hidden" name="place" value={where} />}
          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-ink">{item.file ? 'למה המסמך הזה שייך?' : 'למה זה שייך?'}</legend>
            {sug && (
              <p className="mb-3 flex items-center gap-1.5 text-xs text-accent-ink">
                <Sparkles className="size-4" aria-hidden />מילאתי כמו בפעם הקודמת (<bdi>{sug.from}</bdi>). אפשר לשנות.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {roots.map(r => (
                <button key={r.key} type="button" aria-pressed={root === r.key}
                  onClick={() => setWhere(options.find(o => o.value.startsWith(r.prefix))!.value)}
                  className={cn('h-11 rounded-lg border text-sm font-medium transition-colors',
                    root === r.key ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line-strong bg-surface hover:bg-surface-2')}>
                  <bdi>{r.label}</bdi>
                </button>
              ))}
            </div>
          </fieldset>
          {where && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
              {inside.length > 1 && (
                <label className={cn(labelClass, 'flex flex-col gap-1.5')}>איפה בדיוק
                  <select value={where} onChange={e => setWhere(e.target.value)} className={selectClass}>
                    {inside.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
              <label className={cn(labelClass, 'flex flex-col gap-1.5')}>קטגוריה
                <select key={domain} name="category" defaultValue={sug && sug.place === where && sug.category ? sug.category : 'general'} className={selectClass}>
                  {categoriesFor(domain).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className={cn(labelClass, 'flex flex-col gap-1.5')}>מה זה
                <select name="module" value={module} onChange={e => setModule(e.target.value)} className={selectClass}>
                  {choices.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </label>
              <div className="col-span-2 flex items-end sm:col-span-1">
                <Button type="submit" variant="primary" disabled={pending} className="w-full">{module === 'task' ? 'צור משימה' : 'שייך'}</Button>
              </div>
            </div>
          )}
          {state && !state.ok && <p role="alert" className="text-sm text-critical-ink">{state.error}</p>}
        </form>
      )}
    </li>
  );
}

export function ClassifiedRow({ item }: { item: InboxItem }) {
  const label = MODULES.find(m => m.key === item.classified?.module)?.label;
  return (
    <li className="flex items-center justify-between gap-3 py-3 text-sm">
      <span className="min-w-0 truncate text-ink-2"><bdi>{item.raw_text ?? item.file?.name}</bdi></span>
      <span className="flex shrink-0 items-center gap-1.5">
        {label && <Badge>{label}</Badge>}
        <Badge tone="accent"><bdi dir="rtl">{item.classified?.context}</bdi></Badge>
      </span>
    </li>
  );
}

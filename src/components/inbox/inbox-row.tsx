'use client';
import { useActionState, useMemo, useState, useTransition } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { classifyInbox, removeInbox, type ActionResult } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { inputClass } from '@/components/work/fields';
import { stamp } from '@/lib/format';
import { categoriesFor, decodePlace, placeOptions } from '@/lib/places';
import type { InboxItem } from '@/server/entries';
import { cn } from '@/lib/utils';

const MODULES = [{ key: 'task', label: 'משימה' }, { key: 'note', label: 'הערה' }, { key: 'document', label: 'מסמך' }] as const;
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

// One unsorted item. "שייך" opens the sorting form: where it belongs and what it is.
export function InboxRow({ item }: { item: InboxItem }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(classifyInbox, null);
  const [removing, startRemove] = useTransition();
  const options = useMemo(placeOptions, []);
  const [where, setWhere] = useState(options[0].value);
  const [module, setModule] = useState<string>(item.file ? 'document' : 'task');
  const domain = decodePlace(where)?.domain ?? 'personal';

  return (
    <li className={cn('flex flex-col gap-2 py-3', removing && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {item.raw_text && <p className="whitespace-pre-wrap text-sm text-ink"><bdi>{item.raw_text}</bdi></p>}
          {item.file && (
            <a href={`/api/v1/files/${item.file.id}`} className="mt-1 inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
              <FileText className="size-4" aria-hidden /><bdi>{item.file.name}</bdi><span className="text-xs text-muted">{kb(item.file.size)}</span>
            </a>
          )}
          <p className="mt-1 text-xs text-muted">{stamp(item.created_at)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant={open ? 'ghost' : 'secondary'} onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? 'סגור' : 'שייך'}</Button>
          <button type="button" aria-label="מחק פריט" disabled={removing}
            onClick={() => { if (confirm('למחוק את הפריט?')) startRemove(async () => { await removeInbox(item.id); }); }}
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-critical-ink"><Trash2 className="size-4" aria-hidden /></button>
        </div>
      </div>
      {open && (
        <form action={action} className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-2/40 p-3 sm:grid-cols-4">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="place" value={where} />
          <label className="flex flex-col gap-1 text-xs text-muted">שייך ל
            <select value={where} onChange={e => setWhere(e.target.value)} className={inputClass}>
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">מודול
            <select name="module" value={module} onChange={e => setModule(e.target.value)} className={inputClass}>
              {MODULES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          {module === 'task' && (
            <label className="flex flex-col gap-1 text-xs text-muted">קטגוריה
              <select key={domain} name="category" defaultValue="general" className={inputClass}>
                {categoriesFor(domain).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          )}
          <div className="col-span-2 flex items-end sm:col-span-1">
            <Button type="submit" variant="primary" disabled={pending} className="w-full">{module === 'task' ? 'צור משימה' : 'שייך'}</Button>
          </div>
          {state && !state.ok && <p role="alert" className="col-span-full text-xs text-critical-ink">{state.error}</p>}
        </form>
      )}
    </li>
  );
}

export function ClassifiedRow({ item }: { item: InboxItem }) {
  const label = MODULES.find(m => m.key === item.classified?.module)?.label;
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0 truncate text-ink-2"><bdi>{item.raw_text ?? item.file?.name}</bdi></span>
      <span className="flex shrink-0 items-center gap-1.5">
        {label && <Badge>{label}</Badge>}
        <Badge tone="accent"><bdi dir="rtl">{item.classified?.context}</bdi></Badge>
      </span>
    </li>
  );
}

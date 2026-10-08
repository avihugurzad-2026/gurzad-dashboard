'use client';
import { useActionState, useEffect, useId, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cancelImport, commitImport, importReceiptUrl, saveReceipt, uploadReceipt, uploadStatement, type ImportResult } from '@/app/import-actions';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Field, compactInputClass, inputClass, selectClass } from '@/components/work/fields';
import { ils, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type AccOpt, type CatOpt, type WsOpt } from './forms';
import { FREQ_LABEL } from '@/lib/ledger-labels';

export type Mode = 'statement' | 'receipt' | 'camera' | 'url';
const wsLabel = (w: WsOpt) => (w.kind === 'personal' ? 'אישי' : w.name);

function Err({ s }: { s: ImportResult | null }) {
  return s && !s.ok ? <p role="alert" className="text-sm text-critical-ink">{s.error}</p> : null;
}

// ── Upload ────────────────────────────────────────────────────────────────────
export function ImportUpload({ mode, targets, accountsByWs, defaultWs }: {
  mode: Mode; targets: WsOpt[]; accountsByWs: Record<string, AccOpt[]>; defaultWs: string;
}) {
  const uid = useId();
  const [ws, setWs] = useState(defaultWs);
  const action = mode === 'statement' ? uploadStatement : mode === 'url' ? importReceiptUrl : uploadReceipt;
  const [state, run, pending] = useActionState<ImportResult | null, FormData>(action, null);
  const accounts = accountsByWs[ws] ?? [];
  return (
    <form action={run} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="ברירת מחדל: לאן התנועות שייכות" htmlFor={`${uid}-ws`} hint="אפשר לשנות לכל שורה בסקירה">
        <select id={`${uid}-ws`} name="ws" value={ws} onChange={e => setWs(e.target.value)} className={selectClass}>
          {targets.map(w => <option key={w.id} value={w.id}>{wsLabel(w)}</option>)}
        </select>
      </Field>
      {mode === 'statement' && (
        <>
          <Field label="מאיזה חשבון / כרטיס" htmlFor={`${uid}-acc`} hint="חשבון של משק הבית ישייך את השורות לבית">
            <select id={`${uid}-acc`} name="account_id" className={selectClass} key={ws}>
              <option value="">{accounts.length ? 'לא משויך' : 'אין חשבונות באזור הזה'}</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ‎••${a.last4}` : ''}</option>)}
            </select>
          </Field>
          <Field label="סוג הדוח" htmlFor={`${uid}-kind`} hint="בכרטיס אשראי סכום חיובי הוא הוצאה; בבנק מינוס הוא הוצאה">
            <select id={`${uid}-kind`} name="kind" defaultValue="auto" className={selectClass}>
              <option value="auto">זיהוי אוטומטי</option><option value="card">כרטיס אשראי</option><option value="bank">חשבון בנק</option>
            </select>
          </Field>
        </>
      )}
      {mode === 'url' ? (
        <Field label="קישור לקבלה או לחשבונית" htmlFor={`${uid}-url`} className="col-span-full" hint="קישור https ציבורי (PDF או דף קבלה)">
          <input id={`${uid}-url`} name="url" type="url" required dir="ltr" placeholder="https://" className={inputClass} />
        </Field>
      ) : (
        <Field label={mode === 'statement' ? 'קובץ (CSV, Excel או PDF)' : mode === 'camera' ? 'צילום הקבלה' : 'קובץ (PDF, JPG או PNG)'} htmlFor={`${uid}-file`} className="col-span-full">
          <input id={`${uid}-file`} name="file" type="file" required
            accept={mode === 'statement' ? '.csv,.tsv,.txt,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf,image/jpeg,image/png,image/webp,image/heic'}
            capture={mode === 'camera' ? 'environment' : undefined}
            className="min-w-0 text-sm text-ink-2 file:me-3 file:h-9 file:cursor-pointer file:rounded-lg file:border file:border-solid file:border-line-strong file:bg-surface file:px-3 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-2" />
        </Field>
      )}
      <div className="col-span-full flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? 'קורא…' : mode === 'statement' ? 'קרא את הדוח' : 'קרא את הקבלה'}</Button>
        <Err s={state} />
      </div>
      <p className="col-span-full text-xs text-muted">שום דבר לא נשמר עד שתאשר בסקירה. מספרי כרטיס מלאים לא נשמרים.</p>
    </form>
  );
}


// ── Statement review ──────────────────────────────────────────────────────────
export type Cand = {
  id: string; occurred_on: string | null; merchant: string | null; description: string | null; amount: number | null; direction: 'income' | 'expense' | null;
  target_workspace_id: string | null; category_id: string | null; subcategory_id: string | null; fixed_or_variable: string | null; frequency: string | null;
  status: string; first_time: boolean; rule_id: string | null;
};
const GROUPS = [
  { key: 'auto', label: 'סווג אוטומטית', tone: 'good' as const },
  { key: 'review', label: 'צריך בדיקה', tone: 'warning' as const },
  { key: 'unrecognized', label: 'לא מזוהה', tone: 'critical' as const },
  { key: 'duplicate', label: 'כנראה כפול', tone: 'neutral' as const },
];

export function StatementReview({ importId, candidates, targets, catsByWs }: {
  importId: string; candidates: Cand[]; targets: WsOpt[]; catsByWs: Record<string, CatOpt[]>;
}) {
  const router = useRouter();
  const [state, run, pending] = useActionState<ImportResult | null, FormData>(commitImport, null);
  const [cancelling, startCancel] = useTransition();
  const [included, setIncluded] = useState<Record<string, boolean>>(() => Object.fromEntries(candidates.map(c => [c.id, c.status === 'auto' || c.status === 'review'])));
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  const count = Object.values(included).filter(Boolean).length;
  const total = useMemo(() => candidates.filter(c => included[c.id] && c.amount).reduce((a, c) => a + (c.direction === 'income' ? 1 : -1) * (c.amount ?? 0), 0), [candidates, included]);
  return (
    <form action={run} className="flex flex-col gap-6">
      <input type="hidden" name="import" value={importId} />
      {GROUPS.map(g => {
        const rows = candidates.filter(c => c.status === g.key);
        if (!rows.length) return null;
        return (
          <section key={g.key} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-section font-semibold">{g.label} <Badge tone={g.tone}>{rows.length}</Badge></h2>
            {g.key === 'duplicate' && <p className="-mt-1 text-sm text-muted">נראות כמו תנועות שכבר שמורות (אותו סכום, ±3 ימים). לא מסומנות לייבוא.</p>}
            {g.key === 'unrecognized' && <p className="-mt-1 text-sm text-muted">חסר בהן תאריך, סכום או סוג. השלם ידנית או השאר לא מסומן.</p>}
            <ul className="flex flex-col divide-y divide-[color:var(--border)] rounded-xl border border-line bg-surface">
              {rows.map(c => <CandRow key={c.id} c={c} targets={targets} catsByWs={catsByWs} on={!!included[c.id]} setOn={v => setIncluded(s => ({ ...s, [c.id]: v }))} />)}
            </ul>
          </section>
        );
      })}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-surface px-4 py-3 sm:mx-0 sm:rounded-xl sm:border">
        <Button type="submit" variant="primary" disabled={pending || !count}>{pending ? 'שומר…' : `ייבא ${count} תנועות`}</Button>
        <span className="text-sm text-muted">נטו: <bdi className="tabular">{ils(total) ?? '—'}</bdi></span>
        <Button variant="ghost" disabled={cancelling} onClick={() => { if (confirm('לבטל את הייבוא? שום דבר לא יישמר.')) startCancel(async () => { const r = await cancelImport(importId); if (!r.ok) alert(r.error); else router.refresh(); }); }}>ביטול הייבוא</Button>
        <Err s={state} />
      </div>
    </form>
  );
}

function CandRow({ c, targets, catsByWs, on, setOn }: { c: Cand; targets: WsOpt[]; catsByWs: Record<string, CatOpt[]>; on: boolean; setOn: (v: boolean) => void }) {
  const [ws, setWs] = useState(c.target_workspace_id ?? targets[0]?.id ?? '');
  const [dir, setDir] = useState<'income' | 'expense'>(c.direction ?? 'expense');
  const cats = catsByWs[ws] ?? [];
  const [cat, setCat] = useState(c.category_id && cats.some(x => x.id === c.category_id) ? c.category_id : '');
  const top = cats.filter(x => x.kind === dir && !x.parent_id);
  const subs = cats.filter(x => x.parent_id && x.parent_id === cat);
  const incomplete = !c.occurred_on || !c.amount || !c.direction;
  const n = (k: string) => `${k}_${c.id}`;
  return (
    <li className={cn('flex flex-col gap-2 px-4 py-3', !on && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-3">
        <input type="checkbox" name={n('inc')} checked={on} onChange={e => setOn(e.target.checked)} aria-label="לייבא" className="size-4" />
        {incomplete ? (
          <div className="flex flex-wrap items-center gap-2">
            <input name={n('merchant')} defaultValue={c.merchant ?? ''} placeholder="בית עסק" aria-label="בית עסק" className={cn(compactInputClass, 'w-40')} />
            <DateField name={n('date')} defaultValue={c.occurred_on ?? undefined} compact />
            <input name={n('amt')} defaultValue={c.amount ?? ''} placeholder="סכום" inputMode="decimal" aria-label="סכום" className={cn(compactInputClass, 'w-24')} />
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium"><bdi>{c.merchant ?? c.description ?? '—'}</bdi>{c.first_time && <Badge tone="accent" className="ms-2">פעם ראשונה</Badge>}</p>
            <p className="text-xs text-muted">{c.occurred_on ? shortDate(c.occurred_on) : ''}{c.description && c.description !== c.merchant ? <> · <bdi>{c.description}</bdi></> : null}</p>
          </div>
        )}
        <span className={cn('ms-auto font-semibold tabular', dir === 'income' ? 'text-good-ink' : 'text-ink')}><bdi>{ils((dir === 'income' ? 1 : -1) * (c.amount ?? 0)) ?? ''}</bdi></span>
      </div>
      {on && (
        <div className="flex flex-wrap items-center gap-2 ps-7">
          <select name={n('ws')} value={ws} onChange={e => { setWs(e.target.value); setCat(''); }} aria-label="אזור" className={cn(compactInputClass, 'w-auto pe-8')}>
            {targets.map(w => <option key={w.id} value={w.id}>{wsLabel(w)}</option>)}
          </select>
          <select name={n('dir')} value={dir} onChange={e => { setDir(e.target.value as 'income' | 'expense'); setCat(''); }} aria-label="סוג" className={cn(compactInputClass, 'w-auto pe-8')}>
            <option value="expense">הוצאה</option><option value="income">הכנסה</option>
          </select>
          <select name={n('cat')} value={cat} onChange={e => setCat(e.target.value)} aria-label="קטגוריה" className={cn(compactInputClass, 'w-auto pe-8')}>
            <option value="">קטגוריה…</option>{top.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          {subs.length > 0 && (
            <select name={n('sub')} defaultValue={c.subcategory_id ?? ''} aria-label="תת-קטגוריה" className={cn(compactInputClass, 'w-auto pe-8')}>
              <option value="">תת-קטגוריה…</option>{subs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <select name={n('fv')} defaultValue={c.fixed_or_variable ?? ''} aria-label="קבועה או משתנה" className={cn(compactInputClass, 'w-auto pe-8')}>
            <option value="">קבועה/משתנה</option><option value="fixed">קבועה</option><option value="variable">משתנה</option>
          </select>
          <select name={n('freq')} defaultValue={c.frequency ?? ''} aria-label="תדירות" className={cn(compactInputClass, 'w-auto pe-8')}>
            <option value="">תדירות</option>{Object.entries(FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {!c.rule_id && c.merchant && (
            <label className="flex items-center gap-1.5 text-sm text-ink-2"><input type="checkbox" name={n('rem')} defaultChecked={false} className="size-4" />זכור את הבחירה</label>
          )}
        </div>
      )}
    </li>
  );
}

// ── Receipt review ────────────────────────────────────────────────────────────
export function ReceiptReview({ importId, cand, note, targets, catsByWs, matches, fileHref, today }: {
  importId: string; cand: Cand & { vat_amount: number | null; document_number: string | null }; note: string | null; targets: WsOpt[];
  catsByWs: Record<string, CatOpt[]>; matches: { id: string; workspace_id: string; occurred_on: string; amount: number; merchant: string | null; description: string | null; has_document: boolean }[];
  fileHref: string | null; today: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [state, run, pending] = useActionState<ImportResult | null, FormData>(saveReceipt, null);
  const [cancelling, startCancel] = useTransition();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  const [ws, setWs] = useState(cand.target_workspace_id ?? targets[0]?.id ?? '');
  const [match, setMatch] = useState('');
  const top = (catsByWs[ws] ?? []).filter(x => x.kind === 'expense' && !x.parent_id);
  return (
    <form action={run} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="import" value={importId} />
      <input type="hidden" name="candidate" value={cand.id} />
      {note && <p className="col-span-full rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-ink">{note}</p>}
      {fileHref && <Link href={fileHref} target="_blank" className={cn(buttonClass('ghost', 'sm'), 'col-span-full w-fit')}>פתח את הקובץ</Link>}
      <Field label="ספק" htmlFor={`${uid}-m`}><input id={`${uid}-m`} name="merchant" required maxLength={120} defaultValue={cand.merchant ?? ''} className={inputClass} /></Field>
      <Field label="תאריך" htmlFor={`${uid}-d`}><DateField id={`${uid}-d`} name="occurred_on" defaultValue={cand.occurred_on ?? today} required /></Field>
      <Field label="סה״כ (₪)" htmlFor={`${uid}-a`}><input id={`${uid}-a`} name="amount" required inputMode="decimal" defaultValue={cand.amount ?? ''} className={inputClass} /></Field>
      <Field label="מתוכו מע״מ (₪)" htmlFor={`${uid}-v`} hint="רק אם מופיע בקבלה"><input id={`${uid}-v`} name="vat_amount" inputMode="decimal" defaultValue={cand.vat_amount ?? ''} className={inputClass} /></Field>
      <Field label="מספר מסמך" htmlFor={`${uid}-n`}><input id={`${uid}-n`} name="document_number" maxLength={40} defaultValue={cand.document_number ?? ''} className={inputClass} /></Field>
      <Field label="שייך ל-" htmlFor={`${uid}-w`}>
        <select id={`${uid}-w`} name="ws" value={ws} onChange={e => setWs(e.target.value)} className={selectClass}>
          {targets.map(w => <option key={w.id} value={w.id}>{wsLabel(w)}</option>)}
        </select>
      </Field>
      <fieldset className="col-span-full flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink-2">התאמה לתנועה קיימת</legend>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="match" value="" checked={match === ''} onChange={() => setMatch('')} />שמור כהוצאה חדשה</label>
        {matches.map(m => (
          <label key={m.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name="match" value={m.id} checked={match === m.id} onChange={() => setMatch(m.id)} />
            <span><bdi>{m.merchant ?? m.description ?? 'תנועה'}</bdi> · {shortDate(m.occurred_on)} · <bdi className="tabular">{ils(m.amount)}</bdi>
              {' · '}{wsLabel(targets.find(t => t.id === m.workspace_id) ?? { id: '', name: '', kind: 'household' })}{m.has_document ? ' · כבר יש מסמך' : ''}</span>
          </label>
        ))}
        {!matches.length && <p className="text-xs text-muted">לא נמצאה תנועה עם אותו סכום בשבוע סביב התאריך.</p>}
      </fieldset>
      {match === '' && (
        <Field label="קטגוריה" htmlFor={`${uid}-c`}>
          <select id={`${uid}-c`} name="category_id" defaultValue="" key={ws} className={selectClass}>
            <option value="">ללא קטגוריה</option>{top.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
      )}
      <div className="col-span-full flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? 'שומר…' : match ? 'צרף לתנועה' : 'שמור'}</Button>
        <Button variant="ghost" disabled={cancelling} onClick={() => { if (confirm('לבטל? שום דבר לא יישמר.')) startCancel(async () => { const r = await cancelImport(importId); if (!r.ok) alert(r.error); else router.refresh(); }); }}>ביטול</Button>
        <Err s={state} />
      </div>
    </form>
  );
}

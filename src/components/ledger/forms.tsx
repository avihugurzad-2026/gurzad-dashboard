'use client';
import { submitWith } from '@/lib/submit';
import money from '@domain/money';
import { useActionState, useEffect, useId, useMemo, useState, useTransition } from 'react';
import { ArrowLeftRight, Pencil, Trash2 } from 'lucide-react';
import {
  copyBudget, deleteAccount, deleteCategory, deleteRecurring, deleteRule, deleteSavingsGoal, deleteTransaction, depositSavings,
  endContribution, cancelContributionPayment, executeContribution, moveTransaction, recordRecurring, saveAccount, saveBudget, saveCategory,
  saveContribution, saveRecurring, saveRule, saveSavingsGoal, saveTransaction, type LedgerResult,
} from '@/app/ledger-actions';
import { FormDialog } from '@/components/finance/dialog';
import { Button, buttonClass } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Field, inputClass, selectClass, textareaClass, numberInputClass } from '@/components/work/fields';
import { ils } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ACCOUNT_LABEL, FREQ_LABEL } from '@/lib/ledger-labels';

// Every create / edit / delete form of personal and household finance. Pages pass in the
// workspace's own categories and accounts; nothing here knows a person, an amount or a category.

export type CatOpt = { id: string; kind: 'income' | 'expense'; name: string; parent_id: string | null };
export type AccOpt = { id: string; name: string; kind: string; last4?: string | null };
export type WsOpt = { id: string; name: string; kind: 'personal' | 'household' };
type Action = (s: LedgerResult | null, f: FormData) => Promise<LedgerResult>;


function useSave(action: Action, onSaved?: () => void) {
  const [state, run, pending] = useActionState<LedgerResult | null, FormData>(action, null);
  useEffect(() => { if (state?.ok) onSaved?.(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return { state, run, pending };
}

function Footer({ state, pending, label }: { state: LedgerResult | null; pending: boolean; label: string }) {
  return (
    <div className="col-span-full flex flex-wrap items-center gap-3">
      <Button type="submit" variant="primary" disabled={pending}>{pending ? 'שומר…' : label}</Button>
      {state && !state.ok && <p role="alert" className="text-sm text-critical-ink">{state.error}</p>}
    </div>
  );
}

const Hidden = ({ v }: { v: Record<string, string | null | undefined> }) => (
  <>{Object.entries(v).map(([k, val]) => val ? <input key={k} type="hidden" name={k} value={val} /> : null)}</>
);

function CategorySelects({ cats, kind, id, category, subcategory }: {
  cats: CatOpt[]; kind: 'income' | 'expense'; id: (k: string) => string; category?: string | null; subcategory?: string | null;
}) {
  const [cat, setCat] = useState(category ?? '');
  const top = cats.filter(c => c.kind === kind && !c.parent_id);
  const subs = cats.filter(c => c.parent_id && c.parent_id === cat);
  return (
    <>
      <Field label="קטגוריה" htmlFor={id('cat')}>
        <select id={id('cat')} name="category_id" value={cat} onChange={e => setCat(e.target.value)} className={selectClass}>
          <option value="">ללא קטגוריה</option>
          {top.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="תת-קטגוריה" htmlFor={id('sub')}>
        <select id={id('sub')} name="subcategory_id" defaultValue={subcategory ?? ''} disabled={!subs.length} className={selectClass}>
          <option value="">{subs.length ? 'ללא' : 'אין תת-קטגוריות'}</option>
          {subs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
    </>
  );
}

function AccountSelect({ accounts, id, value, label = 'חשבון / כרטיס', name = 'account_id' }: { accounts: AccOpt[]; id: string; value?: string | null; label?: string; name?: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} name={name} defaultValue={value ?? ''} className={selectClass}>
        <option value="">{accounts.length ? 'לא משויך' : 'אין חשבונות עדיין'}</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ‎••${a.last4}` : ''}</option>)}
      </select>
    </Field>
  );
}

// ── Transaction ───────────────────────────────────────────────────────────────
export type TxValues = {
  id?: string; direction: 'income' | 'expense'; occurred_on: string; amount?: number; currency?: string; merchant?: string | null; description?: string | null;
  category_id?: string | null; subcategory_id?: string | null; account_id?: string | null; fixed_or_variable?: string | null; frequency?: string | null; notes?: string | null;
};

export function TxForm({ ws, cats, accounts, initial, onSaved, today }: {
  ws: string; cats: CatOpt[]; accounts: AccOpt[]; initial?: TxValues; onSaved?: () => void; today: string;
}) {
  const { state, run, pending } = useSave(saveTransaction, onSaved);
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [direction, setDirection] = useState<'income' | 'expense'>(initial?.direction ?? 'expense');
  return (
    <form onSubmit={submitWith(run)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={{ ws, id: initial?.id, direction, currency: initial?.currency ?? 'ILS' }} />{/* an edit keeps the row's currency */}
      <div role="group" aria-label="סוג" className="col-span-full inline-flex w-fit rounded-lg border border-line-strong bg-surface p-0.5 text-sm">
        {(['expense', 'income'] as const).map(k => (
          <button key={k} type="button" onClick={() => setDirection(k)} aria-pressed={direction === k}
            className={cn('h-8 rounded-md px-4 font-medium', direction === k ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2')}>
            {k === 'expense' ? 'הוצאה' : 'הכנסה'}
          </button>
        ))}
      </div>
      <Field label={`סכום (${!initial?.currency || initial.currency === 'ILS' ? '₪' : initial.currency})`} htmlFor={id('amount')}>
        <input id={id('amount')} name="amount" inputMode="decimal" dir="ltr" required defaultValue={initial?.amount ?? ''} className={numberInputClass} placeholder="0.00" />
      </Field>
      <Field label="תאריך" htmlFor={id('date')}>
        <DateField id={id('date')} name="occurred_on" defaultValue={initial?.occurred_on ?? today} required />
      </Field>
      <Field label={direction === 'income' ? 'ממי / מקור' : 'בית עסק'} htmlFor={id('merchant')}>
        <input id={id('merchant')} name="merchant" defaultValue={initial?.merchant ?? ''} maxLength={120} className={inputClass} />
      </Field>
      <Field label="תיאור" htmlFor={id('desc')}>
        <input id={id('desc')} name="description" defaultValue={initial?.description ?? ''} maxLength={500} className={inputClass} />
      </Field>
      <CategorySelects key={direction} cats={cats} kind={direction} id={id} category={initial?.direction === direction ? initial?.category_id : null}
        subcategory={initial?.direction === direction ? initial?.subcategory_id : null} />
      <AccountSelect accounts={accounts} id={id('acc')} value={initial?.account_id} />
      {direction === 'expense' ? (
        <Field label="קבועה או משתנה" htmlFor={id('fv')}>
          <select id={id('fv')} name="fixed_or_variable" defaultValue={initial?.fixed_or_variable ?? ''} className={selectClass}>
            <option value="">לא צוין</option><option value="fixed">קבועה</option><option value="variable">משתנה</option>
          </select>
        </Field>
      ) : <div className="hidden sm:block" />}
      <Field label="תדירות" htmlFor={id('freq')}>
        <select id={id('freq')} name="frequency" defaultValue={initial?.frequency ?? ''} className={selectClass}>
          <option value="">לא צוין</option>
          {Object.entries(FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="הערות" htmlFor={id('notes')} className="col-span-full">
        <textarea id={id('notes')} name="notes" defaultValue={initial?.notes ?? ''} maxLength={1000} className={textareaClass} />
      </Field>
      <label className="col-span-full flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="remember" /> זכור את הבחירה לבית העסק הזה (כלל סיווג אוטומטי)
      </label>
      <Footer state={state} pending={pending} label={initial?.id ? 'שמירה' : direction === 'income' ? 'הוסף הכנסה' : 'הוסף הוצאה'} />
    </form>
  );
}

export function TxDialog({ trigger, title, triggerClass, ...p }: Parameters<typeof TxForm>[0] & { trigger: React.ReactNode; title: string; triggerClass?: string }) {
  return <FormDialog trigger={trigger} title={title} triggerClass={triggerClass}>{close => <TxForm {...p} onSaved={close} />}</FormDialog>;
}

// Edit / move / delete on a transaction row
export function TxRowActions({ tx, ws, cats, accounts, today, moveTo, locked }: {
  tx: TxValues & { id: string }; ws: string; cats: CatOpt[]; accounts: AccOpt[]; today: string; moveTo: WsOpt[]; locked: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center justify-end gap-0.5">
      {!locked && (
        <TxDialog trigger={<Pencil aria-hidden />} title="עריכת תנועה" triggerClass={buttonClass('ghost', 'icon', 'size-8 text-muted')}
          ws={ws} cats={cats} accounts={accounts} initial={tx} today={today} />
      )}
      {!locked && moveTo.length > 0 && (
        <FormDialog trigger={<ArrowLeftRight aria-hidden />} title="העברה לאזור אחר" wide={false} triggerClass={buttonClass('ghost', 'icon', 'size-8 text-muted')}>
          {close => (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">התנועה תעבור כמו שהיא. החשבון והתת-קטגוריה מתאפסים כי הם שייכים לאזור.</p>
              {moveTo.map(w => (
                <Button key={w.id} disabled={pending} onClick={() => start(async () => {
                  const r = await moveTransaction(tx.id, ws, w.id);
                  if (!r.ok) alert(r.error); else close();
                })}>{w.kind === 'personal' ? 'לאזור האישי' : <bdi>{w.name}</bdi>}</Button>
              ))}
            </div>
          )}
        </FormDialog>
      )}
      <DeleteButton label={locked ? 'ביטול ההעברה (בשני הצדדים)' : 'מחיקת התנועה'} run={() => deleteTransaction(tx.id, ws)} pending={pending} start={start} />
    </div>
  );
}

function DeleteButton({ label, run, pending, start }: { label: string; run: () => Promise<LedgerResult>; pending?: boolean; start?: React.TransitionStartFunction }) {
  const [own, startOwn] = useTransition();
  const go = start ?? startOwn;
  return (
    <button type="button" disabled={pending || own} aria-label={label} title={label}
      onClick={() => { if (confirm(`${label}?`)) go(async () => { const r = await run(); if (!r.ok) alert(r.error); }); }}
      className={buttonClass('ghost', 'icon', 'size-8 text-muted hover:text-critical-ink')}>
      <Trash2 aria-hidden />
    </button>
  );
}
export function Remove({ label, kind, id, ws }: { label: string; kind: 'account' | 'recurring' | 'savings' | 'category' | 'rule'; id: string; ws: string }) {
  const run = () => kind === 'account' ? deleteAccount(id, ws) : kind === 'recurring' ? deleteRecurring(id, ws) : kind === 'savings' ? deleteSavingsGoal(id, ws)
    : kind === 'category' ? deleteCategory(id, ws) : deleteRule(id);
  return <DeleteButton label={label} run={run} />;
}

// ── Account / credit card ─────────────────────────────────────────────────────
export type AccountValues = {
  id?: string; kind: string; name?: string; institution?: string | null; last4?: string | null; currency?: string; opening_balance?: number | null;
  balance?: number | null; balance_as_of?: string | null; credit_limit?: number | null; billing_day?: number | null; notes?: string | null;
};
export function AccountForm({ ws, initial, onSaved }: { ws: string; initial: AccountValues; onSaved?: () => void }) {
  const { state, run, pending } = useSave(saveAccount, onSaved);
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [kind, setKind] = useState(initial.kind);
  const card = kind === 'credit_card';
  return (
    <form onSubmit={submitWith(run)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={{ ws, id: initial.id }} />
      <Field label="סוג" htmlFor={id('kind')}>
        <select id={id('kind')} name="kind" value={kind} onChange={e => setKind(e.target.value)} className={selectClass}>
          {Object.entries(ACCOUNT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="שם" htmlFor={id('name')} hint={card ? 'למשל: הכרטיס הראשי' : undefined}>
        <input id={id('name')} name="name" required maxLength={80} defaultValue={initial.name ?? ''} className={inputClass} />
      </Field>
      <Field label={card ? 'חברת אשראי / בנק' : 'בנק / גוף'} htmlFor={id('inst')}>
        <input id={id('inst')} name="institution" maxLength={80} defaultValue={initial.institution ?? ''} className={inputClass} />
      </Field>
      <Field label="4 ספרות אחרונות" htmlFor={id('last4')} hint="רק 4 ספרות. לעולם לא את המספר המלא.">
        <input id={id('last4')} name="last4" inputMode="numeric" pattern="\d{4}" maxLength={4} defaultValue={initial.last4 ?? ''} className={inputClass} dir="ltr" />
      </Field>
      <Field label={card ? 'יתרת חיוב נוכחית (₪)' : 'יתרה נוכחית (₪)'} htmlFor={id('bal')} hint="אפשר מינוס">
        <input id={id('bal')} name="balance" inputMode="text" dir="ltr" defaultValue={initial.balance ?? ''} className={numberInputClass} />
      </Field>
      <Field label="נכון לתאריך" htmlFor={id('asof')}>
        <DateField id={id('asof')} name="balance_as_of" defaultValue={initial.balance_as_of ?? undefined} />
      </Field>
      {card && (
        <>
          <Field label="מסגרת (₪)" htmlFor={id('limit')}>
            <input id={id('limit')} name="credit_limit" inputMode="decimal" dir="ltr" defaultValue={initial.credit_limit ?? ''} className={numberInputClass} />
          </Field>
          <Field label="יום חיוב בחודש" htmlFor={id('day')}>
            <input id={id('day')} name="billing_day" type="number" min={1} max={31} defaultValue={initial.billing_day ?? ''} className={inputClass} />
          </Field>
        </>
      )}
      <input type="hidden" name="currency" value={initial.currency ?? 'ILS'} />
      <Field label="הערות" htmlFor={id('notes')} className="col-span-full">
        <textarea id={id('notes')} name="notes" maxLength={1000} defaultValue={initial.notes ?? ''} className={textareaClass} />
      </Field>
      <Footer state={state} pending={pending} label={initial.id ? 'שמירה' : card ? 'הוסף כרטיס' : 'הוסף חשבון'} />
    </form>
  );
}
export function AccountDialog({ trigger, title, triggerClass, ws, initial }: { trigger: React.ReactNode; title: string; triggerClass?: string; ws: string; initial: AccountValues }) {
  return <FormDialog trigger={trigger} title={title} triggerClass={triggerClass}>{close => <AccountForm ws={ws} initial={initial} onSaved={close} />}</FormDialog>;
}

// ── Recurring expense ─────────────────────────────────────────────────────────
export type RecurringValues = {
  id?: string; name?: string; merchant?: string | null; amount?: number; category_id?: string | null; account_id?: string | null; frequency?: string;
  interval_months?: number | null; day_of_month?: number | null; start_date?: string | null; end_date?: string | null; status?: string; notes?: string | null;
};
export function RecurringForm({ ws, cats, accounts, initial, onSaved, today }: {
  ws: string; cats: CatOpt[]; accounts: AccOpt[]; initial?: RecurringValues; onSaved?: () => void; today: string;
}) {
  const { state, run, pending } = useSave(saveRecurring, onSaved);
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [freq, setFreq] = useState(initial?.frequency ?? 'monthly');
  const top = cats.filter(c => c.kind === 'expense' && !c.parent_id);
  return (
    <form onSubmit={submitWith(run)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={{ ws, id: initial?.id }} />
      <Field label="שם" htmlFor={id('name')} hint="למשל: שכירות, ביטוח רכב, מנוי">
        <input id={id('name')} name="name" required maxLength={80} defaultValue={initial?.name ?? ''} className={inputClass} />
      </Field>
      <Field label="סכום (₪)" htmlFor={id('amount')}>
        <input id={id('amount')} name="amount" inputMode="decimal" dir="ltr" required defaultValue={initial?.amount ?? ''} className={numberInputClass} />
      </Field>
      <Field label="תדירות" htmlFor={id('freq')}>
        <select id={id('freq')} name="frequency" value={freq} onChange={e => setFreq(e.target.value)} className={selectClass}>
          <option value="monthly">חודשי</option><option value="yearly">שנתי</option><option value="custom">כל X חודשים</option><option value="one_time">חד-פעמי</option>
        </select>
      </Field>
      {freq === 'custom' ? (
        <Field label="כל כמה חודשים" htmlFor={id('int')}>
          <input id={id('int')} name="interval_months" type="number" min={1} max={60} required defaultValue={initial?.interval_months ?? ''} className={inputClass} />
          {/* the day isn't asked here; keep the stored one rather than resetting it to the start date's day */}
          {initial?.day_of_month ? <input type="hidden" name="day_of_month" value={initial.day_of_month} /> : null}
        </Field>
      ) : (
        <Field label="יום בחודש" htmlFor={id('day')}>
          <input id={id('day')} name="day_of_month" type="number" min={1} max={31} defaultValue={initial?.day_of_month ?? ''} className={inputClass} />
        </Field>
      )}
      <Field label={freq === 'one_time' ? 'תאריך' : 'מתחיל ב-'} htmlFor={id('start')}>
        <DateField id={id('start')} name="start_date" defaultValue={initial?.start_date ?? today} />
      </Field>
      {freq !== 'one_time' && (
        <Field label="מסתיים ב- (לא חובה)" htmlFor={id('end')}>
          <DateField id={id('end')} name="end_date" defaultValue={initial?.end_date ?? undefined} />
        </Field>
      )}
      <Field label="קטגוריה" htmlFor={id('cat')}>
        <select id={id('cat')} name="category_id" defaultValue={initial?.category_id ?? ''} className={selectClass}>
          <option value="">ללא קטגוריה</option>
          {top.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <AccountSelect accounts={accounts} id={id('acc')} value={initial?.account_id} label="מחויב מ-" />
      <Field label="בית עסק (לזיהוי בייבוא)" htmlFor={id('merchant')}>
        <input id={id('merchant')} name="merchant" maxLength={120} defaultValue={initial?.merchant ?? ''} className={inputClass} />
      </Field>
      {initial?.id && (
        <Field label="סטטוס" htmlFor={id('status')}>
          <select id={id('status')} name="status" defaultValue={initial.status ?? 'active'} className={selectClass}>
            <option value="active">פעיל</option><option value="paused">מושהה</option><option value="ended">הסתיים</option>
          </select>
        </Field>
      )}
      <Field label="הערות" htmlFor={id('notes')} className="col-span-full">
        <textarea id={id('notes')} name="notes" maxLength={1000} defaultValue={initial?.notes ?? ''} className={textareaClass} />
      </Field>
      <Footer state={state} pending={pending} label={initial?.id ? 'שמירה' : 'הוסף הוצאה קבועה'} />
    </form>
  );
}
export function RecurringDialog({ trigger, title, triggerClass, ...p }: Parameters<typeof RecurringForm>[0] & { trigger: React.ReactNode; title: string; triggerClass?: string }) {
  return <FormDialog trigger={trigger} title={title} triggerClass={triggerClass}>{close => <RecurringForm {...p} onSaved={close} />}</FormDialog>;
}

export function RecordPaymentDialog({ ws, id: rid, amount, due, today, name }: { ws: string; id: string; amount: number; due: string | null; today: string; name: string }) {
  return (
    <FormDialog trigger="שולם" title={`תשלום: ${name}`} wide={false} triggerClass={buttonClass('secondary', 'sm')}>
      {close => <RecordPaymentForm ws={ws} id={rid} amount={amount} date={due && due < today ? due : today} onSaved={close} />}
    </FormDialog>
  );
}
function RecordPaymentForm({ ws, id: rid, amount, date, onSaved }: { ws: string; id: string; amount: number; date: string; onSaved: () => void }) {
  const { state, run, pending } = useSave(recordRecurring, onSaved);
  const uid = useId();
  return (
    <form onSubmit={submitWith(run)} className="grid grid-cols-1 gap-4">
      <Hidden v={{ ws, id: rid }} />
      <p className="text-sm text-muted">נרשמת הוצאה קבועה בתנועות, והמועד הבא מתעדכן.</p>
      <Field label="סכום (₪)" htmlFor={`${uid}-a`}><input id={`${uid}-a`} name="amount" inputMode="decimal" dir="ltr" defaultValue={amount} className={numberInputClass} /></Field>
      <Field label="תאריך" htmlFor={`${uid}-d`}><DateField id={`${uid}-d`} name="occurred_on" defaultValue={date} /></Field>
      <Footer state={state} pending={pending} label="רשום תשלום" />
    </form>
  );
}

// ── Savings goal ──────────────────────────────────────────────────────────────
export type SavingsValues = {
  id?: string; name?: string; target_amount?: number; current_amount?: number; deadline?: string | null; monthly_contribution?: number | null;
  account_id?: string | null; status?: string; notes?: string | null;
};
export function SavingsForm({ ws, accounts, initial, onSaved }: { ws: string; accounts: AccOpt[]; initial?: SavingsValues; onSaved?: () => void }) {
  const { state, run, pending } = useSave(saveSavingsGoal, onSaved);
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  return (
    <form onSubmit={submitWith(run)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={{ ws, id: initial?.id }} />
      <Field label="שם היעד" htmlFor={id('name')} hint="למשל: קרן חירום, חופשה, רכב">
        <input id={id('name')} name="name" required maxLength={80} defaultValue={initial?.name ?? ''} className={inputClass} />
      </Field>
      <Field label="סכום יעד (₪)" htmlFor={id('target')}>
        <input id={id('target')} name="target_amount" inputMode="decimal" dir="ltr" required defaultValue={initial?.target_amount ?? ''} className={numberInputClass} />
      </Field>
      <Field label="כבר נחסך (₪)" htmlFor={id('cur')}>
        <input id={id('cur')} name="current_amount" inputMode="decimal" dir="ltr" defaultValue={initial?.current_amount ?? ''} placeholder="0" className={numberInputClass} />
      </Field>
      <Field label="הפקדה חודשית מתוכננת (₪)" htmlFor={id('monthly')}>
        <input id={id('monthly')} name="monthly_contribution" inputMode="decimal" dir="ltr" defaultValue={initial?.monthly_contribution ?? ''} className={numberInputClass} />
      </Field>
      <Field label="עד תאריך (לא חובה)" htmlFor={id('deadline')}>
        <DateField id={id('deadline')} name="deadline" defaultValue={initial?.deadline ?? undefined} />
      </Field>
      <AccountSelect accounts={accounts} id={id('acc')} value={initial?.account_id} label="חשבון החיסכון" />
      {initial?.id && (
        <Field label="סטטוס" htmlFor={id('status')}>
          <select id={id('status')} name="status" defaultValue={initial.status ?? 'active'} className={selectClass}>
            <option value="active">פעיל</option><option value="reached">הושג</option><option value="paused">מושהה</option><option value="dropped">בוטל</option>
          </select>
        </Field>
      )}
      <Field label="הערות" htmlFor={id('notes')} className="col-span-full">
        <textarea id={id('notes')} name="notes" maxLength={1000} defaultValue={initial?.notes ?? ''} className={textareaClass} />
      </Field>
      <Footer state={state} pending={pending} label={initial?.id ? 'שמירה' : 'הוסף יעד'} />
    </form>
  );
}
export function SavingsDialog({ trigger, title, triggerClass, ...p }: Parameters<typeof SavingsForm>[0] & { trigger: React.ReactNode; title: string; triggerClass?: string }) {
  return <FormDialog trigger={trigger} title={title} triggerClass={triggerClass}>{close => <SavingsForm {...p} onSaved={close} />}</FormDialog>;
}
export function DepositDialog({ ws, id: gid, name }: { ws: string; id: string; name: string }) {
  return (
    <FormDialog trigger="הפקדה" title={`הפקדה ל${name}`} wide={false} triggerClass={buttonClass('secondary', 'sm')}>
      {close => <DepositForm ws={ws} id={gid} onSaved={close} />}
    </FormDialog>
  );
}
function DepositForm({ ws, id: gid, onSaved }: { ws: string; id: string; onSaved: () => void }) {
  const { state, run, pending } = useSave(depositSavings, onSaved);
  const uid = useId();
  return (
    <form onSubmit={submitWith(run)} className="grid gap-4">
      <Hidden v={{ ws, id: gid }} />
      <Field label="סכום (₪)" htmlFor={`${uid}-a`} hint="מספר שלילי = משיכה"><input id={`${uid}-a`} name="amount" inputMode="text" dir="ltr" required className={numberInputClass} /></Field>
      <Footer state={state} pending={pending} label="עדכן" />
    </form>
  );
}

// ── Budget ────────────────────────────────────────────────────────────────────
export function BudgetForm({ ws, month, cats, lines, notes, onSaved }: {
  ws: string; month: string; cats: CatOpt[]; lines: Record<string, number>; notes?: string | null; onSaved?: () => void;
}) {
  const { state, run, pending } = useSave(saveBudget, onSaved);
  const uid = useId();
  const top = cats.filter(c => c.kind === 'expense' && !c.parent_id);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(top.map(c => [c.id, lines[c.id] !== undefined ? String(lines[c.id]) : ''])));
  const total = Object.values(vals).reduce((a, v) => { const n = money.parseNumber(v); return a + (n !== null && Number.isFinite(n) ? n : 0); }, 0);
  return (
    <form onSubmit={submitWith(run)} className="flex flex-col gap-4">
      <Hidden v={{ ws, month }} />
      {!top.length && <p className="text-sm text-muted">אין עדיין קטגוריות הוצאה. הוסף קטגוריה בלשונית כללי סיווג.</p>}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {top.map(c => (
          <label key={c.id} htmlFor={`${uid}-${c.id}`} className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink-2"><bdi>{c.name}</bdi></span>
            <input id={`${uid}-${c.id}`} name={`b_${c.id}`} inputMode="decimal" dir="ltr" value={vals[c.id] ?? ''} placeholder="ללא"
              onChange={e => setVals(v => ({ ...v, [c.id]: e.target.value }))} className={cn(inputClass, 'w-36 text-end tabular')} />
          </label>
        ))}
      </div>
      <p className="text-sm text-ink-2">סה״כ מתוכנן: <span className="font-semibold tabular">{ils(total) ?? '—'}</span></p>
      <Field label="הערות" htmlFor={`${uid}-n`}><textarea id={`${uid}-n`} name="notes" defaultValue={notes ?? ''} maxLength={1000} className={textareaClass} /></Field>
      <Footer state={state} pending={pending} label="שמור תקציב" />
    </form>
  );
}
export function BudgetDialog({ trigger, title, triggerClass, ...p }: Parameters<typeof BudgetForm>[0] & { trigger: React.ReactNode; title: string; triggerClass?: string }) {
  return <FormDialog trigger={trigger} title={title} triggerClass={triggerClass}>{close => <BudgetForm {...p} onSaved={close} />}</FormDialog>;
}
export function CopyBudgetButton({ ws, from, to, label }: { ws: string; from: string; to: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button disabled={pending} onClick={() => start(async () => { const r = await copyBudget(ws, from, to); if (!r.ok) alert(r.error); })}>{label}</Button>
  );
}

// ── Categories ────────────────────────────────────────────────────────────────
export function CategoryForm({ ws, cats, initial, onSaved }: {
  ws: string; cats: CatOpt[]; initial?: { id?: string; name?: string; kind?: 'income' | 'expense'; parent_id?: string | null }; onSaved?: () => void;
}) {
  const { state, run, pending } = useSave(saveCategory, onSaved);
  const uid = useId();
  const [kind, setKind] = useState<'income' | 'expense'>(initial?.kind ?? 'expense');
  const parents = cats.filter(c => c.kind === kind && !c.parent_id && c.id !== initial?.id);
  return (
    <form onSubmit={submitWith(run)} className="grid grid-cols-1 gap-4">
      <Hidden v={{ ws, id: initial?.id }} />
      <Field label="שם" htmlFor={`${uid}-n`}><input id={`${uid}-n`} name="name" required maxLength={60} defaultValue={initial?.name ?? ''} className={inputClass} /></Field>
      <Field label="סוג" htmlFor={`${uid}-k`}>
        <select id={`${uid}-k`} name="kind" value={kind} onChange={e => setKind(e.target.value as 'income' | 'expense')} className={selectClass} disabled={!!initial?.id}>
          <option value="expense">הוצאה</option><option value="income">הכנסה</option>
        </select>
      </Field>
      {initial?.id && <input type="hidden" name="kind" value={kind} />}
      <Field label="תחת קטגוריה (לא חובה)" htmlFor={`${uid}-p`}>
        <select id={`${uid}-p`} name="parent_id" defaultValue={initial?.parent_id ?? ''} className={selectClass}>
          <option value="">קטגוריה ראשית</option>
          {parents.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Footer state={state} pending={pending} label={initial?.id ? 'שמירה' : 'הוסף קטגוריה'} />
    </form>
  );
}
export function CategoryDialog({ trigger, title, triggerClass, ...p }: Parameters<typeof CategoryForm>[0] & { trigger: React.ReactNode; title: string; triggerClass?: string }) {
  return <FormDialog trigger={trigger} title={title} triggerClass={triggerClass} wide={false}>{close => <CategoryForm {...p} onSaved={close} />}</FormDialog>;
}

// ── Categorization rule ───────────────────────────────────────────────────────
export type RuleValues = {
  id?: string; pattern?: string; match_field?: string; match_type?: string; target_workspace_id?: string; category_id?: string | null;
  subcategory_id?: string | null; fixed_or_variable?: string | null; frequency?: string | null; priority?: number; active?: boolean;
};
export function RuleForm({ targets, catsByWs, initial, onSaved }: {
  targets: WsOpt[]; catsByWs: Record<string, CatOpt[]>; initial?: RuleValues; onSaved?: () => void;
}) {
  const { state, run, pending } = useSave(saveRule, onSaved);
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [target, setTarget] = useState(initial?.target_workspace_id ?? targets[0]?.id ?? '');
  const cats = catsByWs[target] ?? [];
  const [kind, setKind] = useState<'income' | 'expense'>(() => (cats.find(c => c.id === initial?.category_id)?.kind ?? 'expense'));
  return (
    <form onSubmit={submitWith(run)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={{ id: initial?.id }} />
      <Field label="כשבית העסק / התיאור" htmlFor={id('mt')}>
        <div className="flex gap-2">
          <select name="match_field" defaultValue={initial?.match_field ?? 'merchant'} className={selectClass} aria-label="שדה">
            <option value="merchant">בית העסק</option><option value="description">התיאור</option>
          </select>
          <select id={id('mt')} name="match_type" defaultValue={initial?.match_type ?? 'contains'} className={selectClass}>
            <option value="contains">מכיל</option><option value="starts_with">מתחיל ב-</option><option value="equals">שווה ל-</option>
          </select>
        </div>
      </Field>
      <Field label="את הטקסט" htmlFor={id('p')}>
        <input id={id('p')} name="pattern" required minLength={2} maxLength={120} defaultValue={initial?.pattern ?? ''} className={inputClass} />
      </Field>
      <Field label="שייך ל-" htmlFor={id('ws')}>
        <select id={id('ws')} name="target_workspace_id" value={target} onChange={e => setTarget(e.target.value)} className={selectClass}>
          {targets.map(w => <option key={w.id} value={w.id}>{w.kind === 'personal' ? 'אישי' : w.name}</option>)}
        </select>
      </Field>
      <Field label="סוג" htmlFor={id('k')}>
        <select id={id('k')} value={kind} onChange={e => setKind(e.target.value as 'income' | 'expense')} className={selectClass}>
          <option value="expense">הוצאה</option><option value="income">הכנסה</option>
        </select>
      </Field>
      <CategorySelects key={`${target}-${kind}`} cats={cats} kind={kind} id={id} category={initial?.category_id} subcategory={initial?.subcategory_id} />
      <Field label="קבועה או משתנה" htmlFor={id('fv')}>
        <select id={id('fv')} name="fixed_or_variable" defaultValue={initial?.fixed_or_variable ?? ''} className={selectClass}>
          <option value="">לא צוין</option><option value="fixed">קבועה</option><option value="variable">משתנה</option>
        </select>
      </Field>
      <Field label="תדירות" htmlFor={id('f')}>
        <select id={id('f')} name="frequency" defaultValue={initial?.frequency ?? ''} className={selectClass}>
          <option value="">לא צוין</option>
          {Object.entries(FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="עדיפות" htmlFor={id('pr')} hint="מספר נמוך גובר">
        <input id={id('pr')} name="priority" type="number" min={1} max={1000} defaultValue={initial?.priority ?? 100} className={inputClass} />
      </Field>
      {initial?.id && (
        <label className="flex items-center gap-2 self-end text-sm text-ink-2"><input type="checkbox" name="inactive" defaultChecked={initial.active === false} /> מושבת</label>
      )}
      <Footer state={state} pending={pending} label={initial?.id ? 'שמירה' : 'הוסף כלל'} />
    </form>
  );
}
export function RuleDialog({ trigger, title, triggerClass, ...p }: Parameters<typeof RuleForm>[0] & { trigger: React.ReactNode; title: string; triggerClass?: string }) {
  return <FormDialog trigger={trigger} title={title} triggerClass={triggerClass}>{close => <RuleForm {...p} onSaved={close} />}</FormDialog>;
}

// ── Contribution to a household ───────────────────────────────────────────────
export type ContributionValues = {
  id?: string; household?: string; rule?: string; amount?: number | null; percentage?: number | null; frequency?: string; day_of_month?: number;
  start_date?: string; end_date?: string | null; status?: string; auto_or_manual?: string; source_account_id?: string | null;
};
export function ContributionForm({ households, accounts, initial, onSaved, today }: {
  households: WsOpt[]; accounts: AccOpt[]; initial?: ContributionValues; onSaved?: () => void; today: string;
}) {
  const { state, run, pending } = useSave(saveContribution, onSaved);
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [rule, setRule] = useState(initial?.rule ?? 'fixed');
  return (
    <form onSubmit={submitWith(run)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={{ id: initial?.id }} />
      <Field label="למשק הבית" htmlFor={id('hh')}>
        <select id={id('hh')} name="household" defaultValue={initial?.household ?? households[0]?.id} className={selectClass} disabled={!!initial?.id}>
          {households.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </Field>
      {initial?.id && <input type="hidden" name="household" value={initial.household} />}
      <Field label="איך נקבע הסכום" htmlFor={id('rule')}>
        <select id={id('rule')} name="rule" value={rule} onChange={e => setRule(e.target.value)} className={selectClass}>
          <option value="fixed">סכום קבוע</option><option value="percentage">אחוז מההכנסה שלי</option><option value="manual">ידני, כל פעם</option>
        </select>
      </Field>
      {rule === 'percentage' ? (
        <Field label="אחוז" htmlFor={id('pct')} hint="פרטי: משק הבית רואה רק את הסכום שהועבר">
          <input id={id('pct')} name="percentage" inputMode="decimal" dir="ltr" required defaultValue={initial?.percentage ?? ''} className={numberInputClass} />
        </Field>
      ) : (
        <Field label={rule === 'fixed' ? 'סכום חודשי (₪)' : 'סכום משוער (₪, לא חובה)'} htmlFor={id('amt')}>
          <input id={id('amt')} name="amount" inputMode="decimal" dir="ltr" required={rule === 'fixed'} defaultValue={initial?.amount ?? ''} className={numberInputClass} />
        </Field>
      )}
      <Field label="יום ההעברה בחודש" htmlFor={id('day')}>
        <input id={id('day')} name="day_of_month" type="number" min={1} max={28} defaultValue={initial?.day_of_month ?? 1} className={inputClass} />
      </Field>
      <Field label="תדירות" htmlFor={id('freq')}>
        <select id={id('freq')} name="frequency" defaultValue={initial?.frequency ?? 'monthly'} className={selectClass}>
          <option value="monthly">כל חודש</option><option value="one_time">פעם אחת</option>
          {initial?.frequency === 'custom' && <option value="custom">מותאם</option>}
        </select>
      </Field>
      <Field label="החל מ-" htmlFor={id('start')}><DateField id={id('start')} name="start_date" defaultValue={initial?.start_date ?? today} /></Field>
      <Field label="עד (לא חובה)" htmlFor={id('end')}><DateField id={id('end')} name="end_date" defaultValue={initial?.end_date ?? undefined} /></Field>
      <AccountSelect accounts={accounts} id={id('src')} name="source_account_id" value={initial?.source_account_id} label="מאיזה חשבון (פרטי)" />
      {initial?.id && (
        <Field label="סטטוס" htmlFor={id('status')}>
          <select id={id('status')} name="status" defaultValue={initial.status ?? 'active'} className={selectClass}>
            <option value="active">פעיל</option><option value="paused">מושהה</option>
            {initial.status === 'ended' && <option value="ended">הסתיים</option>}
          </select>
        </Field>
      )}
      <Footer state={state} pending={pending} label={initial?.id ? 'שמירה' : 'הגדר העברה'} />
    </form>
  );
}
export function ContributionDialog({ trigger, title, triggerClass, ...p }: Parameters<typeof ContributionForm>[0] & { trigger: React.ReactNode; title: string; triggerClass?: string }) {
  return <FormDialog trigger={trigger} title={title} triggerClass={triggerClass}>{close => <ContributionForm {...p} onSaved={close} />}</FormDialog>;
}

export function ExecuteContributionDialog({ id: cid, household, suggested, today, rule, triggerClass }: {
  id: string; household: string; suggested: number | null; today: string; rule: string; triggerClass?: string;
}) {
  return (
    <FormDialog trigger="בצע העברה" title={`העברה ל${household}`} wide={false} triggerClass={triggerClass ?? buttonClass('primary', 'sm')}>
      {close => <ExecuteForm id={cid} suggested={suggested} today={today} rule={rule} onSaved={close} />}
    </FormDialog>
  );
}
function ExecuteForm({ id: cid, suggested, today, rule, onSaved }: { id: string; suggested: number | null; today: string; rule: string; onSaved: () => void }) {
  const { state, run, pending } = useSave(executeContribution, onSaved);
  const uid = useId();
  return (
    <form onSubmit={submitWith(run)} className="grid gap-4">
      <Hidden v={{ id: cid }} />
      <p className="text-sm text-muted">נרשמת העברה יוצאת באזור האישי והכנסה במשק הבית, מקושרות. הכסף לא נספר פעמיים.</p>
      <Field label="סכום (₪)" htmlFor={`${uid}-a`} hint={rule === 'percentage' && !suggested ? 'ריק = מחושב מההכנסות שלך החודש' : undefined}>
        <input id={`${uid}-a`} name="amount" inputMode="decimal" dir="ltr" defaultValue={suggested ?? ''} required={rule !== 'percentage'} className={numberInputClass} />
      </Field>
      <Field label="תאריך" htmlFor={`${uid}-d`}><DateField id={`${uid}-d`} name="paid_on" defaultValue={today} /></Field>
      <Footer state={state} pending={pending} label="רשום העברה" />
    </form>
  );
}

export function EndContributionButton({ id: cid }: { id: string }) {
  return <DeleteButton label="הפסקת ההעברה" run={() => endContribution(cid)} />;
}
export function CancelPaymentButton({ id: pid }: { id: string }) {
  return <DeleteButton label="ביטול ההעברה הזו (בשני הצדדים)" run={() => cancelContributionPayment(pid)} />;
}

export function useMemoCats(cats: CatOpt[]) {
  return useMemo(() => new Map(cats.map(c => [c.id, c])), [cats]);
}

'use client';
import { useActionState, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, HandCoins, Pencil, Plus, UserPlus } from 'lucide-react';
import {
  addCase, addContact, addDeadline, addInvestment, addLoan, addProperty, addSubjectTask, addSubjectTransaction,
  recordRepayment, updateCase, updateInvestment, updatePropertyValue, type VenturesResult,
} from '@/app/ventures-actions';
import { Button, buttonClass } from '@/components/ui/button';
import { Field, inputClass, selectClass, textareaClass } from '@/components/work/fields';
import { DateField } from '@/components/ui/date-field';
import { FormDialog } from '@/components/finance/dialog';
import { CLASSIFICATIONS, PAYMENT_METHODS, categoriesOf, type Direction } from '@/lib/finance';
import { PRIORITIES } from '@/lib/places';
import { ils } from '@/lib/format';
import ventures from '@domain/ventures';

type Act = (prev: VenturesResult | null, f: FormData) => Promise<VenturesResult>;
type Opts = { id?: string; className?: string };

const Err = ({ s }: { s: VenturesResult | null }) =>
  s && !s.ok ? <p role="alert" className="col-span-full text-sm text-critical-ink">{s.error}</p> : null;

// A form bound to a server action; calls onSaved(id) after a successful save
function useForm(action: Act, onSaved?: (id?: string) => void) {
  const [state, act, pending] = useActionState<VenturesResult | null, FormData>(action, null);
  useEffect(() => { if (state?.ok) onSaved?.(state.id); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return { state, act, pending };
}

const Hidden = ({ v }: { v: Record<string, string> }) => <>{Object.entries(v).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}</>;

function ScopeField({ id, defaultValue = 'user' }: { id: string; defaultValue?: string }) {
  return (
    <Field label="מי רואה" htmlFor={id}>
      <select id={id} name="scope" defaultValue={defaultValue} className={selectClass}>
        <option value="user">רק אני</option>
        <option value="shared">משותף לפי הרשאות</option>
      </select>
    </Field>
  );
}

const Submit = ({ pending, children }: { pending: boolean; children: React.ReactNode }) => (
  <div className="col-span-full flex justify-end">
    <Button type="submit" variant="primary" disabled={pending}>{children}</Button>
  </div>
);

// ── Properties ────────────────────────────────────────────────────────────────
export function AddPropertyDialog({ path, today }: { path: string; today: string }) {
  const router = useRouter();
  return (
    <FormDialog title="נכס חדש" trigger={<><Plus className="size-4" aria-hidden />נכס</>}>
      {close => <PropertyForm path={path} today={today} onSaved={id => { close(); if (id) router.push(`/ventures/real-estate/${id}`); }} />}
    </FormDialog>
  );
}

function PropertyForm({ path, today, onSaved }: { path: string; today: string; onSaved: (id?: string) => void }) {
  const { state, act, pending } = useForm(addProperty, onSaved);
  const id = useId();
  return (
    <form action={act} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={{ path }} />
      <Field label="שם הנכס" htmlFor={`${id}-n`}><input id={`${id}-n`} name="name" required maxLength={120} className={inputClass} /></Field>
      <Field label="סוג" htmlFor={`${id}-k`}>
        <select id={`${id}-k`} name="kind" defaultValue="apartment" className={selectClass}>
          <option value="apartment">דירה</option><option value="house">בית</option><option value="commercial">מסחרי</option>
          <option value="land">קרקע</option><option value="other">אחר</option>
        </select>
      </Field>
      <Field label="כתובת" htmlFor={`${id}-a`} className="sm:col-span-2"><input id={`${id}-a`} name="address" maxLength={200} className={inputClass} /></Field>
      <Field label="תאריך רכישה" htmlFor={`${id}-pd`}><DateField id={`${id}-pd`} name="purchase_date" /></Field>
      <Field label="עלות רכישה כולל מס רכישה ועמלות (₪)" htmlFor={`${id}-pc`}><input id={`${id}-pc`} name="purchase_cost" inputMode="decimal" className={inputClass} /></Field>
      <Field label="שווי נוכחי (₪)" htmlFor={`${id}-v`}><input id={`${id}-v`} name="current_value" inputMode="decimal" className={inputClass} /></Field>
      <Field label="מקור השווי" htmlFor={`${id}-s`}>
        <select id={`${id}-s`} name="value_source" defaultValue="estimate" className={selectClass}>
          <option value="estimate">הערכה</option><option value="appraisal">שמאות</option><option value="purchase">מחיר רכישה</option>
        </select>
      </Field>
      <Field label="נכון לתאריך" htmlFor={`${id}-vd`}><DateField id={`${id}-vd`} name="value_date" defaultValue={today} /></Field>
      <ScopeField id={`${id}-sc`} />
      <Field label="הערות" htmlFor={`${id}-o`} className="sm:col-span-2"><textarea id={`${id}-o`} name="notes" maxLength={2000} rows={2} className={textareaClass} /></Field>
      <Err s={state} />
      <Submit pending={pending}><Plus className="size-4" aria-hidden />שמור נכס</Submit>
    </form>
  );
}

export function PropertyValueDialog({ id, path, today, value, source }: { id: string; path: string; today: string; value: number | null; source: string | null }) {
  return (
    <FormDialog wide={false} title="עדכון שווי" triggerClass={buttonClass('secondary', 'sm')} trigger={<><Pencil className="size-4" aria-hidden />עדכן שווי</>}>
      {close => <PropertyValueForm id={id} path={path} today={today} value={value} source={source} onSaved={close} />}
    </FormDialog>
  );
}
function PropertyValueForm({ id, path, today, value, source, onSaved }: { id: string; path: string; today: string; value: number | null; source: string | null; onSaved: () => void }) {
  const { state, act, pending } = useForm(updatePropertyValue, onSaved);
  const uid = useId();
  return (
    <form action={act} className="grid grid-cols-2 gap-4">
      <Hidden v={{ id, path }} />
      <Field label="שווי (₪)" htmlFor={`${uid}-v`} className="col-span-2"><input id={`${uid}-v`} name="current_value" required inputMode="decimal" defaultValue={value ?? ''} className={inputClass} /></Field>
      <Field label="מקור" htmlFor={`${uid}-s`}>
        <select id={`${uid}-s`} name="value_source" defaultValue={source ?? 'estimate'} className={selectClass}>
          <option value="estimate">הערכה</option><option value="appraisal">שמאות</option><option value="purchase">מחיר רכישה</option>
        </select>
      </Field>
      <Field label="נכון לתאריך" htmlFor={`${uid}-d`}><DateField id={`${uid}-d`} name="value_date" required defaultValue={today} /></Field>
      <Err s={state} />
      <Submit pending={pending}>שמור</Submit>
    </form>
  );
}

// ── Loans ─────────────────────────────────────────────────────────────────────
export function AddLoanDialog({ assetId, path, today }: { assetId: string; path: string; today: string }) {
  return (
    <FormDialog title="הלוואה למימון הנכס" triggerClass={buttonClass('secondary', 'sm')} trigger={<><Plus className="size-4" aria-hidden />הלוואה</>}>
      {close => <LoanForm assetId={assetId} path={path} today={today} onSaved={close} />}
    </FormDialog>
  );
}
function LoanForm({ assetId, path, today, onSaved }: { assetId: string; path: string; today: string; onSaved: () => void }) {
  const { state, act, pending } = useForm(addLoan, onSaved);
  const id = useId();
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [term, setTerm] = useState('');
  const computed = ventures.monthlyPayment(Number(principal.replace(/,/g, '')), ventures.parseRatePct(rate), Number(term));
  return (
    <form action={act} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={{ path, asset_id: assetId }} />
      <Field label="מלווה (בנק / גוף)" htmlFor={`${id}-l`}><input id={`${id}-l`} name="lender" required maxLength={120} className={inputClass} /></Field>
      <Field label="סוג" htmlFor={`${id}-k`}>
        <select id={`${id}-k`} name="kind" defaultValue="mortgage" className={selectClass}>
          <option value="mortgage">משכנתא</option><option value="loan">הלוואה</option><option value="other">אחר</option>
        </select>
      </Field>
      <Field label="סכום ההלוואה (₪)" htmlFor={`${id}-p`}><input id={`${id}-p`} name="principal" required inputMode="decimal" value={principal} onChange={e => setPrincipal(e.target.value)} className={inputClass} /></Field>
      <Field label="ריבית שנתית (%)" htmlFor={`${id}-r`}><input id={`${id}-r`} name="annual_rate_pct" required inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} placeholder="4.5" className={inputClass} /></Field>
      <Field label="תאריך תחילה" htmlFor={`${id}-s`}><DateField id={`${id}-s`} name="start_date" required defaultValue={today} /></Field>
      <Field label="תקופה (חודשים)" htmlFor={`${id}-t`}><input id={`${id}-t`} name="term_months" required inputMode="numeric" value={term} onChange={e => setTerm(e.target.value)} placeholder="300" className={inputClass} /></Field>
      <Field label="החזר חודשי (₪) — ריק = לפי שפיצר" htmlFor={`${id}-m`}>
        <input id={`${id}-m`} name="monthly_payment" inputMode="decimal" placeholder={computed ? String(computed) : ''} className={inputClass} />
      </Field>
      <Field label="חלק היזמות בכל החזר (%)" htmlFor={`${id}-v`}><input id={`${id}-v`} name="venture_share_pct" inputMode="decimal" defaultValue="100" className={inputClass} /></Field>
      <Field label="יתרה היום (₪) — ריק = סכום ההלוואה" htmlFor={`${id}-b`}><input id={`${id}-b`} name="balance" inputMode="decimal" className={inputClass} /></Field>
      <Field label="היתרה נכונה לתאריך — ריק = תאריך התחילה" htmlFor={`${id}-bd`}><DateField id={`${id}-bd`} name="balance_date" /></Field>
      <p className="text-xs text-muted sm:col-span-2">
        {computed ? <>החזר מחושב (שפיצר): <bdi className="amount tabular">{ils(computed)}</bdi> לחודש. </> : null}
        החלק שאינו של היזמות נרשם בכל החזר כהוצאה באזור האישי.
      </p>
      <Err s={state} />
      <Submit pending={pending}><Plus className="size-4" aria-hidden />שמור הלוואה</Submit>
    </form>
  );
}

export function RepaymentDialog({ loanId, lender, payment, balance, sharePct, path, today }: {
  loanId: string; lender: string; payment: number; balance: number; sharePct: number; path: string; today: string;
}) {
  return (
    <FormDialog wide={false} title={`החזר · ${lender}`} triggerClass={buttonClass('primary', 'sm', 'whitespace-nowrap')}
      trigger={<><HandCoins className="size-4" aria-hidden />רשום החזר</>}>
      {close => <RepaymentForm loanId={loanId} payment={payment} balance={balance} sharePct={sharePct} path={path} today={today} onSaved={close} />}
    </FormDialog>
  );
}
function RepaymentForm({ loanId, payment, balance, sharePct, path, today, onSaved }: {
  loanId: string; payment: number; balance: number; sharePct: number; path: string; today: string; onSaved: () => void;
}) {
  const { state, act, pending } = useForm(recordRepayment, onSaved);
  const id = useId();
  const [amount, setAmount] = useState(String(payment));
  const share = ventures.shareSplit(Number(amount.replace(/,/g, '')), sharePct);
  return (
    <form action={act} className="grid grid-cols-2 gap-4">
      <Hidden v={{ path, liability_id: loanId }} />
      <p className="col-span-2 text-sm text-muted">יתרה: <bdi className="amount tabular font-medium text-ink">{ils(balance)}</bdi></p>
      <Field label="סכום (₪)" htmlFor={`${id}-a`}><input id={`${id}-a`} name="amount" required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={inputClass} /></Field>
      <Field label="תאריך" htmlFor={`${id}-d`}><DateField id={`${id}-d`} name="paid_on" required defaultValue={today} /></Field>
      <Field label="אמצעי תשלום" htmlFor={`${id}-m`} className="col-span-2">
        <select id={`${id}-m`} name="payment_method" defaultValue="transfer" className={selectClass}>
          {PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Field>
      {share && (
        <p className="col-span-2 text-xs text-muted">
          יירשם ביזמות <bdi className="amount tabular">{ils(share.venture)}</bdi>
          {share.personal > 0 && <> ובאזור האישי <bdi className="amount tabular">{ils(share.personal)}</bdi></>}.
          {' '}הריבית מחושבת מהיתרה (יתרה × ריבית ÷ 12), השאר מוריד את הקרן.
        </p>
      )}
      <Err s={state} />
      <Submit pending={pending}>רשום החזר</Submit>
    </form>
  );
}

// ── Money linked to an object ─────────────────────────────────────────────────
export function SubjectTxDialog({ subjectType, subjectId, path, today, label = 'הכנסה/הוצאה', defaultDirection = 'income' }: {
  subjectType: 'asset' | 'investment' | 'legal_case'; subjectId: string; path: string; today: string; label?: string; defaultDirection?: Direction;
}) {
  return (
    <FormDialog title={label} triggerClass={buttonClass('secondary', 'sm')} trigger={<><Plus className="size-4" aria-hidden />{label}</>}>
      {close => <SubjectTxForm subjectType={subjectType} subjectId={subjectId} path={path} today={today} defaultDirection={defaultDirection} onSaved={close} />}
    </FormDialog>
  );
}
function SubjectTxForm({ subjectType, subjectId, path, today, defaultDirection, onSaved }: {
  subjectType: string; subjectId: string; path: string; today: string; defaultDirection: Direction; onSaved: () => void;
}) {
  const { state, act, pending } = useForm(addSubjectTransaction, onSaved);
  const id = useId();
  const [direction, setDirection] = useState<Direction>(defaultDirection);
  const cats = categoriesOf(direction);
  const def = direction === 'income' ? (subjectType === 'asset' ? 'rent-income' : 'other') : (subjectType === 'legal_case' ? 'professional' : 'other');
  return (
    <form action={act} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={{ path, subject_type: subjectType, subject_id: subjectId }} />
      <Field label="כיוון" htmlFor={`${id}-dir`}>
        <select id={`${id}-dir`} name="direction" value={direction} onChange={e => setDirection(e.target.value as Direction)} className={inputClass}>
          <option value="income">הכנסה</option><option value="expense">הוצאה</option>
        </select>
      </Field>
      <Field label="קטגוריה" htmlFor={`${id}-c`}>
        <select key={direction} id={`${id}-c`} name="category" defaultValue={cats.some(c => c.id === def) ? def : 'other'} className={inputClass}>
          {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="סכום (₪)" htmlFor={`${id}-a`}><input id={`${id}-a`} name="amount" required inputMode="decimal" className={inputClass} /></Field>
      <Field label="תאריך" htmlFor={`${id}-d`}><DateField id={`${id}-d`} name="occurred_on" required defaultValue={today} /></Field>
      <Field label="סיווג" htmlFor={`${id}-cl`}>
        <select id={`${id}-cl`} name="classification" defaultValue="personal" className={selectClass}>
          {CLASSIFICATIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="צד שני" htmlFor={`${id}-cp`}><input id={`${id}-cp`} name="counterparty_name" maxLength={120} className={inputClass} /></Field>
      <Field label="תיאור" htmlFor={`${id}-ds`} className="sm:col-span-2"><input id={`${id}-ds`} name="description" maxLength={500} className={inputClass} /></Field>
      <label className="inline-flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="vat_included" className="mt-0.5 size-4" />
        <span>הסכום כולל מע״מ (לפי שיעור התאריך)</span>
      </label>
      <Err s={state} />
      <Submit pending={pending}><Plus className="size-4" aria-hidden />שמור</Submit>
    </form>
  );
}

// ── Investments ───────────────────────────────────────────────────────────────
const INV_CATS = [
  ['stocks', 'מניות'], ['bonds', 'אג״ח'], ['fund', 'קרן / תיק מנוהל'], ['pension', 'פנסיה / השתלמות'], ['deposit', 'פיקדון'],
  ['crypto', 'קריפטו'], ['private', 'השקעה פרטית'], ['real-estate', 'נדל״ן (קרן / קבוצה)'], ['other', 'אחר'],
] as const;
const INV_SOURCES = [['statement', 'דוח מהגוף המנהל'], ['market', 'מחיר שוק'], ['estimate', 'הערכה']] as const;

export function AddInvestmentDialog({ path, today }: { path: string; today: string }) {
  const router = useRouter();
  return (
    <FormDialog title="השקעה חדשה" trigger={<><Plus className="size-4" aria-hidden />השקעה</>}>
      {close => <InvestmentForm path={path} today={today} onSaved={id => { close(); if (id) router.push(`/ventures/investments/${id}`); }} />}
    </FormDialog>
  );
}
function InvestmentForm({ path, today, onSaved }: { path: string; today: string; onSaved: (id?: string) => void }) {
  const { state, act, pending } = useForm(addInvestment, onSaved);
  const id = useId();
  return (
    <form action={act} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={{ path }} />
      <Field label="שם" htmlFor={`${id}-n`}><input id={`${id}-n`} name="name" required maxLength={120} className={inputClass} /></Field>
      <Field label="קטגוריה" htmlFor={`${id}-c`}>
        <select id={`${id}-c`} name="category" defaultValue="fund" className={selectClass}>{INV_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label="סכום ההשקעה (₪)" htmlFor={`${id}-a`}><input id={`${id}-a`} name="amount_invested" required inputMode="decimal" className={inputClass} /></Field>
      <Field label="תאריך ההשקעה" htmlFor={`${id}-d`}><DateField id={`${id}-d`} name="invested_on" required defaultValue={today} /></Field>
      <Field label="שווי נוכחי (₪)" htmlFor={`${id}-v`}><input id={`${id}-v`} name="current_value" inputMode="decimal" className={inputClass} /></Field>
      <Field label="מקור השווי" htmlFor={`${id}-s`}>
        <select id={`${id}-s`} name="value_source" defaultValue="statement" className={selectClass}>{INV_SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label="נכון לתאריך" htmlFor={`${id}-vd`}><DateField id={`${id}-vd`} name="value_date" defaultValue={today} /></Field>
      <Field label="סימול (לחיבור עתידי לשוק ההון)" htmlFor={`${id}-t`}><input id={`${id}-t`} name="ticker" dir="ltr" maxLength={20} className={inputClass} /></Field>
      <ScopeField id={`${id}-sc`} />
      <Field label="הערות" htmlFor={`${id}-o`} className="sm:col-span-2"><textarea id={`${id}-o`} name="notes" maxLength={2000} rows={2} className={textareaClass} /></Field>
      <Err s={state} />
      <Submit pending={pending}><Plus className="size-4" aria-hidden />שמור השקעה</Submit>
    </form>
  );
}

export function UpdateInvestmentDialog({ inv, path, today }: {
  inv: { id: string; current_value: number | null; value_source: string | null; status: string; notes: string | null }; path: string; today: string;
}) {
  return (
    <FormDialog wide={false} title="עדכון השקעה" triggerClass={buttonClass('secondary', 'sm')} trigger={<><Pencil className="size-4" aria-hidden />עדכן</>}>
      {close => <UpdateInvestmentForm inv={inv} path={path} today={today} onSaved={close} />}
    </FormDialog>
  );
}
function UpdateInvestmentForm({ inv, path, today, onSaved }: {
  inv: { id: string; current_value: number | null; value_source: string | null; status: string; notes: string | null }; path: string; today: string; onSaved: () => void;
}) {
  const { state, act, pending } = useForm(updateInvestment, onSaved);
  const id = useId();
  return (
    <form action={act} className="grid grid-cols-2 gap-4">
      <Hidden v={{ path, id: inv.id }} />
      <Field label="שווי נוכחי (₪)" htmlFor={`${id}-v`} className="col-span-2"><input id={`${id}-v`} name="current_value" inputMode="decimal" defaultValue={inv.current_value ?? ''} className={inputClass} /></Field>
      <Field label="מקור" htmlFor={`${id}-s`}>
        <select id={`${id}-s`} name="value_source" defaultValue={inv.value_source ?? 'statement'} className={selectClass}>{INV_SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label="נכון לתאריך" htmlFor={`${id}-d`}><DateField id={`${id}-d`} name="value_date" defaultValue={today} /></Field>
      <Field label="סטטוס" htmlFor={`${id}-st`} className="col-span-2">
        <select id={`${id}-st`} name="status" defaultValue={inv.status} className={selectClass}><option value="active">פעילה</option><option value="exited">מומשה</option></select>
      </Field>
      <Field label="הערות" htmlFor={`${id}-o`} className="col-span-2"><textarea id={`${id}-o`} name="notes" maxLength={2000} rows={3} defaultValue={inv.notes ?? ''} className={textareaClass} /></Field>
      <Err s={state} />
      <Submit pending={pending}>שמור</Submit>
    </form>
  );
}

// ── Legal cases ───────────────────────────────────────────────────────────────
type CaseValues = {
  id?: string; title?: string; case_number?: string | null; court?: string | null; status?: string; parties?: string | null;
  lawyer?: string | null; opened_on?: string | null; closed_on?: string | null; notes?: string | null;
};

export function AddCaseDialog({ path, today }: { path: string; today: string }) {
  const router = useRouter();
  return (
    <FormDialog title="תיק חדש" trigger={<><Plus className="size-4" aria-hidden />תיק</>}>
      {close => <CaseForm action={addCase} path={path} today={today} values={{}} onSaved={id => { close(); if (id) router.push(`/ventures/legal-and-tasks/${id}`); }} />}
    </FormDialog>
  );
}
export function EditCaseDialog({ values, path, today }: { values: CaseValues; path: string; today: string }) {
  return (
    <FormDialog title="עריכת תיק" triggerClass={buttonClass('secondary', 'sm')} trigger={<><Pencil className="size-4" aria-hidden />עריכה</>}>
      {close => <CaseForm action={updateCase} path={path} today={today} values={values} onSaved={close} />}
    </FormDialog>
  );
}
function CaseForm({ action, path, today, values, onSaved }: { action: Act; path: string; today: string; values: CaseValues; onSaved: (id?: string) => void }) {
  const { state, act, pending } = useForm(action, onSaved);
  const id = useId();
  const isNew = !values.id;
  return (
    <form action={act} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Hidden v={values.id ? { path, id: values.id } : { path }} />
      <Field label="שם התיק" htmlFor={`${id}-t`} className="sm:col-span-2"><input id={`${id}-t`} name="title" required maxLength={200} defaultValue={values.title ?? ''} className={inputClass} /></Field>
      <Field label="סטטוס" htmlFor={`${id}-s`}>
        <select id={`${id}-s`} name="status" defaultValue={values.status ?? 'open'} className={selectClass}>
          <option value="open">פתוח</option><option value="waiting">ממתין</option><option value="closed">סגור</option>
        </select>
      </Field>
      <Field label="מספר תיק" htmlFor={`${id}-n`}><input id={`${id}-n`} name="case_number" maxLength={60} dir="ltr" defaultValue={values.case_number ?? ''} className={inputClass} /></Field>
      <Field label="צדדים" htmlFor={`${id}-p`} className="sm:col-span-2"><input id={`${id}-p`} name="parties" maxLength={500} defaultValue={values.parties ?? ''} placeholder="תובע נגד נתבע" className={inputClass} /></Field>
      <Field label="עורך/ת דין" htmlFor={`${id}-l`}><input id={`${id}-l`} name="lawyer" maxLength={120} defaultValue={values.lawyer ?? ''} className={inputClass} /></Field>
      <Field label="ערכאה" htmlFor={`${id}-c`}><input id={`${id}-c`} name="court" maxLength={120} defaultValue={values.court ?? ''} className={inputClass} /></Field>
      <Field label="נפתח בתאריך" htmlFor={`${id}-o`}><DateField id={`${id}-o`} name="opened_on" defaultValue={values.opened_on ?? (isNew ? today : '')} /></Field>
      {!isNew && <Field label="נסגר בתאריך" htmlFor={`${id}-cl`}><DateField id={`${id}-cl`} name="closed_on" defaultValue={values.closed_on ?? ''} /></Field>}
      {isNew && (
        <>
          <Field label="מועד ראשון (לא חובה)" htmlFor={`${id}-dd`}><DateField id={`${id}-dd`} name="deadline_on" /></Field>
          <Field label="מה המועד" htmlFor={`${id}-dt`}><input id={`${id}-dt`} name="deadline_title" maxLength={200} placeholder="הגשת כתב הגנה" className={inputClass} /></Field>
          <ScopeField id={`${id}-sc`} />
        </>
      )}
      <Field label="הערות" htmlFor={`${id}-nt`} className="sm:col-span-2"><textarea id={`${id}-nt`} name="notes" maxLength={4000} rows={3} defaultValue={values.notes ?? ''} className={textareaClass} /></Field>
      <Err s={state} />
      <Submit pending={pending}>{isNew ? <><Plus className="size-4" aria-hidden />פתח תיק</> : 'שמור'}</Submit>
    </form>
  );
}

export function AddDeadlineForm({ caseId, path }: { caseId: string; path: string }) {
  const [key, setKey] = useState(0);
  const { state, act, pending } = useForm(addDeadline, () => setKey(k => k + 1));
  const id = useId();
  return (
    <form key={key} action={act} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
      <Hidden v={{ path, case_id: caseId }} />
      <Field label="מועד חדש" htmlFor={`${id}-t`}><input id={`${id}-t`} name="title" required maxLength={200} placeholder="דיון / הגשה / תשלום" className={inputClass} /></Field>
      <Field label="תאריך" htmlFor={`${id}-d`}><DateField id={`${id}-d`} name="due_on" required /></Field>
      <Button type="submit" variant="secondary" disabled={pending}><CalendarPlus className="size-4" aria-hidden />הוסף</Button>
      <Err s={state} />
    </form>
  );
}

// ── Tasks and contacts of an object ───────────────────────────────────────────
export function SubjectTaskForm({ subjectType, subjectId, path }: Opts & { subjectType: string; subjectId: string; path: string }) {
  const [key, setKey] = useState(0);
  const { state, act, pending } = useForm(addSubjectTask, () => setKey(k => k + 1));
  const id = useId();
  return (
    <form key={key} action={act} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_11rem_6rem_auto] sm:items-end">
      <Hidden v={{ path, subject_type: subjectType, subject_id: subjectId }} />
      <Field label="משימה חדשה" htmlFor={`${id}-t`}><input id={`${id}-t`} name="title" required maxLength={300} className={inputClass} /></Field>
      <Field label="עד" htmlFor={`${id}-d`}><DateField id={`${id}-d`} name="due_date" /></Field>
      <Field label="עדיפות" htmlFor={`${id}-p`}>
        <select id={`${id}-p`} name="priority" defaultValue="3" className={selectClass}>{PRIORITIES.map(p => <option key={p.value} value={p.value}>P{p.value}</option>)}</select>
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}><Plus className="size-4" aria-hidden />משימה</Button>
      <Err s={state} />
    </form>
  );
}

export function ContactDialog({ subjectType, subjectId, path }: { subjectType: string; subjectId: string; path: string }) {
  return (
    <FormDialog wide={false} title="איש קשר" triggerClass={buttonClass('secondary', 'sm')} trigger={<><UserPlus className="size-4" aria-hidden />איש קשר</>}>
      {close => <ContactForm subjectType={subjectType} subjectId={subjectId} path={path} onSaved={close} />}
    </FormDialog>
  );
}
function ContactForm({ subjectType, subjectId, path, onSaved }: { subjectType: string; subjectId: string; path: string; onSaved: () => void }) {
  const { state, act, pending } = useForm(addContact, onSaved);
  const id = useId();
  return (
    <form action={act} className="grid grid-cols-2 gap-4">
      <Hidden v={{ path, subject_type: subjectType, subject_id: subjectId }} />
      <Field label="שם" htmlFor={`${id}-n`}><input id={`${id}-n`} name="name" required maxLength={120} className={inputClass} /></Field>
      <Field label="תפקיד" htmlFor={`${id}-r`}><input id={`${id}-r`} name="role" maxLength={60} placeholder="שוכר / עו״ד / מתווך" className={inputClass} /></Field>
      <Field label="טלפון" htmlFor={`${id}-p`}><input id={`${id}-p`} name="phone" type="tel" dir="ltr" maxLength={30} className={inputClass} /></Field>
      <Field label="אימייל" htmlFor={`${id}-e`}><input id={`${id}-e`} name="email" type="email" dir="ltr" maxLength={120} className={inputClass} /></Field>
      <Field label="הערות" htmlFor={`${id}-o`} className="col-span-2"><input id={`${id}-o`} name="notes" maxLength={1000} className={inputClass} /></Field>
      <Err s={state} />
      <Submit pending={pending}><UserPlus className="size-4" aria-hidden />שמור</Submit>
    </form>
  );
}

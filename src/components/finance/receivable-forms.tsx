'use client';
import { useActionState, useEffect, useId } from 'react';
import { HandCoins, Plus } from 'lucide-react';
import { addReceivable, recordPayment, type FinanceResult } from '@/app/finance-actions';
import { Button, buttonClass } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Field, inputClass, selectClass } from '@/components/work/fields';

const fileClass = 'min-w-0 text-sm text-ink-2 file:me-3 file:h-9 file:cursor-pointer file:rounded-lg file:border file:border-solid file:border-line-strong file:bg-surface file:px-3 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-2';
import { FormDialog } from './dialog';
import { PAYMENT_METHODS } from '@/lib/finance';
import { ils } from '@/lib/format';

const Err = ({ s }: { s: FinanceResult | null }) =>
  s && !s.ok ? <p role="alert" className="col-span-full text-sm text-critical-ink">{s.error}</p> : null;

// "+ חוב": a new receivable (amount incl. VAT)
export function AddReceivableDialog({ path, place, today }: { path: string; place: string; today: string }) {
  return (
    <FormDialog title="חוב חדש לגבייה" trigger={<><Plus aria-hidden />חוב</>}>
      {close => <AddReceivableForm path={path} place={place} today={today} onSaved={close} />}
    </FormDialog>
  );
}

function AddReceivableForm({ path, place, today, onSaved }: { path: string; place: string; today: string; onSaved: () => void }) {
  const [state, action, pending] = useActionState<FinanceResult | null, FormData>(addReceivable, null);
  const id = useId();
  useEffect(() => { if (state?.ok) onSaved(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form action={action} className="grid grid-cols-2 gap-4">
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="place" value={place} />
      <Field label="לקוח" htmlFor={`${id}-c`} className="col-span-2">
        <input id={`${id}-c`} name="client_name" required maxLength={120} className={inputClass} />
      </Field>
      <Field label="סכום כולל מע״מ (₪)" htmlFor={`${id}-a`}>
        <input id={`${id}-a`} name="amount" required inputMode="decimal" className={inputClass} />
      </Field>
      <Field label="ח״פ / ע״מ" htmlFor={`${id}-t`}>
        <input id={`${id}-t`} name="client_tax_id" inputMode="numeric" pattern="\d{5,9}" maxLength={9} dir="ltr" title="ספרות בלבד, 5 עד 9" className={inputClass} />
      </Field>
      <Field label="תאריך הפקה" htmlFor={`${id}-i`}>
        <DateField id={`${id}-i`} name="issued_on" defaultValue={today} />
      </Field>
      <Field label="לתשלום עד" htmlFor={`${id}-d`}>
        <DateField id={`${id}-d`} name="due_date" required />
      </Field>
      <Field label="מספר חשבונית" htmlFor={`${id}-n`}>
        <input id={`${id}-n`} name="invoice_number" maxLength={40} dir="ltr" className={inputClass} />
      </Field>
      <Field label="חשבונית (קובץ, עד 4MB)" htmlFor={`${id}-f`}>
        <input id={`${id}-f`} name="file" type="file" accept="image/*,application/pdf" className={fileClass} />
      </Field>
      <Field label="הערה" htmlFor={`${id}-o`} className="col-span-2">
        <input id={`${id}-o`} name="note" maxLength={500} className={inputClass} />
      </Field>
      <Err s={state} />
      <div className="col-span-2 flex justify-end border-t border-line pt-4">
        <Button type="submit" variant="primary" disabled={pending}><Plus aria-hidden />שמור חוב</Button>
      </div>
    </form>
  );
}

// "רשום תשלום" on one row. Amount defaults to what is still open.
export function PaymentDialog({ id, client, remaining, path, today }: { id: string; client: string; remaining: number; path: string; today: string }) {
  return (
    <FormDialog wide={false} title={`תשלום מ${client}`} triggerClass={buttonClass('secondary', 'sm', 'whitespace-nowrap')}
      trigger={<><HandCoins aria-hidden />רשום תשלום</>}>
      {close => <PaymentForm id={id} remaining={remaining} path={path} today={today} onSaved={close} />}
    </FormDialog>
  );
}

function PaymentForm({ id, remaining, path, today, onSaved }: { id: string; remaining: number; path: string; today: string; onSaved: () => void }) {
  const [state, action, pending] = useActionState<FinanceResult | null, FormData>(recordPayment, null);
  const uid = useId();
  useEffect(() => { if (state?.ok) onSaved(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form action={action} className="grid grid-cols-2 gap-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="record_income_field" value="1" />
      <p className="col-span-2 text-sm text-muted">נשאר לגבות: <bdi className="amount tabular font-medium text-ink">{ils(remaining)}</bdi></p>
      <Field label="סכום (₪)" htmlFor={`${uid}-a`}>
        <input id={`${uid}-a`} name="amount" required inputMode="decimal" defaultValue={String(remaining)} className={inputClass} />
      </Field>
      <Field label="תאריך" htmlFor={`${uid}-d`}>
        <DateField id={`${uid}-d`} name="paid_on" required defaultValue={today} />
      </Field>
      <Field label="אמצעי תשלום" htmlFor={`${uid}-m`} className="col-span-2">
        <select id={`${uid}-m`} name="payment_method" defaultValue="transfer" className={selectClass}>
          {PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Field>
      <label className="col-span-2 inline-flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="record_income" defaultChecked className="mt-0.5 size-4" />
        <span>לרשום גם תנועת הכנסה עסקית (כולל מע״מ לפי שיעור התאריך)</span>
      </label>
      <Err s={state} />
      <div className="col-span-2 flex justify-end border-t border-line pt-4">
        <Button type="submit" variant="primary" disabled={pending}>רשום תשלום</Button>
      </div>
    </form>
  );
}

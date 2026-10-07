'use client';
import { useActionState, useEffect, useId, useMemo, useState } from 'react';
import { Paperclip, Plus } from 'lucide-react';
import { addTransaction, type FinanceResult } from '@/app/finance-actions';
import { Button } from '@/components/ui/button';
import { Field, inputClass } from '@/components/work/fields';
import { FormDialog } from './dialog';
import { encodePlace, placeOptions, type Place } from '@/lib/places';
import {
  CLASSIFICATIONS, DOCUMENT_TYPES, PAYMENT_METHODS, SPLIT_PEOPLE, categoriesOf, vatRateOn,
  type Classification, type Direction, type VatRateRow,
} from '@/lib/finance';
import { ils } from '@/lib/format';
import { cn } from '@/lib/utils';
import money from '@domain/money';

// "+ תנועה": every field of a transaction. The VAT preview uses the dated rates the page passes in
// (from `parameters`), for the date typed in the form; the server recomputes and stores its own.
export function TransactionDialog({ vatRates, today, path, place }: {
  vatRates: VatRateRow[]; today: string; path: string; place?: Place;
}) {
  return (
    <FormDialog title="תנועה חדשה" trigger={<><Plus className="size-4" aria-hidden />תנועה</>}>
      {close => <TransactionForm vatRates={vatRates} today={today} path={path} place={place} onSaved={close} />}
    </FormDialog>
  );
}

export function TransactionForm({ vatRates, today, path, place, onSaved }: {
  vatRates: VatRateRow[]; today: string; path: string; place?: Place; onSaved?: () => void;
}) {
  const [state, action, pending] = useActionState<FinanceResult | null, FormData>(addTransaction, null);
  const id = useId();
  const options = useMemo(placeOptions, []);
  const [direction, setDirection] = useState<Direction>('expense');
  const [classification, setClassification] = useState<Classification>(place?.domain === 'personal' ? 'personal' : 'business');
  const [where, setWhere] = useState(encodePlace(place ?? { domain: 'business', branch: 'adigital', location: null }));
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [vatIncluded, setVatIncluded] = useState(classification !== 'personal');
  const [split, setSplit] = useState(false);
  const [scope, setScope] = useState<'user' | 'shared'>('user');

  useEffect(() => { if (state?.ok) onSaved?.(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const rate = vatRateOn(vatRates, date);
  const gross = money.parseAmount(amount);
  const preview = gross === null ? null : money.vatSplit(gross, rate, vatIncluded);
  const cats = categoriesOf(direction, classification === 'mixed' ? undefined : classification);
  const f = (k: string) => `${id}-${k}`;

  return (
    <form action={action} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="direction" value={direction} />
      <div role="group" aria-label="סוג תנועה" className="col-span-2 inline-flex w-fit rounded-lg border border-line-strong p-0.5 text-sm sm:col-span-4">
        {(['expense', 'income'] as const).map(k => (
          <button key={k} type="button" onClick={() => setDirection(k)} aria-pressed={direction === k}
            className={cn('rounded-md px-4 py-1.5', direction === k ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2')}>
            {k === 'expense' ? 'הוצאה' : 'הכנסה'}
          </button>
        ))}
      </div>

      <Field label="סכום ששולם (₪)" htmlFor={f('amount')}>
        <input id={f('amount')} name="amount" required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={inputClass} />
      </Field>
      <Field label="תאריך המסמך" htmlFor={f('date')}>
        <input id={f('date')} name="occurred_on" type="date" required value={date} onChange={e => setDate(e.target.value)} className={inputClass} />
      </Field>
      <Field label="סיווג" htmlFor={f('cls')}>
        <select id={f('cls')} name="classification" value={classification}
          onChange={e => { const c = e.target.value as Classification; setClassification(c); setVatIncluded(c !== 'personal'); }} className={inputClass}>
          {CLASSIFICATIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="קטגוריה" htmlFor={f('cat')}>
        <select id={f('cat')} name="category" key={`${direction}-${classification}`} defaultValue={cats[0]?.id} className={inputClass}>
          {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>

      <div className="col-span-2 flex flex-col gap-1 rounded-lg border border-line bg-surface-2/40 p-3 sm:col-span-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="vat_included" checked={vatIncluded} onChange={e => setVatIncluded(e.target.checked)} className="size-4" />
          הסכום כולל מע״מ
        </label>
        <p className="text-xs text-muted" aria-live="polite">
          {rate === null
            ? <span className="text-critical-ink">אין שיעור מע״מ מוגדר לתאריך הזה, השמירה תיחסם.</span>
            : <>שיעור מע״מ לתאריך: <bdi className="tabular">{Math.round(rate * 1000) / 10}%</bdi>
              {preview && <> · מע״מ <bdi className="tabular">{ils(preview.vat)}</bdi> · ללא מע״מ <bdi className="tabular">{ils(preview.net)}</bdi></>}</>}
        </p>
      </div>

      <Field label="שיוך" htmlFor={f('place')} className="col-span-2">
        <select id={f('place')} name="place" value={where} onChange={e => setWhere(e.target.value)} className={inputClass}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="מי רואה" htmlFor={f('scope')} className="col-span-2">
        <select id={f('scope')} name="scope" value={split ? 'shared' : scope} disabled={split}
          onChange={e => setScope(e.target.value as 'user' | 'shared')} className={inputClass}>
          <option value="user">רק אני</option>
          <option value="shared">משותף (מי שיש לו הרשאה למקום)</option>
        </select>
        {split && <input type="hidden" name="scope" value="shared" />}
      </Field>

      <Field label="תיאור" htmlFor={f('desc')} className="col-span-2 sm:col-span-4">
        <input id={f('desc')} name="description" maxLength={500} className={inputClass} />
      </Field>

      <Field label="סוג מסמך" htmlFor={f('doc')}>
        <select id={f('doc')} name="document_type" defaultValue="tax_invoice" className={inputClass}>
          {DOCUMENT_TYPES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </Field>
      <Field label="מספר מסמך" htmlFor={f('docno')}>
        <input id={f('docno')} name="document_number" maxLength={40} dir="ltr" className={inputClass} />
      </Field>
      <Field label={direction === 'income' ? 'לקוח' : 'ספק'} htmlFor={f('cp')}>
        <input id={f('cp')} name="counterparty_name" maxLength={120} className={inputClass} />
      </Field>
      <Field label="ח״פ / ע״מ" htmlFor={f('tax')}>
        <input id={f('tax')} name="counterparty_tax_id" inputMode="numeric" pattern="\d{5,9}" maxLength={9} dir="ltr"
          title="ספרות בלבד, 5 עד 9" className={inputClass} />
      </Field>
      <Field label="אמצעי תשלום" htmlFor={f('pm')}>
        <select id={f('pm')} name="payment_method" defaultValue="" className={inputClass}>
          <option value="">לא צוין</option>
          {PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Field>
      <Field label="תאריך תשלום" htmlFor={f('pd')}>
        <input id={f('pd')} name="payment_date" type="date" className={inputClass} />
      </Field>
      <Field label="מסמך מצורף (עד 4MB)" htmlFor={f('file')} className="col-span-2">
        <span className="flex items-center gap-2">
          <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
          <input id={f('file')} name="file" type="file" accept="image/*,application/pdf" className="min-w-0 text-sm" />
        </span>
      </Field>

      <div className="col-span-2 flex flex-col gap-2 sm:col-span-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="split" checked={split} onChange={e => setSplit(e.target.checked)} className="size-4" />
          חלוקה בין אנשים
        </label>
        {split && (
          <div className="flex flex-wrap gap-3">
            {SPLIT_PEOPLE.map(p => (
              <Field key={p.id} label={`${p.name} (%)`} htmlFor={f(`share-${p.id}`)} className="w-28">
                <input id={f(`share-${p.id}`)} name={`share_${p.id}`} inputMode="decimal" defaultValue="50" className={inputClass} />
              </Field>
            ))}
          </div>
        )}
      </div>

      <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-4">
        {state && !state.ok ? <p role="alert" className="text-sm text-critical-ink">{state.error}</p> : <span />}
        <Button type="submit" variant="primary" disabled={pending}><Plus className="size-4" aria-hidden />שמור תנועה</Button>
      </div>
    </form>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { inputClass, compactInputClass } from '@/components/work/fields';
import { cn } from '@/lib/utils';

// A date input in the Israeli format (dd/mm/yyyy), whatever the browser's language. The form still
// posts ISO (YYYY-MM-DD) under `name`, exactly like <input type="date"> did, so server actions are
// unchanged. The calendar button opens the browser's own picker.

const toText = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

export function parseIlDate(text: string): string | null {
  const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\s*$/.exec(text);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function DateField({ name, id, value, defaultValue, onChange, required, min, max, disabled, compact, className, ...aria }: {
  name?: string; id?: string; value?: string; defaultValue?: string; onChange?: (iso: string) => void;
  required?: boolean; min?: string; max?: string; disabled?: boolean; compact?: boolean; className?: string;
  'aria-label'?: string; 'aria-describedby'?: string;
}) {
  const controlled = value !== undefined;
  const [iso, setIso] = useState(controlled ? value : defaultValue ?? '');
  const [text, setText] = useState(toText(controlled ? value : defaultValue));
  const textRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  // Follow a controlled value set from outside (e.g. a form reset by its parent)
  useEffect(() => {
    if (controlled && value !== iso) { setIso(value); setText(toText(value)); }
  }, [controlled, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: string) => {
    setIso(next);
    onChange?.(next);
  };
  const onText = (t: string) => {
    setText(t);
    const parsed = t.trim() === '' ? '' : parseIlDate(t);
    const bad = parsed === null || (parsed && ((min && parsed < min) || (max && parsed > max)));
    textRef.current?.setCustomValidity(bad ? 'תאריך בפורמט יום/חודש/שנה, למשל 08/10/2026' : '');
    if (!bad) commit(parsed ?? '');
  };
  const openPicker = () => {
    const p = pickRef.current;
    if (!p) return;
    try { p.showPicker(); } catch { p.focus(); }
  };

  return (
    <div className={cn('relative', className)}>
      <input ref={textRef} id={id} type="text" inputMode="numeric" autoComplete="off" dir="ltr" placeholder="dd/mm/yyyy"
        value={text} onChange={e => onText(e.target.value)} onBlur={() => { if (iso) setText(toText(iso)); }}
        required={required} disabled={disabled} {...aria}
        className={cn(compact ? compactInputClass : inputClass, 'pl-10 text-right tabular')} />
      {name && <input type="hidden" name={name} value={iso} />}
      <input ref={pickRef} type="date" tabIndex={-1} aria-hidden value={iso} min={min} max={max}
        onChange={e => { setText(toText(e.target.value)); textRef.current?.setCustomValidity(''); commit(e.target.value); }}
        className="pointer-events-none absolute inset-0 opacity-0" />
      <button type="button" onClick={openPicker} disabled={disabled} aria-label="בחירה מלוח השנה"
        className="absolute inset-y-0 left-0 grid w-9 place-items-center rounded-l-lg text-muted hover:text-ink">
        <CalendarDays className="size-4" aria-hidden />
      </button>
    </div>
  );
}

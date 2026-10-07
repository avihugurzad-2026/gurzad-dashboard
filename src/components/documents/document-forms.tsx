'use client';
import { useActionState, useEffect, useId, useState, useTransition } from 'react';
import { FilePlus2, Trash2, Upload } from 'lucide-react';
import { addDocumentVersion, removeDocument, uploadDocument, type DocResult } from '@/app/documents-actions';
import { FormDialog } from '@/components/finance/dialog';
import { Field, inputClass } from '@/components/work/fields';
import { Button, buttonClass } from '@/components/ui/button';
import { DOC_TYPES, MAX_DOC_BYTES } from '@/lib/documents';

type PlaceOpt = { value: string; label: string };

function useFileCheck() {
  const [err, setErr] = useState<string | null>(null);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setErr(f && f.size > MAX_DOC_BYTES ? 'הקובץ גדול מ-4MB' : null);
  };
  return { err, onChange };
}

// "העלאת מסמך": title, type, place (only places this user may file documents in), file, date, notes
export function UploadDocumentDialog({ places, defaultPlace, subject, path, label = 'העלאת מסמך' }: {
  places: PlaceOpt[]; defaultPlace?: string | null; subject?: { type: string; id: string } | null; path: string; label?: string;
}) {
  if (!places.length) return null;
  return (
    <FormDialog title="העלאת מסמך" trigger={<><Upload className="size-4" aria-hidden />{label}</>}>
      {close => <UploadForm places={places} defaultPlace={defaultPlace} subject={subject} path={path} onSaved={close} />}
    </FormDialog>
  );
}

function UploadForm({ places, defaultPlace, subject, path, onSaved }: {
  places: PlaceOpt[]; defaultPlace?: string | null; subject?: { type: string; id: string } | null; path: string; onSaved: () => void;
}) {
  const [state, action, pending] = useActionState<DocResult | null, FormData>(uploadDocument, null);
  const file = useFileCheck();
  const id = useId();
  const f = (k: string) => `${id}-${k}`;
  useEffect(() => { if (state?.ok) onSaved(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = places.some(p => p.value === defaultPlace) ? defaultPlace! : places[0].value;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="path" value={path} />
      {subject && <><input type="hidden" name="subject_type" value={subject.type} /><input type="hidden" name="subject_id" value={subject.id} /></>}
      <Field label="קובץ (עד 4MB)" htmlFor={f('file')} className="sm:col-span-2">
        <input id={f('file')} name="file" type="file" required onChange={file.onChange} aria-describedby={file.err ? f('ferr') : undefined}
          className="min-w-0 text-sm file:me-3 file:rounded-md file:border file:border-line-strong file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm" />
      </Field>
      {file.err && <p id={f('ferr')} role="alert" className="text-xs text-critical-ink sm:col-span-2">{file.err}</p>}
      <Field label="שם המסמך (ריק = שם הקובץ)" htmlFor={f('title')} className="sm:col-span-2">
        <input id={f('title')} name="title" maxLength={200} autoComplete="off" className={inputClass} />
      </Field>
      <Field label="סוג" htmlFor={f('type')}>
        <select id={f('type')} name="doc_type" defaultValue="other" className={inputClass}>
          {DOC_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </Field>
      <Field label="שייך ל" htmlFor={f('place')}>
        <select id={f('place')} name="place" defaultValue={initial} className={inputClass}>
          {places.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </Field>
      <Field label="תאריך המסמך (לא חובה)" htmlFor={f('date')}>
        <input id={f('date')} name="doc_date" type="date" className={inputClass} />
      </Field>
      <label className="inline-flex items-center gap-1.5 self-end pb-2 text-sm text-ink-2">
        <input type="checkbox" name="scope" value="user" className="size-4" />פרטי (רק אני רואה)
      </label>
      <Field label="הערות (לא חובה)" htmlFor={f('notes')} className="sm:col-span-2">
        <textarea id={f('notes')} name="notes" maxLength={1000} rows={2} className={`${inputClass} h-auto py-2`} />
      </Field>
      <div className="flex items-center justify-between gap-3 sm:col-span-2">
        {state && !state.ok ? <p role="alert" className="text-sm text-critical-ink">{state.error}</p> : <span />}
        <Button type="submit" variant="primary" disabled={pending || Boolean(file.err)}>{pending ? 'מעלה…' : 'העלה'}</Button>
      </div>
    </form>
  );
}

// "גרסה חדשה" for one document
export function NewVersionDialog({ id, title, path }: { id: string; title: string; path: string }) {
  return (
    <FormDialog title={`גרסה חדשה · ${title}`} wide={false}
      triggerClass={buttonClass('ghost', 'sm', 'h-7 px-2 text-xs')}
      trigger={<><FilePlus2 className="size-3.5" aria-hidden />גרסה חדשה</>}>
      {close => <VersionForm id={id} path={path} onSaved={close} />}
    </FormDialog>
  );
}

function VersionForm({ id, path, onSaved }: { id: string; path: string; onSaved: () => void }) {
  const [state, action, pending] = useActionState<DocResult | null, FormData>(addDocumentVersion, null);
  const file = useFileCheck();
  const fid = useId();
  useEffect(() => { if (state?.ok) onSaved(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="path" value={path} />
      <Field label="קובץ (עד 4MB)" htmlFor={`${fid}-file`}>
        <input id={`${fid}-file`} name="file" type="file" required onChange={file.onChange} className="min-w-0 text-sm" />
      </Field>
      {file.err && <p role="alert" className="text-xs text-critical-ink">{file.err}</p>}
      <Field label="מה השתנה (לא חובה)" htmlFor={`${fid}-note`}>
        <input id={`${fid}-note`} name="note" maxLength={300} autoComplete="off" className={inputClass} />
      </Field>
      <div className="flex items-center justify-between gap-3">
        {state && !state.ok ? <p role="alert" className="text-sm text-critical-ink">{state.error}</p> : <span />}
        <Button type="submit" variant="primary" disabled={pending || Boolean(file.err)}>{pending ? 'מעלה…' : 'העלה גרסה'}</Button>
      </div>
    </form>
  );
}

export function RemoveDocumentButton({ id, title, path }: { id: string; title: string; path: string }) {
  const [pending, start] = useTransition();
  const label = `מחיקת המסמך ${title}`;
  return (
    <button type="button" disabled={pending} aria-label={label} title="מחיקה"
      onClick={() => {
        if (!confirm(`למחוק את "${title}"? (אפשר לשחזר מהמסד)`)) return;
        start(async () => {
          const r = await removeDocument(id, path);
          if (!r.ok) alert(r.error);
        });
      }}
      className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-critical-ink disabled:opacity-50">
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}

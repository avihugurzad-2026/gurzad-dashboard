import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { Collection, Rec } from '../data/types';
import { SCHEMAS } from '../data/schemas';
import { store } from '../data/store';
import { RecordSheet, useToast } from './overlay';

/** One hook = add / edit / delete-with-undo sheet for a collection. `scope` is merged into new records (e.g. business_id). */
export function useCrud(collection: Collection, scope?: Record<string, any>, opts?: { hide?: string[]; preset?: Record<string, any> }) {
  const schema = SCHEMAS[collection]!;
  const toast = useToast();
  const [state, setState] = useState<{ open: boolean; rec: Rec | null; preset?: Record<string, any> }>({ open: false, rec: null });
  const fields = useMemo(() => schema.fields.filter((f) => !opts?.hide?.includes(f.key)), [schema, opts?.hide]);
  const scopeKey = JSON.stringify(scope ?? {});

  const openNew = useCallback((preset?: Record<string, any>) => setState({ open: true, rec: null, preset }), []);
  const openEdit = useCallback((rec: Rec) => setState({ open: true, rec }), []);
  const remove = useCallback((rec: Rec) => {
    const undo = store.remove(collection, rec.id);
    toast(`${schema.singular} נמחק/ה`, undo);
  }, [collection, schema, toast]);

  const sheet: ReactNode = (
    <RecordSheet
      open={state.open}
      onClose={() => setState((s) => ({ ...s, open: false }))}
      title={state.rec ? `עריכת ${schema.singular}` : `${schema.singular} — הוספה`}
      fields={fields}
      initial={state.rec ?? { ...opts?.preset, ...state.preset }}
      onSave={(data) => {
        if (state.rec) { store.update(collection, state.rec.id, data); toast('נשמר'); }
        else { store.add(collection, { ...JSON.parse(scopeKey), ...data }); toast(`${schema.singular} נוסף/ה`); }
      }}
      onDelete={state.rec ? () => remove(state.rec!) : undefined}
    />
  );
  return { openNew, openEdit, remove, sheet, schema };
}

export function AddButton({ onClick, label, small }: { onClick: () => void; label: string; small?: boolean }) {
  return <button className={`btn btn-primary ${small ? 'btn-sm' : ''}`} onClick={onClick}><Plus size={16} />{label}</button>;
}

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Draft = { text: string; owner: string; due_week: string };
const blank = (): Draft => ({ text: '', owner: '', due_week: '' });

// The review's decisions. Saving writes to Supabase; the vault is updated by hand from the export.
export function DecisionsForm({ period }: { period: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>([blank()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (i: number, patch: Partial<Draft>) =>
    setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErrors([]); setSaved(false);
    const decisions = rows
      .filter(r => r.text.trim() || r.owner.trim() || r.due_week)
      // the week input gives "2026-W41" already
      .map(r => ({ text: r.text.trim(), owner: r.owner.trim(), due_week: r.due_week }));
    const res = await fetch('/api/v1/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions, notes: notes.trim() || null }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErrors(Array.isArray(body.errors) && body.errors.length ? body.errors.map(String) : [body.error ?? 'השמירה נכשלה']);
      return;
    }
    setRows([blank()]); setNotes(''); setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_150px_auto]">
          <input value={r.text} onChange={e => update(i, { text: e.target.value })} placeholder="ההחלטה"
            aria-label={`החלטה ${i + 1}`} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm" />
          <input value={r.owner} onChange={e => update(i, { owner: e.target.value })} placeholder="בעלים"
            aria-label={`בעלים להחלטה ${i + 1}`} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm" />
          <input type="week" value={r.due_week} onChange={e => update(i, { due_week: e.target.value })}
            aria-label={`שבוע יעד להחלטה ${i + 1}`} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm" />
          {rows.length > 1 && (
            <Button type="button" variant="ghost" size="icon" aria-label="הסרת ההחלטה"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}><X className="size-4" /></Button>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setRows([...rows, blank()])}>
          <Plus className="size-4" aria-hidden /> החלטה נוספת
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'שומר…' : `שמירת הסקירה (${period})`}
        </Button>
        {saved && <span className="text-sm text-good-ink">נשמר</span>}
      </div>

      <label className="text-sm text-ink-2" htmlFor="notes">הערות (לא חובה)</label>
      <textarea id="notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
        className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" />

      {errors.length > 0 && (
        <ul role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical-ink">
          {errors.map((m, i) => <li key={i}><bdi>{m}</bdi></li>)}
        </ul>
      )}
    </form>
  );
}

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

// Snoozing writes to Supabase only — never to the vault
export function SnoozeForm({ id }: { id: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch(`/api/v1/alerts/${id}/snooze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ until }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'הדחייה נכשלה'); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>דחה</Button>;
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`until-${id}`}>דחייה עד תאריך</label>
      <input id={`until-${id}`} type="date" required value={until} onChange={e => setUntil(e.target.value)}
        className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-sm" />
      <Button size="sm" variant="primary" type="submit" disabled={busy || !until}>שמור</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>ביטול</Button>
      {error && <span role="alert" className="text-xs text-critical-ink">{error}</span>}
    </form>
  );
}

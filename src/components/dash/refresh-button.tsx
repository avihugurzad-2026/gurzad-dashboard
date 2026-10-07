'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Pulls the latest months from Buyz into Supabase, then reloads the page data
export function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true); setMsg(null);
    const res = await fetch('/api/v1/ospa/refresh', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg(body.error ?? 'הרענון נכשל'); return; }
    setMsg(body.added || body.changed ? `עודכנו ${body.added + body.changed} חודשים` : 'אין שינויים');
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span role="status" className="text-xs text-muted">{msg}</span>}
      <Button size="sm" onClick={run} disabled={busy}>
        <RefreshCw className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden />
        רענן מ-Buyz
      </Button>
    </div>
  );
}

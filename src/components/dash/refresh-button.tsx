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
      {msg && <span role="status" className="text-sm text-muted">{msg}</span>}
      <Button size="md" onClick={run} disabled={busy} title="משיכת הנתונים האחרונים מ-Buyz">
        <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
        סנכרן
      </Button>
    </div>
  );
}

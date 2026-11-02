'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';

// The manual route is the same service used by the protected cron. Feedback is
// deliberately ephemeral: only the status, last sync and last error persisted
// by the server are shown as durable integration state.
export function BuyzSyncButton() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');

  async function sync() {
    setState('syncing');
    try {
      const res = await fetch('/api/v1/ospa/refresh', { method: 'POST' });
      if (!res.ok) throw new Error('sync failed');
      setState('done');
      router.refresh();
    } catch {
      setState('error');
    }
  }

  const syncing = state === 'syncing';
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" className={buttonClass('secondary', 'sm')} onClick={sync} disabled={syncing} aria-busy={syncing}>
        <RefreshCw className={syncing ? 'animate-spin' : undefined} aria-hidden />
        {syncing ? 'מסנכרן…' : 'סנכרן עכשיו'}
      </button>
      {state === 'done' && <span role="status" className="text-xs text-good-ink">הסנכרון הושלם</span>}
      {state === 'error' && <span role="alert" className="text-xs text-critical-ink">הסנכרון נכשל. בדוק את מצב החיבור.</span>}
    </div>
  );
}

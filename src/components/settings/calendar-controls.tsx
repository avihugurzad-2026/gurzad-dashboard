'use client';
import { useMemo, useState, useTransition } from 'react';
import { RefreshCw, Unplug } from 'lucide-react';
import { calendarDisconnect, calendarRefresh, setCalendarMapping } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { encodePlace, placeOptions, type Domain } from '@/lib/places';
import type { CalendarStatus } from '@/server/calendar';
import { cn } from '@/lib/utils';

export function CalendarActions() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await calendarRefresh(); setMsg(r.ok ? 'עודכן' : r.error); })}>
        <RefreshCw className={cn('size-4', pending && 'animate-spin')} aria-hidden />רענן עכשיו
      </Button>
      <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => { if (confirm('לנתק את יומן Google? האירועים יפסיקו להופיע.')) start(async () => { await calendarDisconnect(); }); }}>
        <Unplug className="size-4" aria-hidden />נתק
      </Button>
      {msg && <span role="status" className="text-xs text-muted">{msg}</span>}
    </div>
  );
}

// One Google calendar: show it or not, and (optionally) which area/business it belongs to
export function CalendarMappingRow({ cal }: { cal: CalendarStatus['calendars'][number] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(placeOptions, []);
  const current = cal.domain ? encodePlace({ domain: cal.domain as Domain, branch: cal.branch, location: cal.location }) : '';
  const save = (enabled: boolean, place: string) => start(async () => {
    const r = await setCalendarMapping(cal.id, enabled, place);
    setError(r.ok ? null : r.error);
  });
  return (
    <li className={cn('flex flex-wrap items-center gap-3 py-2.5', pending && 'opacity-60')}>
      <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <input type="checkbox" checked={cal.is_enabled} disabled={pending} onChange={e => save(e.target.checked, current)} className="size-4" />
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: cal.color ?? 'var(--series-1)' }} aria-hidden />
        <bdi className="truncate">{cal.name ?? cal.google_calendar_id}</bdi>
      </label>
      <label className="flex items-center gap-2 text-xs text-muted">שייך ל
        <select value={current} disabled={pending} onChange={e => save(cal.is_enabled, e.target.value)}
          className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink">
          <option value="">לא משויך</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="w-full text-xs text-critical-ink">{error}</p>}
    </li>
  );
}

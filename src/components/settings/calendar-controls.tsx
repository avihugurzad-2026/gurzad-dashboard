'use client';
import { useMemo, useState, useTransition } from 'react';
import { RefreshCw, Unplug } from 'lucide-react';
import { calendarDisconnectAction, calendarRefreshAction, setCalendarMappingAction, setCalendarShareAction, setDefaultWriteCalendarAction } from '@/app/calendar-actions';
import { Button } from '@/components/ui/button';
import { compactInputClass } from '@/components/work/fields';
import { encodePlace, placeOptions, type Domain } from '@/lib/places';
import type { CalendarStatus } from '@/server/calendar';
import { cn } from '@/lib/utils';

export function CalendarActions() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await calendarRefreshAction(); setMsg(r.ok ? 'עודכן' : r.error); })}>
        <RefreshCw className={cn(pending && 'animate-spin')} aria-hidden />רענן עכשיו
      </Button>
      <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => { if (confirm('לנתק את יומן Google? האירועים יפסיקו להופיע.')) start(async () => { await calendarDisconnectAction(); }); }}>
        <Unplug aria-hidden />נתק
      </Button>
      {msg && <span role="status" className="text-xs text-muted">{msg}</span>}
    </div>
  );
}

// One Google calendar: show it or not, which area/business it belongs to, shared with that
// place's members or private, and whether new events go to it by default
export function CalendarMappingRow({ cal }: { cal: CalendarStatus['calendars'][number] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(placeOptions, []);
  const current = cal.domain ? encodePlace({ domain: cal.domain as Domain, branch: cal.branch, location: cal.location }) : '';
  const save = (enabled: boolean, place: string) => start(async () => {
    const r = await setCalendarMappingAction(cal.id, enabled, place);
    setError(r.ok ? null : r.error);
  });
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const r = await fn();
    setError(r.ok ? null : r.error ?? 'לא נשמר');
  });
  return (
    <li className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 py-3', pending && 'opacity-60')}>
      <label className="flex min-w-0 flex-1 basis-48 items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" checked={cal.is_enabled} disabled={pending} onChange={e => save(e.target.checked, current)} className="size-4" />
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: cal.color ?? 'var(--series-1)' }} aria-hidden />
        <bdi className="truncate">{cal.name ?? cal.google_calendar_id}</bdi>
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-2">שייך ל
        <select value={current} disabled={pending} onChange={e => save(cal.is_enabled, e.target.value)}
          className={cn(compactInputClass, 'w-auto max-w-56 pe-7')}>
          <option value="">לא משויך</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-2" title="משותף: מי שיש לו גישה למקום ששויך יראה את האירועים. אחרת רק אתה.">
        <input type="checkbox" checked={cal.scope === 'shared'} disabled={pending || !cal.is_enabled} onChange={e => run(() => setCalendarShareAction(cal.id, e.target.checked))} className="size-4" />
        משותף
      </label>
      <label className={cn('flex items-center gap-2 text-sm', cal.writable ? 'text-ink-2' : 'text-muted')}
        title={cal.writable ? 'אירועים חדשים נכתבים ליומן הזה כשאין יומן שמשויך למקום' : 'אין הרשאת כתיבה ליומן הזה'}>
        <input type="radio" name="default-write-calendar" checked={cal.is_default_write} disabled={pending || !cal.writable || !cal.is_enabled}
          onChange={() => run(() => setDefaultWriteCalendarAction(cal.id))} className="size-4" />
        ברירת מחדל לאירועים חדשים
      </label>
      {error && <p role="alert" className="w-full text-sm text-critical-ink">{error}</p>}
    </li>
  );
}

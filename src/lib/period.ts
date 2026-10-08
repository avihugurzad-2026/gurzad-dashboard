// Date ranges for the header's time-range picker. Dates are ISO YYYY-MM-DD in Israel time.

export const RANGES = [
  { key: 'today', label: 'היום' },
  { key: 'week', label: 'השבוע' },
  { key: 'month', label: 'החודש' },
  { key: 'quarter', label: 'הרבעון' },
  { key: 'year', label: 'השנה' },
  { key: 'ytd', label: 'מתחילת השנה' },
] as const;

export type RangeKey = (typeof RANGES)[number]['key'];
export const DEFAULT_RANGE: RangeKey = 'month';

export function parseRange(v: unknown): RangeKey {
  return RANGES.some(r => r.key === v) ? (v as RangeKey) : DEFAULT_RANGE;
}

export function rangeLabel(key: RangeKey): string {
  return RANGES.find(r => r.key === key)!.label;
}

export function todayIL(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
}

// A DATE column as node-postgres returns it (a Date at local midnight) back to YYYY-MM-DD. Reading
// it with toISOString() shifts it a day back on a server east of UTC.
export function dbDate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

export function addDays(dIso: string, n: number): string {
  const d = utc(dIso);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

// Calendar period containing today. The Israeli week runs Sunday to Saturday.
export function periodBounds(key: RangeKey, today: string): { start: string; end: string } {
  const d = utc(today);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (key) {
    case 'today':
      return { start: today, end: today };
    case 'week': {
      const start = addDays(today, -d.getUTCDay());
      return { start, end: addDays(start, 6) };
    }
    case 'month':
      return { start: iso(new Date(Date.UTC(y, m, 1))), end: iso(new Date(Date.UTC(y, m + 1, 0))) };
    case 'quarter': {
      const q = Math.floor(m / 3) * 3;
      return { start: iso(new Date(Date.UTC(y, q, 1))), end: iso(new Date(Date.UTC(y, q + 3, 0))) };
    }
    case 'year':
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    case 'ytd':
      return { start: `${y}-01-01`, end: today };
  }
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utc(toIso).getTime() - utc(fromIso).getTime()) / 86400000);
}

// ── Israel wall-clock ↔ instants (DST-safe, no fixed offset) ──────────────────
const ilParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Jerusalem', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function ilOffsetMs(at: Date): number {
  const p = Object.fromEntries(ilParts.formatToParts(at).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

// The instant Israel's day `dIso` starts (local midnight), as a Date
export function ilDayStart(dIso: string): Date {
  const guess = Date.UTC(+dIso.slice(0, 4), +dIso.slice(5, 7) - 1, +dIso.slice(8, 10));
  const first = guess - ilOffsetMs(new Date(guess));
  return new Date(guess - ilOffsetMs(new Date(first)));
}

// Instant → Israel date "YYYY-MM-DD" and time "HH:MM"
export const ilDate = (ts: string | Date) => todayIL(new Date(ts));
const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const ilTime = (ts: string | Date) => hm.format(new Date(ts));

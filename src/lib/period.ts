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

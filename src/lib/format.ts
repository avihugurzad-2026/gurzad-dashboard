// Display helpers (he-IL). A null value is "no data", never 0.

export const NO_DATA = 'אין נתונים עדיין';

// Whole shekels stay whole ("₪1,200"); agorot are shown when there are any ("₪480.75", not "₪481")
const ilsFmt = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const ilsAgorot = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });

export function ils(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.abs(Math.round(n * 100) % 100) === 0 ? ilsFmt.format(n) : ilsAgorot.format(n);
}

export function num(n: number | null | undefined): string | null {
  return n === null || n === undefined || Number.isNaN(n) ? null : numFmt.format(n);
}

const dayMonth = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateTime = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

// ISO date (YYYY-MM-DD) → "7 באוק׳"
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return dayMonth.format(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`));
}

export function longDate(iso: string): string {
  return fullDate.format(new Date(`${iso}T00:00:00Z`));
}

// Timestamp → "7 באוק׳, 14:05" in Israel time
export function stamp(ts: string | null | undefined): string {
  return ts ? dateTime.format(new Date(ts)) : '';
}

export function daysAgo(days: number | null | undefined): string {
  if (days === null || days === undefined) return '';
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  return `לפני ${days} ימים`;
}

export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Jerusalem' }).format(now));
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

// ISO week "2026-W41" → "שבוע 41"
export function weekLabel(period: string): string {
  return `שבוע ${Number(period.split('-W')[1])}`;
}

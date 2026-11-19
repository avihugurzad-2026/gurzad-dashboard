const ils0 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const num0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('he-IL', { style: 'percent', maximumFractionDigits: 0 });
const dShort = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' });
const dLong = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
const mName = new Intl.DateTimeFormat('he-IL', { month: 'short' });
const mLong = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
const time = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });

let hidden = false;
export const setHideAmounts = (v: boolean) => { hidden = v; };

export const money = (v: number | undefined | null) =>
  v == null || Number.isNaN(v) ? '—' : hidden ? '₪ •••' : ils0.format(v);
export const moneyRaw = (v: number) => ils0.format(v);
export const number = (v: number) => (hidden ? '•••' : num0.format(v));
export const percent = (v: number) => pct.format(v);

export const today = () => iso(new Date());
export const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const addDays = (base: string | Date, n: number) => {
  const d = typeof base === 'string' ? new Date(base + 'T12:00:00') : new Date(base);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const daysUntil = (date?: string) => {
  if (!date) return Infinity;
  const a = new Date(today() + 'T12:00:00').getTime();
  const b = new Date(date + 'T12:00:00').getTime();
  return Math.round((b - a) / 86400000);
};
export const shortDate = (date?: string) => (date ? dShort.format(new Date(date + 'T12:00:00')) : '—');
export const longDate = (date?: string) => (date ? dLong.format(new Date(date + 'T12:00:00')) : '—');
export const monthName = (ym: string) => mName.format(new Date(ym + '-15T12:00:00'));
export const monthLong = (ym: string) => mLong.format(new Date(ym + '-15T12:00:00'));
export const clock = (isoTs: string) => time.format(new Date(isoTs));
export const thisMonth = () => today().slice(0, 7);
export const monthsBack = (n: number) => {
  const out: string[] = [];
  const d = new Date(today() + 'T12:00:00');
  d.setDate(15);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setMonth(d.getMonth() - i);
    out.push(iso(x).slice(0, 7));
  }
  return out;
};

export const relDay = (date?: string) => {
  const n = daysUntil(date);
  if (n === Infinity) return '';
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  if (n === -1) return 'אתמול';
  if (n > 1 && n < 14) return `בעוד ${n} ימים`;
  if (n < -1 && n > -60) return `לפני ${-n} ימים`;
  return shortDate(date);
};

export const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
};

export const uid = () =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

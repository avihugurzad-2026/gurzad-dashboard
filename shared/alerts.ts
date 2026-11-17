// Alert engine — shared by the app (browser) and the push cron (server), so the phone gets
// exactly the same "דורש תשומת לב" list the dashboard shows. Pure: data comes in through `get`.
import type { Row } from './agent';

export type AlertArea = 'home' | 'business' | 'invest';
export type AlertLevel = 'danger' | 'warn' | 'info';
export type Alert = { id: string; level: AlertLevel; area: AlertArea; title: string; detail: string; to: string; sort: number };
export type AlertCtx = { today: string; money?: (n: number) => string };

const ils = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL');
const sum = (rows: Row[], key: string) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

export function computeAlerts(get: (collection: string) => Row[], ctx: AlertCtx): Alert[] {
  const money = ctx.money ?? ils;
  const t0 = new Date(ctx.today + 'T12:00:00').getTime();
  const daysUntil = (date?: string) => (date ? Math.round((new Date(date + 'T12:00:00').getTime() - t0) / 86400000) : Infinity);
  const dd = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  const relDay = (date?: string) => {
    const n = daysUntil(date);
    if (n === Infinity || !date) return '';
    if (n === 0) return 'היום';
    if (n === 1) return 'מחר';
    if (n === -1) return 'אתמול';
    if (n > 1 && n < 14) return `בעוד ${n} ימים`;
    if (n < -1 && n > -60) return `לפני ${-n} ימים`;
    return dd(date);
  };
  const param = (key: string, date = ctx.today): number | undefined =>
    get('parameters').filter((p) => p.key === key && p.effective_from <= date)
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]?.value;
  const gross = (inv: Row) => Math.round((inv.amount_net || 0) * (1 + (param('vat_rate', inv.issue_date) ?? 0)));
  const live = (inv: Row) => inv.status !== 'בוטלה' && inv.status !== 'טיוטה';

  const out: Alert[] = [];
  const push = (a: Alert) => out.push(a);
  const ym = ctx.today.slice(0, 7);

  // ---- home ----
  get('home_tasks').filter((t) => !t.done && t.due && daysUntil(t.due) < 0).forEach((t) =>
    push({ id: 'ht' + t.id, level: 'warn', area: 'home', title: t.title, detail: `משימת בית באיחור · ${relDay(t.due)}`, to: '/home/tasks', sort: daysUntil(t.due) }));
  get('bills').filter((b) => daysUntil(b.next_due) <= 3).forEach((b) =>
    push({ id: 'b' + b.id, level: daysUntil(b.next_due) < 0 ? 'danger' : 'warn', area: 'home', title: `${b.name} · ${money(b.amount)}`, detail: `חשבון לתשלום ${relDay(b.next_due)}`, to: '/home/bills', sort: daysUntil(b.next_due) }));
  get('documents').filter((d) => d.expires && daysUntil(d.expires) <= 14).forEach((d) =>
    push({ id: 'd' + d.id, level: daysUntil(d.expires) < 0 ? 'danger' : 'warn', area: 'home', title: d.title, detail: `פג תוקף ${relDay(d.expires)}`, to: '/home/documents', sort: daysUntil(d.expires) }));
  get('maintenance').filter((m) => m.next_service && daysUntil(m.next_service) <= 7).forEach((m) =>
    push({ id: 'mt' + m.id, level: 'warn', area: 'home', title: m.item ?? 'תחזוקה', detail: `טיפול ${relDay(m.next_service)}`, to: '/home/maintenance', sort: daysUntil(m.next_service) }));
  const tx = get('transactions').filter((t) => (t.date || '').startsWith(ym) && t.kind === 'הוצאה');
  get('budgets').forEach((b) => {
    const spent = sum(tx.filter((t) => t.category === b.category), 'amount');
    if (b.monthly && spent > b.monthly)
      push({ id: 'bud' + b.category + ym, level: 'warn', area: 'home', title: `חריגה בתקציב · ${b.category}`, detail: `${money(spent)} מתוך ${money(b.monthly)}`, to: '/home/budget', sort: 5 });
  });

  // ---- business ----
  get('businesses').forEach((b) => {
    const inv = get('invoices').filter((i) => i.business_id === b.id);
    inv.filter((i) => live(i) && i.status !== 'שולמה' && i.due_date && daysUntil(i.due_date) < 0).forEach((i) =>
      push({ id: 'io' + i.id, level: daysUntil(i.due_date) < -30 ? 'danger' : 'warn', area: 'business', title: `${b.name} · ${i.client}`, detail: `חשבונית ${i.number} באיחור ${-daysUntil(i.due_date)} ימים · ${money(gross(i))}`, to: `/business/${b.id}/invoices`, sort: daysUntil(i.due_date) }));
    inv.filter((i) => { const t = param('allocation_threshold', i.issue_date); return t != null && (i.amount_net || 0) > t && !i.allocation_number && live(i); }).forEach((i) =>
      push({ id: 'ia' + i.id, level: 'danger', area: 'business', title: `${b.name} · חסר מספר הקצאה`, detail: `חשבונית ${i.number} · ${i.client}`, to: `/business/${b.id}/invoices`, sort: -100 }));
    get('biz_tasks').filter((t) => t.business_id === b.id && !t.done && t.due && daysUntil(t.due) < 0).forEach((t) =>
      push({ id: 'bt' + t.id, level: 'warn', area: 'business', title: `${b.name} · ${t.title}`, detail: `משימה באיחור · ${relDay(t.due)}`, to: `/business/${b.id}/tasks`, sort: daysUntil(t.due) }));
  });

  // ---- investments — driven by user-defined rules ----
  const rules = get('alert_rules').filter((r) => r.enabled);
  const rule = (k: string) => rules.find((r) => r.kind === k);
  get('properties').forEach((p) => {
    const pays = get('rent_payments').filter((x) => x.property_id === p.id);
    const lease = get('leases').filter((l) => l.property_id === p.id).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    const lateRule = rule('איחור בתשלום שכירות');
    if (lateRule) pays.filter((x) => (x.paid_amount || 0) < (x.amount || 0) && daysUntil(x.due_date) < 0 && -daysUntil(x.due_date) >= (lateRule.threshold ?? 0)).forEach((x) =>
      push({ id: 'rp' + x.id, level: 'danger', area: 'invest', title: `${p.name} · שכירות לא שולמה`, detail: `${money(x.amount - (x.paid_amount || 0))} · ${-daysUntil(x.due_date)} ימים באיחור`, to: `/invest/${p.id}/payments`, sort: daysUntil(x.due_date) }));
    const le = rule('סיום חוזה מתקרב');
    if (le && lease && daysUntil(lease.end) <= (le.threshold ?? 90) && daysUntil(lease.end) >= -30)
      push({ id: 'le' + p.id, level: daysUntil(lease.end) <= 30 ? 'danger' : 'warn', area: 'invest', title: `${p.name} · חוזה מסתיים`, detail: `בעוד ${daysUntil(lease.end)} ימים — זמן לחדש או לחפש שוכר`, to: `/invest/${p.id}/lease`, sort: daysUntil(lease.end) });
    const ins = rule('ביטוח מבנה פג');
    if (ins && p.insurance_until && daysUntil(p.insurance_until) <= (ins.threshold ?? 30))
      push({ id: 'in' + p.id, level: 'warn', area: 'invest', title: `${p.name} · ביטוח מבנה`, detail: `פג ${relDay(p.insurance_until)}`, to: `/invest/${p.id}`, sort: daysUntil(p.insurance_until) });
    const ot = rule('משימה פתוחה זמן רב');
    if (ot) get('prop_tasks').filter((t) => t.property_id === p.id && !t.done && t.due && -daysUntil(t.due) >= (ot.threshold ?? 7)).forEach((t) =>
      push({ id: 'pt' + t.id, level: 'warn', area: 'invest', title: `${p.name} · ${t.title}`, detail: `פתוחה ${-daysUntil(t.due)} ימים אחרי היעד`, to: `/invest/${p.id}/tasks`, sort: daysUntil(t.due) }));
    const vac = rule('נכס פנוי');
    if (vac && p.status === 'פנוי')
      push({ id: 'va' + p.id, level: 'warn', area: 'invest', title: `${p.name} · עומד ריק`, detail: 'אין שוכר פעיל', to: `/invest/${p.id}`, sort: 0 });
  });

  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.sort - b.sort);
}

/** Notification preferences stored per device subscription. */
export type NotifyPrefs = { areas: AlertArea[]; urgentOnly: boolean };
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = { areas: ['home', 'business', 'invest'], urgentOnly: false };
export const wants = (a: Alert, p: NotifyPrefs) => p.areas.includes(a.area) && (!p.urgentOnly || a.level === 'danger');

/** One push message for a batch of alerts. */
export function digest(list: Alert[]): { title: string; body: string; url: string; tag: string } | null {
  if (!list.length) return null;
  if (list.length === 1) return { title: list[0].title, body: list[0].detail, url: list[0].to, tag: list[0].id };
  const urgent = list.filter((a) => a.level === 'danger').length;
  return {
    title: urgent ? `${list.length} דברים מחכים לך · ${urgent} דחופים` : `${list.length} דברים מחכים לך`,
    body: list.slice(0, 3).map((a) => `• ${a.title}`).join('\n') + (list.length > 3 ? `\nועוד ${list.length - 3}` : ''),
    url: '/notifications', tag: 'digest',
  };
}

// Task categories, planner items and reminder templates. Pure code shared by the app and the server.

export type Category = { name: string; color: string; cssVar: string };
/** Colour per task category. The CSS variables live in tokens.css; the hex values are for emails and Google. */
export const CATEGORIES: Category[] = [
  { name: 'בית', color: '#2F9E8F', cssVar: '--cat-home' },
  { name: 'כספים', color: '#E0A030', cssVar: '--cat-money' },
  { name: 'עבודה', color: '#3340D6', cssVar: '--cat-work' },
  { name: 'לקוחות', color: '#8B7FE8', cssVar: '--cat-clients' },
  { name: 'משפחה', color: '#E26D8F', cssVar: '--cat-family' },
  { name: 'בריאות', color: '#58B368', cssVar: '--cat-health' },
  { name: 'סידורים', color: '#5F8A99', cssVar: '--cat-errands' },
  { name: 'נכסים', color: '#A3AD0C', cssVar: '--cat-property' },
];
export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
export const GOOGLE_CATEGORY = 'Google';
const FALLBACK: Record<string, string> = { home_tasks: 'בית', biz_tasks: 'עבודה', prop_tasks: 'נכסים', events: 'סידורים' };
export const categoryOf = (collection: string, rec: Record<string, any>) =>
  rec.category && CATEGORY_NAMES.includes(rec.category) ? rec.category : FALLBACK[collection] ?? 'סידורים';
export const catVar = (name: string) => (name === GOOGLE_CATEGORY ? 'var(--cat-google)' : `var(${CATEGORIES.find((c) => c.name === name)?.cssVar ?? '--cat-errands'})`);
export const catHex = (name: string) => CATEGORIES.find((c) => c.name === name)?.color ?? '#5F8A99';

export const PLAN_COLLECTIONS = ['home_tasks', 'biz_tasks', 'prop_tasks', 'events'] as const;
export type PlanCollection = (typeof PLAN_COLLECTIONS)[number];
export const AREA_OF: Record<PlanCollection, 'home' | 'business' | 'invest' | 'shared'> = { home_tasks: 'home', biz_tasks: 'business', prop_tasks: 'invest', events: 'home' };
export const dateOf = (collection: string, rec: Record<string, any>): string => String((collection === 'events' ? rec.date : rec.due) || '').slice(0, 10);

/* ---------- reminder templates ---------- */
export type ReminderSettings = {
  enabled: boolean;
  on_assign: boolean;
  days_before: number;
  assign_subject: string; assign_body: string;
  before_subject: string; before_body: string;
};
export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: true,
  on_assign: true,
  days_before: 1,
  assign_subject: 'צוותת למשימה: {משימה}',
  assign_body: 'היי {שם},\n{מאת} צירף אותך למשימה "{משימה}".\nמתי: {תאריך} {שעה}\nסיווג: {קטגוריה}\n\nלפתיחה בדשבורד: {קישור}',
  before_subject: 'תזכורת למחר: {משימה}',
  before_body: 'היי {שם},\nרק להזכיר: "{משימה}" מתוכנן ל{תאריך} {שעה}.\nסיווג: {קטגוריה}\n\nלפתיחה בדשבורד: {קישור}',
};
export const TEMPLATE_VARS = ['שם', 'משימה', 'תאריך', 'שעה', 'קטגוריה', 'מאת', 'קישור'] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARS)[number], string>>;
export const SETTINGS_KEY = 'reminders';

export function mergeReminders(saved?: Record<string, any> | null): ReminderSettings {
  const out: any = { ...DEFAULT_REMINDERS };
  for (const k of Object.keys(DEFAULT_REMINDERS) as (keyof ReminderSettings)[]) {
    const v = saved?.[k];
    if (typeof v === typeof DEFAULT_REMINDERS[k] && v !== '') out[k] = v;
  }
  out.days_before = Math.min(14, Math.max(0, Math.round(Number(out.days_before)) || 0));
  return out;
}
/** Fill {placeholders}. Unknown ones are left as they are so a typo is visible in the preview. */
export function fillTemplate(tpl: string, vars: TemplateVars): string {
  return tpl.replace(/\{([^{}\n]{1,20})\}/g, (m, k: string) => (k.trim() in vars ? (vars as any)[k.trim()] ?? '' : m))
    .replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}
export const heDate = (iso: string) => new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
export function varsFor(collection: string, rec: Record<string, any>, extra: { from?: string; url?: string }): TemplateVars {
  const date = dateOf(collection, rec);
  return {
    'שם': String(rec.assignee || '').trim(),
    'משימה': String(rec.title || '').trim(),
    'תאריך': date ? heDate(date) : 'ללא תאריך',
    'שעה': rec.time ? `בשעה ${rec.time}` : '',
    'קטגוריה': categoryOf(collection, rec),
    'מאת': extra.from ?? '',
    'קישור': extra.url ?? '',
  };
}
export const addDaysIso = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

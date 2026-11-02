// Activity log (3.6): turns an activity_log row into a short Hebrew sentence — "אביהו יצר משימה",
// "עדן סימנה תשלום", "סנכרון Buyz". Pure, so the page, the panels and tests share it.

// Hebrew verbs agree with the actor. users has no gender column yet, so no id is assumed feminine.
const FEMININE = new Set<string>();

type Meta = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type V = [string, string];       // [masculine, feminine]
type Rule = V | string | ((m: Meta) => V | string);

const STATUS_LABEL: Record<string, string> = { todo: 'לביצוע', in_progress: 'בעבודה', waiting: 'ממתין', done: 'בוצע', cancelled: 'בוטל' };
const PROVIDER: Record<string, string> = { buyz: 'Buyz', google: 'Google', obsidian: 'Obsidian' };
const ROLE: Record<string, string> = { owner: 'בעלים', admin: 'מנהל מערכת', manager: 'מנהל', employee: 'עובד', viewer: 'צופה' };

export const OBJECT_TYPES: { id: string; label: string }[] = [
  { id: 'task', label: 'משימות' }, { id: 'document', label: 'מסמכים' }, { id: 'transaction', label: 'תנועות' },
  { id: 'receivable', label: 'גבייה' }, { id: 'goal', label: 'יעדים' }, { id: 'inbox_item', label: 'Inbox' },
  { id: 'calendar', label: 'יומן' }, { id: 'asset', label: 'נכסים' }, { id: 'liability', label: 'הלוואות' },
  { id: 'investment', label: 'השקעות' }, { id: 'legal_case', label: 'תיקים משפטיים' }, { id: 'case_deadline', label: 'מועדים משפטיים' },
  { id: 'contact', label: 'אנשי קשר' }, { id: 'integration', label: 'סנכרונים' }, { id: 'invitation', label: 'הזמנות' },
  { id: 'membership', label: 'הרשאות' },
];

const RULES: Record<string, Rule> = {
  'task:create': ['יצר משימה', 'יצרה משימה'],
  'task:status': m => m.status === 'done' ? ['סימן משימה כבוצעה', 'סימנה משימה כבוצעה']
    : m.status === 'cancelled' ? ['ביטל משימה', 'ביטלה משימה']
    : [`העביר משימה ל«${STATUS_LABEL[m.status] ?? m.status}»`, `העבירה משימה ל«${STATUS_LABEL[m.status] ?? m.status}»`],
  'task:priority': m => [`שינה עדיפות משימה ל-P${m.priority}`, `שינתה עדיפות משימה ל-P${m.priority}`],
  'task:delete': ['מחק משימה', 'מחקה משימה'],
  'inbox_item:create': m => m.file ? ['העלה קובץ ל-Inbox', 'העלתה קובץ ל-Inbox'] : ['הוסיף פריט ל-Inbox', 'הוסיפה פריט ל-Inbox'],
  'inbox_item:classify': ['שייך פריט מה-Inbox', 'שייכה פריט מה-Inbox'],
  'inbox_item:delete': ['מחק פריט מה-Inbox', 'מחקה פריט מה-Inbox'],
  'goal:create': ['יצר יעד', 'יצרה יעד'],
  'goal:progress': ['עדכן התקדמות ביעד', 'עדכנה התקדמות ביעד'],
  'goal:status': m => m.status === 'done' ? ['סימן יעד כהושג', 'סימנה יעד כהושג']
    : m.status === 'dropped' ? ['ויתר על יעד', 'ויתרה על יעד'] : ['החזיר יעד לפעיל', 'החזירה יעד לפעיל'],
  'invitation:create': m => [`הזמין משתמש (${ROLE[m.role] ?? m.role ?? ''})`, `הזמינה משתמש (${ROLE[m.role] ?? m.role ?? ''})`],
  'invitation:accept': ['הצטרף למערכת', 'הצטרפה למערכת'],
  'invitation:revoke': ['ביטל הזמנה', 'ביטלה הזמנה'],
  'membership:revoke': ['הסיר הרשאה', 'הסירה הרשאה'],
  'transaction:create': m => m.direction === 'income' ? ['רשם הכנסה', 'רשמה הכנסה'] : ['רשם הוצאה', 'רשמה הוצאה'],
  'transaction:update': ['עדכן תנועה', 'עדכנה תנועה'],
  'transaction:delete': ['מחק תנועה', 'מחקה תנועה'],
  'receivable:create': ['פתח חוב לגבייה', 'פתחה חוב לגבייה'],
  'receivable:payment': ['סימן תשלום', 'סימנה תשלום'],
  'receivable:delete': ['מחק חוב לגבייה', 'מחקה חוב לגבייה'],
  'document:create': ['העלה מסמך', 'העלתה מסמך'],
  'document:version': m => [`העלה גרסה ${m.version ?? 'חדשה'} למסמך`, `העלתה גרסה ${m.version ?? 'חדשה'} למסמך`],
  'document:delete': ['מחק מסמך', 'מחקה מסמך'],
  'asset:create': ['הוסיף נכס', 'הוסיפה נכס'],
  'asset:update_value': ['עדכן שווי נכס', 'עדכנה שווי נכס'],
  'asset:delete': ['מחק נכס', 'מחקה נכס'],
  'liability:create': ['הוסיף הלוואה', 'הוסיפה הלוואה'],
  'liability:repayment': ['רשם החזר הלוואה', 'רשמה החזר הלוואה'],
  'liability:repayment_undo': ['ביטל החזר הלוואה', 'ביטלה החזר הלוואה'],
  'liability:delete': ['מחק הלוואה', 'מחקה הלוואה'],
  'investment:create': ['הוסיף השקעה', 'הוסיפה השקעה'],
  'investment:update': ['עדכן השקעה', 'עדכנה השקעה'],
  'investment:delete': ['מחק השקעה', 'מחקה השקעה'],
  'legal_case:create': ['פתח תיק משפטי', 'פתחה תיק משפטי'],
  'legal_case:update': ['עדכן תיק משפטי', 'עדכנה תיק משפטי'],
  'legal_case:delete': ['מחק תיק משפטי', 'מחקה תיק משפטי'],
  'case_deadline:create': ['הוסיף מועד לתיק', 'הוסיפה מועד לתיק'],
  'case_deadline:done': ['סימן מועד כבוצע', 'סימנה מועד כבוצע'],
  'case_deadline:reopen': ['פתח מחדש מועד', 'פתחה מחדש מועד'],
  'case_deadline:delete': ['מחק מועד', 'מחקה מועד'],
  'contact:create': ['הוסיף איש קשר', 'הוסיפה איש קשר'],
  'contact:unlink': ['הסיר איש קשר', 'הסירה איש קשר'],
  // Calendar (lib/gcal.js + src/server/calendar.ts)
  'calendar:event_created': ['יצר אירוע ביומן', 'יצרה אירוע ביומן'],
  'calendar:event_updated': ['עדכן אירוע ביומן', 'עדכנה אירוע ביומן'],
  'calendar:event_deleted': ['מחק אירוע מהיומן', 'מחקה אירוע מהיומן'],
  'calendar:conflict_resolved': ['פתר התנגשות ביומן', 'פתרה התנגשות ביומן'],
  'calendar:task_event_linked': ['הציג משימה ביומן', 'הציגה משימה ביומן'],
  'calendar:mapping_updated': ['עדכן הגדרות יומן', 'עדכנה הגדרות יומן'],
  'calendar:disconnected': ['ניתק את יומן Google', 'ניתקה את יומן Google'],
  'calendar:event_conflict': 'התנגשות בעדכון אירוע ביומן',
  'calendar:channel_started': 'מעקב שינויים ביומן הופעל',
  'calendar:channel_failed': 'הפעלת מעקב שינויים ביומן נכשלה',
  'calendar:sync_failed': 'סנכרון יומן Google נכשל',
  'calendar:auth_failed': 'החיבור ליומן Google נכשל',
};

// { actor, text, system }: `actor` is null for system rows ("סנכרון Buyz"), `text` is the predicate
export function describeActivity(row: { user_id: string | null; user_name: string | null; object_type: string; object_id?: string; action: string; metadata: Meta }):
  { actor: string | null; text: string } {
  const m = row.metadata ?? {};
  const fem = row.user_id ? FEMININE.has(row.user_id) : false;
  const actor = row.user_id ? (row.user_name ?? row.user_id) : null;
  if (row.action === 'sync' || row.object_type === 'integration') {
    const p = PROVIDER[m.provider] ?? m.provider ?? row.object_id ?? '';
    const failed = m.status === 'error' || m.error_code;
    return { actor: null, text: `סנכרון ${p}${failed ? ' נכשל' : ''}`.trim() };
  }
  const rule = RULES[`${row.object_type}:${row.action}`];
  if (rule) {
    const r = typeof rule === 'function' ? rule(m) : rule;
    if (typeof r === 'string') return { actor: null, text: r };
    return { actor: actor ?? 'המערכת', text: fem ? r[1] : r[0] };
  }
  if (row.object_type === 'calendar' && row.action.endsWith('_failed')) return { actor: null, text: 'פעולה ביומן Google נכשלה' };
  const type = OBJECT_TYPES.find(t => t.id === row.object_type)?.label ?? row.object_type;
  return { actor: actor ?? 'המערכת', text: `${row.action} · ${type}` };
}

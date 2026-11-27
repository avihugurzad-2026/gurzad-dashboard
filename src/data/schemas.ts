import type { Collection, FieldDef } from './types';
import { today, thisMonth } from '../lib/format';
import { CATEGORY_NAMES } from '../../shared/planner';

export const HOME_CATEGORIES = ['סופר ומזון', 'דיור ומשכנתא', 'חשמל מים וגז', 'תחבורה ורכב', 'ילדים וחינוך', 'בריאות', 'בילויים ומסעדות', 'ביגוד', 'תקשורת ומנויים', 'ביטוחים', 'חיסכון והשקעה', 'שונות'];
export const INCOME_CATEGORIES = ['משכורת', 'משיכה מהעסק', 'שכירות', 'החזרים', 'אחר'];
export const SHOP_DEPTS = ['ירקות ופירות', 'חלב וביצים', 'מאפייה', 'בשר ודגים', 'יבשים ושימורים', 'קפואים', 'ניקיון', 'פארם', 'אחר'];
export const PAY_METHODS = ['אשראי', 'הוראת קבע', 'העברה בנקאית', 'מזומן', 'ביט / פייבוקס'];

const category = (def: string): FieldDef => ({ key: 'category', label: 'סיווג', type: 'select', options: CATEGORY_NAMES, default: def, half: true, hint: 'קובע את הצבע בלוחות' });
const time: FieldDef = { key: 'time', label: 'שעה', type: 'time', half: true };
const assignee: FieldDef = { key: 'assignee', label: 'אחראי', type: 'member', half: true, hint: 'מקבל מייל כשמצוות, ותזכורת יום לפני' };
const priority: FieldDef = { key: 'priority', label: 'עדיפות', type: 'select', options: ['רגילה', 'גבוהה', 'נמוכה'], default: 'רגילה', half: true };

export const SCHEMAS: Partial<Record<Collection, { title: string; singular: string; fields: FieldDef[] }>> = {
  home_tasks: {
    title: 'משימות הבית', singular: 'משימה',
    fields: [
      { key: 'title', label: 'מה צריך לעשות', type: 'text', required: true },
      { key: 'due', label: 'עד מתי', type: 'date', half: true },
      time,
      category('בית'),
      assignee,
      { key: 'repeat', label: 'חוזר', type: 'select', options: ['לא חוזר', 'כל יום', 'כל שבוע', 'כל חודש'], default: 'לא חוזר', half: true },
      priority,
      { key: 'done', label: 'בוצע', type: 'bool', default: false },
    ],
  },
  shopping: {
    title: 'רשימת קניות', singular: 'פריט',
    fields: [
      { key: 'name', label: 'פריט', type: 'text', required: true },
      { key: 'qty', label: 'כמות', type: 'text', half: true, placeholder: '1' },
      { key: 'dept', label: 'מחלקה', type: 'select', options: SHOP_DEPTS, default: 'אחר', half: true },
      { key: 'done', label: 'נקנה', type: 'bool', default: false },
    ],
  },
  transactions: {
    title: 'תנועות', singular: 'תנועה',
    fields: [
      { key: 'title', label: 'תיאור', type: 'text', required: true, placeholder: 'למשל: שופרסל' },
      { key: 'amount', label: 'סכום', type: 'money', required: true, half: true },
      { key: 'kind', label: 'סוג', type: 'select', options: ['הוצאה', 'הכנסה'], default: 'הוצאה', half: true },
      { key: 'category', label: 'קטגוריה', type: 'select', options: [...HOME_CATEGORIES, ...INCOME_CATEGORIES], default: 'סופר ומזון', half: true },
      { key: 'date', label: 'תאריך', type: 'date', default: () => today(), half: true },
      { key: 'method', label: 'אמצעי תשלום', type: 'select', options: PAY_METHODS, default: 'אשראי', half: true },
      { key: 'note', label: 'הערה', type: 'textarea' },
    ],
  },
  budgets: {
    title: 'תקציב חודשי', singular: 'סעיף תקציב',
    fields: [
      { key: 'category', label: 'קטגוריה', type: 'select', options: HOME_CATEGORIES, required: true, half: true },
      { key: 'monthly', label: 'תקציב לחודש', type: 'money', required: true, half: true },
    ],
  },
  bills: {
    title: 'חשבונות ומנויים', singular: 'חשבון',
    fields: [
      { key: 'name', label: 'שם', type: 'text', required: true, placeholder: 'חשמל, ארנונה, נטפליקס…' },
      { key: 'amount', label: 'סכום משוער', type: 'money', half: true },
      { key: 'frequency', label: 'תדירות', type: 'select', options: ['חודשי', 'דו־חודשי', 'רבעוני', 'שנתי'], default: 'חודשי', half: true },
      { key: 'next_due', label: 'מועד הבא', type: 'date', half: true },
      { key: 'method', label: 'אמצעי תשלום', type: 'select', options: PAY_METHODS, default: 'הוראת קבע', half: true },
      { key: 'category', label: 'קטגוריה', type: 'select', options: HOME_CATEGORIES, default: 'חשמל מים וגז', half: true },
      { key: 'provider', label: 'ספק / מספר לקוח', type: 'text', half: true },
    ],
  },
  maintenance: {
    title: 'תחזוקה ואחריות', singular: 'פריט',
    fields: [
      { key: 'item', label: 'מכשיר / מערכת', type: 'text', required: true },
      { key: 'location', label: 'מיקום', type: 'text', half: true },
      { key: 'vendor', label: 'ספק / טכנאי', type: 'text', half: true },
      { key: 'warranty_until', label: 'אחריות עד', type: 'date', half: true },
      { key: 'next_service', label: 'טיפול הבא', type: 'date', half: true },
      { key: 'note', label: 'הערה', type: 'textarea' },
    ],
  },
  documents: {
    title: 'מסמכים', singular: 'מסמך',
    fields: [
      { key: 'title', label: 'שם המסמך', type: 'text', required: true },
      { key: 'type', label: 'סוג', type: 'select', options: ['ביטוח', 'חוזה', 'אחריות', 'רכב', 'בריאות', 'מס', 'אחר'], default: 'ביטוח', half: true },
      { key: 'expires', label: 'בתוקף עד', type: 'date', half: true },
      { key: 'link', label: 'קישור לקובץ', type: 'url' },
      { key: 'note', label: 'הערה', type: 'textarea' },
    ],
  },
  businesses: {
    title: 'עסקים', singular: 'עסק',
    fields: [
      { key: 'name', label: 'שם העסק', type: 'text', required: true },
      { key: 'kind', label: 'תחום', type: 'select', options: ['משרד פרסום', 'ספא וטיפוח', 'מסחר', 'שירותים', 'אחר'], default: 'שירותים', half: true },
      { key: 'owner_pct', label: 'אחוז בעלות', type: 'number', default: 100, half: true },
      { key: 'vat_mode', label: 'דיווח מע״מ', type: 'select', options: ['חודשי', 'דו־חודשי', 'עוסק פטור'], default: 'חודשי', half: true },
      { key: 'site', label: 'אתר', type: 'url', half: true },
    ],
  },
  invoices: {
    title: 'חשבוניות', singular: 'חשבונית',
    fields: [
      { key: 'number', label: 'מספר', type: 'text', required: true, half: true },
      { key: 'client', label: 'לקוח', type: 'text', required: true, half: true },
      { key: 'amount_net', label: 'סכום לפני מע״מ', type: 'money', required: true, half: true },
      { key: 'status', label: 'סטטוס', type: 'select', options: ['טיוטה', 'נשלחה', 'שולמה', 'בוטלה'], default: 'נשלחה', half: true },
      { key: 'issue_date', label: 'תאריך הפקה', type: 'date', default: () => today(), half: true },
      { key: 'due_date', label: 'לתשלום עד', type: 'date', half: true },
      { key: 'allocation_number', label: 'מספר הקצאה', type: 'text', hint: 'נדרש מעל סף ההקצאה' },
    ],
  },
  clients: {
    title: 'לקוחות', singular: 'לקוח',
    fields: [
      { key: 'name', label: 'שם', type: 'text', required: true },
      { key: 'contact', label: 'איש קשר', type: 'text', half: true },
      { key: 'phone', label: 'טלפון', type: 'tel', half: true },
      { key: 'monthly_fee', label: 'ריטיינר חודשי (לפני מע״מ)', type: 'money', half: true },
      { key: 'status', label: 'סטטוס', type: 'select', options: ['פעיל', 'בהקפאה', 'הסתיים', 'ליד'], default: 'פעיל', half: true },
    ],
  },
  biz_expenses: {
    title: 'הוצאות', singular: 'הוצאה',
    fields: [
      { key: 'title', label: 'תיאור', type: 'text', required: true },
      { key: 'supplier', label: 'ספק', type: 'text', half: true },
      { key: 'amount_net', label: 'סכום לפני מע״מ', type: 'money', required: true, half: true },
      { key: 'category', label: 'קטגוריה', type: 'select', options: ['שכר', 'שכירות', 'שיווק ופרסום', 'תוכנות', 'חומרים ומלאי', 'רכב', 'מקצועי (רו״ח/עו״ד)', 'אחר'], default: 'אחר', half: true },
      { key: 'date', label: 'תאריך', type: 'date', default: () => today(), half: true },
    ],
  },
  biz_tasks: {
    title: 'משימות', singular: 'משימה',
    fields: [
      { key: 'title', label: 'משימה', type: 'text', required: true },
      { key: 'due', label: 'עד מתי', type: 'date', half: true },
      time,
      category('עבודה'),
      assignee,
      priority,
      { key: 'done', label: 'בוצע', type: 'bool', default: false },
    ],
  },
  integrations: {
    title: 'חיבורים', singular: 'חיבור',
    fields: [
      { key: 'name', label: 'שם המערכת', type: 'text', required: true, placeholder: 'למשל: חשבונית ירוקה' },
      { key: 'kind', label: 'סוג', type: 'select', options: ['חשבוניות', 'דשבורד קיים', 'תורים וקופה', 'בנק', 'פרסום', 'אחר'], default: 'חשבוניות', half: true },
      { key: 'status', label: 'מצב', type: 'select', options: ['לא מחובר', 'מחובר', 'שגיאה'], default: 'לא מחובר', half: true },
      { key: 'note', label: 'מה צריך כדי לחבר', type: 'textarea' },
    ],
  },
  properties: {
    title: 'נכסים', singular: 'נכס',
    fields: [
      { key: 'name', label: 'שם הנכס', type: 'text', required: true, placeholder: 'למשל: דירה ברחובות' },
      { key: 'address', label: 'כתובת', type: 'text' },
      { key: 'type', label: 'סוג', type: 'select', options: ['דירה', 'משרד', 'חנות', 'מחסן', 'קרקע'], default: 'דירה', half: true },
      { key: 'status', label: 'מצב', type: 'select', options: ['מושכר', 'פנוי', 'בשיפוץ', 'בהליך מכירה'], default: 'מושכר', half: true },
      { key: 'purchase_price', label: 'מחיר רכישה', type: 'money', half: true },
      { key: 'market_value', label: 'שווי משוער', type: 'money', half: true },
      { key: 'monthly_rent', label: 'שכירות חודשית', type: 'money', half: true },
      { key: 'mortgage_monthly', label: 'החזר משכנתא חודשי', type: 'money', half: true },
      { key: 'insurance_until', label: 'ביטוח מבנה עד', type: 'date', half: true },
      { key: 'rooms', label: 'חדרים / מ״ר', type: 'text', half: true },
    ],
  },
  tenants: {
    title: 'שוכרים', singular: 'שוכר',
    fields: [
      { key: 'name', label: 'שם', type: 'text', required: true },
      { key: 'phone', label: 'טלפון', type: 'tel', half: true },
      { key: 'email', label: 'מייל', type: 'email', half: true },
      { key: 'since', label: 'גר בנכס מאז', type: 'date', half: true },
      { key: 'pay_method', label: 'אמצעי תשלום', type: 'select', options: ['העברה בנקאית', 'צ׳קים', 'הוראת קבע', 'מזומן'], default: 'העברה בנקאית', half: true },
      { key: 'note', label: 'הערות', type: 'textarea' },
    ],
  },
  leases: {
    title: 'חוזים', singular: 'חוזה',
    fields: [
      { key: 'start', label: 'תחילה', type: 'date', required: true, half: true },
      { key: 'end', label: 'סיום', type: 'date', required: true, half: true },
      { key: 'monthly_rent', label: 'שכירות חודשית', type: 'money', required: true, half: true },
      { key: 'indexation', label: 'הצמדה', type: 'select', options: ['ללא', 'מדד המחירים לצרכן', 'דולר'], default: 'ללא', half: true },
      { key: 'guarantee', label: 'בטוחות', type: 'text', placeholder: 'ערבות בנקאית, שטר חוב…' },
      { key: 'option', label: 'אופציה', type: 'text', placeholder: 'למשל: שנה נוספת, +3%' },
      { key: 'link', label: 'קישור לחוזה החתום', type: 'url' },
    ],
  },
  rent_payments: {
    title: 'תשלומים', singular: 'תשלום',
    fields: [
      { key: 'month', label: 'חודש', type: 'month', required: true, default: () => thisMonth(), half: true },
      { key: 'due_date', label: 'מועד תשלום', type: 'date', half: true },
      { key: 'amount', label: 'לתשלום', type: 'money', required: true, half: true },
      { key: 'paid_amount', label: 'שולם', type: 'money', half: true },
      { key: 'paid_date', label: 'תאריך תשלום', type: 'date', half: true },
    ],
  },
  prop_tasks: {
    title: 'משימות', singular: 'משימה',
    fields: [
      { key: 'title', label: 'משימה', type: 'text', required: true },
      { key: 'due', label: 'עד מתי', type: 'date', half: true },
      time,
      category('נכסים'),
      assignee,
      { key: 'vendor', label: 'בעל מקצוע', type: 'text', half: true },
      { key: 'cost', label: 'עלות משוערת', type: 'money', half: true },
      priority,
      { key: 'done', label: 'בוצע', type: 'bool', default: false },
    ],
  },
  events: {
    title: 'אירועים', singular: 'אירוע',
    fields: [
      { key: 'title', label: 'מה קורה', type: 'text', required: true },
      { key: 'date', label: 'תאריך', type: 'date', required: true, default: () => today(), half: true },
      time,
      { key: 'end_time', label: 'עד שעה', type: 'time', half: true },
      category('סידורים'),
      assignee,
      { key: 'place', label: 'מקום', type: 'text', half: true },
      { key: 'note', label: 'הערה', type: 'textarea' },
    ],
  },
  alert_rules: {
    title: 'חוקי התראה', singular: 'חוק',
    fields: [
      { key: 'name', label: 'שם', type: 'text', required: true },
      { key: 'kind', label: 'מתי', type: 'select', options: ['איחור בתשלום שכירות', 'סיום חוזה מתקרב', 'ביטוח מבנה פג', 'משימה פתוחה זמן רב', 'נכס פנוי'], required: true },
      { key: 'threshold', label: 'סף (ימים)', type: 'number', default: 5, half: true },
      { key: 'channel', label: 'ערוץ', type: 'select', options: ['באפליקציה', 'וואטסאפ', 'מייל'], default: 'באפליקציה', half: true },
      { key: 'enabled', label: 'פעיל', type: 'bool', default: true },
    ],
  },
  monitors: {
    title: 'בדיקות', singular: 'בדיקה',
    fields: [
      { key: 'name', label: 'שם', type: 'text', required: true },
      { key: 'domain', label: 'דומיין (למעקב אתר)', type: 'text', half: true, placeholder: 'example.co.il', hint: 'אופציונלי — יילמד מהכניסה הראשונה' },
      { key: 'url', label: 'כתובת לבדיקה', type: 'url', half: true },
      { key: 'kind', label: 'סוג', type: 'select', options: ['אתר', 'מערכת', 'API'], default: 'אתר', half: true },
      { key: 'owner', label: 'שייך ל', type: 'text', half: true, placeholder: 'עדן, הספא…' },
      { key: 'ga_property', label: 'Google Analytics (מזהה נכס GA4)', type: 'text', half: true, placeholder: '123456789', hint: 'אופציונלי — לנתוני GA4' },
      { key: 'gsc_site', label: 'Search Console (לא חובה)', type: 'text', half: true, placeholder: 'sc-domain:example.co.il', hint: 'ריק = לפי כתובת האתר' },
    ],
  },
};

// Sample data for demo mode only. Dates are relative to today so the demo always looks current.
import { addDays, today, monthsBack, uid } from '../lib/format';
import type { Rec } from './types';

const d = (n: number) => addDays(today(), n);
const r = (o: Record<string, any>): Rec => ({ id: uid(), created_at: new Date().toISOString(), ...o });

export function buildSeed(): Record<string, Rec[]> {
  const months = monthsBack(6);
  const biz1 = 'biz-adigital';
  const biz2 = 'biz-ospa';
  const p1 = 'prop-1', p2 = 'prop-2', p3 = 'prop-3';

  const tx: Rec[] = [];
  const spend: [string, string, number, number][] = [
    ['שופרסל דיל', 'סופר ומזון', 640, -2], ['רמי לוי', 'סופר ומזון', 455, -6], ['פז', 'תחבורה ורכב', 310, -3],
    ['חברת החשמל', 'חשמל מים וגז', 590, -9], ['סלקום', 'תקשורת ומנויים', 129, -10], ['חוג שחייה', 'ילדים וחינוך', 380, -12],
    ['מסעדה', 'בילויים ומסעדות', 420, -4], ['סופר פארם', 'בריאות', 186, -7], ['זארה', 'ביגוד', 350, -14], ['משכנתא', 'דיור ומשכנתא', 5200, -1],
    ['ביטוח רכב', 'ביטוחים', 410, -11], ['מאפייה', 'סופר ומזון', 78, 0],
  ];
  spend.forEach(([title, category, amount, off]) => tx.push(r({ title, category, amount, kind: 'הוצאה', date: d(off), method: title === 'משכנתא' ? 'הוראת קבע' : 'אשראי' })));
  tx.push(r({ title: 'משיכה מאדיג׳יטל', category: 'משיכה מהעסק', amount: 18000, kind: 'הכנסה', date: d(-5), method: 'העברה בנקאית' }));
  tx.push(r({ title: 'שכירות · רחובות', category: 'שכירות', amount: 5400, kind: 'הכנסה', date: d(-8), method: 'העברה בנקאית' }));
  // previous months (for trend)
  months.slice(0, -1).forEach((m, i) => {
    tx.push(r({ title: 'הוצאות החודש (סיכום)', category: 'שונות', amount: 13800 + i * 420 + (i % 2) * 900, kind: 'הוצאה', date: `${m}-20`, method: 'אשראי' }));
    tx.push(r({ title: 'הכנסות החודש (סיכום)', category: 'אחר', amount: 24500 + i * 300, kind: 'הכנסה', date: `${m}-10`, method: 'העברה בנקאית' }));
  });

  const invoices: Rec[] = [];
  const clientsA = ['סטודיו גלים', 'מרפאת שן־טוב', 'נדל״ן הצפון', 'קפה רוסטרס', 'אופטיקה עין', 'חנות הבית'];
  months.forEach((m, mi) => clientsA.forEach((c, ci) => {
    if (ci > 3 + (mi % 3)) return;
    const paid = mi < months.length - 1 || ci < 2;
    invoices.push(r({ business_id: biz1, number: `${2400 + mi * 10 + ci}`, client: c, amount_net: [3500, 2200, 4800, 1800, 2600, 3100][ci], issue_date: `${m}-0${1 + (ci % 5)}`, due_date: addDays(`${m}-0${1 + (ci % 5)}`, 30), status: paid ? 'שולמה' : 'נשלחה', allocation_number: ci === 2 ? '' : `A${880000 + mi * 10 + ci}` }));
  }));
  invoices.push(r({ business_id: biz1, number: '2391', client: 'נדל״ן הצפון', amount_net: 6200, issue_date: d(-48), due_date: d(-18), status: 'נשלחה', allocation_number: '' }));
  months.forEach((m, mi) => {
    invoices.push(r({ business_id: biz2, number: `S${510 + mi}`, client: 'מכירות קופה (סיכום חודשי)', amount_net: 38000 + mi * 1600, issue_date: `${m}-${mi === months.length - 1 ? '10' : '28'}`, status: 'שולמה', allocation_number: `B${440000 + mi}` }));
  });

  const bizExp: Rec[] = [];
  months.forEach((m, mi) => {
    bizExp.push(r({ business_id: biz1, title: 'שכר עובדים', supplier: 'שכר', amount_net: 7200, category: 'שכר', date: `${m}-09` }));
    bizExp.push(r({ business_id: biz1, title: 'תוכנות ו־SaaS', supplier: 'שונים', amount_net: 940 + mi * 20, category: 'תוכנות', date: `${m}-03` }));
    bizExp.push(r({ business_id: biz2, title: 'שכר מטפלות', supplier: 'שכר', amount_net: 16500 + mi * 300, category: 'שכר', date: `${m}-09` }));
    bizExp.push(r({ business_id: biz2, title: 'שכירות המתחם', supplier: 'בעל הנכס', amount_net: 9000, category: 'שכירות', date: `${m}-01` }));
    bizExp.push(r({ business_id: biz2, title: 'מוצרים ושמנים', supplier: 'ספק מוצרים', amount_net: 3100 + (mi % 3) * 400, category: 'חומרים ומלאי', date: `${m}-15` }));
  });

  const rent: Rec[] = [];
  months.forEach((m, mi) => {
    const last = mi === months.length - 1;
    rent.push(r({ property_id: p1, month: m, due_date: `${m}-01`, amount: 5400, paid_amount: 5400, paid_date: `${m}-02` }));
    rent.push(r({ property_id: p2, month: m, due_date: `${m}-05`, amount: 7800, paid_amount: last ? 0 : 7800, paid_date: last ? '' : `${m}-06` }));
  });

  return {
    home_tasks: [
      r({ title: 'להזמין טכנאי למזגן בסלון', due: d(1), assignee: 'אביהו', repeat: 'לא חוזר', priority: 'גבוהה', done: false }),
      r({ title: 'לחדש ביטוח דירה', due: d(6), assignee: 'אביהו', repeat: 'לא חוזר', priority: 'רגילה', done: false }),
      r({ title: 'ניקיון מקרר', due: d(0), assignee: '', repeat: 'כל שבוע', priority: 'נמוכה', done: false }),
      r({ title: 'להוציא זבל מיחזור', due: d(0), assignee: '', repeat: 'כל שבוע', priority: 'רגילה', done: true }),
      r({ title: 'תשלום ועד בית', due: d(-1), assignee: 'אביהו', repeat: 'כל חודש', priority: 'רגילה', done: false }),
      r({ title: 'לקבוע תור לרופא שיניים', due: d(10), assignee: '', repeat: 'לא חוזר', priority: 'רגילה', done: false }),
    ],
    shopping: [
      ['חלב 3%', '2', 'חלב וביצים'], ['ביצים L', '12', 'חלב וביצים'], ['עגבניות', '1 ק״ג', 'ירקות ופירות'], ['מלפפונים', '1 ק״ג', 'ירקות ופירות'],
      ['בננות', '6', 'ירקות ופירות'], ['לחם מחמצת', '1', 'מאפייה'], ['חזה עוף', '1 ק״ג', 'בשר ודגים'], ['אורז בסמטי', '1', 'יבשים ושימורים'],
      ['נוזל כלים', '1', 'ניקיון'], ['משחת שיניים', '2', 'פארם'],
    ].map(([name, qty, dept], i) => r({ name, qty, dept, done: i === 3 })),
    transactions: tx,
    budgets: [
      ['סופר ומזון', 3200], ['דיור ומשכנתא', 5200], ['חשמל מים וגז', 900], ['תחבורה ורכב', 1400], ['ילדים וחינוך', 1500],
      ['בריאות', 500], ['בילויים ומסעדות', 900], ['ביגוד', 600], ['תקשורת ומנויים', 450], ['ביטוחים', 900],
    ].map(([category, monthly]) => r({ category, monthly })),
    bills: [
      r({ name: 'חשמל', amount: 590, frequency: 'דו־חודשי', next_due: d(12), method: 'הוראת קבע', category: 'חשמל מים וגז', provider: 'חברת החשמל' }),
      r({ name: 'ארנונה', amount: 780, frequency: 'דו־חודשי', next_due: d(3), method: 'הוראת קבע', category: 'דיור ומשכנתא', provider: 'עירייה' }),
      r({ name: 'מים', amount: 210, frequency: 'דו־חודשי', next_due: d(19), method: 'אשראי', category: 'חשמל מים וגז', provider: 'תאגיד מים' }),
      r({ name: 'אינטרנט וסלולר', amount: 129, frequency: 'חודשי', next_due: d(8), method: 'אשראי', category: 'תקשורת ומנויים', provider: 'סלקום' }),
      r({ name: 'סטרימינג', amount: 55, frequency: 'חודשי', next_due: d(2), method: 'אשראי', category: 'תקשורת ומנויים', provider: '' }),
      r({ name: 'ביטוח דירה', amount: 1450, frequency: 'שנתי', next_due: d(6), method: 'אשראי', category: 'ביטוחים', provider: '' }),
      r({ name: 'ועד בית', amount: 180, frequency: 'חודשי', next_due: d(-1), method: 'העברה בנקאית', category: 'דיור ומשכנתא', provider: '' }),
    ],
    maintenance: [
      r({ item: 'מזגן סלון', location: 'סלון', vendor: 'טכנאי מיזוג', warranty_until: d(140), next_service: d(1), note: 'ניקוי פילטרים' }),
      r({ item: 'דוד שמש', location: 'גג', vendor: '', warranty_until: d(-200), next_service: d(45) }),
      r({ item: 'מדיח כלים', location: 'מטבח', vendor: 'מעבדה מורשית', warranty_until: d(25), next_service: '' }),
      r({ item: 'רכב משפחתי', location: 'חניה', vendor: 'מוסך', warranty_until: '', next_service: d(32), note: 'טיפול 30,000' }),
    ],
    documents: [
      r({ title: 'ביטוח דירה ותכולה', type: 'ביטוח', expires: d(6) }),
      r({ title: 'ביטוח רכב חובה + מקיף', type: 'רכב', expires: d(74) }),
      r({ title: 'רישיון רכב', type: 'רכב', expires: d(118) }),
      r({ title: 'דרכונים', type: 'אחר', expires: d(410) }),
    ],
    businesses: [
      r({ id: biz1, name: 'אדיג׳יטל', kind: 'משרד פרסום', owner_pct: 100, vat_mode: 'חודשי', site: '' }),
      r({ id: biz2, name: 'OSPA', kind: 'ספא וטיפוח', owner_pct: 50, vat_mode: 'חודשי', site: '' }),
    ],
    invoices,
    clients: clientsA.map((name, i) => r({ business_id: biz1, name, contact: '', phone: '', monthly_fee: [3500, 2200, 4800, 1800, 2600, 3100][i], status: i < 5 ? 'פעיל' : 'ליד' })),
    biz_expenses: bizExp,
    biz_tasks: [
      r({ business_id: biz1, title: 'להנפיק חשבוניות ריטיינר לחודש', due: d(2), assignee: 'אביהו', priority: 'גבוהה', done: false }),
      r({ business_id: biz1, title: 'הצעת מחיר לקמפיין חורף', due: d(4), assignee: '', priority: 'רגילה', done: false }),
      r({ business_id: biz1, title: 'לבקש מספר הקצאה לחשבונית 2391', due: d(-1), assignee: 'אביהו', priority: 'גבוהה', done: false }),
      r({ business_id: biz2, title: 'הזמנת מוצרים לחודש הבא', due: d(5), assignee: '', priority: 'רגילה', done: false }),
      r({ business_id: biz2, title: 'פגישת שותפים — דוח רבעוני', due: d(9), assignee: 'אביהו', priority: 'רגילה', done: false }),
    ],
    integrations: [
      r({ business_id: biz1, name: 'מערכת חשבוניות', kind: 'חשבוניות', status: 'לא מחובר', note: 'נחבר דרך API של ספק החשבוניות כשתבחר אותו' }),
      r({ business_id: biz1, name: 'דשבורד קיים (וואלט Obsidian)', kind: 'דשבורד קיים', status: 'לא מחובר', note: 'מייבא את ה־retainers והחובות מהגרסה הקודמת' }),
      r({ business_id: biz2, name: 'מערכת תורים וקופה', kind: 'תורים וקופה', status: 'לא מחובר', note: 'צריך ייצוא/API ממערכת הספא' }),
      r({ business_id: biz2, name: 'אתר הספא', kind: 'דשבורד קיים', status: 'לא מחובר', note: 'שיקוף נתונים מהאתר — בהמשך' }),
    ],
    properties: [
      r({ id: p1, name: 'דירת 4 חד׳ · רחובות', address: 'רחובות', type: 'דירה', status: 'מושכר', purchase_price: 1650000, market_value: 2100000, monthly_rent: 5400, mortgage_monthly: 4100, insurance_until: d(190), rooms: '4 חד׳ · 98 מ״ר' }),
      r({ id: p2, name: 'משרד · פתח תקווה', address: 'פתח תקווה', type: 'משרד', status: 'מושכר', purchase_price: 1900000, market_value: 2250000, monthly_rent: 7800, mortgage_monthly: 0, insurance_until: d(20), rooms: '120 מ״ר' }),
      r({ id: p3, name: 'דירת 3 חד׳ · באר שבע', address: 'באר שבע', type: 'דירה', status: 'בשיפוץ', purchase_price: 980000, market_value: 1150000, monthly_rent: 0, mortgage_monthly: 2600, insurance_until: d(300), rooms: '3 חד׳ · 72 מ״ר' }),
    ],
    tenants: [
      r({ property_id: p1, name: 'משפחת לוי', phone: '050-0000000', email: '', since: d(-400), pay_method: 'הוראת קבע' }),
      r({ property_id: p2, name: 'סטארט־אפ בע״מ', phone: '03-0000000', email: '', since: d(-700), pay_method: 'העברה בנקאית' }),
    ],
    leases: [
      r({ property_id: p1, start: d(-400), end: d(330), monthly_rent: 5400, indexation: 'מדד המחירים לצרכן', guarantee: 'שטר חוב + 2 ערבים', option: 'שנה נוספת' }),
      r({ property_id: p2, start: d(-700), end: d(85), monthly_rent: 7800, indexation: 'מדד המחירים לצרכן', guarantee: 'ערבות בנקאית 3 חודשים', option: 'שנתיים, +4%' }),
    ],
    rent_payments: rent,
    prop_tasks: [
      r({ property_id: p3, title: 'החלפת מטבח', due: d(14), vendor: 'נגר', cost: 32000, priority: 'גבוהה', done: false }),
      r({ property_id: p3, title: 'צבע לכל הדירה', due: d(21), vendor: 'צבעי', cost: 9000, priority: 'רגילה', done: false }),
      r({ property_id: p1, title: 'תיקון נזילה באמבטיה', due: d(-9), vendor: 'אינסטלטור', cost: 650, priority: 'גבוהה', done: false }),
      r({ property_id: p2, title: 'חידוש ביטוח מבנה', due: d(15), vendor: '', cost: 0, priority: 'רגילה', done: false }),
    ],
    photos: [],
    alert_rules: [
      r({ name: 'שכירות לא שולמה', kind: 'איחור בתשלום שכירות', threshold: 5, channel: 'וואטסאפ', enabled: true }),
      r({ name: 'חוזה מסתיים', kind: 'סיום חוזה מתקרב', threshold: 90, channel: 'באפליקציה', enabled: true }),
      r({ name: 'ביטוח מבנה', kind: 'ביטוח מבנה פג', threshold: 30, channel: 'מייל', enabled: true }),
      r({ name: 'משימה תקועה', kind: 'משימה פתוחה זמן רב', threshold: 7, channel: 'באפליקציה', enabled: true }),
      r({ name: 'נכס עומד ריק', kind: 'נכס פנוי', threshold: 30, channel: 'באפליקציה', enabled: false }),
    ],
    monitors: [
      r({ name: 'הדשבורד הזה', url: typeof location !== 'undefined' ? location.origin : '', kind: 'אתר', owner: 'בית', history: synthHistory(0) }),
      r({ name: 'האתר של עדן', url: '', kind: 'אתר', owner: 'עדן', history: [] }),
      r({ name: 'אתר הספא', url: '', kind: 'אתר', owner: 'OSPA', history: [] }),
      r({ name: 'Supabase (נתונים והתחברות)', url: 'https://status.supabase.com', kind: 'מערכת', owner: 'תשתית', history: synthHistory(1) }),
      r({ name: 'Kapso · WhatsApp API', url: 'https://api.kapso.ai', kind: 'API', owner: 'תשתית', history: synthHistory(0) }),
      r({ name: 'Gemini API', url: 'https://generativelanguage.googleapis.com', kind: 'API', owner: 'תשתית', history: synthHistory(2) }),
    ],
    wa_messages: [
      r({ direction: 'in', text: 'תוסיף לקניות חלב וביצים', at: new Date(Date.now() - 3600e3 * 26).toISOString() }),
      r({ direction: 'out', text: 'הוספתי לרשימת הקניות: חלב, ביצים ✅', at: new Date(Date.now() - 3600e3 * 26 + 4000).toISOString() }),
      r({ direction: 'in', text: 'כמה הוצאנו החודש על סופר?', at: new Date(Date.now() - 3600e3 * 3).toISOString() }),
      r({ direction: 'out', text: 'החודש יצאו ₪1,173 על סופר ומזון, מתוך תקציב של ₪3,200 (37%).', at: new Date(Date.now() - 3600e3 * 3 + 5000).toISOString() }),
    ],
    members: [
      r({ email: 'owner@example.com', name: 'אביהו', role: 'owner', areas: ['home', 'business', 'invest'], status: 'active' }),
    ],
    parameters: [
      r({ key: 'vat_rate', effective_from: '2025-01-01', value: 0.18 }),
      r({ key: 'vat_rate', effective_from: '2015-10-01', value: 0.17 }),
      r({ key: 'allocation_threshold', effective_from: '2026-06-01', value: 5000 }),
    ],
  };
}

function synthHistory(seed: number) {
  // 30 days of {ok, ms}. Deterministic per seed.
  return Array.from({ length: 30 }, (_, i) => {
    const bad = (i * 7 + seed * 13) % 29 === 0 && seed !== 0;
    return { day: addDays(today(), i - 29), ok: !bad, ms: 120 + ((i * 37 + seed * 11) % 140) };
  });
}

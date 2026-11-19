// WhatsApp agent core — shared by the in-app sandbox (browser) and the Kapso webhook (server).
// The agent only ever touches data through `AgentData`, so the same tools work on demo data and on Supabase.

export type Row = { id: string; [k: string]: any };
export interface AgentData {
  all(collection: string): Promise<Row[]> | Row[];
  add(collection: string, data: Record<string, any>): Promise<unknown> | unknown;
  update(collection: string, id: string, patch: Record<string, any>): Promise<unknown> | unknown;
}

const ils = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL');
// Dates in Israel time, summer time included (a fixed UTC+2 put "tomorrow" on the wrong day after 21:00 in summer).
const israelDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const todayIso = () => israelDay();
const addDays = (n: number) => { const d = new Date(todayIso() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dd = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

/* ---------- tool declarations (Gemini function calling format) ---------- */
export const TOOL_DECLARATIONS = [
  { name: 'add_shopping_items', description: 'הוספת פריטים לרשימת הקניות של הבית', parameters: { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, qty: { type: 'STRING' } }, required: ['name'] } } }, required: ['items'] } },
  { name: 'get_shopping_list', description: 'שליפת רשימת הקניות הפתוחה', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'add_task', description: 'הוספת משימה. area: home (בית), business (עסק), property (נכס)', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, due: { type: 'STRING', description: 'YYYY-MM-DD' }, area: { type: 'STRING', enum: ['home', 'business', 'property'] }, target: { type: 'STRING', description: 'שם העסק או הנכס' } }, required: ['title'] } },
  { name: 'get_tasks', description: 'שליפת משימות פתוחות', parameters: { type: 'OBJECT', properties: { area: { type: 'STRING', enum: ['home', 'business', 'property', 'all'] } } } },
  { name: 'add_expense', description: 'רישום הוצאה של הבית', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, amount: { type: 'NUMBER' }, category: { type: 'STRING' } }, required: ['title', 'amount'] } },
  { name: 'get_home_spending', description: 'כמה הוצאנו החודש בבית, אופציונלית לפי קטגוריה', parameters: { type: 'OBJECT', properties: { category: { type: 'STRING' } } } },
  { name: 'get_business_summary', description: 'מצב כספי של עסק: הכנסות, הוצאות, חשבוניות פתוחות', parameters: { type: 'OBJECT', properties: { business: { type: 'STRING' } } } },
  { name: 'get_rent_status', description: 'מצב תשלומי שכירות בנכסים החודש ומי באיחור', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'mark_rent_paid', description: 'סימון שכירות החודש כשולמה בנכס', parameters: { type: 'OBJECT', properties: { property: { type: 'STRING' } }, required: ['property'] } },
  { name: 'get_upcoming', description: 'מה קורה בימים הקרובים: חשבונות, משימות, חוזים', parameters: { type: 'OBJECT', properties: { days: { type: 'NUMBER' } } } },
] as const;

export const SYSTEM_PROMPT = `אתה העוזר האישי של בעל הדשבורד בוואטסאפ. ענה בעברית, קצר וענייני (עד 5 שורות), בלי Markdown.
השתמש בכלים כדי להזין ולשלוף מידע מהמערכת: בית (קניות, משימות, הוצאות), עסקים (מצב כספי, חשבוניות), נכסים (שכירות, חוזים).
לעולם אל תמציא נתונים. אם חסר פרט חיוני (למשל סכום), שאל שאלה אחת קצרה. התאריך היום: ${todayIso()}.`;

/* ---------- tool implementations ---------- */
const match = (rows: Row[], q?: string) => {
  if (!q) return rows[0];
  const n = q.replace(/[׳'"״]/g, '').toLowerCase();
  return rows.find((r) => String(r.name || '').replace(/[׳'"״]/g, '').toLowerCase().includes(n)) ?? rows.find((r) => n.includes(String(r.name || '').split(' ')[0].toLowerCase()));
};

export async function execTool(name: string, args: Record<string, any>, db: AgentData): Promise<string> {
  const ym = todayIso().slice(0, 7);
  switch (name) {
    case 'add_shopping_items': {
      const items: { name: string; qty?: string }[] = args.items ?? [];
      for (const it of items) await db.add('shopping', { name: it.name, qty: it.qty ?? '', dept: 'אחר', done: false, source: 'whatsapp' });
      return `הוספתי לרשימת הקניות: ${items.map((i) => i.name + (i.qty ? ` (${i.qty})` : '')).join(', ')} ✅`;
    }
    case 'get_shopping_list': {
      const open = (await db.all('shopping')).filter((r) => !r.done);
      return open.length ? `ברשימה ${open.length} פריטים:\n` + open.map((r) => `• ${r.name}${r.qty ? ` · ${r.qty}` : ''}`).join('\n') : 'רשימת הקניות ריקה.';
    }
    case 'add_task': {
      const area = args.area ?? 'home';
      if (area === 'business') {
        const b = match(await db.all('businesses'), args.target);
        if (!b) return 'לא מצאתי עסק כזה.';
        await db.add('biz_tasks', { business_id: b.id, title: args.title, due: args.due ?? '', priority: 'רגילה', done: false, source: 'whatsapp' });
        return `נוספה משימה ל${b.name}: ${args.title}${args.due ? ` (עד ${dd(args.due)})` : ''} ✅`;
      }
      if (area === 'property') {
        const p = match(await db.all('properties'), args.target);
        if (!p) return 'לא מצאתי נכס כזה.';
        await db.add('prop_tasks', { property_id: p.id, title: args.title, due: args.due ?? '', priority: 'רגילה', done: false, source: 'whatsapp' });
        return `נוספה משימה לנכס ${p.name}: ${args.title} ✅`;
      }
      await db.add('home_tasks', { title: args.title, due: args.due ?? '', priority: 'רגילה', repeat: 'לא חוזר', done: false, source: 'whatsapp' });
      return `נוספה משימת בית: ${args.title}${args.due ? ` (עד ${dd(args.due)})` : ''} ✅`;
    }
    case 'get_tasks': {
      const area = args.area ?? 'all';
      const out: string[] = [];
      const fmt = (t: Row, tag: string) => `• ${t.title}${t.due ? ` · ${dd(t.due)}` : ''}${tag ? ` (${tag})` : ''}`;
      if (area === 'all' || area === 'home') (await db.all('home_tasks')).filter((t) => !t.done).forEach((t) => out.push(fmt(t, area === 'all' ? 'בית' : '')));
      if (area === 'all' || area === 'business') { const bs = await db.all('businesses'); (await db.all('biz_tasks')).filter((t) => !t.done).forEach((t) => out.push(fmt(t, bs.find((b) => b.id === t.business_id)?.name ?? 'עסק'))); }
      if (area === 'all' || area === 'property') { const ps = await db.all('properties'); (await db.all('prop_tasks')).filter((t) => !t.done).forEach((t) => out.push(fmt(t, ps.find((p) => p.id === t.property_id)?.name ?? 'נכס'))); }
      return out.length ? `${out.length} משימות פתוחות:\n${out.slice(0, 12).join('\n')}${out.length > 12 ? `\nועוד ${out.length - 12}…` : ''}` : 'אין משימות פתוחות 🎉';
    }
    case 'add_expense': {
      await db.add('transactions', { title: args.title, amount: Number(args.amount), kind: 'הוצאה', category: args.category ?? guessCategory(args.title), date: todayIso(), method: 'אשראי', source: 'whatsapp' });
      return `נרשמה הוצאה: ${args.title} · ${ils(Number(args.amount))} (${args.category ?? guessCategory(args.title)}) ✅`;
    }
    case 'get_home_spending': {
      const tx = (await db.all('transactions')).filter((t) => t.kind === 'הוצאה' && String(t.date || '').startsWith(ym));
      const budgets = await db.all('budgets');
      if (args.category) {
        const cat = budgets.map((b) => b.category as string).find((c) => c.includes(args.category) || args.category.includes(c.split(' ')[0])) ?? args.category;
        const spent = tx.filter((t) => t.category === cat).reduce((a, t) => a + (t.amount || 0), 0);
        const bud = budgets.find((b) => b.category === cat)?.monthly;
        return `החודש יצאו ${ils(spent)} על ${cat}` + (bud ? `, מתוך תקציב של ${ils(bud)} (${Math.round((spent / bud) * 100)}%).` : '.');
      }
      const spent = tx.reduce((a, t) => a + (t.amount || 0), 0);
      const bud = budgets.reduce((a, b) => a + (b.monthly || 0), 0);
      return `החודש יצאו ${ils(spent)}` + (bud ? ` מתוך תקציב ${ils(bud)}. נשאר ${ils(bud - spent)}.` : '.');
    }
    case 'get_business_summary': {
      const bs = await db.all('businesses');
      const list = args.business ? [match(bs, args.business)].filter(Boolean) as Row[] : bs;
      if (!list.length) return 'לא מצאתי עסק כזה.';
      const inv = await db.all('invoices'); const exp = await db.all('biz_expenses');
      return list.map((b) => {
        const income = inv.filter((i) => i.business_id === b.id && String(i.issue_date || '').startsWith(ym) && !['בוטלה', 'טיוטה'].includes(i.status)).reduce((a, i) => a + (i.amount_net || 0), 0);
        const out = exp.filter((e) => e.business_id === b.id && String(e.date || '').startsWith(ym)).reduce((a, e) => a + (e.amount_net || 0), 0);
        const open = inv.filter((i) => i.business_id === b.id && i.status === 'נשלחה');
        const late = open.filter((i) => i.due_date && i.due_date < todayIso());
        return `${b.name} — החודש: הכנסות ${ils(income)}, הוצאות ${ils(out)}, רווח ${ils(income - out)} (לפני מע״מ). ${open.length} חשבוניות פתוחות${late.length ? `, ${late.length} באיחור` : ''}.`;
      }).join('\n');
    }
    case 'get_rent_status': {
      const ps = await db.all('properties'); const pay = (await db.all('rent_payments')).filter((r) => r.month === ym);
      if (!pay.length) return 'אין תשלומי שכירות רשומים לחודש הזה.';
      return pay.map((r) => {
        const p = ps.find((x) => x.id === r.property_id);
        const full = (r.paid_amount || 0) >= r.amount;
        return `• ${p?.name ?? 'נכס'}: ${full ? `שולם ${ils(r.amount)} ✅` : r.due_date < todayIso() ? `לא שולם ${ils(r.amount)} ⚠️ (מועד ${dd(r.due_date)})` : `ממתין, מועד ${dd(r.due_date)}`}`;
      }).join('\n');
    }
    case 'mark_rent_paid': {
      const p = match(await db.all('properties'), args.property);
      if (!p) return 'לא מצאתי נכס כזה.';
      const r = (await db.all('rent_payments')).find((x) => x.property_id === p.id && x.month === ym);
      if (!r) return `אין רשומת שכירות לחודש הזה ב${p.name}.`;
      await db.update('rent_payments', r.id, { paid_amount: r.amount, paid_date: todayIso() });
      return `סימנתי: שכירות ${p.name} שולמה (${ils(r.amount)}) ✅`;
    }
    case 'get_upcoming': {
      const until = addDays(Number(args.days) || 7); const now = todayIso();
      const within = (d?: string) => !!d && d >= now && d <= until;
      const out: [string, string][] = [];
      (await db.all('bills')).filter((b) => within(b.next_due)).forEach((b) => out.push([b.next_due, `${b.name} · ${ils(b.amount || 0)}`]));
      (await db.all('home_tasks')).filter((t) => !t.done && within(t.due)).forEach((t) => out.push([t.due, t.title]));
      (await db.all('biz_tasks')).filter((t) => !t.done && within(t.due)).forEach((t) => out.push([t.due, t.title]));
      (await db.all('leases')).filter((l) => within(l.end)).forEach((l) => out.push([l.end, 'סיום חוזה שכירות']));
      out.sort((a, b) => a[0].localeCompare(b[0]));
      return out.length ? `בימים הקרובים:\n${out.slice(0, 10).map(([d, t]) => `• ${dd(d)} — ${t}`).join('\n')}` : 'אין מועדים בימים הקרובים.';
    }
  }
  return 'לא הצלחתי לבצע את הפעולה.';
}

function guessCategory(title: string) {
  if (/סופר|שופרסל|רמי לוי|ויקטורי|מכולת|ירקות|מאפ/.test(title)) return 'סופר ומזון';
  if (/דלק|פז|סונול|חניה|מוסך|רכב|רכבת|מונית/.test(title)) return 'תחבורה ורכב';
  if (/מסעד|קפה|פיצה|סרט|בילוי/.test(title)) return 'בילויים ומסעדות';
  if (/פארם|רופא|תרופ|קופת/.test(title)) return 'בריאות';
  if (/חשמל|מים|גז|ארנונה/.test(title)) return 'חשמל מים וגז';
  return 'שונות';
}

/* ---------- rule-based fallback (no LLM key needed) ---------- */
export async function ruleBasedReply(text: string, db: AgentData): Promise<string> {
  const t = text.trim();
  let m: RegExpMatchArray | null;

  if ((m = t.match(/^(?:תוסיף|תוסיפי|להוסיף|הוסף|תרשום)?\s*(?:לי\s+)?ל?(?:רשימת\s+)?(?:ה)?קניות[:\s]+(.+)$/)) || (m = t.match(/^(?:תוסיף|הוסף|תקנה|לקנות)\s+(.+?)\s+ל(?:רשימת\s+)?(?:ה)?קניות$/)) || (m = t.match(/^(?:לקנות|תקנה)\s+(.+)$/))) {
    const items = m[1].split(/,|\sו(?=[א-ת])/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name }));
    return execTool('add_shopping_items', { items }, db);
  }
  if (/מה (יש )?ב?(רשימת )?(ה)?קניות|רשימת קניות|מה (צריך )?לקנות/.test(t)) return execTool('get_shopping_list', {}, db);

  if ((m = t.match(/^(?:הוצאה|הוצאתי|שילמתי|תרשום הוצאה)[:\s]+(.+)$/))) {
    const amt = m[1].match(/(\d[\d,.]*)/);
    if (!amt) return 'כמה זה עלה? כתוב למשל: הוצאה 120 סופר';
    const title = m[1].replace(amt[0], '').replace(/ש"?ח|₪|שקל(?:ים)?|על|ב(?=\s)/g, '').trim() || 'הוצאה';
    return execTool('add_expense', { title, amount: Number(amt[1].replace(/,/g, '')) }, db);
  }
  if ((m = t.match(/^(?:משימה|תזכיר לי|להזכיר|תוסיף משימה)[:\s]+(.+)$/))) {
    let title = m[1].trim(); let due: string | undefined;
    if (/מחר/.test(title)) { due = addDays(1); title = title.replace(/\s*מחר\s*/, ' ').trim(); }
    else if (/היום/.test(title)) { due = todayIso(); title = title.replace(/\s*היום\s*/, ' ').trim(); }
    return execTool('add_task', { title: title.replace(/^ל(?=[א-ת])/, 'ל'), due }, db);
  }
  if (/משימות|מה יש לי לעשות|מה פתוח/.test(t)) return execTool('get_tasks', { area: /עסק/.test(t) ? 'business' : /נכס/.test(t) ? 'property' : /בית/.test(t) ? 'home' : 'all' }, db);

  if ((m = t.match(/כמה (?:הוצאנו|הוצאתי|יצא|בזבזנו)(?:.*?על\s+(.+?))?[?？]?$/))) return execTool('get_home_spending', { category: m[1]?.replace(/החודש/, '').trim() || undefined }, db);
  if (/תקציב|כמה נשאר/.test(t)) return execTool('get_home_spending', {}, db);

  if ((m = t.match(/(?:שכירות|שכ"ד).*?(?:שולמה|שילמו|התקבלה).*?(?:ב|של)\s*(.+)$/)) || (m = t.match(/^(.+?)\s+שילמ[וה]\s+(?:שכירות|שכ"ד)/))) return execTool('mark_rent_paid', { property: m[1].trim() }, db);
  if (/שכירות|שוכר|נכסים/.test(t)) return execTool('get_rent_status', {}, db);

  if ((m = t.match(/(?:מה המצב|מצב|איך|סיכום).*?(?:ב|של)\s*(.+?)[?？]?$/)) && !/בית/.test(m[1])) {
    const r = await execTool('get_business_summary', { business: m[1].trim() }, db);
    if (!r.startsWith('לא מצאתי')) return r;
  }
  if (/עסק|חשבוניות|הכנסות|רווח/.test(t)) return execTool('get_business_summary', {}, db);
  if (/השבוע|קרוב|מה קורה|מה יש לי/.test(t)) return execTool('get_upcoming', { days: 7 }, db);

  return 'אפשר לכתוב לי למשל:\n• תוסיף לקניות חלב, ביצים\n• הוצאה 120 סופר\n• משימה: לחדש ביטוח מחר\n• כמה הוצאנו על סופר?\n• מה המצב בספא?\n• מי שילם שכירות?';
}

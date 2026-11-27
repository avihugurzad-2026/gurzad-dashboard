// WhatsApp agent core — shared by the in-app sandbox (browser) and the Kapso webhook (server).
// The agent only ever touches data through `AgentData`, so the same tools work on demo data and on Supabase.

export type Row = { id: string; [k: string]: any };
export interface AgentData {
  all(collection: string): Promise<Row[]> | Row[];
  add(collection: string, data: Record<string, any>): Promise<unknown> | unknown;
  update(collection: string, id: string, patch: Record<string, any>): Promise<unknown> | unknown;
}

export interface AgentScope {
  areas: ('home' | 'business' | 'invest')[];
  allowMeta?: boolean;
  readOnly?: boolean;
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

/** Return only the tool declarations permitted for a member's scope (defense-in-depth). */
export function toolsForScope(scope?: AgentScope) {
  if (!scope) return [...TOOL_DECLARATIONS];
  const has = (a: 'home' | 'business' | 'invest') => scope.areas.includes(a);
  const ro = Boolean(scope.readOnly);
  const out: any[] = [];
  for (const t of TOOL_DECLARATIONS) {
    if (t.name === 'add_shopping_items' || t.name === 'add_expense') {
      if (has('home') && !ro) out.push(t);
    } else if (t.name === 'get_shopping_list' || t.name === 'get_home_spending') {
      if (has('home')) out.push(t);
    } else if (t.name === 'get_business_summary') {
      if (has('business')) out.push(t);
    } else if (t.name === 'get_rent_status') {
      if (has('invest')) out.push(t);
    } else if (t.name === 'mark_rent_paid') {
      if (has('invest') && !ro) out.push(t);
    } else if (t.name === 'add_task') {
      if (!ro && scope.areas.length) {
        out.push({
          ...t,
          parameters: {
            ...t.parameters,
            properties: {
              ...t.parameters.properties,
              area: { type: 'STRING', enum: scope.areas },
            },
          },
        });
      }
    } else if (t.name === 'get_tasks') {
      if (scope.areas.length) {
        out.push({
          ...t,
          parameters: {
            ...t.parameters,
            properties: {
              area: { type: 'STRING', enum: [...scope.areas, 'all'] },
            },
          },
        });
      }
    } else if (t.name === 'get_upcoming') {
      if (scope.areas.length) out.push(t);
    }
  }
  return out;
}

export function systemPromptForScope(scope?: AgentScope) {
  if (!scope) return SYSTEM_PROMPT;
  const labels: string[] = [];
  if (scope.areas.includes('home')) labels.push('בית (קניות, משימות בית, הוצאות ותקציב, חשבונות קרובים)');
  if (scope.areas.includes('business')) labels.push('עסקים (מצב כספי, משימות עסקיות, חשבוניות)');
  if (scope.areas.includes('invest')) labels.push('השקעות ונכסים (שכירות, חוזים, משימות נכסים)');
  const denied: string[] = [];
  if (!scope.areas.includes('business')) denied.push('עסקים');
  if (!scope.allowMeta) denied.push('קמפיינים ופרסום במטא');
  if (!scope.areas.includes('invest')) denied.push('נכסים והשקעות');
  return `אתה העוזר האישי של המשתמש במערכת. ענה בעברית, קצר, נעים וענייני (עד 5 שורות).
הגישה של המשתמש מוגבלת אך ורק לתחומים הבאים: ${labels.join(', ') || 'ללא תחומים'}.${scope.readOnly ? ' המשתמש במצב צפייה בלבד (קריאה בלבד, ללא הוספה או שינוי נתונים).' : ''}
${denied.length ? `אין למשתמש גישה למידע על ${denied.join(', ')} — אם הוא שואל על תחומים אלו, ענה בנימוס שאין לך גישה לנתונים האלו עבור המשתמש הזה.` : ''}
לעולם אל תמציא נתונים. התאריך היום: ${todayIso()}.`;
}

/* ---------- tool implementations ---------- */
const match = (rows: Row[], q?: string) => {
  if (!q) return rows[0];
  const n = q.replace(/[׳'"״]/g, '').toLowerCase();
  return rows.find((r) => String(r.name || '').replace(/[׳'"״]/g, '').toLowerCase().includes(n)) ?? rows.find((r) => n.includes(String(r.name || '').split(' ')[0].toLowerCase()));
};

export async function execTool(name: string, args: Record<string, any>, db: AgentData, scope?: AgentScope): Promise<string> {
  const allow = (a: 'home' | 'business' | 'invest') => !scope || scope.areas.includes(a);
  const ro = Boolean(scope?.readOnly);
  const ym = todayIso().slice(0, 7);
  switch (name) {
    case 'add_shopping_items': {
      if (!allow('home') || ro) return 'אין הרשאה להוסיף פריטים לרשימת הקניות.';
      const items: { name: string; qty?: string }[] = args.items ?? [];
      for (const it of items) await db.add('shopping', { name: it.name, qty: it.qty ?? '', dept: 'אחר', done: false, source: 'whatsapp' });
      return `הוספתי לרשימת הקניות: ${items.map((i) => i.name + (i.qty ? ` (${i.qty})` : '')).join(', ')} ✅`;
    }
    case 'get_shopping_list': {
      if (!allow('home')) return 'אין גישה לרשימת הקניות.';
      const open = (await db.all('shopping')).filter((r) => !r.done);
      return open.length ? `ברשימה ${open.length} פריטים:\n` + open.map((r) => `• ${r.name}${r.qty ? ` · ${r.qty}` : ''}`).join('\n') : 'רשימת הקניות ריקה.';
    }
    case 'add_task': {
      if (ro) return 'אין הרשאת עריכה להוספת משימות.';
      const area = (args.area ?? (allow('home') ? 'home' : scope?.areas[0] ?? 'home')) as 'home' | 'business' | 'property';
      if (area === 'business') {
        if (!allow('business')) return 'אין גישה לתחום העסקים.';
        const b = match(await db.all('businesses'), args.target);
        if (!b) return 'לא מצאתי עסק כזה.';
        await db.add('biz_tasks', { business_id: b.id, title: args.title, due: args.due ?? '', priority: 'רגילה', done: false, source: 'whatsapp' });
        return `נוספה משימה ל${b.name}: ${args.title}${args.due ? ` (עד ${dd(args.due)})` : ''} ✅`;
      }
      if (area === 'property') {
        if (!allow('invest')) return 'אין גישה לתחום הנכסים.';
        const p = match(await db.all('properties'), args.target);
        if (!p) return 'לא מצאתי נכס כזה.';
        await db.add('prop_tasks', { property_id: p.id, title: args.title, due: args.due ?? '', priority: 'רגילה', done: false, source: 'whatsapp' });
        return `נוספה משימה לנכס ${p.name}: ${args.title} ✅`;
      }
      if (!allow('home')) return 'אין גישה לתחום הבית.';
      await db.add('home_tasks', { title: args.title, due: args.due ?? '', priority: 'רגילה', repeat: 'לא חוזר', done: false, source: 'whatsapp' });
      return `נוספה משימת בית: ${args.title}${args.due ? ` (עד ${dd(args.due)})` : ''} ✅`;
    }
    case 'get_tasks': {
      const area = args.area ?? 'all';
      const out: string[] = [];
      const fmt = (t: Row, tag: string) => `• ${t.title}${t.due ? ` · ${dd(t.due)}` : ''}${tag ? ` (${tag})` : ''}`;
      if ((area === 'all' || area === 'home') && allow('home')) (await db.all('home_tasks')).filter((t) => !t.done).forEach((t) => out.push(fmt(t, area === 'all' && (!scope || scope.areas.length > 1) ? 'בית' : '')));
      if ((area === 'all' || area === 'business') && allow('business')) { const bs = await db.all('businesses'); (await db.all('biz_tasks')).filter((t) => !t.done).forEach((t) => out.push(fmt(t, bs.find((b) => b.id === t.business_id)?.name ?? 'עסק'))); }
      if ((area === 'all' || area === 'property') && allow('invest')) { const ps = await db.all('properties'); (await db.all('prop_tasks')).filter((t) => !t.done).forEach((t) => out.push(fmt(t, ps.find((p) => p.id === t.property_id)?.name ?? 'נכס'))); }
      return out.length ? `${out.length} משימות פתוחות:\n${out.slice(0, 12).join('\n')}${out.length > 12 ? `\nועוד ${out.length - 12}…` : ''}` : 'אין משימות פתוחות 🎉';
    }
    case 'add_expense': {
      if (!allow('home') || ro) return 'אין הרשאה לרשום הוצאות בית.';
      await db.add('transactions', { title: args.title, amount: Number(args.amount), kind: 'הוצאה', category: args.category ?? guessCategory(args.title), date: todayIso(), method: 'אשראי', source: 'whatsapp' });
      return `נרשמה הוצאה: ${args.title} · ${ils(Number(args.amount))} (${args.category ?? guessCategory(args.title)}) ✅`;
    }
    case 'get_home_spending': {
      if (!allow('home')) return 'אין גישה לנתוני הוצאות הבית.';
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
      if (!allow('business')) return 'אין גישה לנתוני העסקים.';
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
      if (!allow('invest')) return 'אין גישה לנתוני נכסים ושכירות.';
      const ps = await db.all('properties'); const pay = (await db.all('rent_payments')).filter((r) => r.month === ym);
      if (!pay.length) return 'אין תשלומי שכירות רשומים לחודש הזה.';
      return pay.map((r) => {
        const p = ps.find((x) => x.id === r.property_id);
        const full = (r.paid_amount || 0) >= r.amount;
        return `• ${p?.name ?? 'נכס'}: ${full ? `שולם ${ils(r.amount)} ✅` : r.due_date < todayIso() ? `לא שולם ${ils(r.amount)} ⚠️ (מועד ${dd(r.due_date)})` : `ממתין, מועד ${dd(r.due_date)}`}`;
      }).join('\n');
    }
    case 'mark_rent_paid': {
      if (!allow('invest') || ro) return 'אין הרשאה לעדכן תשלומי שכירות.';
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
      if (allow('home')) {
        (await db.all('bills')).filter((b) => within(b.next_due)).forEach((b) => out.push([b.next_due, `${b.name} · ${ils(b.amount || 0)}`]));
        (await db.all('home_tasks')).filter((t) => !t.done && within(t.due)).forEach((t) => out.push([t.due, t.title]));
      }
      if (allow('business')) {
        (await db.all('biz_tasks')).filter((t) => !t.done && within(t.due)).forEach((t) => out.push([t.due, t.title]));
      }
      if (allow('invest')) {
        (await db.all('leases')).filter((l) => within(l.end)).forEach((l) => out.push([l.end, 'סיום חוזה שכירות']));
      }
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

import { env, israelDay } from './server.js';
import { execTool, SYSTEM_PROMPT, TOOL_DECLARATIONS, type AgentData } from '../../shared/agent.js';
import {
  campaignsAccountDetail,
  campaignsOverview,
  DEFAULT_AGENCY_ACCOUNTS,
  executeVerifiedRecommendation,
  loadAgencyAccounts,
  metaCampaignsReady,
  runMetaDailyAgent,
} from './meta-campaigns.js';

const MODELS = () => [env('GEMINI_MODEL') || 'gemini-3.8-flash', 'gemini-flash-latest'].filter((m, i, a) => a.indexOf(m) === i);
const endpoint = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Thrown when Gemini stayed busy/over quota for the whole retry window — callers must not invent an answer. */
export class GeminiBusy extends Error {}

let onBusy: (() => Promise<void> | void) | null = null;
/** Run fn; the first time Gemini turns out to be busy, notify() is called once (e.g. "one moment…"). */
export async function whileBusy<T>(notify: () => Promise<void> | void, fn: () => Promise<T>): Promise<T> {
  let told = false;
  onBusy = async () => { if (!told) { told = true; await notify(); } };
  try { return await fn(); } finally { onBusy = null; }
}

async function call(body: unknown) {
  // Busy (503), over the per-minute quota (429) or slow: wait and try again, alternating models, for up to ~3 minutes.
  const deadline = Date.now() + 45_000; // stay inside the function time limit so the reply is always sent
  let last = '';
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const model = MODELS()[attempt % MODELS().length];
    try {
      const r = await fetch(endpoint(model), { method: 'POST', signal: AbortSignal.timeout(25000), headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') }, body: JSON.stringify(body) });
      if (r.ok) return r.json() as Promise<any>;
      last = `Gemini ${model} ${r.status}: ${(await r.text()).slice(0, 200)}`;
      if (![429, 500, 503, 504].includes(r.status)) throw new Error(last);
    } catch (e) {
      if (!(e instanceof Error) || !/aborted|timeout|fetch failed|ECONN/i.test(e.message)) throw e;
      last = `Gemini ${model}: ${e.message}`;
    }
    console.warn('gemini retry', attempt, last.slice(0, 120));
    await onBusy?.();
    await sleep(Math.min(4000 * 2 ** Math.floor(attempt / 2), 30000));
  }
  throw new GeminiBusy(last);
}

const META_WA_TOOLS = [
  {
    name: 'get_meta_campaigns_overview',
    description: 'סקירה חיה של כל חשבונות המודעות במטא של אדיג׳יטל (הוצאה, לידים, התכתבויות, התראות שחיקה והמלצות פתוחות)',
    parameters: { type: 'OBJECT', properties: { days: { type: 'NUMBER', description: 'מספר ימים אחורה (ברירת מחדל 7)' } } },
  },
  {
    name: 'get_meta_client_report',
    description: 'דוח עומק חי ללקוח ספציפי במטא (לידים, התכתבויות, חשיפה, ביקורי פרופיל, פירוט יומי ומודעות מנצחות ושורפות)',
    parameters: {
      type: 'OBJECT',
      properties: {
        client: { type: 'STRING', description: 'שם הלקוח (למשל אוספא, מונה מדיקל, באלנס רחובות, איזי ריזולטס) או מזהה חשבון' },
        days: { type: 'NUMBER', description: 'מספר ימים אחורה (למשל 1 לאתמול, 7, 14, 30)' },
      },
      required: ['client'],
    },
  },
  {
    name: 'run_meta_daily_review',
    description: 'מריץ עכשיו את סוכן הסקירה היומית של מטא, שומר המלצות חדשות בדשבורד ומחזיר סיכום',
    parameters: { type: 'OBJECT', properties: { days: { type: 'NUMBER' } } },
  },
  {
    name: 'pause_or_activate_meta_ad',
    description: 'השהיה (PAUSED) או הפעלה (ACTIVE) של מודעה/קמפיין במטא עם אימות חי מול שרתי Meta ותיעוד ביומן הביצועים',
    parameters: {
      type: 'OBJECT',
      properties: {
        client: { type: 'STRING', description: 'שם הלקוח או מזהה החשבון' },
        entityId: { type: 'STRING', description: 'מזהה המודעה או הקמפיין המספרי במטא' },
        entityName: { type: 'STRING', description: 'שם המודעה (אופציונלי)' },
        status: { type: 'STRING', enum: ['PAUSED', 'ACTIVE'] },
      },
      required: ['client', 'entityId', 'status'],
    },
  },
  {
    name: 'adjust_meta_budget',
    description: 'העלאה או הורדה של תקציב יומי באחוזים (-50 עד +30) במטא ללקוח, עם אימות חי מול שרתי Meta ותיעוד ביומן',
    parameters: {
      type: 'OBJECT',
      properties: {
        client: { type: 'STRING', description: 'שם הלקוח או מזהה החשבון' },
        deltaPct: { type: 'NUMBER', description: 'אחוז שינוי תקציב (למשל 20 להעלאה ב-20% או -15 להורדה)' },
        targetEntityId: { type: 'STRING', description: 'מזהה קמפיין/סט מודעות אופציונלי' },
      },
      required: ['client', 'deltaPct'],
    },
  },
];

async function resolveMetaAccount(workspaceId: string, query: string) {
  const list = await loadAgencyAccounts(workspaceId).catch(() => DEFAULT_AGENCY_ACCOUNTS);
  const q = String(query || '').trim().toLowerCase().replace(/[׳'"״-]/g, ' ');
  const exact = list.find((a) => a.accountId === q.replace(/^act_/, ''));
  if (exact) return exact;
  // Common Hebrew/English aliases
  const norm = q.replace(/אוספא|או ספא|ספא ראש/, 'ospa').replace(/טוסום/, 'twosome').replace(/קוזי/, 'cozy');
  return (
    list.find((a) => `${a.name} ${a.business || ''}`.toLowerCase().replace(/[׳'"״-]/g, ' ').includes(norm)) ??
    list.find((a) => norm.split(/\s+/).filter((w) => w.length >= 2).some((w) => `${a.name} ${a.business || ''}`.toLowerCase().includes(w)))
  );
}

async function execMetaWaTool(workspaceId: string, name: string, args: Record<string, any>): Promise<unknown> {
  if (name === 'get_meta_campaigns_overview') {
    const ov: any = await campaignsOverview(workspaceId, { days: Number(args.days) || 7 });
    if (!ov.configured) return { error: 'חיבור Meta Ads לא מוגדר בשרת' };
    return {
      range: ov.range,
      totals: ov.totals,
      activeAccounts: (ov.accounts || [])
        .filter((a: any) => a.spend > 0)
        .slice(0, 14)
        .map((a: any) => ({
          accountId: a.accountId,
          name: a.name,
          spend: Math.round(a.spend),
          leads: a.leads,
          messages: a.messages,
          impressions: a.impressions,
          profileVisits: a.profileVisits,
          frequency: Number(a.frequency.toFixed(2)),
          cpl: a.costPerResult ? Number(a.costPerResult.toFixed(1)) : null,
          status: a.statusLabel,
        })),
      topRecommendations: (ov.recommendations || []).slice(0, 6).map((r: any, i: number) => ({
        num: i + 1,
        title: r.title,
        reason: r.reason,
        kind: r.kind,
        accountId: r.accountId,
        targetEntityId: r.targetEntityId,
        impactIls: r.impactIls,
      })),
    };
  }
  if (name === 'get_meta_client_report') {
    const acc = await resolveMetaAccount(workspaceId, String(args.client || ''));
    if (!acc) return { error: `לא מצאתי חשבון מודעות בשם "${args.client}"` };
    const det = await campaignsAccountDetail(acc.accountId, { days: Number(args.days) || 7 });
    return {
      accountId: det.accountId,
      name: det.name,
      range: det.range,
      summary: det.summary,
      recentDays: det.daily.slice(-7).map((d) => ({ day: d.day, spend: Math.round(d.spend), leads: d.leads, messages: d.messages, reach: d.reach, impressions: d.impressions, profileVisits: d.profileVisits })),
      winners: det.winners.map((w) => ({ id: w.id, name: w.name, spend: Math.round(w.spend), results: w.primaryResults, cpl: w.costPerResult ? Number(w.costPerResult.toFixed(1)) : null })),
      bleeding: det.bleeding.map((b) => ({ id: b.id, name: b.name, spend: Math.round(b.spend), results: b.primaryResults, cpl: b.costPerResult ? Number(b.costPerResult.toFixed(1)) : null })),
    };
  }
  if (name === 'run_meta_daily_review') {
    const rev = await runMetaDailyAgent(workspaceId, Number(args.days) || 7);
    return { summary: rev.summary, recommendationsCount: rev.recommendations.length, recommendations: rev.recommendations.slice(0, 6) };
  }
  if (name === 'pause_or_activate_meta_ad') {
    const acc = await resolveMetaAccount(workspaceId, String(args.client || ''));
    const res = await executeVerifiedRecommendation(workspaceId, {
      kind: args.status === 'ACTIVE' ? 'activate_ad' : 'pause_ad',
      accountId: acc?.accountId || String(args.client || ''),
      accountName: acc?.name || String(args.client || ''),
      targetEntityId: String(args.entityId || ''),
      targetEntityName: args.entityName ? String(args.entityName) : undefined,
    });
    return res.receipt;
  }
  if (name === 'adjust_meta_budget') {
    const acc = await resolveMetaAccount(workspaceId, String(args.client || ''));
    if (!acc) return { error: `לא מצאתי חשבון מודעות בשם "${args.client}"` };
    const res = await executeVerifiedRecommendation(workspaceId, {
      kind: 'scale_budget',
      accountId: acc.accountId,
      accountName: acc.name,
      targetEntityId: args.targetEntityId ? String(args.targetEntityId) : undefined,
      deltaPct: Number(args.deltaPct),
    });
    return res.receipt;
  }
  return { error: 'כלי לא מוכר' };
}

/** Free-text → tool calls → Hebrew reply. Max 4 tool rounds. */
export async function geminiAgentReply(text: string, db: AgentData, history: { role: 'user' | 'model'; text: string }[] = [], workspaceId?: string): Promise<string> {
  const contents: any[] = [...history.filter((h) => h.text).map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: 'user', parts: [{ text }] }];
  // Gemini requires the conversation to start with a user turn.
  while (contents.length > 1 && contents[0].role !== 'user') contents.shift();
  const metaEnabled = Boolean(workspaceId && metaCampaignsReady());
  const allTools = metaEnabled ? [...TOOL_DECLARATIONS, ...META_WA_TOOLS] : [...TOOL_DECLARATIONS];
  const systemText = metaEnabled
    ? `${SYSTEM_PROMPT}\nבנוסף, אתה מחובר ישירות גם לסוכן ניהול הקמפיינים במטא של אדיג׳יטל: אפשר לבדוק מצב קמפיינים כללי או של לקוח ספציפי (לידים, התכתבויות, חשיפות, ביקורי פרופיל, מודעות מנצחות ושורפות), להריץ סקירה יומית, להשהות/להפעיל מודעות ולשנות תקציבים במטא. אחרי ביצוע פעולה במטא ציין תמיד את האימות שהתקבל (לפני -> אחרי).`
    : SYSTEM_PROMPT;

  for (let round = 0; round < 4; round++) {
    const out = await call({
      systemInstruction: { parts: [{ text: systemText }] },
      tools: [{ functionDeclarations: allTools }],
      contents,
    });
    const parts: any[] = out.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) return parts.map((p) => p.text || '').join('').trim() || 'לא הצלחתי להבין, אפשר לנסח אחרת?';
    contents.push({ role: 'model', parts });
    const results = [];
    for (const c of calls) {
      const fnName = c.functionCall.name;
      const fnArgs = c.functionCall.args ?? {};
      let result: unknown;
      if (metaEnabled && workspaceId && META_WA_TOOLS.some((t) => t.name === fnName)) {
        try { result = await execMetaWaTool(workspaceId, fnName, fnArgs); }
        catch (e: any) { result = { error: e.message || 'שגיאה בפעולת Meta Ads' }; }
      } else {
        result = await execTool(fnName, fnArgs, db);
      }
      results.push({ functionResponse: { name: fnName, response: { result } } });
    }
    contents.push({ role: 'user', parts: results });
  }
  return 'בוצע.';
}

const RECEIPT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchant: { type: 'STRING', nullable: true, description: 'שם העסק/הספק' },
    total: { type: 'NUMBER', nullable: true, description: 'סה״כ לתשלום כולל מע״מ' },
    vat: { type: 'NUMBER', nullable: true, description: 'סכום המע״מ' },
    date: { type: 'STRING', nullable: true, description: 'תאריך הקבלה בפורמט YYYY-MM-DD. בקבלות ישראליות התאריך מודפס יום/חודש/שנה (למשל 19/11/26 = 2026-11-19)' },
    category: { type: 'STRING', nullable: true, description: 'קטגוריית הוצאה בעברית' },
    invoice_number: { type: 'STRING', nullable: true },
    payment_method: { type: 'STRING', nullable: true },
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, qty: { type: 'NUMBER', nullable: true }, price: { type: 'NUMBER', nullable: true } }, required: ['name'] } },
    suggested_target: { type: 'STRING', nullable: true, description: 'אחת מהאפשרויות ברשימת היעדים, הכי סבירה' },
  },
};
const receiptPrompt = (targets: string[], cats: string[]) =>
  `זו קבלה או חשבונית. חלץ את כל הפרטים: ספק, תאריך, סה״כ, מע״מ, אמצעי תשלום ורשימת מוצרים/שירותים עם כמות ומחיר.
אם שדה לא מופיע בבירור, החזר null ואל תנחש.
date: קבלות בישראל מדפיסות תאריך בסדר יום/חודש/שנה, לרוב עם שנה בשתי ספרות (19/11/26 הוא 19 בנובמבר 2026, לא 2019). היום ${israelDay()}, וקבלה היא כמעט תמיד מהימים או מהשבועות האחרונים.
category: בחר אחת מ: ${cats.join(', ')}.
suggested_target: בחר מהרשימה לאן ההוצאה הכי סבירה שייכת: ${targets.join(' | ')}.`;

/** Receipt image/PDF → structured expense (with line items and a suggested destination). */
export async function scanReceipt(base64: string, mimeType: string, targets: string[] = [], cats: string[] = []) {
  const out = await call({
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: base64 } }, { text: receiptPrompt(targets, cats) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RECEIPT_SCHEMA },
  });
  return JSON.parse(out.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
}

/** Receipt that arrived as a web page (digital receipt link) → same structure. */
export async function scanReceiptText(text: string, targets: string[] = [], cats: string[] = []) {
  const out = await call({
    contents: [{ role: 'user', parts: [{ text: `${receiptPrompt(targets, cats)}\n\nתוכן הדף:\n${text}` }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RECEIPT_SCHEMA },
  });
  return JSON.parse(out.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
}

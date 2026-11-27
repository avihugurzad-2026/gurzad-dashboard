import { env, israelDay } from './server.js';
import { execTool, systemPromptForScope, toolsForScope, type AgentData, type AgentScope } from '../../shared/agent.js';
import {
  campaignsAccountDetail,
  campaignsOverview,
  DEFAULT_AGENCY_ACCOUNTS,
  executeVerifiedRecommendation,
  loadAgencyAccounts,
  metaCampaignsReady,
  runMetaDailyAgent,
} from './meta-campaigns.js';
import {
  createCreativeDraft,
  getActiveCreativeDraft,
  listClientAdSets,
  publishCreativeDraftToMeta,
  reviseCreativeDraft,
  type CreativeMediaAttachment,
} from './meta-creative.js';

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
  {
    name: 'create_meta_ad_creative',
    description: 'מייצר טיוטת מודעה חדשה למטא: גרפיקת פיד (4:5 או 1:1) + גרסת סטורי/רילס (9:16) + הצעת מלל מלאה (טקסט ראשי, כותרת, תיאור, CTA), ושולח את התמונות לאישור אביהו',
    parameters: {
      type: 'OBJECT',
      properties: {
        client: { type: 'STRING', description: 'שם הלקוח (למשל מונה מדיקל, אוספא, באלנס רחובות)' },
        brief: { type: 'STRING', description: 'בריף מפורט: מה מוכרים, מבצע, סגנון עיצובי, כיתוב רצוי' },
        feedAspect: { type: 'STRING', enum: ['4:5', '1:1'], description: 'יחס פיד (ברירת מחדל 4:5)' },
      },
      required: ['brief'],
    },
  },
  {
    name: 'revise_meta_ad_creative',
    description: 'מעדכן את טיוטת המודעה הפעילה: תיקון מלל (טקסט ראשי/כותרת/תיאור/CTA) ו/או יצירה מחדש של גרפיקת הפיד, הסטורי או שניהם',
    parameters: {
      type: 'OBJECT',
      properties: {
        editInstruction: { type: 'STRING', description: 'הנחיית התיקון המדויקת מאביהו' },
        regenerate: { type: 'STRING', enum: ['none', 'feed', 'story', 'both'], description: 'אילו גרפיקות לייצר מחדש (none אם זה רק שינוי מלל)' },
        primaryText: { type: 'STRING', description: 'טקסט ראשי חדש (אם השתנה)' },
        headline: { type: 'STRING', description: 'כותרת חדשה (אם השתנתה)' },
        description: { type: 'STRING', description: 'תיאור חדש (אם השתנה)' },
        ctaType: { type: 'STRING', description: 'CTA חדש (אופציונלי)' },
        client: { type: 'STRING', description: 'עדכון לקוח (אופציונלי)' },
      },
    },
  },
  {
    name: 'list_meta_client_adsets',
    description: 'מחזיר את רשימת סדרות המודעות (Ad Sets) הפעילות והמושהות של לקוח במטא כדי לבחור לאן להעלות מודעה',
    parameters: {
      type: 'OBJECT',
      properties: {
        client: { type: 'STRING', description: 'שם הלקוח או מזהה החשבון' },
      },
      required: ['client'],
    },
  },
  {
    name: 'publish_meta_ad_creative',
    description: 'מעלה בפועל את טיוטת המודעה המאושרת (פיד + סטורי + מלל) למטא. חובה לקרוא רק אחרי שאביהו אישר במפורש גם את המודעה וגם את המלל! ברירת מחדל ACTIVE (לאוויר), ו-PAUSED רק אם אביהו ביקש לא לפרסם אלא רק להעלות כמושהה',
    parameters: {
      type: 'OBJECT',
      properties: {
        client: { type: 'STRING', description: 'שם הלקוח (אופציונלי אם כבר שמור בטיוטה)' },
        adsetId: { type: 'STRING', description: 'מזהה סט המודעות המספרי (אם ידוע)' },
        adsetQuery: { type: 'STRING', description: 'שם סט המודעות או הקמפיין שאביהו בחר' },
        publishStatus: { type: 'STRING', enum: ['ACTIVE', 'PAUSED'], description: 'ACTIVE (ברירת מחדל באישור מלא) או PAUSED אם אביהו הנחה לא לפרסם אלא לשמור מושהה' },
      },
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

async function execMetaWaTool(
  workspaceId: string,
  name: string,
  args: Record<string, any>,
  opts?: { referencePath?: string | null; onAttachments?: (atts: CreativeMediaAttachment[]) => void },
): Promise<unknown> {
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
  if (name === 'create_meta_ad_creative') {
    const res = await createCreativeDraft({
      workspaceId,
      client: args.client ? String(args.client) : undefined,
      brief: String(args.brief || ''),
      referencePath: opts?.referencePath ?? null,
      feedAspect: args.feedAspect === '1:1' ? '1:1' : '4:5',
    });
    if (res.attachments.length) opts?.onAttachments?.(res.attachments);
    return {
      draftId: res.draft.id,
      client: res.draft.accountName || res.draft.clientQuery || 'לא צוין',
      feedAspect: res.draft.feedAspect,
      generatedImagesSent: res.attachments.map((a) => a.caption),
      adName: res.draft.adName,
      primaryText: res.draft.primaryText,
      headline: res.draft.headline,
      description: res.draft.description,
      ctaType: res.draft.ctaType,
      availableAdSets: (res.adsets || []).slice(0, 6),
    };
  }
  if (name === 'revise_meta_ad_creative') {
    const res = await reviseCreativeDraft({
      workspaceId,
      editInstruction: args.editInstruction ? String(args.editInstruction) : undefined,
      regenerate: args.regenerate ? (String(args.regenerate) as any) : 'none',
      primaryText: args.primaryText ? String(args.primaryText) : undefined,
      headline: args.headline ? String(args.headline) : undefined,
      description: args.description ? String(args.description) : undefined,
      ctaType: args.ctaType ? String(args.ctaType) : undefined,
      client: args.client ? String(args.client) : undefined,
    });
    if (res.attachments.length) opts?.onAttachments?.(res.attachments);
    return {
      draftId: res.draft.id,
      client: res.draft.accountName || 'לא צוין',
      updatedImagesSent: res.attachments.map((a) => a.caption),
      adName: res.draft.adName,
      primaryText: res.draft.primaryText,
      headline: res.draft.headline,
      description: res.draft.description,
      ctaType: res.draft.ctaType,
    };
  }
  if (name === 'list_meta_client_adsets') {
    const res = await listClientAdSets(workspaceId, String(args.client || ''));
    return { account: res.account.name, adsets: res.adsets };
  }
  if (name === 'publish_meta_ad_creative') {
    return await publishCreativeDraftToMeta({
      workspaceId,
      client: args.client ? String(args.client) : undefined,
      adsetId: args.adsetId ? String(args.adsetId) : undefined,
      adsetQuery: args.adsetQuery ? String(args.adsetQuery) : undefined,
      publishStatus: args.publishStatus === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
    });
  }
  return { error: 'כלי לא מוכר' };
}

/** Free-text → tool calls → Hebrew reply. Max 4 tool rounds. */
export async function geminiAgentReply(
  text: string,
  db: AgentData,
  history: { role: 'user' | 'model'; text: string }[] = [],
  workspaceId?: string,
  opts?: { referencePath?: string | null; onAttachments?: (atts: CreativeMediaAttachment[]) => void; scope?: AgentScope },
): Promise<string> {
  const contents: any[] = [...history.filter((h) => h.text).map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: 'user', parts: [{ text }] }];
  // Gemini requires the conversation to start with a user turn.
  while (contents.length > 1 && contents[0].role !== 'user') contents.shift();
  const scope = opts?.scope;
  const metaAllowed = scope ? Boolean(scope.allowMeta) : true;
  const metaEnabled = Boolean(metaAllowed && workspaceId && metaCampaignsReady());
  const baseTools = toolsForScope(scope);
  const allTools = metaEnabled ? [...baseTools, ...META_WA_TOOLS] : baseTools;
  const activeDraft = metaEnabled && workspaceId ? await getActiveCreativeDraft(workspaceId).catch(() => null) : null;
  const draftHint = activeDraft
    ? `\n\n[סטטוס טיוטת מודעה פעילה כרגע: לקוח=${activeDraft.accountName || 'לא נבחר'}, כותרת="${activeDraft.headline}", טקסט="${activeDraft.primaryText.slice(0, 120)}...", יש פיד=${!!activeDraft.feedPath}, יש סטורי=${!!activeDraft.storyPath}${activeDraft.adsetName ? `, סט מודעות=${activeDraft.adsetName}` : ''}]`
    : '';
  const basePrompt = systemPromptForScope(scope);
  const systemText = metaEnabled
    ? `${basePrompt}\nבנוסף, אתה מחובר ישירות גם לסוכן ניהול הקמפיינים והקריאייטיב במטא של אדיג׳יטל (מנהל מדיה וקריאייטיב בכיר):
- אפשר לבדוק מצב קמפיינים כללי או של לקוח ספציפי (לידים, התכתבויות, חשיפות, ביקורי פרופיל, מודעות מנצחות ושורפות), להריץ סקירה יומית, להשהות/להפעיל מודעות ולשנות תקציבים במטא.
- **סטודיו קריאייטיב והעלאת מודעות למטא**: אתה יודע לייצר גרפיקות מודעה (תמיד **גם פיד וגם סטורי 9:16** ביחד!) + הצעת מלל מלאה (טקסט ראשי, כותרת, תיאור, CTA), לבצע תיקונים לפי בקשת אביהו (במלל, בפיד, בסטורי או בשניהם), ולהעלות בפועל למטא.
- **כללי אישור והעלאה קשיחים**:
  1. לעולם אל תעלה למטא (\`publish_meta_ad_creative\`) לפני שאביהו אישר במפורש **גם את המלל וגם את המודעות (פיד + סטורי)**.
  2. ברגע שאביהו אישר את המלל + המודעות וציין לאיזה לקוח/סט מודעות להעלות — העלה בסטטוס \`ACTIVE\` (ישר לאוויר!).
  3. אם אביהו הנחה במפורש לא לפרסם אלא רק להעלות/לשמור מושהה (למשל "תעלה מושהה", "אל תפעיל עדיין", "רק תעלה בלי לפרסם") — העלה בסטטוס \`PAUSED\`.
  4. כשמציגים טיוטת מודעה לאישור, הצג בצורה מסודרת ויפה לוואטסאפ את *הטקסט הראשי*, *הכותרת*, *התיאור* וה־*CTA*, וציין את סדרות המודעות הפעילות שאפשר להעלות אליהן.
- כשעונים על קמפיינים במטא: ענה בצורה חכמה, מעמיקה ומעוצבת לוואטסאפ — עם *כותרות מודגשות*, אמוג׳ים מדויקים (📊 🔥 ⚠️ ✅ 🎯 💡 💰 🎨 🚀), תובנות עסקיות אמיתיות והמלצות קונקרטיות ממוספרות (1️⃣ 2️⃣ 3️⃣). אחרי ביצוע פעולה במטא ציין תמיד את האימות החי שהתקבל (לפני -> אחרי ✅).${draftHint}`
    : basePrompt;

  for (let round = 0; round < 4; round++) {
    const out = await call({
      systemInstruction: { parts: [{ text: systemText }] },
      ...(allTools.length ? { tools: [{ functionDeclarations: allTools }] } : {}),
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
        try { result = await execMetaWaTool(workspaceId, fnName, fnArgs, opts); }
        catch (e: any) { result = { error: e.message || 'שגיאה בפעולת Meta Ads' }; }
      } else {
        result = await execTool(fnName, fnArgs, db, scope);
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

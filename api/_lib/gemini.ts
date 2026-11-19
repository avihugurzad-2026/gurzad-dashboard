import { env } from './server.js';
import { execTool, SYSTEM_PROMPT, TOOL_DECLARATIONS, type AgentData } from '../../shared/agent.js';

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

/** Free-text → tool calls → Hebrew reply. Max 4 tool rounds. */
export async function geminiAgentReply(text: string, db: AgentData, history: { role: 'user' | 'model'; text: string }[] = []): Promise<string> {
  const contents: any[] = [...history.filter((h) => h.text).map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: 'user', parts: [{ text }] }];
  // Gemini requires the conversation to start with a user turn.
  while (contents.length > 1 && contents[0].role !== 'user') contents.shift();
  for (let round = 0; round < 4; round++) {
    const out = await call({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      contents,
    });
    const parts: any[] = out.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) return parts.map((p) => p.text || '').join('').trim() || 'לא הצלחתי להבין, אפשר לנסח אחרת?';
    contents.push({ role: 'model', parts });
    const results = [];
    for (const c of calls) {
      const result = await execTool(c.functionCall.name, c.functionCall.args ?? {}, db);
      results.push({ functionResponse: { name: c.functionCall.name, response: { result } } });
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
date: קבלות בישראל מדפיסות תאריך בסדר יום/חודש/שנה, לרוב עם שנה בשתי ספרות (19/11/26 הוא 19 בנובמבר 2026, לא 2019). היום ${new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10)}, וקבלה היא כמעט תמיד מהימים או מהשבועות האחרונים.
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

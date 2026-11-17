import { env } from './server.js';
import { execTool, SYSTEM_PROMPT, TOOL_DECLARATIONS, type AgentData } from '../../shared/agent.js';

const MODELS = () => [env('GEMINI_MODEL') || 'gemini-3.8-flash', 'gemini-flash-latest'].filter((m, i, a) => a.indexOf(m) === i);
const endpoint = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

async function call(body: unknown) {
  // Each try is capped at 9s; when the main model is busy (429/503) or slow, fall back to the next one.
  let last = '';
  for (const model of MODELS()) {
    try {
      const r = await fetch(endpoint(model), { method: 'POST', signal: AbortSignal.timeout(9000), headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') }, body: JSON.stringify(body) });
      if (r.ok) return r.json() as Promise<any>;
      last = `Gemini ${model} ${r.status}: ${(await r.text()).slice(0, 200)}`;
      if (r.status !== 503 && r.status !== 429 && r.status !== 404) break;
    } catch (e) { last = `Gemini ${model}: ${(e as Error).message}`; }
  }
  throw new Error(last);
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
    date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
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

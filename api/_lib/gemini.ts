import { env } from './server.js';
import { execTool, SYSTEM_PROMPT, TOOL_DECLARATIONS, type AgentData } from '../../shared/agent.js';

const endpoint = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${env('GEMINI_MODEL') || 'gemini-2.5-flash'}:generateContent`;

async function call(body: unknown) {
  const r = await fetch(endpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json() as Promise<any>;
}

/** Free-text → tool calls → Hebrew reply. Max 4 tool rounds. */
export async function geminiAgentReply(text: string, db: AgentData): Promise<string> {
  const contents: any[] = [{ role: 'user', parts: [{ text }] }];
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

/** Receipt image → structured expense. Used by /api/gemini/scan-receipt (and later by WhatsApp image messages). */
export async function scanReceipt(base64: string, mimeType: string) {
  const out = await call({
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType, data: base64 } },
      { text: 'זו קבלה או חשבונית. חלץ את הפרטים. אם שדה לא מופיע בבירור, החזר null ואל תנחש.' },
    ] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          merchant: { type: 'STRING', nullable: true },
          total: { type: 'NUMBER', nullable: true },
          vat: { type: 'NUMBER', nullable: true },
          date: { type: 'STRING', description: 'YYYY-MM-DD', nullable: true },
          category: { type: 'STRING', nullable: true },
          invoice_number: { type: 'STRING', nullable: true },
        },
      },
    },
  });
  return JSON.parse(out.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
}

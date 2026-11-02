// Types for the tested CommonJS Gmail-import module (stage 4)
declare namespace gmail {
  type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;
  type Attachment = { filename: string | null; mimeType: string | null; attachmentId: string | null; size: number | null; data?: string };
  type Parts = { id: string | null; subject: string | null; from: string | null; date: string | null; text: string; attachments: Attachment[] };
  /** A candidate row (src/server/imports.ts ParsedRow without external_id). Null = not stated, never guessed. */
  type Extracted = {
    occurred_on: string | null; amount: number | null; direction: 'expense'; merchant: string | null; description: string | null;
    currency: string | null; vat_amount: number | null; document_number: string | null;
  };
}
declare const gmail: {
  SCOPE_GMAIL: string;
  searchQuery(opts?: { since?: Date | string | number | null }): string;
  getProfile(accessToken: string, opts?: { fetchImpl?: gmail.FetchImpl }): Promise<{ email: string | null }>;
  searchQueries(args?: { since?: Date | string | number }): string[];
  listMessages(accessToken: string, q: string, opts?: { max?: number; fetchImpl?: gmail.FetchImpl }): Promise<{ id: string; threadId: string | null }[]>;
  getMessage(accessToken: string, id: string, opts?: { fetchImpl?: gmail.FetchImpl }): Promise<unknown>;
  getAttachment(accessToken: string, messageId: string, attachmentId: string, opts?: { fetchImpl?: gmail.FetchImpl }): Promise<Buffer>;
  messageParts(msg: unknown): gmail.Parts;
  extractFromMessage(msg: { subject?: string | null; from?: string | null; date?: string | null; text?: string }, attachmentTexts?: string[]): gmail.Extracted;
  classifyMessage(msg: unknown, attachmentTexts?: string[]): { score: number; confidence: 'high' | 'medium' | 'low' | 'none'; rejected: boolean; document_type: string; reasons: string[]; parsed: gmail.Extracted };
  htmlToText(html: string): string;
  parseFrom(from: string | null | undefined): { name: string | null; address: string | null; domain: string | null };
  isPdf(a: { mimeType?: string | null; filename?: string | null } | null | undefined): boolean;
  b64url(data: string | null | undefined): Buffer;
};
export = gmail;

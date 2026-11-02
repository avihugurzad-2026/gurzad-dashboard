// Types for the tested CommonJS statement module (importing bank / card statements and receipts)
type Kind = 'bank' | 'card';
type Opts = { kind?: Kind | 'auto' };
type Row = {
  occurred_on: string; amount: number; direction: 'expense' | 'income'; merchant: string;
  description: string | null; currency: string; reference: string | null; raw: string[];
};
type Rows = { rows: Row[]; columns: Record<string, number>; headerRow: number; warnings: string[]; kind?: Kind | null };
type Receipt = {
  supplier: string | null; date: string | null; document_number: string | null; total: number | null;
  vat: number | null; vat_rate: number | null; currency: string | null; tax_id: string | null;
};

declare const statement: {
  decodeText(buf: Buffer | Uint8Array): string;
  parseCsv(text: string): string[][];
  readXlsx(buf: Buffer | Uint8Array): { name: string; rows: string[][] }[];
  pdfText(buf: Buffer | Uint8Array): string;
  tableToRows(table: string[][], opts?: Opts): Rows;
  textToRows(text: string, opts?: Opts): Rows;
  parseStatement(buf: Buffer | Uint8Array, filename: string, mime?: string | null, opts?: Opts): {
    format: 'csv' | 'xlsx' | 'pdf'; rows: Row[]; columns: Record<string, number>; warnings: string[]; error?: string; kind?: Kind | null;
  };
  /** vat_rate is a fraction (18% → 0.18), only when the text states it */
  parseReceiptText(text: string): Receipt;
  parseAmount(s: string | number | null | undefined): { value: number; currency: string | null } | null;
  parseDate(s: string | null | undefined): string | null;
  excelDate(serial: number | string, date1904?: boolean): string | null;
  currencyOf(s: string | null | undefined): string | null;
};
export = statement;

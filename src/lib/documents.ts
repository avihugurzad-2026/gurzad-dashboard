// Document types and the objects a document can be about (3.4). Shared by the server, the forms
// and the search palette.

export const DOC_TYPES = [
  { id: 'invoice', label: 'חשבונית' },
  { id: 'receipt', label: 'קבלה' },
  { id: 'contract', label: 'חוזה' },
  { id: 'legal', label: 'מסמך משפטי' },
  { id: 'report', label: 'דוח' },
  { id: 'other', label: 'אחר' },
] as const;
export type DocType = (typeof DOC_TYPES)[number]['id'];

export const isDocType = (v: unknown): v is DocType => DOC_TYPES.some(t => t.id === v);
export const docTypeLabel = (id: string) => DOC_TYPES.find(t => t.id === id)?.label ?? 'אחר';

// subject_type values (the ventures objects; no FK, the other tables own their rows)
export const SUBJECT_TYPES = ['asset', 'liability', 'investment', 'legal_case', 'contact'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const isSubjectType = (v: unknown): v is SubjectType => SUBJECT_TYPES.includes(v as SubjectType);

export const MAX_DOC_BYTES = 4 * 1024 * 1024;

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

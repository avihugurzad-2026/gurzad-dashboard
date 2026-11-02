// Smart Inbox (stage 2.5): a rough "what kind of document is this" key, from the file name or
// text. Dates, numbers and the extension are dropped, so "חשבונית_בזק_2026-09.pdf" and
// "חשבונית בזק 10.2026.pdf" get the same words. Used to suggest the last classification
// the user picked for similar items.

const STOP = new Set(['pdf', 'jpg', 'jpeg', 'png', 'heic', 'doc', 'docx', 'xls', 'xlsx', 'img', 'scan', 'file', 'copy',
  'של', 'עם', 'את', 'על', 'קובץ', 'סריקה', 'עותק', 'the', 'and', 'for']);

export function fingerprint(text: string | null | undefined): string {
  if (!text) return '';
  const words = text
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, ' ')
    .split(/[^a-zא-ת]+/i)
    .filter(w => w.length >= 2 && !STOP.has(w));
  return [...new Set(words)].sort().slice(0, 12).join(' ');
}

// Jaccard similarity of two fingerprints (0..1)
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = new Set(a.split(' ')), B = new Set(b.split(' '));
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

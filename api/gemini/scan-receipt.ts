import { handler, has, HttpError, requireMember } from '../_lib/server';
import { scanReceipt } from '../_lib/gemini';

// POST { image: <base64>, mimeType } → { merchant, total, vat, date, category, invoice_number }
// Ready for the receipt-scanning feature; nothing in the UI calls it yet.
export default handler(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  await requireMember(req);
  if (!has('GEMINI_API_KEY')) throw new HttpError(503, 'Gemini לא מחובר');
  const { image, mimeType } = (req.body ?? {}) as { image?: string; mimeType?: string };
  if (!image || !/^image\/(jpeg|png|webp|heic)$/.test(mimeType || '')) throw new HttpError(400, 'נדרשת תמונה');
  if (image.length > 8_000_000) throw new HttpError(413, 'התמונה גדולה מדי');
  res.json(await scanReceipt(image, mimeType!));
});

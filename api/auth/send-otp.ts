import crypto from 'node:crypto';
import { env, handler, HttpError, sbAdmin } from '../_lib/server.js';
import { otpMail, sendMail } from '../_lib/mail.js';

export const hashCode = (email: string, code: string) =>
  crypto.createHmac('sha256', env('SUPABASE_SERVICE_ROLE_KEY')).update(`${email}:${code}`).digest('hex');

/** Who may sign in: the owner (OWNER_EMAIL), existing members, and invited emails. Nobody else. */
export async function isAllowed(email: string) {
  if (email === env('OWNER_EMAIL').trim().toLowerCase()) return true;
  const sb = sbAdmin();
  const { data: inv } = await sb.from('gd_invites').select('id').eq('email', email).limit(1);
  return !!inv?.length; // members always have an invite row (it is kept after acceptance)
}

// POST { email } → always { ok: true } (does not reveal whether the email is allowed)
export default handler(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const email = String((req.body ?? {}).email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new HttpError(400, 'כתובת מייל לא תקינה');

  const sb = sbAdmin();
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { data: recent } = await sb.from('gd_otp').select('created_at').eq('email', email).gte('created_at', since).order('created_at', { ascending: false });
  if (recent?.length && Date.now() - new Date(recent[0].created_at).getTime() < 30e3) throw new HttpError(429, 'אפשר לבקש קוד חדש בעוד חצי דקה');
  if ((recent?.length ?? 0) >= 6) throw new HttpError(429, 'יותר מדי בקשות. נסה שוב בעוד שעה.');

  if (await isAllowed(email)) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await sb.from('gd_otp').insert({ email, code_hash: hashCode(email, code), expires_at: new Date(Date.now() + 10 * 60e3).toISOString() });
    const m = otpMail(code);
    await sendMail(email, m.subject, m.html, m.text);
  } else {
    // record the attempt so the throttle also applies to unknown addresses
    await sb.from('gd_otp').insert({ email, code_hash: 'x', expires_at: new Date().toISOString(), used_at: new Date().toISOString() });
  }
  res.json({ ok: true });
});

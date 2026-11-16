import { handler, HttpError, requireMember, sbAdmin, env } from './_lib/server';
import { inviteMail, sendMail } from './_lib/mail';

// POST { email, name, role, areas } — owner only. Stores the invite and emails it through Resend.
// The invitee signs in with an email OTP; /api/auth/verify-otp turns the invite into a membership.
export default handler(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const me = await requireMember(req);
  if (me.role !== 'owner') throw new HttpError(403, 'רק בעלים יכול להזמין');

  const { email, name, role, areas } = (req.body ?? {}) as { email?: string; name?: string; role?: string; areas?: string[] };
  const mail = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(mail)) throw new HttpError(400, 'כתובת מייל לא תקינה');
  if (!['editor', 'viewer'].includes(role || '')) throw new HttpError(400, 'תפקיד לא תקין');
  const okAreas = (areas ?? []).filter((a) => ['home', 'business', 'invest'].includes(a));
  if (!okAreas.length) throw new HttpError(400, 'יש לבחור תחום אחד לפחות');

  const { error } = await sbAdmin().from('gd_invites').upsert(
    { workspace_id: me.workspaceId, email: mail, name: String(name || '').slice(0, 80), role, areas: okAreas, invited_by: me.user.id, accepted_at: null },
    { onConflict: 'workspace_id,email' });
  if (error) throw error;

  const m = inviteMail(String(me.user.user_metadata?.name || me.user.email), okAreas, env('APP_URL') || `https://${req.headers.host}`);
  await sendMail(mail, m.subject, m.html, m.text);
  res.json({ ok: true });
});

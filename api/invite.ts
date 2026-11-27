import { handler, HttpError, requireMember, sbAdmin, env } from './_lib/server.js';
import { inviteMail, sendMail } from './_lib/mail.js';

const ALLOWED_AREAS = ['home', 'business', 'invest', 'chat', 'meta_campaigns', 'status'] as const;
const MAIN_AREAS = ['home', 'business', 'invest'] as const;

// Owner only.
// POST   { email, name, role, areas } → stores (or re-sends) the invite and emails it through Resend.
//        If that person already signed in before, their access is updated right away.
// PATCH  { email, name?, role, areas } → updates an existing member's permissions immediately (no email sent).
// DELETE { email } → removes the invite AND the membership, so the person really loses access
//        (deleting only the member card would leave the membership in place).
// The invitee signs in with an email OTP; /api/auth/verify-otp turns the invite into a membership.
export default handler(async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') throw new HttpError(405, 'Method not allowed');
  const me = await requireMember(req);
  if (me.role !== 'owner') throw new HttpError(403, 'רק בעלים יכול לנהל הרשאות');
  const sb = sbAdmin();

  const body = (req.body ?? {}) as { email?: string; name?: string; role?: string; areas?: string[] };
  const mail = String(body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(mail)) throw new HttpError(400, 'כתובת מייל לא תקינה');
  if (mail === String(me.user.email || '').toLowerCase()) throw new HttpError(400, 'זה המייל שלך');

  // The member of this workspace with this email, if she already signed in. A workspace has a handful of
  // members, so look them up one by one (auth.users is shared with other apps; no listing of it).
  const existingUserId = async () => {
    const { data: mems } = await sb.from('gd_memberships').select('user_id').eq('workspace_id', me.workspaceId);
    for (const m of mems ?? []) {
      const { data } = await sb.auth.admin.getUserById(m.user_id);
      if (String(data.user?.email || '').toLowerCase() === mail) return m.user_id as string;
    }
    return null;
  };

  if (req.method === 'DELETE') {
    await sb.from('gd_invites').delete().eq('workspace_id', me.workspaceId).eq('email', mail);
    const uid = await existingUserId();
    if (uid) {
      await sb.from('gd_memberships').delete().eq('workspace_id', me.workspaceId).eq('user_id', uid).neq('role', 'owner');
      await sb.from('gd_google_tokens').delete().eq('workspace_id', me.workspaceId).eq('user_id', uid);
    }
    const { data: cards } = await sb.from('gd_records').select('id, data').eq('workspace_id', me.workspaceId).eq('collection', 'members');
    const ids = (cards ?? []).filter((c) => String((c.data as any)?.email).toLowerCase() === mail && (c.data as any)?.role !== 'owner').map((c) => c.id);
    if (ids.length) await sb.from('gd_records').delete().in('id', ids);
    res.json({ ok: true });
    return;
  }

  const { name, role, areas } = body;
  if (!['editor', 'viewer'].includes(role || '')) throw new HttpError(400, 'תפקיד לא תקין');
  const okAreas = Array.from(new Set((areas ?? []).filter((a) => (ALLOWED_AREAS as readonly string[]).includes(a))));
  if (!okAreas.some((a) => (MAIN_AREAS as readonly string[]).includes(a))) throw new HttpError(400, 'יש לבחור תחום אחד לפחות (בית / עסקים / השקעות)');

  if (req.method === 'PATCH') {
    // Update membership (if active) + pending invite (if any) + member card in gd_records
    const uid = await existingUserId();
    if (uid) {
      const { data: mem } = await sb.from('gd_memberships').select('role').eq('workspace_id', me.workspaceId).eq('user_id', uid).maybeSingle();
      if (mem && mem.role !== 'owner') {
        await sb.from('gd_memberships').update({ role, areas: okAreas }).eq('workspace_id', me.workspaceId).eq('user_id', uid);
      }
    }
    await sb.from('gd_invites').update({ role, areas: okAreas, ...(name ? { name: String(name).slice(0, 80) } : {}) }).eq('workspace_id', me.workspaceId).eq('email', mail);
    const { data: cards } = await sb.from('gd_records').select('id, data').eq('workspace_id', me.workspaceId).eq('collection', 'members');
    for (const c of cards ?? []) {
      const d = (c.data ?? {}) as Record<string, any>;
      if (String(d.email || '').toLowerCase() === mail && d.role !== 'owner') {
        await sb.from('gd_records').update({ data: { ...d, role, areas: okAreas, ...(name ? { name: String(name).slice(0, 80) } : {}) } }).eq('id', c.id);
      }
    }
    res.json({ ok: true, role, areas: okAreas });
    return;
  }

  const { error } = await sb.from('gd_invites').upsert(
    { workspace_id: me.workspaceId, email: mail, name: String(name || '').slice(0, 80), role, areas: okAreas, invited_by: me.user.id, accepted_at: null },
    { onConflict: 'workspace_id,email' });
  if (error) throw error;

  // Already a member (changing her areas) → apply now, no need to sign in again.
  const uid = await existingUserId();
  if (uid) {
    const { data: mem } = await sb.from('gd_memberships').select('role').eq('workspace_id', me.workspaceId).eq('user_id', uid).maybeSingle();
    if (mem && mem.role !== 'owner') await sb.from('gd_memberships').update({ role, areas: okAreas }).eq('workspace_id', me.workspaceId).eq('user_id', uid);
  }

  const m = inviteMail(String(me.user.user_metadata?.name || me.user.email), okAreas.filter((a) => (MAIN_AREAS as readonly string[]).includes(a)), env('APP_URL') || `https://${req.headers.host}`);
  await sendMail(mail, m.subject, m.html, m.text);
  res.json({ ok: true });
});

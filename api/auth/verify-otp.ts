import { env, safeEqual, handler, HttpError, sbAdmin } from '../_lib/server.js';
import { hashCode, isAllowed } from './send-otp.js';

// POST { email, code } → { token_hash }. The client exchanges token_hash for a Supabase session
// (supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })), so RLS works with a normal user JWT.
export default handler(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const email = String((req.body ?? {}).email || '').trim().toLowerCase();
  const code = String((req.body ?? {}).code || '').replace(/\D/g, '');
  if (!email || code.length !== 6) throw new HttpError(400, 'הקוד לא נכון');

  const sb = sbAdmin();
  const { data: row } = await sb.from('gd_otp').select('*').eq('email', email).is('used_at', null)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!row || row.attempts >= 5) throw new HttpError(400, 'הקוד לא נכון או שפג תוקפו');
  if (!safeEqual(row.code_hash, hashCode(email, code))) {
    await sb.from('gd_otp').update({ attempts: row.attempts + 1 }).eq('id', row.id);
    throw new HttpError(400, 'הקוד לא נכון');
  }
  await sb.from('gd_otp').update({ used_at: new Date().toISOString() }).eq('id', row.id);
  if (!(await isAllowed(email))) throw new HttpError(403, 'אין גישה');

  // Mint a one-time sign-in token; creates the auth user on first sign-in.
  let link = await sb.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) {
    await sb.auth.admin.createUser({ email, email_confirm: true });
    link = await sb.auth.admin.generateLink({ type: 'magiclink', email });
  }
  const user = link.data?.user;
  const token_hash = link.data?.properties?.hashed_token;
  if (!user || !token_hash) throw new HttpError(500, 'יצירת ההתחברות נכשלה');

  // Membership: owner bootstraps the workspace on first sign-in; invitees join theirs.
  const { data: mine } = await sb.from('gd_memberships').select('workspace_id').eq('user_id', user.id).limit(1);
  if (!mine?.length) {
    if (email === env('OWNER_EMAIL').trim().toLowerCase()) {
      const { data: ws, error } = await sb.from('gd_workspaces').insert({ owner_id: user.id }).select('id').single();
      if (error) throw error;
      await sb.from('gd_memberships').insert({ workspace_id: ws.id, user_id: user.id, role: 'owner' });
      const rec = (collection: string, data: object) => ({ id: crypto.randomUUID(), workspace_id: ws.id, collection, data });
      await sb.from('gd_records').insert([
        rec('members', { email, name: email.split('@')[0], role: 'owner', areas: ['home', 'business', 'invest'], status: 'active' }),
        rec('parameters', { key: 'vat_rate', effective_from: '2025-01-01', value: 0.18 }),
        rec('parameters', { key: 'vat_rate', effective_from: '2015-10-01', value: 0.17 }),
        rec('parameters', { key: 'allocation_threshold', effective_from: '2026-06-01', value: 5000 }),
      ]);
    } else {
      const { data: invs } = await sb.from('gd_invites').select('*').eq('email', email);
      for (const i of invs ?? []) {
        await sb.from('gd_memberships').upsert({ workspace_id: i.workspace_id, user_id: user.id, role: i.role, areas: i.areas });
        await sb.from('gd_invites').update({ accepted_at: new Date().toISOString() }).eq('id', i.id);
        // flip the member card from "invited" to "active"
        const { data: cards } = await sb.from('gd_records').select('id, data').eq('workspace_id', i.workspace_id).eq('collection', 'members');
        const card = cards?.find((c) => (c.data as any).email === email);
        if (card) await sb.from('gd_records').update({ data: { ...(card.data as object), status: 'active' } }).eq('id', card.id);
      }
    }
  }
  res.json({ token_hash });
});

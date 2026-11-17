import { handler, HttpError, requireMember, sbAdmin } from './_lib/server';
import { authUrl, backTo, disconnect, finishConnect, googleReady, listEvents, pushToGoogle, readState, tokenRow } from './_lib/google';

// Google Calendar per user.
// GET  ?action=status              → { ready, connected, email, push, synced_at }
// GET  ?action=start               → { url }  (the app sends the browser there)
// GET  ?action=callback&code&state → Google sends the browser back here; redirects to /planner
// GET  ?action=events&from&to      → { events }  the user's own Google events
// POST ?action=sync                → push my tasks/events to my Google Calendar now
// POST ?action=prefs { push }      → turn "send to Google" on/off
// POST ?action=disconnect          → revoke at Google and forget the token
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default handler(async (req, res) => {
  const action = String(req.query.action || '');
  const host = req.headers.host;

  if (action === 'callback') {
    if (req.query.error || !req.query.code) { res.redirect(302, backTo(host, 'cancelled')); return; }
    try {
      const userId = readState(String(req.query.state || ''));
      await finishConnect(userId, String(req.query.code), host);
      res.redirect(302, backTo(host, 'connected'));
    } catch (e) { console.error('google callback', e); res.redirect(302, backTo(host, 'error')); }
    return;
  }

  const me = await requireMember(req);
  if (action === 'status') {
    const row = googleReady() ? await tokenRow(me.user.id) : null;
    res.json({ ready: googleReady(), connected: !!row, email: row?.google_email ?? null, push: row?.push_enabled ?? true, synced_at: row?.synced_at ?? null });
    return;
  }
  if (!googleReady()) throw new HttpError(503, 'החיבור לגוגל לא הוגדר בשרת');
  if (action === 'start') { res.json({ url: authUrl(me.user.id, host, me.user.email ?? undefined) }); return; }

  const row = await tokenRow(me.user.id);
  if (action === 'disconnect') { await disconnect(me.user.id); res.json({ ok: true }); return; }
  if (!row) throw new HttpError(409, 'Google Calendar לא מחובר');

  if (action === 'events') {
    const { from, to } = req.query;
    if (!isDate(from) || !isDate(to) || String(to) < String(from)) throw new HttpError(400, 'טווח תאריכים לא תקין');
    if ((new Date(String(to)).getTime() - new Date(String(from)).getTime()) / 864e5 > 62) throw new HttpError(400, 'טווח ארוך מדי');
    res.json({ events: await listEvents(row, String(from), String(to)) });
    return;
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  if (action === 'prefs') {
    await sbAdmin().from('gd_google_tokens').update({ push_enabled: !!req.body?.push }).eq('user_id', me.user.id);
    res.json({ ok: true });
    return;
  }
  if (action === 'sync') { res.json(await pushToGoogle(row, { userEmail: me.user.email!, role: me.role, areas: me.areas ?? [] })); return; }
  throw new HttpError(400, 'פעולה לא מוכרת');
});

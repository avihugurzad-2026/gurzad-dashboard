import { handler, HttpError, isCron, requireMember } from './_lib/server.js';
import { connect, disconnect, list, listAll, sync, syncAll } from './_lib/integrations/index.js';
import { PROVIDERS } from '../shared/integrations.js';

// GET  ?business=<id>                                   → providers catalog + this business's connections (no secrets)
// POST { action: 'connect', business, provider, fields } → test the key, store it encrypted, first sync (owner only)
// POST { action: 'sync', business, provider }            → pull now
// POST { action: 'disconnect', business, provider }      → wipe the key, keep history (owner only)
// GET  (no business)                                    → connections of all businesses, keyed by business id
// GET  with the cron secret                             → sync every connection (Vercel cron)
export default handler(async (req, res) => {
  if (req.method === 'GET' && isCron(req.headers.authorization)) { res.json(await syncAll()); return; }
  const m = await requireMember(req);
  if (m.role !== 'owner' && !(m.areas ?? []).includes('business')) throw new HttpError(403, 'אין גישה לעסקים');

  if (req.method === 'POST') {
    const b = req.body ?? {};
    const business = String(b.business || ''), provider = String(b.provider || '');
    if (!business || !provider) throw new HttpError(400, 'חסר עסק או ספק');
    if (b.action === 'sync') { if (m.role === 'viewer') throw new HttpError(403, 'אין הרשאה'); await sync(m.workspaceId, business, provider); }
    else if (b.action === 'connect') { if (m.role !== 'owner') throw new HttpError(403, 'רק בעל המערכת מחבר מערכות'); const r = await connect(m.workspaceId, m.user.id, business, provider, b.fields ?? {}); res.json({ ...r, connections: await list(m.workspaceId, business, false) }); return; }
    else if (b.action === 'disconnect') { if (m.role !== 'owner') throw new HttpError(403, 'רק בעל המערכת מנתק מערכות'); await disconnect(m.workspaceId, business, provider); }
    else throw new HttpError(400, 'פעולה לא מוכרת');
    res.json({ connections: await list(m.workspaceId, business, false) });
    return;
  }

  const business = String(req.query.business || '');
  if (!business) { res.json({ providers: PROVIDERS, byBusiness: await listAll(m.workspaceId) }); return; }
  res.json({ providers: PROVIDERS, connections: await list(m.workspaceId, business) });
});

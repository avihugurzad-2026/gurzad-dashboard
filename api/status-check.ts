import dns from 'node:dns/promises';
import net from 'node:net';
import { env, handler, HttpError, requireMember, sbAdmin } from './_lib/server';
import { notifyEvent } from './_lib/push';

const today = () => new Date().toISOString().slice(0, 10);

function isPrivate(ip: string) {
  if (net.isIPv6(ip)) return ip === '::1' || /^f[cd]|^fe80|^::ffff:/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
}

/** HEAD/GET a public https URL. Refuses private addresses (SSRF guard) and does not follow redirects. */
async function check(raw: string): Promise<{ ok: boolean; ms: number; status?: number }> {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, ms: 0 }; }
  if (url.protocol !== 'https:' || url.username || url.port) return { ok: false, ms: 0 };
  try {
    const addrs = await dns.lookup(url.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivate(a.address))) return { ok: false, ms: 0 };
  } catch { return { ok: false, ms: 0 }; }
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'uptime-check' } });
    return { ok: r.status < 500, ms: Date.now() - t0, status: r.status };
  } catch { return { ok: false, ms: Date.now() - t0 }; }
}

// GET ?url=…            → one check, for a signed-in member (the "check now" button)
// GET (Vercel cron)     → checks every monitor and appends to its 30-day history
export default handler(async (req, res) => {
  const cron = !!env('CRON_SECRET') && req.headers.authorization === `Bearer ${env('CRON_SECRET')}`;
  if (!cron) {
    await requireMember(req);
    const url = String(req.query.url || '');
    if (!url) throw new HttpError(400, 'חסרה כתובת');
    res.json(await check(url));
    return;
  }
  const sb = sbAdmin();
  const { data: rows } = await sb.from('gd_records').select('id, workspace_id, data').eq('collection', 'monitors');
  let n = 0;
  for (const row of rows ?? []) {
    const m = row.data as any;
    if (!m.url) continue;
    const r = await check(m.url);
    const history = [...(m.history ?? []).filter((h: any) => h.day !== today() || !h.ok), { day: today(), ok: r.ok, ms: r.ms }].slice(-30);
    await sb.from('gd_records').update({ data: { ...m, history, last_ok: r.ok, last_checked: new Date().toISOString() } }).eq('id', row.id);
    // tell the phone the moment a site goes down (once, on the up → down transition)
    if (!r.ok && m.last_ok !== false)
      await notifyEvent(row.workspace_id, { id: 'down' + row.id, level: 'danger', area: 'business', title: `${m.name ?? m.url} לא זמין`, detail: 'בדיקת הסטטוס נכשלה. כדאי לבדוק את האתר.', to: '/status', sort: -200 }).catch((e) => console.error(e));
    n++;
  }
  res.json({ ok: true, checked: n });
});

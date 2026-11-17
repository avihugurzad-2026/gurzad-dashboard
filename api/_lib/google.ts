import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env, has, HttpError, sbAdmin } from './server';
import { PLAN_COLLECTIONS, AREA_OF, addDaysIso, categoryOf, catHex, dateOf } from '../../shared/planner';

// Google Calendar, one connection per dashboard user (OAuth 2.0 web flow, offline access).
// The refresh token is stored encrypted (AES-256-GCM) in gd_google_tokens, which only the service role can read.
export const googleReady = () => has('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'];
const TZ = 'Asia/Jerusalem';
const appUrl = (host?: string) => (env('APP_URL') || `https://${host}`).replace(/\/$/, '');
export const redirectUri = (host?: string) => `${appUrl(host)}/api/google?action=callback`;
export const backTo = (host: string | undefined, status: string) => `${appUrl(host)}/planner?google=${status}`;

const key = () => createHash('sha256').update('gd-google-token:' + (env('GOOGLE_TOKEN_KEY') || env('CALENDAR_TOKEN_KEY') || env('GOOGLE_CLIENT_SECRET'))).digest();
function seal(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
function open(sealed: string) {
  const [iv, tag, enc] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/* ---- OAuth state: user id + time, signed, valid 15 minutes ---- */
const sign = (s: string) => createHmac('sha256', key()).update(s).digest('base64url');
export const makeState = (userId: string) => { const p = `${userId}.${Date.now()}`; return `${p}.${sign(p)}`; };
export function readState(state: string): string {
  const [uid, ts, mac] = String(state).split('.');
  const want = sign(`${uid}.${ts}`);
  if (!uid || !mac || mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) throw new HttpError(400, 'state');
  if (Date.now() - Number(ts) > 15 * 60e3) throw new HttpError(400, 'expired');
  return uid;
}

export function authUrl(userId: string, host?: string, loginHint?: string) {
  const q = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirectUri(host), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: makeState(userId),
  });
  if (loginHint) q.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenCall(body: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), ...body }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new HttpError(r.status === 400 ? 409 : 502, 'החיבור לגוגל נכשל'); (e as any).google = j.error; throw e; }
  return j as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };
}

/** Finish the OAuth flow: exchange the code and store the (encrypted) refresh token for this user. */
export async function finishConnect(userId: string, code: string, host?: string) {
  const t = await tokenCall({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(host) });
  if (!t.refresh_token) throw new HttpError(400, 'no refresh token');
  // id_token comes straight from Google's token endpoint over TLS, so its payload can be read without re-verifying.
  const email = t.id_token ? JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString()).email : null;
  const sb = sbAdmin();
  const { data: m } = await sb.from('gd_memberships').select('workspace_id').eq('user_id', userId).limit(1).maybeSingle();
  if (!m) throw new HttpError(403, 'אין גישה');
  const { error } = await sb.from('gd_google_tokens').upsert({ user_id: userId, workspace_id: m.workspace_id, google_email: email, refresh_token_enc: seal(t.refresh_token), push_enabled: true, connected_at: new Date().toISOString() });
  if (error) throw error;
}

type TokenRow = { user_id: string; workspace_id: string; google_email: string | null; refresh_token_enc: string; push_enabled: boolean; synced_at: string | null };
export async function tokenRow(userId: string): Promise<TokenRow | null> {
  const { data } = await sbAdmin().from('gd_google_tokens').select('*').eq('user_id', userId).maybeSingle();
  return (data as TokenRow) ?? null;
}
async function accessToken(row: TokenRow) {
  try { return (await tokenCall({ grant_type: 'refresh_token', refresh_token: open(row.refresh_token_enc) })).access_token; }
  catch (e: any) {
    if (e?.google === 'invalid_grant') { // revoked in Google, or expired: forget it so the user sees "connect" again
      await sbAdmin().from('gd_google_tokens').delete().eq('user_id', row.user_id);
      throw new HttpError(409, 'החיבור לגוגל פג. צריך לחבר מחדש.');
    }
    throw e;
  }
}
export async function disconnect(userId: string) {
  const row = await tokenRow(userId);
  if (!row) return;
  try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(open(row.refresh_token_enc))}`, { method: 'POST' }); } catch { /* best effort */ }
  await sbAdmin().from('gd_google_tokens').delete().eq('user_id', userId);
}

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
async function gcal(token: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  if (r.status === 204 || r.status === 410) return null;
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('gcal', r.status, JSON.stringify(j).slice(0, 300)); throw new HttpError(502, 'Google Calendar לא הגיב כמו שצריך'); }
  return j;
}
const local = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
const startOfDayUtc = (date: string) => new Date(`${date}T00:00:00+02:00`).toISOString();

/** The user's own Google events for a date range (events this dashboard created are left out, they are shown from the source). */
export async function listEvents(row: TokenRow, from: string, to: string) {
  const token = await accessToken(row);
  const q = new URLSearchParams({ timeMin: startOfDayUtc(from), timeMax: startOfDayUtc(addDaysIso(to, 1)), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const j = await gcal(token, `${CAL}?${q}`);
  return (j?.items ?? []).filter((e: any) => e.status !== 'cancelled' && !e.extendedProperties?.private?.gd_id).map((e: any) => {
    const allDay = !!e.start?.date;
    const s = allDay ? { date: e.start.date, time: undefined } : local(e.start.dateTime);
    const end = !allDay && e.end?.dateTime ? local(e.end.dateTime).time : undefined;
    return { id: e.id, title: e.summary || '(ללא כותרת)', date: s.date, time: s.time, end_time: end, place: e.location || undefined, link: e.htmlLink, allDay };
  });
}

/* ---- dashboard → Google: tasks and events assigned to this user ---- */
const GOOGLE_COLORS: [string, string][] = [['#2F9E8F', '2'], ['#E0A030', '5'], ['#3340D6', '9'], ['#8B7FE8', '1'], ['#E26D8F', '4'], ['#58B368', '10'], ['#5F8A99', '8'], ['#A3AD0C', '6']];
const colorId = (hex: string) => GOOGLE_COLORS.find(([h]) => h === hex)?.[1] ?? '8';

export async function pushToGoogle(row: TokenRow, opts: { userEmail: string; role: string; areas: string[] }) {
  const sb = sbAdmin();
  const token = await accessToken(row);
  const from = addDaysIso(todayIL(), -7), to = addDaysIso(todayIL(), 90);
  const { data } = await sb.from('gd_records').select('id, collection, data').eq('workspace_id', row.workspace_id).in('collection', PLAN_COLLECTIONS as unknown as string[]);
  const me = opts.userEmail.toLowerCase();
  const mine = (data ?? []).filter((r) => {
    const d = r.data as any;
    const area = AREA_OF[r.collection as keyof typeof AREA_OF];
    const canRead = opts.role === 'owner' || area === 'shared' || opts.areas.includes(area);
    const date = dateOf(r.collection, d);
    const assigned = String(d.assignee_email || '').toLowerCase();
    return canRead && date >= from && date <= to && (assigned === me || (!assigned && opts.role === 'owner'));
  });

  const q = new URLSearchParams({ privateExtendedProperty: 'gd=1', timeMin: startOfDayUtc(addDaysIso(from, -30)), timeMax: startOfDayUtc(addDaysIso(to, 1)), maxResults: '500', showDeleted: 'false' });
  const existing = new Map<string, any>(((await gcal(token, `${CAL}?${q}`))?.items ?? []).map((e: any) => [e.extendedProperties.private.gd_id, e]));
  let pushed = 0, ops = 0;
  const appLink = `${appUrl()}/planner`;
  for (const r of mine) {
    if (ops >= 80) break; // stay inside the function time limit; the next run continues
    const d = r.data as any;
    const date = dateOf(r.collection, d);
    const cat = categoryOf(r.collection, d);
    const ev = existing.get(r.id);
    existing.delete(r.id);
    if (d.done) { if (ev) { await gcal(token, `${CAL}/${ev.id}`, { method: 'DELETE' }); ops++; } continue; }
    const body: any = {
      summary: d.title,
      location: d.place || undefined,
      description: `${cat}${d.assignee ? ` · ${d.assignee}` : ''}\n${appLink}`,
      colorId: colorId(catHex(cat)),
      extendedProperties: { private: { gd: '1', gd_id: r.id } },
      start: d.time ? { dateTime: `${date}T${d.time}:00`, timeZone: TZ } : { date },
      end: d.time ? { dateTime: `${date}T${d.end_time && d.end_time > d.time ? d.end_time : plusHour(d.time)}:00`, timeZone: TZ } : { date: addDaysIso(date, 1) },
      reminders: { useDefault: true },
    };
    const h = createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16);
    body.extendedProperties.private.gd_h = h;
    if (ev?.extendedProperties?.private?.gd_h === h) continue;
    await gcal(token, ev ? `${CAL}/${ev.id}` : CAL, { method: ev ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    pushed++; ops++;
  }
  // removed from the dashboard, reassigned, or moved out of range → remove from Google
  for (const ev of existing.values()) { if (ops >= 80) break; await gcal(token, `${CAL}/${ev.id}`, { method: 'DELETE' }); ops++; }
  await sb.from('gd_google_tokens').update({ synced_at: new Date().toISOString() }).eq('user_id', row.user_id);
  return { pushed };
}
const plusHour = (t: string) => { const [h, m] = t.split(':').map(Number); return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(h >= 23 ? 59 : m).padStart(2, '0')}`; };
export const todayIL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

/** Daily: push for every connected user who left "send to Google" on. */
export async function pushAll() {
  if (!googleReady()) return { skipped: true };
  const sb = sbAdmin();
  const { data: rows } = await sb.from('gd_google_tokens').select('*').eq('push_enabled', true);
  let ok = 0;
  for (const row of (rows ?? []) as TokenRow[]) {
    try {
      const { data: m } = await sb.from('gd_memberships').select('role, areas').eq('user_id', row.user_id).eq('workspace_id', row.workspace_id).maybeSingle();
      const { data: u } = await sb.auth.admin.getUserById(row.user_id);
      if (!m || !u.user?.email) continue;
      await pushToGoogle(row, { userEmail: u.user.email, role: m.role, areas: m.areas ?? [] });
      ok++;
    } catch (e) { console.error('google push failed', row.user_id, e); }
  }
  return { users: ok };
}

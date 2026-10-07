// Google Calendar, two-way (stage 2.2). OAuth (offline refresh token, stored encrypted), calendar
// list, an events sync into `events` (per-calendar incremental sync tokens, soft deletes), event
// writes (insert / patch with If-Match / delete) and push channels (events.watch / channels.stop).
// Pure helpers + DB functions that take a pg client/pool; `fetchImpl` is injectable for tests.
// Nothing here logs or throws tokens, auth codes, raw Google responses or event contents.
'use strict';

const crypto = require('node:crypto');

const TZ = 'Asia/Jerusalem';
const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';     // read + write events
const SCOPE_READONLY = 'https://www.googleapis.com/auth/calendar.readonly'; // list calendars
const SCOPE_FULL = 'https://www.googleapis.com/auth/calendar';
const SCOPES = [SCOPE_EVENTS, SCOPE_READONLY];
const SCOPE = SCOPES.join(' ');
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';
const PAST_DAYS = 60;
const FUTURE_DAYS = 180;
const DAY_MS = 86400000;
const CHANNEL_TTL_S = 7 * 86400;   // Google caps event channels at about a week; the daily cron renews

// ---------- token encryption (AES-256-GCM) ----------

function keyBytes(keyB64) {
  const key = Buffer.from(String(keyB64 ?? ''), 'base64');
  if (key.length !== 32) throw new Error('CALENDAR_TOKEN_KEY must be base64 of 32 bytes');
  return key;
}

function encryptToken(plain, keyB64) {
  const key = keyBytes(keyB64);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

function decryptToken(stored, keyB64) {
  const key = keyBytes(keyB64);
  const parts = String(stored ?? '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Stored token has an unknown format');
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Stored token has an unknown format');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored token failed authentication (wrong key or tampered)');
  }
}

// ---------- OAuth ----------

function authUrl({ clientId, redirectUri, state }) {
  const u = new URL(AUTH_ENDPOINT);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  return u.toString();
}

// An error safe to log/store: an OAuth error code or an HTTP status, never a body or token.
class GoogleError extends Error {
  constructor(code, status) {
    super(`google: ${code}`);
    this.name = 'GoogleError';
    this.code = code;
    this.status = status;
  }
}
const SAFE_CODE = /^[a-z_]{1,40}$/;

async function tokenRequest(params, fetchImpl) {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    const code = typeof body?.error === 'string' && SAFE_CODE.test(body.error) ? body.error : `http_${res.status}`;
    throw new GoogleError(code, res.status);
  }
  return body;
}

async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  const b = await tokenRequest({
    code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code',
  }, fetchImpl);
  return { access_token: b.access_token, refresh_token: b.refresh_token ?? null, expires_in: b.expires_in ?? null, scope: b.scope ?? null };
}

async function refreshAccessToken({ refreshToken, clientId, clientSecret, fetchImpl = fetch }) {
  const b = await tokenRequest({
    refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token',
  }, fetchImpl);
  return { access_token: b.access_token, expires_in: b.expires_in ?? null };
}

async function revokeToken(token, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: String(token) }).toString(),
  });
  return res.ok;
}

// What a granted `scope` string allows. Old consents (stage 1) have only calendar.readonly.
function parseScopes(scope) {
  const list = String(scope ?? '').split(/\s+/).filter(Boolean);
  const has = s => list.includes(s);
  return {
    list,
    read: has(SCOPE_READONLY) || has(SCOPE_EVENTS) || has(SCOPE_FULL),
    write: has(SCOPE_EVENTS) || has(SCOPE_FULL),
    listCalendars: has(SCOPE_READONLY) || has(SCOPE_FULL),
  };
}

async function apiError(res) {
  const body = await res.json().catch(() => null);
  const reason = body?.error?.errors?.[0]?.reason;
  return new GoogleError(typeof reason === 'string' && /^[A-Za-z_]{1,40}$/.test(reason) ? reason : `http_${res.status}`, res.status);
}

async function apiGet(url, accessToken, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

// JSON request with a body. `headers` adds e.g. If-Match. 204 → null.
async function apiSend(method, url, accessToken, body, fetchImpl, headers = {}) {
  const init = { method, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...headers } };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetchImpl(url, init);
  if (!res.ok) throw await apiError(res);
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// All calendars of the account (paginated) → { id, name, color, access_role, primary }
async function listCalendars(accessToken, { fetchImpl = fetch } = {}) {
  const out = [];
  let pageToken = null;
  do {
    const u = new URL(`${API}/users/me/calendarList`);
    u.searchParams.set('maxResults', '250');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const body = await apiGet(u, accessToken, fetchImpl);
    for (const c of body.items ?? []) {
      if (!c?.id || c.deleted) continue;
      out.push({
        id: c.id, name: c.summaryOverride ?? c.summary ?? null, color: c.backgroundColor ?? null,
        access_role: c.accessRole ?? null, primary: c.primary === true,
      });
    }
    pageToken = body.nextPageToken ?? null;
  } while (pageToken);
  return out;
}

// ---------- event mapping ----------

// Offset (ms) of `tz` from UTC at instant `ms`, via Intl (DST-correct, no hardcoded offset)
function tzOffsetMs(ms, tz = TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// 'YYYY-MM-DD' → the UTC instant of local midnight in Asia/Jerusalem
function localMidnightUtc(date, tz = TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!m) throw new Error('Bad all-day date');
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  let t = wall - tzOffsetMs(wall, tz);
  t = wall - tzOffsetMs(t, tz);   // second pass: offset at the actual instant
  return new Date(t).toISOString();
}

// 'YYYY-MM-DD' + 'HH:MM' Israel wall time → UTC ISO instant (DST-correct)
function localTimeUtc(date, hm, tz = TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm));
  if (!m || !t) throw new Error('Bad date or time');
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  let x = wall - tzOffsetMs(wall, tz);
  x = wall - tzOffsetMs(x, tz);
  return new Date(x).toISOString();
}

// Instant → 'YYYY-MM-DD' in Israel
const localDate = (v, tz = TZ) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(v));
const addDaysIso = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function instant(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error('Bad event time');
  return d.toISOString();
}

// Google event → events row fields. All-day: local midnights; Google's end.date is exclusive
// and stays the exclusive end instant. A cancelled event has status 'cancelled' (and may have no times).
function toEventRow(ev) {
  const status = ev.status === 'cancelled' ? 'cancelled' : ev.status === 'tentative' ? 'tentative' : 'confirmed';
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  let start_at = null, end_at = null;
  if (allDay) {
    start_at = localMidnightUtc(ev.start.date);
    end_at = ev.end?.date ? localMidnightUtc(ev.end.date) : new Date(Date.parse(start_at) + DAY_MS).toISOString();
  } else if (ev.start?.dateTime) {
    start_at = instant(ev.start.dateTime);
    end_at = ev.end?.dateTime ? instant(ev.end.dateTime) : start_at;
  }
  if (start_at && end_at && end_at < start_at) end_at = start_at;
  return {
    google_event_id: String(ev.id),
    title: typeof ev.summary === 'string' ? ev.summary.slice(0, 500) : '',
    start_at, end_at, all_day: allDay,
    timezone: ev.start?.timeZone || TZ,
    place: typeof ev.location === 'string' && ev.location ? ev.location.slice(0, 500) : null,
    status,
    html_link: typeof ev.htmlLink === 'string' && ev.htmlLink.startsWith('https://') ? ev.htmlLink : null,
    description: typeof ev.description === 'string' && ev.description ? ev.description.slice(0, 4000) : null,
    google_etag: typeof ev.etag === 'string' ? ev.etag : null,
    google_updated_at: typeof ev.updated === 'string' && !Number.isNaN(Date.parse(ev.updated)) ? new Date(ev.updated).toISOString() : null,
  };
}

// Our fields → a Google event body. fields: { title, start_at, end_at, all_day, description?, place? }
// (instants; for all-day, start_at/end_at are Israel midnights and end is exclusive, like rows).
function toGoogleBody(f) {
  const body = { summary: String(f.title ?? '').slice(0, 500) };
  if (f.description !== undefined) body.description = f.description ? String(f.description).slice(0, 4000) : '';
  if (f.place !== undefined) body.location = f.place ? String(f.place).slice(0, 500) : '';
  if (f.all_day) {
    const start = localDate(f.start_at);
    let end = localDate(f.end_at ?? f.start_at);
    if (end <= start) end = addDaysIso(start, 1);
    body.start = { date: start };
    body.end = { date: end };
  } else {
    body.start = { dateTime: instant(f.start_at), timeZone: TZ };
    body.end = { dateTime: instant(f.end_at ?? f.start_at), timeZone: TZ };
  }
  return body;
}

// Events we don't keep: cancelled, timeless, and Google's "working location" markers
const isRemoval = (ev, row) => row.status === 'cancelled' || !row.start_at || ev.eventType === 'workingLocation';

// ---------- sync ----------

async function fetchEvents(calendarId, accessToken, { syncToken, timeMin, timeMax }, fetchImpl) {
  const items = [];
  let pageToken = null, nextSyncToken = null;
  do {
    const u = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events`);
    u.searchParams.set('singleEvents', 'true');
    u.searchParams.set('maxResults', '250');
    // Google rejects timeMin/timeMax/orderBy together with syncToken
    if (syncToken) u.searchParams.set('syncToken', syncToken);
    else { u.searchParams.set('timeMin', timeMin); u.searchParams.set('timeMax', timeMax); }
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const body = await apiGet(u, accessToken, fetchImpl);
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken ?? null;
    nextSyncToken = body.nextSyncToken ?? nextSyncToken;
  } while (pageToken);
  return { items, nextSyncToken };
}

const UPSERT_CHUNK = 500;

// Sync one mapped calendar. Fetches everything first (incremental with the mapping's sync
// token, or a full window sync; a 410 drops the token and goes full), then writes in one
// transaction on `client`. Returns counts.
// Events belong to the connection's user (owner_user_id) and take the mapping's scope.
async function syncCalendar(client, mapping, accessToken, { fetchImpl = fetch, now = new Date(), ownerUserId } = {}) {
  if (!ownerUserId) throw new Error('ownerUserId is required');
  const nowMs = new Date(now).getTime();
  const timeMin = new Date(nowMs - PAST_DAYS * DAY_MS).toISOString();
  const timeMax = new Date(nowMs + FUTURE_DAYS * DAY_MS).toISOString();
  let full = !mapping.sync_token;
  let res;
  if (!full) {
    try {
      res = await fetchEvents(mapping.google_calendar_id, accessToken, { syncToken: mapping.sync_token }, fetchImpl);
    } catch (e) {
      if (e?.status !== 410) throw e;
      full = true;
    }
  }
  if (full) res = await fetchEvents(mapping.google_calendar_id, accessToken, { timeMin, timeMax }, fetchImpl);

  // Last state of each event wins (an id can repeat across pages)
  const keep = new Map(), drop = new Set();
  for (const ev of res.items) {
    if (!ev?.id) continue;
    const row = toEventRow(ev);
    if (isRemoval(ev, row)) { keep.delete(row.google_event_id); drop.add(row.google_event_id); }
    else { drop.delete(row.google_event_id); keep.set(row.google_event_id, row); }
  }
  const rows = [...keep.values()];
  const counts = { calendar: mapping.google_calendar_id, full, fetched: res.items.length, upserted: 0, removed: 0 };

  await client.query('BEGIN');
  try {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      // An event created from the dashboard keeps the place chosen in its form (created_by is set);
      // everything else takes the mapping's place.
      const r = await client.query(
        `INSERT INTO events (title, start_at, end_at, all_day, timezone, place, status, source,
                             google_event_id, google_calendar_id, mapping_id, owner_user_id, scope,
                             domain, branch, location, html_link, description, google_etag, google_updated_at,
                             deleted_at, updated_at)
         SELECT x.title, x.start_at, x.end_at, x.all_day, x.timezone, x.place, x.status, 'google',
                x.google_event_id, $2, $3, $4, $8, $5, $6, $7, x.html_link, x.description, x.google_etag, x.google_updated_at,
                NULL, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(title text, start_at timestamptz, end_at timestamptz, all_day boolean,
              timezone text, place text, status text, google_event_id text, html_link text, description text,
              google_etag text, google_updated_at timestamptz)
         ON CONFLICT (mapping_id, google_event_id) WHERE source = 'google' DO UPDATE SET
           title = EXCLUDED.title, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, all_day = EXCLUDED.all_day,
           timezone = EXCLUDED.timezone, place = EXCLUDED.place, status = EXCLUDED.status,
           google_calendar_id = EXCLUDED.google_calendar_id, owner_user_id = EXCLUDED.owner_user_id, scope = EXCLUDED.scope,
           domain = CASE WHEN events.created_by IS NULL THEN EXCLUDED.domain ELSE events.domain END,
           branch = CASE WHEN events.created_by IS NULL THEN EXCLUDED.branch ELSE events.branch END,
           location = CASE WHEN events.created_by IS NULL THEN EXCLUDED.location ELSE events.location END,
           html_link = EXCLUDED.html_link, description = EXCLUDED.description,
           google_etag = EXCLUDED.google_etag, google_updated_at = EXCLUDED.google_updated_at,
           deleted_at = NULL, updated_at = now()`,
        [JSON.stringify(chunk), mapping.google_calendar_id, mapping.id, ownerUserId,
          mapping.domain ?? null, mapping.branch ?? null, mapping.location ?? null, mapping.scope === 'shared' ? 'shared' : 'user']);
      counts.upserted += r.rowCount ?? chunk.length;
    }
    if (drop.size) {
      const r = await client.query(
        `UPDATE events SET status = 'cancelled', deleted_at = now(), updated_at = now()
         WHERE source = 'google' AND mapping_id = $1 AND google_event_id = ANY($2::text[]) AND deleted_at IS NULL`,
        [mapping.id, [...drop]]);
      counts.removed += r.rowCount ?? 0;
    }
    if (full) {
      // A full listing has no tombstones: anything in the window we didn't see is gone
      const r = await client.query(
        `UPDATE events SET deleted_at = now(), updated_at = now()
         WHERE source = 'google' AND mapping_id = $1 AND deleted_at IS NULL
           AND start_at < $3 AND end_at > $2 AND NOT (google_event_id = ANY($4::text[]))`,
        [mapping.id, timeMin, timeMax, rows.map(x => x.google_event_id)]);
      counts.removed += r.rowCount ?? 0;
    }
    // No nextSyncToken (shouldn't happen) → token cleared, the next run is a full window sync again
    await client.query(
      `UPDATE calendar_mappings SET sync_token = $2, last_synced_at = now() WHERE id = $1`,
      [mapping.id, res.nextSyncToken ?? null]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
  return counts;
}

const safeError = e => (e instanceof GoogleError ? e.code : 'sync_failed');

// ---------- activity log and the reconnect alert ----------

// One activity_log row (object_type 'calendar'). Metadata holds codes and ids only — never
// tokens or event contents. Never throws: logging must not break a sync.
async function logActivity(db, { userId, objectId, action, metadata = {} }) {
  try {
    await db.query(
      `INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'calendar', $2, $3, $4)`,
      [userId ?? null, String(objectId), action, JSON.stringify(metadata)]);
  } catch { /* the log is best effort */ }
}

const reconnectKey = userId => `calendar-reconnect:${userId}`;

async function raiseReconnectAlert(db, userId) {
  try {
    await db.query(
      `INSERT INTO alerts (alert_key, rule_id, severity, level, title, suggested_action, owner)
       VALUES ($1, 'calendar-reconnect', 'orange', 'warning', 'יומן Google: צריך לחבר מחדש', 'הגדרות ← יומן Google ← חבר מחדש', $2)
       ON CONFLICT (alert_key) WHERE resolved_at IS NULL DO UPDATE SET last_seen = now()`,
      [reconnectKey(userId), userId]);
  } catch { /* alerts table missing in a fresh DB: the connection status still says 'error' */ }
}

async function resolveReconnectAlert(db, userId) {
  try {
    await db.query(`UPDATE alerts SET resolved_at = now(), last_seen = now() WHERE alert_key = $1 AND resolved_at IS NULL`, [reconnectKey(userId)]);
  } catch { /* best effort */ }
}

// Refresh errors that mean "the grant is gone, the user must reconnect"
const FATAL_AUTH = new Set(['invalid_grant', 'unauthorized_client', 'token_unreadable', 'http_401']);

// A fresh access token for a connection. On a dead grant: status 'error' + last_error, the
// reconnect alert and an activity_log row. Returns { ok, accessToken } or { ok: false, error }.
async function accessTokenFor(pool, connection, { clientId, clientSecret, keyB64, fetchImpl = fetch }) {
  try {
    const refreshToken = decryptToken(connection.refresh_token_encrypted, keyB64);
    const { access_token } = await refreshAccessToken({ refreshToken, clientId, clientSecret, fetchImpl });
    return { ok: true, accessToken: access_token };
  } catch (e) {
    const code = e instanceof GoogleError ? e.code : 'token_unreadable';
    const fatal = FATAL_AUTH.has(code);
    await pool.query(
      `UPDATE calendar_connections SET status = CASE WHEN $3 THEN 'error' ELSE status END,
         last_error = $2, last_synced_at = now(), updated_at = now() WHERE id = $1`,
      [connection.id, code, fatal]);
    if (fatal) await raiseReconnectAlert(pool, connection.user_id);
    await logActivity(pool, { userId: connection.user_id, objectId: connection.id, action: 'auth_failed', metadata: { error: code } });
    return { ok: false, error: code };
  }
}

// Refresh the access token and sync every enabled calendar of one connection (or just
// `onlyMappingId`, for a push notification).
async function syncConnection(pool, connection, { clientId, clientSecret, keyB64, fetchImpl = fetch, now = new Date(), onlyMappingId = null }) {
  const tok = await accessTokenFor(pool, connection, { clientId, clientSecret, keyB64, fetchImpl });
  if (!tok.ok) return { ok: false, error: tok.error, calendars: [] };

  const { rows: mappings } = await pool.query(
    `SELECT id, google_calendar_id, domain, branch, location, sync_token, scope
     FROM calendar_mappings WHERE connection_id = $1 AND is_enabled AND ($2::uuid IS NULL OR id = $2)
     ORDER BY created_at`, [connection.id, onlyMappingId]);
  const calendars = [];
  const errors = [];
  for (const m of mappings) {
    const client = await pool.connect();
    try {
      calendars.push(await syncCalendar(client, m, tok.accessToken, { fetchImpl, now, ownerUserId: connection.user_id }));
    } catch (e) {
      errors.push(safeError(e));
      await logActivity(pool, { userId: connection.user_id, objectId: m.id, action: 'sync_failed', metadata: { error: safeError(e) } });
    } finally {
      client.release();
    }
  }
  const lastError = errors.length ? errors[0] : null;
  await pool.query(
    `UPDATE calendar_connections SET status = 'connected', last_error = $2, last_synced_at = now(), updated_at = now()
     WHERE id = $1`, [connection.id, lastError]);
  await resolveReconnectAlert(pool, connection.user_id);
  return lastError ? { ok: false, error: lastError, calendars } : { ok: true, calendars };
}

// ---------- outbound writes ----------

const eventsUrl = calendarId => `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
const eventUrl = (calendarId, eventId) => `${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`;

async function insertEvent({ accessToken, calendarId, fields, fetchImpl = fetch }) {
  return apiSend('POST', eventsUrl(calendarId), accessToken, toGoogleBody(fields), fetchImpl);
}

async function getEvent({ accessToken, calendarId, eventId, fetchImpl = fetch }) {
  return apiGet(eventUrl(calendarId, eventId), accessToken, fetchImpl);
}

// PATCH guarded by If-Match: a 412 (changed in Google since our copy) throws GoogleError 'conflict'.
async function patchEvent({ accessToken, calendarId, eventId, fields, etag, fetchImpl = fetch }) {
  try {
    return await apiSend('PATCH', eventUrl(calendarId, eventId), accessToken, toGoogleBody(fields), fetchImpl,
      etag ? { 'If-Match': etag } : {});
  } catch (e) {
    if (e?.status === 412) throw new GoogleError('conflict', 412);
    throw e;
  }
}

// DELETE. Already gone in Google (404/410) counts as done → false.
async function removeEvent({ accessToken, calendarId, eventId, fetchImpl = fetch }) {
  try {
    await apiSend('DELETE', eventUrl(calendarId, eventId), accessToken, undefined, fetchImpl);
    return true;
  } catch (e) {
    if (e?.status === 404 || e?.status === 410) return false;
    throw e;
  }
}

// ---------- push channels ----------

const hashChannelToken = token => crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');

// Does the X-Goog-Channel-Token match the stored sha256? Constant-time.
function verifyChannelToken(token, storedHash) {
  if (typeof token !== 'string' || !token || typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashChannelToken(token), 'hex'), b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Where Google posts notifications: APP_URL, else the Vercel production URL. Null (= don't
// watch) when neither is set or it isn't https — Google only delivers to https.
function pushAddress(env = process.env) {
  const base = env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  if (!base) return null;
  try {
    const u = new URL('/api/google/push', base);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// events.watch with a random channel id and a random per-channel secret. Only the secret's hash
// is returned (to store); Google echoes the secret back on every notification.
async function watchCalendar({ accessToken, calendarId, address, ttlSeconds = CHANNEL_TTL_S, fetchImpl = fetch, now = new Date() }) {
  const channelId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const body = await apiSend('POST', `${eventsUrl(calendarId)}/watch`, accessToken,
    { id: channelId, type: 'web_hook', address, token, params: { ttl: String(ttlSeconds) } }, fetchImpl);
  const exp = Number(body?.expiration);
  return {
    channel_id: channelId,
    resource_id: typeof body?.resourceId === 'string' ? body.resourceId : null,
    token_hash: hashChannelToken(token),
    expires_at: new Date(Number.isFinite(exp) && exp > 0 ? exp : new Date(now).getTime() + ttlSeconds * 1000).toISOString(),
  };
}

// channels.stop. A channel Google no longer knows (404) is already stopped.
async function stopChannel({ accessToken, channelId, resourceId, fetchImpl = fetch }) {
  try {
    await apiSend('POST', `${API}/channels/stop`, accessToken, { id: channelId, resourceId }, fetchImpl);
    return true;
  } catch (e) {
    if (e?.status === 404) return false;
    throw e;
  }
}

module.exports = {
  SCOPE, SCOPES, SCOPE_EVENTS, SCOPE_READONLY, GoogleError, TZ,
  encryptToken, decryptToken, authUrl, exchangeCode, refreshAccessToken, revokeToken, listCalendars, parseScopes,
  localMidnightUtc, localTimeUtc, localDate, toEventRow, toGoogleBody, syncCalendar, syncConnection, accessTokenFor,
  insertEvent, getEvent, patchEvent, removeEvent,
  hashChannelToken, verifyChannelToken, pushAddress, watchCalendar, stopChannel,
  logActivity, raiseReconnectAlert, resolveReconnectAlert,
};

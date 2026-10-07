// Google Calendar, read-only. OAuth (offline refresh token, stored encrypted), calendar list,
// and an events sync into `events`: per-calendar incremental sync tokens, soft deletes.
// Pure helpers + DB functions that take a pg client/pool; `fetchImpl` is injectable for tests.
// Nothing here logs or throws tokens or raw Google responses.
'use strict';

const crypto = require('node:crypto');

const TZ = 'Asia/Jerusalem';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';
const PAST_DAYS = 60;
const FUTURE_DAYS = 180;
const DAY_MS = 86400000;

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

async function apiGet(url, accessToken, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason;
    throw new GoogleError(typeof reason === 'string' && /^[A-Za-z_]{1,40}$/.test(reason) ? reason : `http_${res.status}`, res.status);
  }
  return res.json();
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
  };
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
async function syncCalendar(client, mapping, accessToken, { fetchImpl = fetch, now = new Date(), ownerUserId = 'avihu' } = {}) {
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
      const r = await client.query(
        `INSERT INTO events (title, start_at, end_at, all_day, timezone, place, status, source,
                             google_event_id, google_calendar_id, mapping_id, owner_user_id,
                             domain, branch, location, html_link, deleted_at, updated_at)
         SELECT x.title, x.start_at, x.end_at, x.all_day, x.timezone, x.place, x.status, 'google',
                x.google_event_id, $2, $3, $4, $5, $6, $7, x.html_link, NULL, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(title text, start_at timestamptz, end_at timestamptz, all_day boolean,
              timezone text, place text, status text, google_event_id text, html_link text)
         ON CONFLICT (google_calendar_id, google_event_id) WHERE source = 'google' DO UPDATE SET
           title = EXCLUDED.title, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, all_day = EXCLUDED.all_day,
           timezone = EXCLUDED.timezone, place = EXCLUDED.place, status = EXCLUDED.status,
           mapping_id = EXCLUDED.mapping_id, owner_user_id = EXCLUDED.owner_user_id,
           domain = EXCLUDED.domain, branch = EXCLUDED.branch, location = EXCLUDED.location,
           html_link = EXCLUDED.html_link, deleted_at = NULL, updated_at = now()`,
        [JSON.stringify(chunk), mapping.google_calendar_id, mapping.id, ownerUserId,
          mapping.domain ?? null, mapping.branch ?? null, mapping.location ?? null]);
      counts.upserted += r.rowCount ?? chunk.length;
    }
    if (drop.size) {
      const r = await client.query(
        `UPDATE events SET status = 'cancelled', deleted_at = now(), updated_at = now()
         WHERE source = 'google' AND google_calendar_id = $1 AND google_event_id = ANY($2::text[]) AND deleted_at IS NULL`,
        [mapping.google_calendar_id, [...drop]]);
      counts.removed += r.rowCount ?? 0;
    }
    if (full) {
      // A full listing has no tombstones: anything in the window we didn't see is gone
      const r = await client.query(
        `UPDATE events SET deleted_at = now(), updated_at = now()
         WHERE source = 'google' AND google_calendar_id = $1 AND deleted_at IS NULL
           AND start_at < $3 AND end_at > $2 AND NOT (google_event_id = ANY($4::text[]))`,
        [mapping.google_calendar_id, timeMin, timeMax, rows.map(x => x.google_event_id)]);
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

// Refresh the access token and sync every enabled calendar of one connection.
async function syncConnection(pool, connection, { clientId, clientSecret, keyB64, fetchImpl = fetch, now = new Date() }) {
  let accessToken;
  try {
    const refreshToken = decryptToken(connection.refresh_token_encrypted, keyB64);
    ({ access_token: accessToken } = await refreshAccessToken({ refreshToken, clientId, clientSecret, fetchImpl }));
  } catch (e) {
    const code = e instanceof GoogleError ? e.code : 'token_unreadable';
    // Revoked/expired grant or unreadable token: needs a reconnect, stop syncing it
    const fatal = code === 'invalid_grant' || code === 'unauthorized_client' || code === 'token_unreadable';
    await pool.query(
      `UPDATE calendar_connections SET status = CASE WHEN $3 THEN 'error' ELSE status END,
         last_error = $2, last_synced_at = now(), updated_at = now() WHERE id = $1`,
      [connection.id, code, fatal]);
    return { ok: false, error: code, calendars: [] };
  }

  const { rows: mappings } = await pool.query(
    `SELECT id, google_calendar_id, domain, branch, location, sync_token
     FROM calendar_mappings WHERE connection_id = $1 AND is_enabled ORDER BY created_at`, [connection.id]);
  const calendars = [];
  const errors = [];
  for (const m of mappings) {
    const client = await pool.connect();
    try {
      calendars.push(await syncCalendar(client, m, accessToken, { fetchImpl, now, ownerUserId: connection.user_id }));
    } catch (e) {
      errors.push(safeError(e));
    } finally {
      client.release();
    }
  }
  const lastError = errors.length ? errors[0] : null;
  await pool.query(
    `UPDATE calendar_connections SET status = 'connected', last_error = $2, last_synced_at = now(), updated_at = now()
     WHERE id = $1`, [connection.id, lastError]);
  return lastError ? { ok: false, error: lastError, calendars } : { ok: true, calendars };
}

module.exports = {
  SCOPE, GoogleError,
  encryptToken, decryptToken, authUrl, exchangeCode, refreshAccessToken, revokeToken, listCalendars,
  localMidnightUtc, toEventRow, syncCalendar, syncConnection,
};

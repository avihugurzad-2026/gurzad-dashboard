import 'server-only';
import type { PoolClient } from 'pg';
import { db } from './db';
import gcal from '@domain/gcal';
import { canCreateIn, canDeleteRow, canEditRow, currentUser, params, visibleSql, type PlaceRef, type SessionUser } from './auth';

// Google Calendar, two-way (stage 2.2), per signed-in user. Sync, OAuth and Google requests live
// in lib/gcal.js; this file is the app-facing API: status, freshness on page load, event reads
// (always through visibleSql), event writes (Google first, then the local row), push channels,
// mapping edits and disconnect. Functions that take an optional `u` fall back to the session user.
// Never log tokens, auth codes or event contents — ids and error codes only.

export type CalendarStatus = {
  configured: boolean;
  /** push notifications possible (APP_URL / production URL is https) */
  push: boolean;
  connection: null | {
    id: string; email: string | null; status: 'connected' | 'error' | 'disconnected'; last_synced_at: string | null; last_error: string | null;
    /** the grant includes calendar.events (old stage-1 consents are read-only) */
    canWrite: boolean;
  };
  calendars: {
    id: string; google_calendar_id: string; name: string | null; color: string | null; is_enabled: boolean;
    domain: string | null; branch: string | null; location: string | null;
    access_role: string | null; is_default_write: boolean; scope: 'user' | 'shared'; writable: boolean; watching: boolean;
  }[];
};

export type EventVersion = { title: string; start_at: string; end_at: string; all_day: boolean; description: string | null };
/** `google: null` = the event was deleted in Google meanwhile */
export type EventConflict = { mine: EventVersion; google: EventVersion | null; at: string };

export type CalEvent = {
  id: string; title: string; start_at: string; end_at: string; all_day: boolean; place: string | null;
  domain: string | null; branch: string | null; location: string | null; color: string | null;
  calendar_name: string | null; html_link: string | null;
  source: 'google' | 'manual'; mapping_id: string | null; description: string | null; scope: 'user' | 'shared';
  owner_user_id: string; writable: boolean; conflict: EventConflict | null;
};

/** One Google calendar the user may write to (for the event dialog) */
export type WriteTarget = { id: string; name: string | null; color: string | null; is_default_write: boolean; domain: string | null; branch: string | null; location: string | null };
/** What the "+ אירוע" dialog may do for this user: write to Google, save locally (no connection), or nothing */
export type EventEditor = { mode: 'google' | 'manual' | 'readonly' | 'none'; calendars: WriteTarget[]; reason: string | null };

/** From the event dialog. Dates 'YYYY-MM-DD', times 'HH:MM' (Israel). */
export type EventInput = {
  title: string; date: string; end_date?: string | null; all_day: boolean; start_time?: string | null; end_time?: string | null;
  domain?: string | null; branch?: string | null; location?: string | null;
  mapping_id?: string | null; description?: string | null; scope?: 'user' | 'shared' | null;
};
export type WriteResult = { ok: true; id: string } | { ok: false; error: string; conflict?: true };

type ConnRow = {
  id: string; user_id: string; google_account_email: string | null; refresh_token_encrypted: string;
  status: 'connected' | 'error' | 'disconnected'; last_synced_at: Date | null; last_error: string | null; scopes: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WRITE_ROLES = ['owner', 'writer'];
const RENEW_WITHIN_MS = 48 * 3600 * 1000;
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
const missingTable = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string })?.code ?? '');
const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const validDate = (d: unknown): d is string => typeof d === 'string' && DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

const ERR = {
  reconnect: 'Google ביטל את ההרשאה. צריך לחבר מחדש (הגדרות ← יומן Google).',
  readOnly: 'החיבור ל-Google הוא לקריאה בלבד. חבר מחדש כדי לאפשר כתיבה (הגדרות ← יומן Google).',
  notConfigured: 'החיבור ל-Google עוד לא הוגדר בשרת.',
  google: 'Google לא קיבל את השינוי, לא נשמר כלום. נסה שוב.',
  forbidden: 'אין הרשאת כתיבה ליומן הזה ב-Google.',
  notFound: 'האירוע לא נמצא.',
  denied: 'אין לך הרשאה לשנות את האירוע הזה.',
  notMine: 'אפשר לערוך מכאן רק אירועים מהיומן שלך שיש לך הרשאת כתיבה אליו.',
  conflict: 'האירוע השתנה ב-Google מאז הסנכרון האחרון. לא דרסנו כלום: בחר איזו גרסה לשמור.',
  noTarget: 'אין יומן Google שאפשר לכתוב אליו. בחר יומן ברירת מחדל בהגדרות.',
} as const;

function googleError(e: unknown): string {
  const code = e instanceof gcal.GoogleError ? e.code : '';
  if (['invalid_grant', 'unauthorized_client', 'token_unreadable', 'http_401', 'authError'].includes(code)) return ERR.reconnect;
  if (['forbidden', 'insufficientPermissions', 'requiredAccessLevel', 'http_403'].includes(code)) return ERR.forbidden;
  return ERR.google;
}

function creds() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const keyB64 = process.env.CALENDAR_TOKEN_KEY;
  return clientId && clientSecret && keyB64 ? { clientId, clientSecret, keyB64 } : null;
}

async function who(u?: SessionUser | null): Promise<SessionUser | null> {
  return u ?? (await currentUser());
}

const log = (userId: string | null, objectId: string, action: string, metadata: Record<string, unknown> = {}) =>
  gcal.logActivity(db(), { userId, objectId, action, metadata });

async function userConnection(userId: string, statuses: string[]): Promise<ConnRow | null> {
  const { rows } = await db().query<ConnRow>(
    `SELECT id, user_id, google_account_email, refresh_token_encrypted, status, last_synced_at, last_error, scopes
     FROM calendar_connections WHERE user_id = $1 AND status = ANY($2::text[])
     ORDER BY updated_at DESC LIMIT 1`, [userId, statuses]);
  return rows[0] ?? null;
}

const canWriteConn = (c: Pick<ConnRow, 'status' | 'scopes'>) => c.status === 'connected' && gcal.parseScopes(c.scopes).write;

// ── Status (Settings) ────────────────────────────────────────────────────────
export async function calendarStatus(u?: SessionUser | null): Promise<CalendarStatus> {
  const configured = creds() !== null;
  const push = gcal.pushAddress() !== null;
  const empty = { configured, push, connection: null, calendars: [] };
  const me = await who(u);
  if (!me) return empty;
  try {
    const c = await userConnection(me.id, ['connected', 'error']);
    if (!c) return empty;
    const canWrite = canWriteConn(c);
    const { rows } = await db().query(
      `SELECT id, google_calendar_id, calendar_name AS name, color, is_enabled, domain, branch, location,
              access_role, is_default_write, scope, channel_id IS NOT NULL AND channel_expires_at > now() AS watching
       FROM calendar_mappings WHERE connection_id = $1
       ORDER BY is_enabled DESC, calendar_name NULLS LAST, google_calendar_id`, [c.id]);
    return {
      configured, push,
      connection: { id: c.id, email: c.google_account_email, status: c.status, last_synced_at: iso(c.last_synced_at), last_error: c.last_error, canWrite },
      calendars: rows.map(r => ({ ...r, writable: canWrite && WRITE_ROLES.includes(r.access_role ?? '') })),
    };
  } catch (e) {
    if (missingTable(e)) return empty;
    throw e;
  }
}

// ── Inbound sync ─────────────────────────────────────────────────────────────
// One sync at a time per connection (or connection+calendar) per server instance: page loads,
// the refresh button, push notifications and the cron share it.
const g = globalThis as unknown as { __gcalSyncs?: Map<string, Promise<{ ok: boolean; error?: string }>> };
const syncs = () => (g.__gcalSyncs ??= new Map());

function runSync(conn: Pick<ConnRow, 'id' | 'user_id' | 'refresh_token_encrypted'>, onlyMappingId: string | null = null): Promise<{ ok: boolean; error?: string }> {
  const key = onlyMappingId ? `${conn.id}:${onlyMappingId}` : conn.id;
  const running = syncs().get(key) ?? syncs().get(conn.id);
  if (running) return running;
  const c = creds();
  if (!c) return Promise.resolve({ ok: false, error: 'not_configured' });
  const p = gcal.syncConnection(db(), { id: conn.id, user_id: conn.user_id, refresh_token_encrypted: conn.refresh_token_encrypted }, { ...c, onlyMappingId })
    .then(r => (r.ok ? { ok: true } : { ok: false, error: r.error }))
    .catch(async (e: unknown) => {
      const code = e instanceof gcal.GoogleError ? e.code : 'sync_failed';
      console.error('Calendar sync failed:', code);
      await log(conn.user_id, conn.id, 'sync_failed', { error: code });
      return { ok: false, error: 'sync_failed' };
    })
    .finally(() => { syncs().delete(key); });
  syncs().set(key, p);
  return p;
}

// Sync when the last sync is older than maxAgeMin; waits at most timeoutMs. Never throws.
// This page-load refresh is the polling fallback for push notifications: Vercel Hobby only
// allows daily crons (no 15-minute poll), and preview deployments behind Vercel protection can't
// receive Google's pushes at all — so every page that shows events calls this first.
export async function ensureFreshEvents(opts: { maxAgeMin?: number; timeoutMs?: number; user?: SessionUser | null } = {}): Promise<void> {
  const { maxAgeMin = 5, timeoutMs = 4000 } = opts;
  try {
    if (!creds()) return;
    const me = await who(opts.user);
    if (!me) return;
    const conn = await userConnection(me.id, ['connected']);
    if (!conn) return;
    if (conn.last_synced_at && Date.now() - new Date(conn.last_synced_at).getTime() < maxAgeMin * 60000) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      runSync(conn),
      new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
    clearTimeout(timer);
  } catch (e) {
    if (!missingTable(e)) console.error('ensureFreshEvents:', e instanceof Error ? e.message : 'error');
  }
}

export async function syncNow(u?: SessionUser | null): Promise<{ ok: boolean; error?: string }> {
  if (!creds()) return { ok: false, error: 'not_configured' };
  const me = await who(u);
  if (!me) return { ok: false, error: 'not_connected' };
  try {
    const conn = await userConnection(me.id, ['connected', 'error']);
    if (!conn) return { ok: false, error: 'not_connected' };
    return await runSync(conn);
  } catch (e) {
    if (missingTable(e)) return { ok: false, error: 'not_connected' };
    throw e;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────
type EventDbRow = {
  id: string; title: string; start_at: Date; end_at: Date; all_day: boolean; place: string | null;
  domain: string | null; branch: string | null; location: string | null; color: string | null; calendar_name: string | null;
  html_link: string | null; source: 'google' | 'manual'; mapping_id: string | null; description: string | null;
  scope: 'user' | 'shared'; owner_user_id: string; conflict_json: EventConflict | null; conflict_at: Date | null;
  google_event_id: string | null; google_calendar_id: string | null; google_etag: string | null;
  access_role: string | null; conn_id: string | null; conn_user: string | null; conn_status: string | null; conn_scopes: string | null;
};

const EVENT_COLS = `e.id, e.title, e.start_at, e.end_at, e.all_day, e.place, e.domain, e.branch, e.location,
  m.color, m.calendar_name, e.html_link, e.source, e.mapping_id, e.description, e.scope, e.owner_user_id,
  e.conflict_json, e.conflict_at, e.google_event_id, e.google_calendar_id, e.google_etag,
  m.access_role, c.id AS conn_id, c.user_id AS conn_user, c.status AS conn_status, c.scopes AS conn_scopes`;

function canWriteGoogleRow(u: SessionUser, r: EventDbRow): boolean {
  return r.conn_user === u.id && r.conn_status === 'connected' && gcal.parseScopes(r.conn_scopes).write
    && WRITE_ROLES.includes(r.access_role ?? '');
}

function isWritable(u: SessionUser, r: EventDbRow): boolean {
  if (!canEditRow(u, 'event', r)) return false;
  return r.source === 'manual' || canWriteGoogleRow(u, r);
}

function toCalEvent(u: SessionUser, r: EventDbRow): CalEvent {
  return {
    id: r.id, title: r.title, start_at: iso(r.start_at)!, end_at: iso(r.end_at)!, all_day: r.all_day, place: r.place,
    domain: r.domain, branch: r.branch, location: r.location, color: r.color, calendar_name: r.calendar_name, html_link: r.html_link,
    source: r.source, mapping_id: r.mapping_id, description: r.description, scope: r.scope, owner_user_id: r.owner_user_id,
    writable: isWritable(u, r),
    conflict: r.conflict_json && r.conn_user === u.id ? r.conflict_json : null,
  };
}

export async function eventsBetween(startIso: string, endIso: string, u?: SessionUser | null): Promise<{ connected: boolean; events: CalEvent[] }> {
  const start = new Date(startIso), end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error('Bad range');
  const me = await who(u);
  if (!me) return { connected: false, events: [] };
  try {
    const conn = await userConnection(me.id, ['connected']);
    const q = params([start.toISOString(), end.toISOString()]);
    const visible = visibleSql(me, 'event', 'e', q.p);
    const { rows } = await db().query<EventDbRow>(
      `SELECT ${EVENT_COLS}
       FROM events e
       LEFT JOIN calendar_mappings m ON m.id = e.mapping_id
       LEFT JOIN calendar_connections c ON c.id = m.connection_id
       WHERE e.deleted_at IS NULL AND e.status <> 'cancelled'
         AND ${visible}
         AND e.start_at < $2 AND (e.end_at > $1 OR (e.end_at = e.start_at AND e.start_at >= $1))
         AND (e.source = 'manual' OR (m.is_enabled AND c.status <> 'disconnected'))
       ORDER BY e.start_at, e.end_at, e.title`, q.values);
    return { connected: conn !== null, events: rows.map(r => toCalEvent(me, r)) };
  } catch (e) {
    if (missingTable(e)) return { connected: false, events: [] };
    throw e;
  }
}

// One event the user can see, with its calendar and connection (for writes)
async function loadEvent(u: SessionUser, id: string, client: Pick<PoolClient, 'query'> = db()): Promise<EventDbRow | null> {
  if (!UUID.test(id)) return null;
  const q = params([id]);
  const visible = visibleSql(u, 'event', 'e', q.p);
  const { rows } = await client.query<EventDbRow>(
    `SELECT ${EVENT_COLS}
     FROM events e
     LEFT JOIN calendar_mappings m ON m.id = e.mapping_id
     LEFT JOIN calendar_connections c ON c.id = m.connection_id
     WHERE e.id = $1 AND e.deleted_at IS NULL AND ${visible}`, q.values);
  return rows[0] ?? null;
}

// Calendars this user may write to (connected, read/write grant, enabled, owner/writer role)
async function writeTargets(conn: ConnRow): Promise<(WriteTarget & { google_calendar_id: string; scope: 'user' | 'shared' })[]> {
  if (!canWriteConn(conn)) return [];
  const { rows } = await db().query(
    `SELECT id, calendar_name AS name, color, is_default_write, domain, branch, location, google_calendar_id, scope
     FROM calendar_mappings WHERE connection_id = $1 AND is_enabled AND access_role = ANY($2::text[])
     ORDER BY is_default_write DESC, (google_calendar_id = $3) DESC, calendar_name NULLS LAST`,
    [conn.id, WRITE_ROLES, conn.google_account_email]);
  return rows;
}

// What the "+ אירוע" dialog can do for this user
export async function eventEditor(u?: SessionUser | null): Promise<EventEditor> {
  const me = await who(u);
  if (!me) return { mode: 'none', calendars: [], reason: null };
  try {
    const conn = await userConnection(me.id, ['connected', 'error']);
    if (!conn) return { mode: 'manual', calendars: [], reason: null };
    if (conn.status === 'error') return { mode: 'readonly', calendars: [], reason: ERR.reconnect };
    if (!gcal.parseScopes(conn.scopes).write) return { mode: 'readonly', calendars: [], reason: ERR.readOnly };
    const calendars = (await writeTargets(conn)).map(({ google_calendar_id: _g, scope: _s, ...t }) => t);
    if (!calendars.length) return { mode: 'readonly', calendars: [], reason: ERR.noTarget };
    return { mode: 'google', calendars, reason: null };
  } catch (e) {
    if (missingTable(e)) return { mode: 'none', calendars: [], reason: null };
    throw e;
  }
}

// ── Input → fields ───────────────────────────────────────────────────────────
type Fields = { title: string; start_at: string; end_at: string; all_day: boolean; description: string | null };
type Place = { domain: string; branch: string | null; location: string | null } | null;

function toFields(input: EventInput): Fields | string {
  const title = String(input.title ?? '').trim();
  if (!title) return 'חסרה כותרת';
  if (title.length > 500) return 'הכותרת ארוכה מדי';
  if (!validDate(input.date)) return 'תאריך לא תקין';
  const endDate = input.end_date ? input.end_date : null;
  if (endDate !== null && (!validDate(endDate) || endDate < input.date)) return 'תאריך הסיום לפני תאריך ההתחלה';
  const description = input.description ? String(input.description).trim() : null;
  if (description && description.length > 4000) return 'התיאור ארוך מדי';
  if (input.all_day) {
    return {
      title, description: description || null, all_day: true,
      start_at: gcal.localMidnightUtc(input.date), end_at: gcal.localMidnightUtc(addDaysIso(endDate ?? input.date, 1)),
    };
  }
  if (!input.start_time || !TIME.test(input.start_time)) return 'שעת התחלה לא תקינה';
  if (input.end_time && !TIME.test(input.end_time)) return 'שעת סיום לא תקינה';
  const start_at = gcal.localTimeUtc(input.date, input.start_time);
  const end_at = input.end_time
    ? gcal.localTimeUtc(endDate ?? input.date, input.end_time)
    : new Date(Date.parse(start_at) + 3600000).toISOString();
  if (end_at < start_at) return 'שעת הסיום לפני שעת ההתחלה';
  return { title, description: description || null, all_day: false, start_at, end_at };
}

function toPlace(input: Pick<EventInput, 'domain' | 'branch' | 'location'>): Place | string {
  if (!input.domain) return input.branch || input.location ? 'שיוך לא תקין' : null;
  if (input.location && !input.branch) return 'שיוך לא תקין';
  return { domain: input.domain, branch: input.branch || null, location: input.location || null };
}

async function placeExists(client: Pick<PoolClient, 'query'>, p: NonNullable<Place>): Promise<boolean> {
  const r = p.location
    ? await client.query(`SELECT 1 FROM locations WHERE domain = $1 AND branch = $2 AND location = $3`, [p.domain, p.branch, p.location])
    : p.branch
      ? await client.query(`SELECT 1 FROM branches WHERE domain = $1 AND branch = $2`, [p.domain, p.branch])
      : await client.query(`SELECT 1 FROM areas WHERE id = $1`, [p.domain]);
  return r.rows.length > 0;
}

const version = (f: { title: string; start_at: string | Date; end_at: string | Date; all_day: boolean; description: string | null }): EventVersion =>
  ({ title: f.title, start_at: iso(f.start_at)!, end_at: iso(f.end_at)!, all_day: f.all_day, description: f.description ?? null });

// ── Outbound writes ──────────────────────────────────────────────────────────
async function tokenFor(conn: Pick<ConnRow, 'id' | 'user_id' | 'refresh_token_encrypted'>): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const c = creds();
  if (!c) return { ok: false, error: ERR.notConfigured };
  const t = await gcal.accessTokenFor(db(), { id: conn.id, user_id: conn.user_id, refresh_token_encrypted: conn.refresh_token_encrypted }, c);
  return t.ok ? t : { ok: false, error: ERR.reconnect };
}

async function connById(id: string): Promise<ConnRow | null> {
  const { rows } = await db().query<ConnRow>(
    `SELECT id, user_id, google_account_email, refresh_token_encrypted, status, last_synced_at, last_error, scopes
     FROM calendar_connections WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

// Create from validated fields: Google first (then the local row), or a local manual event
// when the user has no Google connection at all.
async function createFrom(u: SessionUser, fields: Fields, place: Place, opts: { mapping_id?: string | null; scope?: 'user' | 'shared' | null }): Promise<WriteResult> {
  if (place && !canCreateIn(u, place, 'event')) return { ok: false, error: 'אין לך הרשאה ליצור אירוע במקום הזה.' };
  if (place && !(await placeExists(db(), place))) return { ok: false, error: 'שיוך לא תקין' };
  const conn = await userConnection(u.id, ['connected', 'error']);

  if (!conn) {
    const { rows } = await db().query(
      `INSERT INTO events (title, start_at, end_at, all_day, source, owner_user_id, scope, domain, branch, location, description, created_by)
       VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, $8, $9, $10, $5) RETURNING id`,
      [fields.title, fields.start_at, fields.end_at, fields.all_day, u.id, opts.scope === 'shared' ? 'shared' : 'user',
        place?.domain ?? null, place?.branch ?? null, place?.location ?? null, fields.description]);
    await log(u.id, rows[0].id, 'event_created', { event_id: rows[0].id, source: 'manual' });
    return { ok: true, id: rows[0].id };
  }
  if (conn.status === 'error') return { ok: false, error: ERR.reconnect };
  if (!gcal.parseScopes(conn.scopes).write) return { ok: false, error: ERR.readOnly };

  // Target: the calendar chosen in the form → a writable calendar mapped to this place →
  // the default write calendar → the account's primary calendar → any writable calendar
  const targets = await writeTargets(conn);
  let target = opts.mapping_id ? targets.find(t => t.id === opts.mapping_id) : undefined;
  if (opts.mapping_id && !target) return { ok: false, error: 'היומן שנבחר לא זמין לכתיבה.' };
  if (!target && place) target = targets.find(t => t.domain === place.domain && t.branch === place.branch && t.location === place.location);
  target ??= targets.find(t => t.is_default_write) ?? targets.find(t => t.google_calendar_id === conn.google_account_email) ?? targets[0];
  if (!target) return { ok: false, error: ERR.noTarget };

  const tok = await tokenFor(conn);
  if (!tok.ok) return tok;
  let ev;
  try {
    ev = await gcal.insertEvent({ accessToken: tok.accessToken, calendarId: target.google_calendar_id, fields });
  } catch (e) {
    await log(u.id, target.id, 'event_create_failed', { mapping_id: target.id, error: e instanceof gcal.GoogleError ? e.code : 'error' });
    return { ok: false, error: googleError(e) };
  }
  const row = gcal.toEventRow(ev);
  if (!row.start_at || !row.end_at) return { ok: false, error: ERR.google };
  const finalPlace = place ?? (target.domain ? { domain: target.domain, branch: target.branch, location: target.location } : null);
  // A push-triggered sync may have inserted it already: upsert on the same key the sync uses
  const { rows } = await db().query(
    `INSERT INTO events (title, start_at, end_at, all_day, timezone, place, status, source, google_event_id, google_calendar_id,
                         mapping_id, owner_user_id, scope, domain, branch, location, html_link, description,
                         google_etag, google_updated_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'google', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $11)
     ON CONFLICT (mapping_id, google_event_id) WHERE source = 'google' DO UPDATE SET
       title = EXCLUDED.title, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, all_day = EXCLUDED.all_day,
       domain = EXCLUDED.domain, branch = EXCLUDED.branch, location = EXCLUDED.location, description = EXCLUDED.description,
       google_etag = EXCLUDED.google_etag, google_updated_at = EXCLUDED.google_updated_at, created_by = EXCLUDED.created_by,
       html_link = EXCLUDED.html_link, deleted_at = NULL, updated_at = now()
     RETURNING id`,
    [row.title, row.start_at, row.end_at, row.all_day, row.timezone, row.place, row.status, row.google_event_id, target.google_calendar_id,
      target.id, u.id, target.scope, finalPlace?.domain ?? null, finalPlace?.branch ?? null, finalPlace?.location ?? null,
      row.html_link, row.description, row.google_etag, row.google_updated_at]);
  await log(u.id, rows[0].id, 'event_created', { event_id: rows[0].id, mapping_id: target.id, source: 'google' });
  return { ok: true, id: rows[0].id };
}

export async function createEvent(u: SessionUser, input: EventInput): Promise<WriteResult> {
  const fields = toFields(input);
  if (typeof fields === 'string') return { ok: false, error: fields };
  const place = toPlace(input);
  if (typeof place === 'string') return { ok: false, error: place };
  if (input.mapping_id && !UUID.test(input.mapping_id)) return { ok: false, error: 'יומן לא תקין' };
  return createFrom(u, fields, place, { mapping_id: input.mapping_id, scope: input.scope });
}

// The row's own values as dialog input, so a partial patch can be merged onto it
function inputFromRow(r: EventDbRow): EventInput {
  const lastDay = r.all_day ? gcal.localDate(new Date(new Date(r.end_at).getTime() - 1)) : gcal.localDate(r.end_at);
  const ilTime = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: gcal.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const date = gcal.localDate(r.start_at);
  return {
    title: r.title, date, end_date: lastDay > date ? lastDay : null, all_day: r.all_day,
    start_time: r.all_day ? null : ilTime(new Date(r.start_at)), end_time: r.all_day ? null : ilTime(new Date(r.end_at)),
    domain: r.domain, branch: r.branch, location: r.location, description: r.description,
  };
}

// Store Google's current version as the local row and keep both versions for the user to choose
async function recordConflict(row: EventDbRow, mine: Fields, accessToken: string): Promise<void> {
  let google: EventVersion | null = null;
  let gRow: ReturnType<typeof gcal.toEventRow> | null = null;
  try {
    const ev = await gcal.getEvent({ accessToken, calendarId: row.google_calendar_id!, eventId: row.google_event_id! });
    gRow = gcal.toEventRow(ev);
    if (gRow.status !== 'cancelled' && gRow.start_at && gRow.end_at) {
      google = version({ title: gRow.title, start_at: gRow.start_at, end_at: gRow.end_at, all_day: gRow.all_day, description: gRow.description });
    }
  } catch (e) {
    if (!(e instanceof gcal.GoogleError && (e.status === 404 || e.status === 410))) throw e;
  }
  const conflict: EventConflict = { mine: version(mine), google, at: new Date().toISOString() };
  if (google && gRow) {
    await db().query(
      `UPDATE events SET title = $2, start_at = $3, end_at = $4, all_day = $5, description = $6, place = $7,
         google_etag = $8, google_updated_at = $9, html_link = COALESCE($10, html_link),
         conflict_json = $11, conflict_at = now(), updated_at = now() WHERE id = $1`,
      [row.id, gRow.title, gRow.start_at, gRow.end_at, gRow.all_day, gRow.description, gRow.place,
        gRow.google_etag, gRow.google_updated_at, gRow.html_link, JSON.stringify(conflict)]);
  } else {
    await db().query(`UPDATE events SET conflict_json = $2, conflict_at = now(), updated_at = now() WHERE id = $1`, [row.id, JSON.stringify(conflict)]);
  }
}

// Patch Google (If-Match: our etag) and then the local row. A 412 records a conflict instead.
async function patchGoogle(u: SessionUser, row: EventDbRow, fields: Fields, place: Place, action: string): Promise<WriteResult> {
  if (!canWriteGoogleRow(u, row) || !row.conn_id || !row.google_event_id || !row.google_calendar_id) return { ok: false, error: ERR.notMine };
  const conn = await connById(row.conn_id);
  if (!conn) return { ok: false, error: ERR.notMine };
  const tok = await tokenFor(conn);
  if (!tok.ok) return tok;
  let ev;
  try {
    ev = await gcal.patchEvent({
      accessToken: tok.accessToken, calendarId: row.google_calendar_id, eventId: row.google_event_id,
      fields: { ...fields, description: fields.description ?? '' }, etag: row.google_etag,
    });
  } catch (e) {
    const code = e instanceof gcal.GoogleError ? e.code : 'error';
    if (code === 'conflict') {
      try {
        await recordConflict(row, fields, tok.accessToken);
      } catch {
        return { ok: false, error: ERR.google };
      }
      await log(u.id, row.id, 'event_conflict', { event_id: row.id, mapping_id: row.mapping_id });
      return { ok: false, error: ERR.conflict, conflict: true };
    }
    if (e instanceof gcal.GoogleError && (e.status === 404 || e.status === 410)) {
      await db().query(`UPDATE events SET status = 'cancelled', deleted_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
      return { ok: false, error: 'האירוע נמחק ב-Google בינתיים.' };
    }
    await log(u.id, row.id, `${action}_failed`, { event_id: row.id, error: code });
    return { ok: false, error: googleError(e) };
  }
  const g2 = gcal.toEventRow(ev);
  await db().query(
    `UPDATE events SET title = $2, start_at = $3, end_at = $4, all_day = $5, description = $6,
       domain = $7, branch = $8, location = $9, google_etag = $10, google_updated_at = $11,
       html_link = COALESCE($12, html_link), created_by = COALESCE(created_by, $13),
       conflict_json = NULL, conflict_at = NULL, updated_at = now() WHERE id = $1`,
    [row.id, g2.title || fields.title, g2.start_at ?? fields.start_at, g2.end_at ?? fields.end_at, g2.all_day, g2.description,
      place?.domain ?? null, place?.branch ?? null, place?.location ?? null, g2.google_etag, g2.google_updated_at, g2.html_link, u.id]);
  await log(u.id, row.id, action, { event_id: row.id, mapping_id: row.mapping_id });
  return { ok: true, id: row.id };
}

export async function updateEvent(u: SessionUser, id: string, patch: Partial<EventInput>): Promise<WriteResult> {
  const row = await loadEvent(u, id);
  if (!row) return { ok: false, error: ERR.notFound };
  if (!canEditRow(u, 'event', row)) return { ok: false, error: ERR.denied };
  const merged: EventInput = { ...inputFromRow(row), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  if (patch.all_day === false && patch.end_date === undefined) merged.end_date = null;
  const fields = toFields(merged);
  if (typeof fields === 'string') return { ok: false, error: fields };
  const place = toPlace(merged);
  if (typeof place === 'string') return { ok: false, error: place };
  const placeChanged = (place?.domain ?? null) !== row.domain || (place?.branch ?? null) !== row.branch || (place?.location ?? null) !== row.location;
  if (placeChanged && place) {
    if (!canCreateIn(u, place, 'event')) return { ok: false, error: 'אין לך הרשאה להעביר את האירוע למקום הזה.' };
    if (!(await placeExists(db(), place))) return { ok: false, error: 'שיוך לא תקין' };
  }
  if (row.source === 'manual') {
    await db().query(
      `UPDATE events SET title = $2, start_at = $3, end_at = $4, all_day = $5, description = $6,
         domain = $7, branch = $8, location = $9, updated_at = now() WHERE id = $1`,
      [row.id, fields.title, fields.start_at, fields.end_at, fields.all_day, fields.description, place?.domain ?? null, place?.branch ?? null, place?.location ?? null]);
    await log(u.id, row.id, 'event_updated', { event_id: row.id, source: 'manual' });
    return { ok: true, id: row.id };
  }
  return patchGoogle(u, row, fields, place, 'event_updated');
}

export async function deleteEvent(u: SessionUser, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await loadEvent(u, id);
  if (!row) return { ok: false, error: ERR.notFound };
  if (!canDeleteRow(u, 'event', row)) return { ok: false, error: ERR.denied };
  if (row.source === 'google') {
    if (!canWriteGoogleRow(u, row) || !row.conn_id || !row.google_event_id || !row.google_calendar_id) return { ok: false, error: ERR.notMine };
    const conn = await connById(row.conn_id);
    if (!conn) return { ok: false, error: ERR.notMine };
    const tok = await tokenFor(conn);
    if (!tok.ok) return tok;
    try {
      await gcal.removeEvent({ accessToken: tok.accessToken, calendarId: row.google_calendar_id, eventId: row.google_event_id });
    } catch (e) {
      await log(u.id, row.id, 'event_delete_failed', { event_id: row.id, error: e instanceof gcal.GoogleError ? e.code : 'error' });
      return { ok: false, error: googleError(e) };
    }
  }
  await db().query(`UPDATE events SET status = 'cancelled', deleted_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
  await db().query(`UPDATE work_items SET event_id = NULL, updated_at = now() WHERE event_id = $1`, [row.id]).catch(() => {});
  await log(u.id, row.id, 'event_deleted', { event_id: row.id, source: row.source });
  return { ok: true };
}

// "שמור את שלי" re-patches with the fresh etag (or re-creates when Google deleted it);
// "קבל את Google" keeps Google's version (already stored locally) and clears the conflict.
export async function resolveConflict(u: SessionUser, id: string, choice: 'mine' | 'google'): Promise<WriteResult> {
  const row = await loadEvent(u, id);
  if (!row) return { ok: false, error: ERR.notFound };
  if (!row.conflict_json) return { ok: true, id: row.id };
  if (!canWriteGoogleRow(u, row)) return { ok: false, error: ERR.notMine };
  const c = row.conflict_json;
  if (choice === 'google') {
    if (c.google === null) {
      await db().query(`UPDATE events SET status = 'cancelled', deleted_at = now(), conflict_json = NULL, conflict_at = NULL, updated_at = now() WHERE id = $1`, [row.id]);
    } else {
      await db().query(`UPDATE events SET conflict_json = NULL, conflict_at = NULL, updated_at = now() WHERE id = $1`, [row.id]);
    }
    await log(u.id, row.id, 'conflict_resolved', { event_id: row.id, choice });
    return { ok: true, id: row.id };
  }
  const place = row.domain ? { domain: row.domain, branch: row.branch, location: row.location } : null;
  const fields: Fields = { title: c.mine.title, start_at: c.mine.start_at, end_at: c.mine.end_at, all_day: c.mine.all_day, description: c.mine.description };
  if (c.google === null) {
    // Deleted in Google meanwhile: put my version back as a new Google event
    const conn = await connById(row.conn_id!);
    if (!conn) return { ok: false, error: ERR.notMine };
    const tok = await tokenFor(conn);
    if (!tok.ok) return tok;
    let ev;
    try {
      ev = await gcal.insertEvent({ accessToken: tok.accessToken, calendarId: row.google_calendar_id!, fields });
    } catch (e) {
      return { ok: false, error: googleError(e) };
    }
    const g2 = gcal.toEventRow(ev);
    await db().query(
      `UPDATE events SET google_event_id = $2, title = $3, start_at = $4, end_at = $5, all_day = $6, description = $7,
         google_etag = $8, google_updated_at = $9, html_link = $10, conflict_json = NULL, conflict_at = NULL, updated_at = now()
       WHERE id = $1`,
      [row.id, g2.google_event_id, g2.title, g2.start_at, g2.end_at, g2.all_day, g2.description, g2.google_etag, g2.google_updated_at, g2.html_link]);
    await log(u.id, row.id, 'conflict_resolved', { event_id: row.id, choice });
    return { ok: true, id: row.id };
  }
  const r = await patchGoogle(u, row, fields, place, 'conflict_resolved');
  return r;
}

// ── Tasks → calendar ─────────────────────────────────────────────────────────
export type TaskForEvent = {
  id: string; title: string; due_date: string | null; due_time: string | null;
  domain: string | null; branch: string | null; location: string | null; scope: 'user' | 'shared' | string | null;
};

function appUrl(): string | null {
  const base = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  try { return base ? new URL(base).origin : null; } catch { return null; }
}

// A 30-minute event at the task's due time (Israel), or an all-day event when it has no time.
// Links the event on work_items.event_id; calling it again updates that same event.
export async function createEventForTask(u: SessionUser, task: TaskForEvent): Promise<WriteResult> {
  if (!UUID.test(task.id)) return { ok: false, error: 'משימה לא תקינה' };
  const { rows } = await db().query(
    `SELECT id, owner_user_id, assigned_to, scope, domain, branch, location, event_id FROM work_items WHERE id = $1 AND deleted_at IS NULL`, [task.id]);
  const t = rows[0];
  if (!t) return { ok: false, error: 'המשימה לא נמצאה' };
  if (!canEditRow(u, 'task', t)) return { ok: false, error: 'אין לך הרשאה למשימה הזו.' };
  if (!task.due_date || !validDate(task.due_date)) return { ok: false, error: 'למשימה אין תאריך יעד' };
  const time = task.due_time ? String(task.due_time).slice(0, 5) : null;
  if (time && !TIME.test(time)) return { ok: false, error: 'שעה לא תקינה' };
  const title = String(task.title ?? '').trim().slice(0, 500) || 'משימה';
  const base = appUrl();
  const description = base ? `משימה בדשבורד: ${base}/tasks` : 'נוצר ממשימה בדשבורד';
  const start_at = time ? gcal.localTimeUtc(task.due_date, time) : gcal.localMidnightUtc(task.due_date);
  const end_at = time ? new Date(Date.parse(start_at) + 30 * 60000).toISOString() : gcal.localMidnightUtc(addDaysIso(task.due_date, 1));
  const fields: Fields = { title, description, all_day: !time, start_at, end_at };
  const place: Place = task.domain ? { domain: task.domain, branch: task.branch ?? null, location: task.location ?? null } : null;

  if (t.event_id) {
    const existing = await loadEvent(u, t.event_id);
    if (existing) {
      if (existing.source === 'manual') {
        await db().query(
          `UPDATE events SET title = $2, start_at = $3, end_at = $4, all_day = $5, description = $6, domain = $7, branch = $8, location = $9, updated_at = now() WHERE id = $1`,
          [existing.id, fields.title, fields.start_at, fields.end_at, fields.all_day, fields.description, place?.domain ?? null, place?.branch ?? null, place?.location ?? null]);
        await log(u.id, existing.id, 'event_updated', { event_id: existing.id, task_id: task.id });
        return { ok: true, id: existing.id };
      }
      return patchGoogle(u, existing, fields, place, 'event_updated');
    }
  }
  // An event for a task the user may edit but not "create in" (e.g. an assigned employee) goes
  // into their own calendar without a place
  const placeOk = place && canCreateIn(u, place, 'event') ? place : null;
  const r = await createFrom(u, fields, placeOk, { scope: task.scope === 'shared' ? 'shared' : 'user' });
  if (r.ok) {
    await db().query(`UPDATE work_items SET event_id = $2, updated_at = now() WHERE id = $1`, [task.id, r.id]);
    await log(u.id, r.id, 'task_event_linked', { event_id: r.id, task_id: task.id });
  }
  return r;
}

// Delete the task's event (in Google too) and unlink it. No event → ok.
export async function removeEventForTask(u: SessionUser, taskId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID.test(taskId)) return { ok: false, error: 'משימה לא תקינה' };
  const { rows } = await db().query(
    `SELECT id, owner_user_id, assigned_to, scope, domain, branch, location, event_id FROM work_items WHERE id = $1`, [taskId]);
  const t = rows[0];
  if (!t) return { ok: false, error: 'המשימה לא נמצאה' };
  if (!canEditRow(u, 'task', t)) return { ok: false, error: 'אין לך הרשאה למשימה הזו.' };
  if (!t.event_id) return { ok: true };
  const ev = await loadEvent(u, t.event_id);
  if (ev) {
    const r = await deleteEvent(u, ev.id);
    if (!r.ok) return r;
  }
  await db().query(`UPDATE work_items SET event_id = NULL, updated_at = now() WHERE id = $1`, [taskId]);
  return { ok: true };
}

// ── Push channels ────────────────────────────────────────────────────────────
type ChannelRow = { id: string; google_calendar_id: string; channel_id: string | null; channel_resource_id: string | null };

async function stopMappingChannel(accessToken: string | null, m: ChannelRow): Promise<void> {
  if (m.channel_id && accessToken) {
    try {
      await gcal.stopChannel({ accessToken, channelId: m.channel_id, resourceId: m.channel_resource_id });
    } catch {
      console.error('Calendar channel stop failed (ignored)');
    }
  }
  await db().query(
    `UPDATE calendar_mappings SET channel_id = NULL, channel_resource_id = NULL, channel_token_hash = NULL, channel_expires_at = NULL WHERE id = $1`, [m.id]);
}

// (Re)start the push channel of one calendar. Skipped silently when there is no https address.
async function watchMapping(userId: string, accessToken: string, m: ChannelRow): Promise<boolean> {
  const address = gcal.pushAddress();
  if (!address) return false;
  if (m.channel_id) await stopMappingChannel(accessToken, m);
  try {
    const ch = await gcal.watchCalendar({ accessToken, calendarId: m.google_calendar_id, address });
    await db().query(
      `UPDATE calendar_mappings SET channel_id = $2, channel_resource_id = $3, channel_token_hash = $4, channel_expires_at = $5 WHERE id = $1`,
      [m.id, ch.channel_id, ch.resource_id, ch.token_hash, ch.expires_at]);
    await log(userId, m.id, 'channel_started', { mapping_id: m.id });
    return true;
  } catch (e) {
    await log(userId, m.id, 'channel_failed', { mapping_id: m.id, error: e instanceof gcal.GoogleError ? e.code : 'error' });
    return false;
  }
}

// After connecting: a channel for every enabled calendar. Never throws.
export async function startWatching(connectionId: string): Promise<void> {
  try {
    if (!gcal.pushAddress()) return;
    const conn = await connById(connectionId);
    if (!conn || conn.status !== 'connected') return;
    const tok = await tokenFor(conn);
    if (!tok.ok) return;
    const { rows } = await db().query<ChannelRow>(
      `SELECT id, google_calendar_id, channel_id, channel_resource_id FROM calendar_mappings WHERE connection_id = $1 AND is_enabled`, [conn.id]);
    for (const m of rows) await watchMapping(conn.user_id, tok.accessToken, m);
  } catch (e) {
    console.error('startWatching:', e instanceof Error ? e.message : 'error');
  }
}

// Daily cron: renew channels that expire within 48h (stopping the old one), start missing ones,
// and stop channels left on disabled calendars.
export async function renewChannels(now = new Date()): Promise<{ renewed: number; stopped: number }> {
  const out = { renewed: 0, stopped: 0 };
  const address = gcal.pushAddress();
  const { rows } = await db().query(
    `SELECT m.id, m.google_calendar_id, m.channel_id, m.channel_resource_id, m.channel_expires_at, m.is_enabled, m.connection_id
     FROM calendar_mappings m JOIN calendar_connections c ON c.id = m.connection_id
     WHERE c.status = 'connected'
       AND ((m.is_enabled AND (m.channel_id IS NULL OR m.channel_expires_at IS NULL OR m.channel_expires_at < $1))
            OR (NOT m.is_enabled AND m.channel_id IS NOT NULL))`,
    [new Date(now.getTime() + RENEW_WITHIN_MS).toISOString()]);
  const byConn = new Map<string, typeof rows>();
  for (const r of rows) byConn.set(r.connection_id, [...(byConn.get(r.connection_id) ?? []), r]);
  for (const [connId, maps] of byConn) {
    const conn = await connById(connId);
    if (!conn) continue;
    const tok = await tokenFor(conn);
    if (!tok.ok) continue;
    for (const m of maps) {
      if (!m.is_enabled) { await stopMappingChannel(tok.accessToken, m); out.stopped++; continue; }
      if (address && await watchMapping(conn.user_id, tok.accessToken, m)) out.renewed++;
    }
  }
  return out;
}

// A Google push notification (route /api/google/push). Verifies the channel id and the
// per-channel secret (sha256, constant time); 'sync' handshakes are ignored; anything else runs
// the incremental sync of that one calendar. Returns a code for tests/logs, never details.
export async function handlePush(h: { channelId: string | null; token: string | null; state: string | null; resourceId: string | null }):
  Promise<'synced' | 'ignored' | 'rejected'> {
  if (!h.channelId || !h.token || h.channelId.length > 200) return 'rejected';
  const { rows } = await db().query(
    `SELECT m.id AS mapping_id, m.channel_token_hash, m.channel_resource_id, m.is_enabled,
            c.id, c.user_id, c.refresh_token_encrypted, c.status
     FROM calendar_mappings m JOIN calendar_connections c ON c.id = m.connection_id
     WHERE m.channel_id = $1`, [h.channelId]);
  const r = rows[0];
  if (!r || !gcal.verifyChannelToken(h.token, r.channel_token_hash)) return 'rejected';
  if (r.channel_resource_id && h.resourceId && r.channel_resource_id !== h.resourceId) return 'rejected';
  if (h.state === 'sync' || !r.is_enabled || r.status !== 'connected') return 'ignored';
  await runSync({ id: r.id, user_id: r.user_id, refresh_token_encrypted: r.refresh_token_encrypted }, r.mapping_id);
  return 'synced';
}

// Daily cron: sync every connected user, then renew push channels
export async function cronRun(): Promise<{ ok: boolean; connections: { id: string; ok: boolean; error: string | null }[]; channels: { renewed: number; stopped: number } }> {
  const { rows } = await db().query<ConnRow>(
    `SELECT id, user_id, refresh_token_encrypted FROM calendar_connections WHERE status = 'connected' ORDER BY created_at`);
  const connections = [];
  for (const c of rows) {
    const r = await runSync(c);
    connections.push({ id: c.id, ok: r.ok, error: r.ok ? null : r.error ?? 'sync_failed' });
  }
  let channels = { renewed: 0, stopped: 0 };
  try {
    channels = await renewChannels();
  } catch (e) {
    console.error('Calendar channel renewal failed:', e instanceof Error ? e.message : 'error');
  }
  return { ok: connections.every(c => c.ok), connections, channels };
}

// ── Settings: mapping edits ──────────────────────────────────────────────────
export async function setMapping(
  id: string,
  patch: { is_enabled?: boolean; domain?: string | null; branch?: string | null; location?: string | null; scope?: 'user' | 'shared'; is_default_write?: boolean },
  u?: SessionUser | null,
): Promise<void> {
  if (!UUID.test(id)) throw new Error('Bad mapping id');
  const me = await who(u);
  if (!me) throw new Error('Not signed in');
  const client = await db().connect();
  let enabledChanged: boolean | null = null;
  let mapping!: ChannelRow & { connection_id: string };
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT m.id, m.google_calendar_id, m.channel_id, m.channel_resource_id, m.connection_id,
              m.is_enabled, m.domain, m.branch, m.location, m.scope, m.is_default_write, m.access_role, c.scopes, c.status
       FROM calendar_mappings m JOIN calendar_connections c ON c.id = m.connection_id
       WHERE m.id = $1 AND c.user_id = $2 FOR UPDATE OF m`, [id, me.id]);
    if (!rows[0]) throw new Error('Mapping not found');
    const cur = rows[0];
    mapping = cur;
    const next = {
      is_enabled: patch.is_enabled === undefined ? cur.is_enabled : Boolean(patch.is_enabled),
      domain: patch.domain === undefined ? cur.domain : patch.domain || null,
      branch: patch.branch === undefined ? cur.branch : patch.branch || null,
      location: patch.location === undefined ? cur.location : patch.location || null,
      scope: patch.scope === undefined ? cur.scope : patch.scope === 'shared' ? 'shared' : 'user',
      is_default_write: patch.is_default_write === undefined ? cur.is_default_write : Boolean(patch.is_default_write),
    };
    // Changing a level clears the levels below it unless they were given too
    if (patch.domain !== undefined && patch.branch === undefined && next.domain !== cur.domain) next.branch = null;
    if ((patch.domain !== undefined || patch.branch !== undefined) && patch.location === undefined && next.branch !== cur.branch) next.location = null;

    if (next.branch && !next.domain) throw new Error('branch needs a domain');
    if (next.location && !next.branch) throw new Error('location needs a branch');
    if (next.domain) {
      if (!(await placeExists(client, { domain: next.domain, branch: next.branch, location: next.location }))) throw new Error('Unknown place');
      // Sharing a calendar with a place's members needs the right to add events there
      if (next.scope === 'shared' && !canCreateIn(me, { domain: next.domain, branch: next.branch, location: next.location }, 'event')) throw new Error('Not allowed');
    }
    if (next.is_default_write && !cur.is_default_write) {
      if (!WRITE_ROLES.includes(cur.access_role ?? '') || !gcal.parseScopes(cur.scopes).write) throw new Error('Calendar is not writable');
      await client.query(`UPDATE calendar_mappings SET is_default_write = false WHERE connection_id = $1 AND id <> $2`, [cur.connection_id, id]);
    }
    await client.query(
      `UPDATE calendar_mappings SET is_enabled = $2, domain = $3, branch = $4, location = $5, scope = $6, is_default_write = $7 WHERE id = $1`,
      [id, next.is_enabled, next.domain, next.branch, next.location, next.scope, next.is_default_write]);
    await client.query(
      `UPDATE events SET domain = $2, branch = $3, location = $4, updated_at = now()
       WHERE mapping_id = $1 AND source = 'google' AND created_by IS NULL
         AND (domain, branch, location) IS DISTINCT FROM ($2::text, $3::text, $4::text)`,
      [id, next.domain, next.branch, next.location]);
    if (next.scope !== cur.scope) {
      await client.query(`UPDATE events SET scope = $2, updated_at = now() WHERE mapping_id = $1 AND source = 'google'`, [id, next.scope]);
    }
    await client.query('COMMIT');
    if (next.is_enabled !== cur.is_enabled) enabledChanged = next.is_enabled;
    await log(me.id, id, 'mapping_updated', { mapping_id: id, enabled: next.is_enabled, scope: next.scope, default_write: next.is_default_write });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  // Push channel follows the toggle (best effort, after the commit)
  if (enabledChanged !== null) {
    try {
      const conn = await connById(mapping.connection_id);
      if (conn && conn.status === 'connected' && creds()) {
        const tok = await tokenFor(conn);
        if (enabledChanged && tok.ok) await watchMapping(me.id, tok.accessToken, mapping);
        if (!enabledChanged) await stopMappingChannel(tok.ok ? tok.accessToken : null, mapping);
      }
    } catch {
      console.error('Calendar channel update failed (ignored)');
    }
  }
}

// ── Disconnect ───────────────────────────────────────────────────────────────
// Stop push channels, revoke at Google (best effort) and forget the token ('revoked'; the
// column is NOT NULL). Events stay (soft) but are hidden by eventsBetween; mapping settings are
// kept for a reconnect, sync tokens are cleared so a reconnect starts with a full sync.
export async function disconnect(u?: SessionUser | null): Promise<void> {
  const me = await who(u);
  if (!me) return;
  const keyB64 = process.env.CALENDAR_TOKEN_KEY;
  const c0 = creds();
  const { rows } = await db().query<ConnRow>(
    `SELECT id, refresh_token_encrypted FROM calendar_connections WHERE user_id = $1 AND status <> 'disconnected'`, [me.id]);
  for (const c of rows) {
    let refresh: string | null = null;
    try { refresh = gcal.decryptToken(c.refresh_token_encrypted, keyB64); } catch { /* unreadable: nothing to revoke */ }
    let access: string | null = null;
    if (refresh && c0) {
      try { access = (await gcal.refreshAccessToken({ refreshToken: refresh, clientId: c0.clientId, clientSecret: c0.clientSecret })).access_token; } catch { /* grant already dead */ }
    }
    const { rows: maps } = await db().query<ChannelRow>(
      `SELECT id, google_calendar_id, channel_id, channel_resource_id FROM calendar_mappings WHERE connection_id = $1 AND channel_id IS NOT NULL`, [c.id]);
    for (const m of maps) await stopMappingChannel(access, m);
    if (refresh) {
      try { await gcal.revokeToken(refresh); } catch { console.error('Calendar revoke failed (ignored)'); }
    }
    await db().query(
      `UPDATE calendar_connections SET status = 'disconnected', refresh_token_encrypted = 'revoked',
         last_error = NULL, updated_at = now() WHERE id = $1`, [c.id]);
    await db().query(`UPDATE calendar_mappings SET sync_token = NULL WHERE connection_id = $1`, [c.id]);
    await gcal.resolveReconnectAlert(db(), me.id);
    await log(me.id, c.id, 'disconnected', { connection_id: c.id });
  }
}

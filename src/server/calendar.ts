import 'server-only';
import { db } from './db';
import gcal from '@domain/gcal';

// Google Calendar (read-only) for the owner. Sync logic lives in lib/gcal.js; this file is the
// app-facing API: status, freshness on page load, event reads, mapping edits, disconnect.

export type CalendarStatus = {
  configured: boolean;
  connection: null | { id: string; email: string | null; status: 'connected' | 'error' | 'disconnected'; last_synced_at: string | null; last_error: string | null };
  calendars: { id: string; google_calendar_id: string; name: string | null; color: string | null; is_enabled: boolean; domain: string | null; branch: string | null; location: string | null }[];
};

export type CalEvent = {
  id: string; title: string; start_at: string; end_at: string; all_day: boolean; place: string | null;
  domain: string | null; branch: string | null; location: string | null; color: string | null;
  calendar_name: string | null; html_link: string | null;
};

type ConnRow = { id: string; user_id: string; google_account_email: string | null; refresh_token_encrypted: string; status: 'connected' | 'error' | 'disconnected'; last_synced_at: Date | null; last_error: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
const missingTable = (e: unknown) => (e as { code?: string })?.code === '42P01';

function creds() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const keyB64 = process.env.CALENDAR_TOKEN_KEY;
  return clientId && clientSecret && keyB64 ? { clientId, clientSecret, keyB64 } : null;
}

async function latestConnection(statuses: string[]): Promise<ConnRow | null> {
  const { rows } = await db().query<ConnRow>(
    `SELECT id, user_id, google_account_email, refresh_token_encrypted, status, last_synced_at, last_error
     FROM calendar_connections WHERE user_id = 'avihu' AND status = ANY($1::text[])
     ORDER BY updated_at DESC LIMIT 1`, [statuses]);
  return rows[0] ?? null;
}

export async function calendarStatus(): Promise<CalendarStatus> {
  const configured = creds() !== null;
  try {
    const c = await latestConnection(['connected', 'error']);
    if (!c) return { configured, connection: null, calendars: [] };
    const { rows } = await db().query(
      `SELECT id, google_calendar_id, calendar_name AS name, color, is_enabled, domain, branch, location
       FROM calendar_mappings WHERE connection_id = $1
       ORDER BY is_enabled DESC, calendar_name NULLS LAST, google_calendar_id`, [c.id]);
    return {
      configured,
      connection: { id: c.id, email: c.google_account_email, status: c.status, last_synced_at: iso(c.last_synced_at), last_error: c.last_error },
      calendars: rows,
    };
  } catch (e) {
    if (missingTable(e)) return { configured, connection: null, calendars: [] };
    throw e;
  }
}

// One sync at a time per server instance (page loads, refresh button and cron share it)
const g = globalThis as unknown as { __gcalSync?: Promise<{ ok: boolean; error?: string }> };

function runSync(conn: ConnRow): Promise<{ ok: boolean; error?: string }> {
  if (g.__gcalSync) return g.__gcalSync;
  const c = creds();
  if (!c) return Promise.resolve({ ok: false, error: 'not_configured' });
  const p = gcal.syncConnection(db(), conn, c)
    .then(r => (r.ok ? { ok: true } : { ok: false, error: r.error }))
    .catch((e: unknown) => {
      console.error('Calendar sync failed:', e instanceof gcal.GoogleError ? e.code : 'sync_failed');
      return { ok: false, error: 'sync_failed' };
    })
    .finally(() => { g.__gcalSync = undefined; });
  g.__gcalSync = p;
  return p;
}

// Sync when the last sync is older than maxAgeMin; waits at most timeoutMs. Never throws.
export async function ensureFreshEvents(opts: { maxAgeMin?: number; timeoutMs?: number } = {}): Promise<void> {
  const { maxAgeMin = 5, timeoutMs = 4000 } = opts;
  try {
    if (!creds()) return;
    const conn = await latestConnection(['connected']);
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

export async function eventsBetween(startIso: string, endIso: string): Promise<{ connected: boolean; events: CalEvent[] }> {
  const start = new Date(startIso), end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error('Bad range');
  try {
    const conn = await latestConnection(['connected']);
    const { rows } = await db().query(
      `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.place, e.domain, e.branch, e.location,
              m.color, m.calendar_name, e.html_link
       FROM events e
       LEFT JOIN calendar_mappings m ON m.id = e.mapping_id
       LEFT JOIN calendar_connections c ON c.id = m.connection_id
       WHERE e.deleted_at IS NULL AND e.status <> 'cancelled'
         AND (e.owner_user_id = 'avihu' OR e.scope = 'shared')
         AND e.start_at < $2 AND (e.end_at > $1 OR (e.end_at = e.start_at AND e.start_at >= $1))
         AND (e.source = 'manual' OR (m.is_enabled AND c.status <> 'disconnected'))
       ORDER BY e.start_at, e.end_at, e.title`, [start.toISOString(), end.toISOString()]);
    return {
      connected: conn !== null,
      events: rows.map(r => ({ ...r, start_at: iso(r.start_at)!, end_at: iso(r.end_at)! })),
    };
  } catch (e) {
    if (missingTable(e)) return { connected: false, events: [] };
    throw e;
  }
}

export async function setMapping(
  id: string,
  patch: { is_enabled?: boolean; domain?: string | null; branch?: string | null; location?: string | null },
): Promise<void> {
  if (!UUID.test(id)) throw new Error('Bad mapping id');
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT is_enabled, domain, branch, location FROM calendar_mappings WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw new Error('Mapping not found');
    const cur = rows[0];
    const next = {
      is_enabled: patch.is_enabled === undefined ? cur.is_enabled : Boolean(patch.is_enabled),
      domain: patch.domain === undefined ? cur.domain : patch.domain || null,
      branch: patch.branch === undefined ? cur.branch : patch.branch || null,
      location: patch.location === undefined ? cur.location : patch.location || null,
    };
    // Changing a level clears the levels below it unless they were given too
    if (patch.domain !== undefined && patch.branch === undefined && next.domain !== cur.domain) next.branch = null;
    if ((patch.domain !== undefined || patch.branch !== undefined) && patch.location === undefined && next.branch !== cur.branch) next.location = null;

    if (next.branch && !next.domain) throw new Error('branch needs a domain');
    if (next.location && !next.branch) throw new Error('location needs a branch');
    if (next.domain) {
      const ok = next.location
        ? await client.query(`SELECT 1 FROM locations WHERE domain = $1 AND branch = $2 AND location = $3`, [next.domain, next.branch, next.location])
        : next.branch
          ? await client.query(`SELECT 1 FROM branches WHERE domain = $1 AND branch = $2`, [next.domain, next.branch])
          : await client.query(`SELECT 1 FROM areas WHERE id = $1`, [next.domain]);
      if (!ok.rows.length) throw new Error('Unknown place');
    }
    await client.query(
      `UPDATE calendar_mappings SET is_enabled = $2, domain = $3, branch = $4, location = $5 WHERE id = $1`,
      [id, next.is_enabled, next.domain, next.branch, next.location]);
    await client.query(
      `UPDATE events SET domain = $2, branch = $3, location = $4, updated_at = now()
       WHERE mapping_id = $1 AND source = 'google'
         AND (domain, branch, location) IS DISTINCT FROM ($2::text, $3::text, $4::text)`,
      [id, next.domain, next.branch, next.location]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function syncNow(): Promise<{ ok: boolean; error?: string }> {
  if (!creds()) return { ok: false, error: 'not_configured' };
  try {
    const conn = await latestConnection(['connected', 'error']);
    if (!conn) return { ok: false, error: 'not_connected' };
    return await runSync(conn);
  } catch (e) {
    if (missingTable(e)) return { ok: false, error: 'not_connected' };
    throw e;
  }
}

// Revoke at Google (best effort) and forget the token. Events stay (soft) but are hidden by
// eventsBetween; mapping settings are kept for a reconnect, sync tokens are cleared so a
// reconnect starts with a full sync.
export async function disconnect(): Promise<void> {
  const keyB64 = process.env.CALENDAR_TOKEN_KEY;
  const { rows } = await db().query<ConnRow>(
    `SELECT id, refresh_token_encrypted FROM calendar_connections WHERE user_id = 'avihu' AND status <> 'disconnected'`);
  for (const c of rows) {
    try {
      await gcal.revokeToken(gcal.decryptToken(c.refresh_token_encrypted, keyB64));
    } catch {
      console.error('Calendar revoke failed (ignored)');
    }
    await db().query(
      `UPDATE calendar_connections SET status = 'disconnected', refresh_token_encrypted = 'revoked',
         last_error = NULL, updated_at = now() WHERE id = $1`, [c.id]);
    await db().query(`UPDATE calendar_mappings SET sync_token = NULL WHERE connection_id = $1`, [c.id]);
  }
}

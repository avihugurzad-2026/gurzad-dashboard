import 'server-only';
import { db } from './db';
import type { SessionUser } from './auth';
import { addCandidates, createImport, type ParsedRow } from './imports';
import { personalWorkspace } from './workspaces';
import gcal from '@domain/gcal';
import gmail from '@domain/gmail';
import S from '@domain/statement';

// Gmail import (stage 4), per signed-in user and private to them. The Google grant is the user's
// calendar_connections row (refresh token stored encrypted) with gmail.readonly added. A sync
// reads receipt-like messages and creates ONE statement_imports row (source gmail) with one
// candidate per message — never a transaction; the user reviews them at /finance-import.
// Nothing of the e-mail is stored except the candidate fields (no bodies, no attachments).
// Never log tokens, addresses or message contents: ids, counts and error codes only.

export type GmailStatus = {
  /** Google OAuth env present on the server */
  configured: boolean;
  connected: boolean;
  /** the grant failed at Google (status 'error'): reconnect */
  needsReconnect: boolean;
  email: string | null;
  hasGmailScope: boolean;
  /** the connection also holds calendar scopes (disconnecting removes both) */
  hasCalendarScope: boolean;
  lastSync: string | null;
};

export type GmailImport = { id: string; status: string; row_count: number; imported_count: number; error: string | null; created_at: string };

export type SyncResult =
  | { ok: true; importId: string; added: number; skipped: number; failed: number; more: boolean }
  | { ok: false; error: GmailError };

export type GmailError = 'not_configured' | 'not_connected' | 'no_scope' | 'reconnect' | 'no_workspace' | 'busy' | 'google' | 'failed';

const LOOKBACK_DAYS = 90;
const OVERLAP_DAYS = 2;
const MAX_LIST = 300;          // ids only: cheap
const MAX_MESSAGES = 50;       // fetched and parsed per run
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_PDFS_PER_MESSAGE = 3;
const CONCURRENCY = 4;
const DEADLINE_MS = 40_000;    // stay inside a serverless request; the rest waits for the next run
const DAY_MS = 86_400_000;

const missingTable = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string })?.code ?? '');

function creds() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const keyB64 = process.env.CALENDAR_TOKEN_KEY;
  return clientId && clientSecret && keyB64 ? { clientId, clientSecret, keyB64 } : null;
}

type ConnRow = { id: string; user_id: string; google_account_email: string | null; refresh_token_encrypted: string; status: string; scopes: string | null };

// The user's live Google connection, preferring one that holds the Gmail scope
async function connectionOf(userId: string): Promise<ConnRow | null> {
  const { rows } = await db().query<ConnRow>(
    `SELECT id, user_id, google_account_email, refresh_token_encrypted, status, scopes
     FROM calendar_connections WHERE user_id = $1 AND status IN ('connected', 'error')
     ORDER BY (coalesce(scopes, '') LIKE $2) DESC, updated_at DESC LIMIT 1`, [userId, `%${gcal.SCOPE_GMAIL}%`]);
  return rows[0] ?? null;
}

async function lastGmailImport(userId: string): Promise<string | null> {
  const { rows } = await db().query(
    `SELECT max(created_at) AS at FROM statement_imports WHERE owner_user_id = $1 AND source = 'gmail'`, [userId]);
  return rows[0]?.at ? new Date(rows[0].at).toISOString() : null;
}

export async function gmailStatus(u: SessionUser): Promise<GmailStatus> {
  const configured = creds() !== null;
  const empty: GmailStatus = { configured, connected: false, needsReconnect: false, email: null, hasGmailScope: false, hasCalendarScope: false, lastSync: null };
  try {
    const c = await connectionOf(u.id);
    const lastSync = await lastGmailImport(u.id).catch(e => { if (missingTable(e)) return null; throw e; });
    if (!c) return { ...empty, lastSync };
    const sc = gcal.parseScopes(c.scopes);
    return {
      configured, connected: c.status === 'connected', needsReconnect: c.status === 'error', email: c.google_account_email,
      hasGmailScope: sc.gmail, hasCalendarScope: sc.read, lastSync,
    };
  } catch (e) {
    if (missingTable(e)) return empty;
    throw e;
  }
}

export async function gmailImports(u: SessionUser, limit = 10): Promise<GmailImport[]> {
  try {
    const { rows } = await db().query(
      `SELECT id, status, row_count, imported_count, error, created_at FROM statement_imports
       WHERE owner_user_id = $1 AND source = 'gmail' ORDER BY created_at DESC LIMIT $2`, [u.id, limit]);
    return rows.map(r => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

/** Seconds since the user's last Gmail import (null = none) — the action's rate limit */
export async function secondsSinceLastGmailImport(u: SessionUser): Promise<number | null> {
  const at = await lastGmailImport(u.id);
  return at ? (Date.now() - Date.parse(at)) / 1000 : null;
}

// Run `fn` over `items` with at most `n` at a time, stopping new work after `deadline`
async function pool<T, R>(items: T[], n: number, deadline: number, fn: (x: T) => Promise<R>): Promise<{ done: R[]; left: number }> {
  const done: R[] = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length && Date.now() < deadline) {
      const x = items[i++];
      done.push(await fn(x));
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return { done, left: items.length - i };
}

const codeOf = (e: unknown) => (e instanceof gcal.GoogleError ? e.code : 'error');
const AUTH = new Set(['invalid_grant', 'unauthorized_client', 'token_unreadable', 'http_401', 'authError']);
const SCOPE = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'PERMISSION_DENIED', 'http_403']);

// One message → a candidate row, or null when it could not be read (counted as failed)
async function readMessage(accessToken: string, id: string): Promise<ParsedRow | null> {
  try {
    const parts = gmail.messageParts(await gmail.getMessage(accessToken, id));
    const texts: string[] = [];
    for (const a of parts.attachments.filter(gmail.isPdf).slice(0, MAX_PDFS_PER_MESSAGE)) {
      if (a.size !== null && a.size > MAX_PDF_BYTES) continue;
      try {
        const buf = a.data ? gmail.b64url(a.data) : a.attachmentId ? await gmail.getAttachment(accessToken, id, a.attachmentId) : null;
        if (buf && buf.length && buf.length <= MAX_PDF_BYTES) texts.push(S.pdfText(buf));
      } catch { /* an unreadable PDF: the body may still have the amount */ }
    }
    const row = gmail.extractFromMessage(parts, texts);
    return { ...row, external_id: `gmail:${id}` };
  } catch (e) {
    if (e instanceof gcal.GoogleError && (AUTH.has(e.code) || SCOPE.has(e.code))) throw e;
    return null;
  }
}

// One sync at a time per user per server instance
const g = globalThis as unknown as { __gmailSyncs?: Set<string> };
const running = () => (g.__gmailSyncs ??= new Set());

export async function syncGmail(u: SessionUser): Promise<SyncResult> {
  const c0 = creds();
  if (!c0) return { ok: false, error: 'not_configured' };
  if (running().has(u.id)) return { ok: false, error: 'busy' };
  running().add(u.id);
  try {
    const conn = await connectionOf(u.id);
    if (!conn) return { ok: false, error: 'not_connected' };
    if (conn.status === 'error') return { ok: false, error: 'reconnect' };
    if (!gcal.parseScopes(conn.scopes).gmail) return { ok: false, error: 'no_scope' };
    const ws = await personalWorkspace(u);
    if (!ws) return { ok: false, error: 'no_workspace' };

    // accessTokenFor marks a dead grant ('error'), raises the reconnect alert and logs the code
    const tok = await gcal.accessTokenFor(db(), conn, c0);
    if (!tok.ok) return { ok: false, error: AUTH.has(tok.error) ? 'reconnect' : 'google' };

    // Window: since the last Gmail import (with overlap), but never less than 90 days back, so a
    // capped run or a long gap loses nothing; message ids already imported are dropped below.
    const last = await lastGmailImport(u.id);
    const floor = Date.now() - LOOKBACK_DAYS * DAY_MS;
    const since = last ? Math.min(floor, Date.parse(last) - OVERLAP_DAYS * DAY_MS) : floor;

    let ids: string[];
    try {
      ids = (await gmail.listMessages(tok.accessToken, gmail.searchQuery({ since }), { max: MAX_LIST })).map(m => m.id);
    } catch (e) {
      const code = codeOf(e);
      await log(u, conn.id, 'gmail_sync_failed', { error: code });
      return { ok: false, error: AUTH.has(code) ? 'reconnect' : SCOPE.has(code) ? 'no_scope' : 'google' };
    }
    const { rows: known } = ids.length ? await db().query<{ external_id: string }>(
      `SELECT external_id FROM import_candidates WHERE owner_user_id = $1 AND external_id = ANY($2::text[])`,
      [u.id, ids.map(id => `gmail:${id}`)]) : { rows: [] };
    const seen = new Set(known.map(r => r.external_id));
    // Oldest first, so a capped run finishes the older mail before it leaves the window
    const fresh = ids.filter(id => !seen.has(`gmail:${id}`)).reverse();
    const batch = fresh.slice(0, MAX_MESSAGES);

    let read: { done: (ParsedRow | null)[]; left: number };
    try {
      read = await pool(batch, CONCURRENCY, Date.now() + DEADLINE_MS, id => readMessage(tok.accessToken, id));
    } catch (e) {
      const code = codeOf(e);
      await log(u, conn.id, 'gmail_sync_failed', { error: code });
      return { ok: false, error: AUTH.has(code) ? 'reconnect' : 'no_scope' };
    }
    const rows = read.done.filter((r): r is ParsedRow => r !== null);
    const failed = read.done.length - rows.length;

    const client = await db().connect();
    let importId: string, added: number, skipped: number;
    try {
      await client.query('BEGIN');
      importId = await createImport(client, u, { workspace_id: ws.id, source: 'gmail', format: 'email', file_name: 'Gmail' });
      ({ added, skipped } = rows.length ? await addCandidates(client, u, importId, ws.id, rows) : { added: 0, skipped: 0 });
      // Nothing new: the run is still recorded (window + rate limit) but leaves nothing to review
      if (!added) await client.query(`UPDATE statement_imports SET status = 'imported', completed_at = now() WHERE id = $1`, [importId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const more = fresh.length - batch.length + read.left > 0;
    await log(u, importId, 'gmail_synced', { found: ids.length, added, skipped, failed, more });
    return { ok: true, importId, added, skipped, failed, more };
  } catch (e) {
    console.error('Gmail sync failed:', codeOf(e));
    return { ok: false, error: 'failed' };
  } finally {
    running().delete(u.id);
  }
}

// activity_log: ids, counts and codes only. Best effort.
export async function log(u: SessionUser, objectId: string, action: string, metadata: Record<string, unknown> = {}): Promise<void> {
  try {
    await db().query(
      `INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'import', $2, $3, $4)`,
      [u.id, objectId, action, JSON.stringify({ source: 'gmail', ...metadata })]);
  } catch { /* the log must not break a sync */ }
}

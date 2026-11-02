import 'server-only';
import { db } from './db';
import type { SessionUser } from './auth';
import { todayIL } from '@/lib/period';
import { contextLabel } from '@/lib/places';
import integrationsLib from '@domain/integrations';
import { ingestOspa } from './ingest';

// Stage 3.2: scheduled pull of every connected data source into local tables. Credentials are
// resolved from env by credentials_ref only (never stored, never logged). One activity_log row
// per integration per run, with counts only.

export type SyncSummary = { ok: boolean; results: { location: string; ok: boolean; error?: string; days: number; months_added: number; months_changed: number }[]; added: number; changed: number; error?: string };

const missing = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string })?.code ?? '');

export async function syncIntegrations(userId: string | null = null): Promise<SyncSummary> {
  let results: Awaited<ReturnType<typeof integrationsLib.syncAll>>;
  try {
    results = await integrationsLib.syncAll(db(), { today: todayIL(), userId });
  } catch (e) {
    if (!missing(e)) throw e;
    // Stage 3 migration not applied: keep the stage-1 monthly pull working
    const r = await ingestOspa();
    return r.ok ? { ok: true, results: [], added: r.added, changed: r.changed } : { ok: false, results: [], added: 0, changed: 0, error: r.error };
  }
  const out = results.map(r => ({ location: r.location, ok: r.ok, error: r.ok ? undefined : r.error, days: r.days, months_added: r.months_added, months_changed: r.months_changed }));
  const failed = results.filter(r => !r.ok);
  if (failed.length) console.error('integration sync failed:', failed.map(f => `${f.location}:${'code' in f ? f.code : ''}`).join(', ')); // codes only
  return {
    ok: failed.length === 0,
    results: out,
    added: results.reduce((a, r) => a + r.months_added, 0),
    changed: results.reduce((a, r) => a + r.months_changed, 0),
    error: failed.length ? failed.map(f => ('error' in f ? f.error : '')).join(' · ') : undefined,
  };
}

export type IntegrationStatus = {
  id: string; provider: string; place: string; domain: string; branch: string; location: string;
  status: 'ok' | 'error' | 'disabled' | 'not_connected'; last_sync_at: string | null; last_error: string | null; credentials: string;
};

const PROVIDER_LABEL: Record<string, string> = { buyz: 'Buyz' };
export const providerLabel = (p: string) => PROVIDER_LABEL[p] ?? p;

// Settings → "חיבורים": owner/admin only (null for anyone else). The UI only
// reveals whether a server-side credential reference exists; environment names
// are configuration internals and are not sent to a browser.
export async function integrationsStatus(u: SessionUser): Promise<IntegrationStatus[] | null> {
  if (!u.isOwner && !u.isAdmin) return null;
  try {
    const { rows } = await db().query(
      `SELECT id, provider, domain, branch, location, status, last_sync_at, last_error, credentials_ref
       FROM integrations ORDER BY branch, location, provider`);
    return rows.map(r => ({
      id: r.id, provider: r.provider, domain: r.domain, branch: r.branch, location: r.location,
      place: contextLabel(r), status: r.status, last_error: r.last_error,
      last_sync_at: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
      credentials: r.credentials_ref ? 'מוגדר בשרת' : 'לא הוגדר',
    }));
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

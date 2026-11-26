import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { env, HttpError, sbAdmin } from '../server.js';
import { providerById, type ConnectionView } from '../../../shared/integrations.js';
import { buyz } from './buyz.js';
import { morning } from './morning.js';
import { buyzdb } from './buyzdb.js';

// Generic per-business integrations. Each provider is an Adapter; secrets are sealed with INTEGRATIONS_KEY
// and live in gd_integration_connections (service role only). The browser never receives a secret back.

export type Adapter = {
  /** When a provider has several secret fields, how to pack them into one sealed value. */
  combineSecret?: (secrets: Record<string, string>) => string;
  /** Cheap call that proves the credentials work. Returns a short Hebrew status line. */
  test(config: Record<string, string>, secret: string): Promise<string>;
  /** Pull data; returns snapshots keyed by kind (e.g. { revenue: {...} }). */
  sync(config: Record<string, string>, secret: string): Promise<Record<string, unknown>>;
};
const ADAPTERS: Record<string, Adapter> = { buyz, morning, buyzdb };

const STALE_MS = 15 * 60e3; // re-sync on view when the last sync is older than 15 minutes

function key() {
  const k = env('INTEGRATIONS_KEY');
  if (k.length < 32) throw new HttpError(503, 'INTEGRATIONS_KEY לא מוגדר בשרת (לפחות 32 תווים)');
  return createHash('sha256').update('gd-integrations:' + k).digest();
}
function seal(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}
function open(sealed: string) {
  const [iv, tag, enc] = sealed.split('.').map((x) => Buffer.from(x, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

function adapter(provider: string) {
  const a = ADAPTERS[provider];
  if (!a || !providerById(provider)) throw new HttpError(400, 'ספק לא מוכר');
  return a;
}

/** The business must be a "businesses" record of this workspace. */
export async function assertBusiness(workspaceId: string, businessId: string) {
  const { data } = await sbAdmin().from('gd_records').select('id').eq('workspace_id', workspaceId).eq('collection', 'businesses').eq('id', businessId).maybeSingle();
  if (!data) throw new HttpError(404, 'העסק לא נמצא');
}

const errMsg = (e: unknown) => (e instanceof HttpError ? e.message : 'שגיאה בחיבור לספק').slice(0, 300);

/** Split the submitted form into secret + non-secret config, per the provider's field list. */
function splitFields(provider: string, fields: Record<string, unknown>) {
  const info = providerById(provider)!;
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of info.fields) {
    const v = String(fields?.[f.key] ?? '').trim();
    if (!v && !f.optional) throw new HttpError(400, `חסר: ${f.label}`);
    if (v.length > 500) throw new HttpError(400, `${f.label}: ארוך מדי`);
    if (f.secret) secrets[f.key] = v; else if (v) config[f.key] = v;
  }
  const vals = Object.values(secrets);
  const secret = vals.length > 1 ? (adapter(provider).combineSecret ?? ((x) => JSON.stringify(x)))(secrets) : (vals[0] ?? '');
  return { config, secret };
}

export async function connect(workspaceId: string, userId: string, businessId: string, provider: string, fields: Record<string, unknown>) {
  await assertBusiness(workspaceId, businessId);
  const a = adapter(provider);
  const { config, secret } = splitFields(provider, fields);
  const message = await a.test(config, secret); // throws with a Hebrew message if the key is wrong
  const sb = sbAdmin();
  const { data, error } = await sb.from('gd_integration_connections').upsert({
    workspace_id: workspaceId, business_id: businessId, provider, config, secret_enc: seal(secret),
    key_hint: secret.slice(-4), status: 'connected', last_error: null, created_by: userId,
  }, { onConflict: 'workspace_id,business_id,provider' }).select('id').single();
  if (error) throw error;
  await syncOne(data.id).catch(() => null); // first pull; errors are recorded on the row
  return { message };
}

export async function disconnect(workspaceId: string, businessId: string, provider: string) {
  // Soft: wipe the secret and keep the row (and last snapshot) for history.
  const { error } = await sbAdmin().from('gd_integration_connections').update({ secret_enc: '', key_hint: null, status: 'disconnected' })
    .eq('workspace_id', workspaceId).eq('business_id', businessId).eq('provider', provider);
  if (error) throw error;
}

async function syncOne(connectionId: string) {
  const sb = sbAdmin();
  const { data: c } = await sb.from('gd_integration_connections').select('id, workspace_id, business_id, provider, config, secret_enc, key_hint, created_by').eq('id', connectionId).single();
  if (!c?.secret_enc) throw new HttpError(409, 'החיבור מנותק');
  try {
    const snaps = await adapter(c.provider).sync((c.config ?? {}) as Record<string, string>, open(c.secret_enc));
    const now = new Date().toISOString();
    const rows = Object.entries(snaps).map(([kind, data]) => ({ connection_id: c.id, kind, data, fetched_at: now }));
    if (rows.length) { const { error } = await sb.from('gd_integration_snapshots').upsert(rows, { onConflict: 'connection_id,kind' }); if (error) throw error; }
    await sb.from('gd_integration_connections').update({ status: 'connected', last_sync_at: now, last_error: null }).eq('id', c.id);
    if (c.provider === 'buyzdb' && !(c.config as any)?.auto) await provisionBuyzBranches(c, (snaps as any).discovery).catch((e) => console.error('buyz provision', e));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error('integration sync', c.provider, e);
    await sb.from('gd_integration_connections').update({ status: 'error', last_error: errMsg(e) }).eq('id', c.id);
    throw e;
  }
}

export async function sync(workspaceId: string, businessId: string, provider: string) {
  const { data } = await sbAdmin().from('gd_integration_connections').select('id').eq('workspace_id', workspaceId).eq('business_id', businessId).eq('provider', provider).maybeSingle();
  if (!data) throw new HttpError(404, 'אין חיבור כזה');
  await syncOne(data.id);
}

/** Connections of one business, without secrets. Re-syncs stale connected ones first (best effort). */
export async function list(workspaceId: string, businessId: string, refresh = true): Promise<ConnectionView[]> {
  const sb = sbAdmin();
  const load = () => sb.from('gd_integration_connections')
    .select('id, provider, status, key_hint, last_sync_at, last_error, secret_enc, gd_integration_snapshots(kind, data, fetched_at)')
    .eq('workspace_id', workspaceId).eq('business_id', businessId);
  let { data, error } = await load();
  if (error) throw error;
  if (refresh) {
    const stale = (data ?? []).filter((c: any) => c.secret_enc && c.status !== 'disconnected' && (!c.last_sync_at || Date.now() - Date.parse(c.last_sync_at) > STALE_MS));
    if (stale.length) {
      await Promise.allSettled(stale.map((c: any) => syncOne(c.id)));
      ({ data, error } = await load());
      if (error) throw error;
    }
  }
  return (data ?? []).map((c: any) => ({
    provider: c.provider, status: c.status, keyHint: c.key_hint, lastSyncAt: c.last_sync_at, lastError: c.last_error,
    snapshots: Object.fromEntries((c.gd_integration_snapshots ?? []).map((x: any) => [x.kind, { data: x.data, fetchedAt: x.fetched_at }])),
  }));
}

/** Connections of every business in the workspace, keyed by business id (stale ones re-synced first). */
export async function listAll(workspaceId: string): Promise<Record<string, ConnectionView[]>> {
  const { data, error } = await sbAdmin().from('gd_integration_connections').select('business_id').eq('workspace_id', workspaceId);
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((r: any) => r.business_id as string))];
  const out: Record<string, ConnectionView[]> = {};
  await Promise.all(ids.map(async (id) => { out[id] = await list(workspaceId, id); }));
  return out;
}

/** Cron: pull every live connection of every workspace. Errors are recorded per connection. */
export async function syncAll() {
  const { data, error } = await sbAdmin().from('gd_integration_connections').select('id').neq('status', 'disconnected').neq('secret_enc', '');
  if (error) throw error;
  const r = await Promise.allSettled((data ?? []).map((c: any) => syncOne(c.id)));
  return { total: r.length, ok: r.filter((x) => x.status === 'fulfilled').length };
}

/**
 * Buyz database: every branch of the same network (e.g. OSPA Modiin + Rishon) gets its own business in the
 * dashboard with its own connection (same credentials, different slug), created automatically.
 */
async function provisionBuyzBranches(c: any, discovery: any) {
  const branches: { slug: string; name: string }[] = (discovery?.network ?? []).filter((b: any) => b.slug);
  const selfSlug = String(c.config?.slug || 'ospa');
  const sb = sbAdmin();
  const { data: bizRows } = await sb.from('gd_records').select('id, data').eq('workspace_id', c.workspace_id).eq('collection', 'businesses');
  const businesses = bizRows ?? [];
  const src = businesses.find((b: any) => b.id === c.business_id);
  if (src && !src.data?.buyz_slug) await sb.from('gd_records').update({ data: { ...src.data, buyz_slug: selfSlug }, updated_at: new Date().toISOString() }).eq('id', src.id);
  const { data: conns } = await sb.from('gd_integration_connections').select('business_id, config').eq('workspace_id', c.workspace_id).eq('provider', 'buyzdb');
  const linked = new Set((conns ?? []).map((x: any) => String(x.config?.slug || 'ospa')));
  for (const b of branches) {
    if (b.slug === selfSlug || linked.has(b.slug)) continue;
    let biz = businesses.find((x: any) => x.data?.buyz_slug === b.slug);
    if (!biz) {
      const id = randomUUID();
      const data = { name: b.name, kind: src?.data?.kind ?? 'ספא וטיפוח', owner_pct: src?.data?.owner_pct ?? 100, vat_mode: src?.data?.vat_mode ?? 'חודשי', site: '', buyz_slug: b.slug };
      const { error } = await sb.from('gd_records').insert({ id, workspace_id: c.workspace_id, collection: 'businesses', data, created_by: c.created_by ?? null });
      if (error) throw error;
      biz = { id, data };
    }
    const { data: nc, error } = await sb.from('gd_integration_connections').upsert({
      workspace_id: c.workspace_id, business_id: biz.id, provider: 'buyzdb', config: { ...c.config, slug: b.slug, auto: '1' },
      secret_enc: c.secret_enc, key_hint: c.key_hint, status: 'connected', last_error: null, created_by: c.created_by,
    }, { onConflict: 'workspace_id,business_id,provider' }).select('id').single();
    if (error) throw error;
    await syncOne(nc.id).catch(() => null);
  }
}

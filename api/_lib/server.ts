import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { AgentData, Row } from '../../shared/agent.js';

/** Env value, trimmed and without wrapping quotes (values pasted into Vercel often carry them). */
export const env = (k: string) => (process.env[k] || '').trim().replace(/^(['"])(.*)\1$/, '$2');
/** Constant-time string comparison (secrets, hashes). */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
/** Vercel cron calls carry `Authorization: Bearer <CRON_SECRET>`. */
export const isCron = (auth?: string) => !!env('CRON_SECRET') && safeEqual(auth || '', `Bearer ${env('CRON_SECRET')}`);
/** Today's date in Israel (handles summer time), YYYY-MM-DD. */
export const israelDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
export const has = (...keys: string[]) => keys.every((k) => !!process.env[k]);

let admin: SupabaseClient | null = null;
export function sbAdmin(): SupabaseClient {
  if (!has('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')) throw new HttpError(503, 'Supabase לא מוגדר בשרת');
  return (admin ||= createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } }));
}

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Resolve the signed-in user + their membership from the Bearer token. */
export async function requireMember(req: VercelRequest) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'לא מחובר');
  const sb = sbAdmin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'לא מחובר');
  const { data: m } = await sb.from('gd_memberships').select('workspace_id, role, areas').eq('user_id', data.user.id).limit(1).maybeSingle();
  if (!m) throw new HttpError(403, 'אין גישה');
  return { user: data.user, workspaceId: m.workspace_id as string, role: m.role as string, areas: m.areas as string[] };
}

export function handler(fn: (req: VercelRequest, res: VercelResponse) => Promise<unknown>) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.status(status).json({ error: e instanceof HttpError ? e.message : 'שגיאת שרת' });
    }
  };
}

/** Agent data access for one workspace, backed by the `records` table (service role — scoped by workspace id here). */
export function recordsData(workspaceId: string): AgentData {
  const sb = sbAdmin();
  return {
    async all(collection) {
      const { data, error } = await sb.from('gd_records').select('id, data').eq('workspace_id', workspaceId).eq('collection', collection).limit(5000);
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...(r.data as object), id: r.id })) as Row[];
    },
    async add(collection, data) {
      const { error } = await sb.from('gd_records').insert({ id: crypto.randomUUID(), workspace_id: workspaceId, collection, data });
      if (error) throw error;
    },
    async update(_collection, id, patch) {
      const { data: cur } = await sb.from('gd_records').select('data').eq('id', id).eq('workspace_id', workspaceId).single();
      const { error } = await sb.from('gd_records').update({ data: { ...(cur?.data as object), ...patch } }).eq('id', id).eq('workspace_id', workspaceId);
      if (error) throw error;
    },
  };
}

const COLLECTIONS_BY_AREA: Record<string, string[]> = {
  home: ['home_tasks', 'shopping', 'transactions', 'budgets', 'bills', 'maintenance', 'documents'],
  business: ['businesses', 'invoices', 'clients', 'biz_expenses', 'biz_tasks', 'integrations'],
  invest: ['properties', 'tenants', 'leases', 'rent_payments', 'prop_tasks', 'photos', 'alert_rules'],
};

/** Hard server-side isolation: restricts AgentData strictly to the collections allowed for a member's areas & role. */
export function scopedRecordsData(workspaceId: string, scope: { areas: string[]; readOnly?: boolean }): AgentData {
  const base = recordsData(workspaceId);
  const allowed = new Set<string>();
  for (const a of scope.areas) for (const c of COLLECTIONS_BY_AREA[a] ?? []) allowed.add(c);
  return {
    async all(collection) {
      if (!allowed.has(collection)) return [];
      return base.all(collection);
    },
    async add(collection, data) {
      if (scope.readOnly || !allowed.has(collection)) throw new HttpError(403, 'אין הרשאת עריכה בתחום זה');
      return base.add(collection, data);
    },
    async update(collection, id, patch) {
      if (scope.readOnly || !allowed.has(collection)) throw new HttpError(403, 'אין הרשאת עריכה בתחום זה');
      return base.update(collection, id, patch);
    },
  };
}

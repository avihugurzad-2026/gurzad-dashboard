import { supabase } from './supabase';

/** Call one of our own /api functions as the signed-in user. Throws an Error with a Hebrew message. */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const headers: Record<string, string> = {};
  if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  const j = r.headers.get('content-type')?.includes('json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error(j.error || 'משהו השתבש. נסה שוב.');
  return j as T;
}

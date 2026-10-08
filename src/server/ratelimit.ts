import 'server-only';

// Login throttle: 5 attempts per 15 minutes per client address, per server instance
const WINDOW_MS = 15 * 60 * 1000;
const MAX = 5;
const hits = new Map<string, number[]>();

export function allow(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

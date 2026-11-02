import 'server-only';
import { db } from './db';

// Which tables/columns exist right now. Stage 3 tables are created by separate pieces of work and
// may be missing on a given database; search and the activity log skip what is not there instead
// of failing. Cached per server instance for a minute (a migration shows up within a minute).
const TTL_MS = 60_000;
let cached: { at: number; cols: Map<string, Set<string>> } | null = null;

export async function schemaColumns(): Promise<Map<string, Set<string>>> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.cols;
  const { rows } = await db().query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
  const cols = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!cols.has(r.table_name)) cols.set(r.table_name, new Set());
    cols.get(r.table_name)!.add(r.column_name);
  }
  cached = { at: Date.now(), cols };
  return cols;
}

export const hasTable = (cols: Map<string, Set<string>>, t: string) => cols.has(t);
export const hasCols = (cols: Map<string, Set<string>>, t: string, ...c: string[]) => {
  const s = cols.get(t);
  return Boolean(s && c.every(x => s.has(x)));
};
// The first of `candidates` that table `t` has, or null
export const pickCol = (cols: Map<string, Set<string>>, t: string, ...candidates: string[]) =>
  candidates.find(c => cols.get(t)?.has(c)) ?? null;

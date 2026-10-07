import 'server-only';
import { db } from './db';
import { todayIL } from '@/lib/period';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Things typed into the dashboard: tasks, goals, household money. Vault tasks stay read-only
// and are listed next to these (source 'vault'). Missing tables (migration not applied yet)
// read as `ready: false`, never as an error page.

export type Domain = 'business' | 'personal' | 'ventures';
export type Place = { domain: Domain; branch: string | null; location: string | null; list?: string | null };

export const PEOPLE = [{ id: 'avihu', name: 'אביהו' }, { id: 'eden', name: 'עדן' }] as const;
export const PERSONAL_LISTS = [
  { key: 'home', label: 'בית' }, { key: 'personal', label: 'אישי' }, { key: 'study', label: 'לימודים' },
] as const;

export type WorkItem = {
  id: string; source: 'dashboard' | 'vault'; title: string; notes: string | null;
  priority: 1 | 2 | 3; status: 'open' | 'doing' | 'done'; due: string | null; owner: string | null;
  list: string | null; location: string | null; days_past: number | null; done_at: string | null;
};
export type Goal = {
  id: string; title: string; unit: 'ils' | 'count' | 'pct'; target: number | null; current: number | null;
  due: string | null; status: 'active' | 'done' | 'dropped'; owner: string; location: string | null;
};
export type MoneyEntry = {
  id: string; kind: 'income' | 'expense'; amount: number; category: string;
  occurred_on: string; note: string | null; owner: string;
};

const missing = (e: any) => e?.code === '42P01';

function where(p: Place, alias = '') {
  const a = alias ? `${alias}.` : '';
  const params: unknown[] = [p.domain];
  const parts = [`${a}domain = $1`, `${a}deleted_at IS NULL`];
  if (p.branch) { params.push(p.branch); parts.push(`${a}branch = $${params.length}`); }
  if (p.location) { params.push(p.location); parts.push(`${a}location = $${params.length}`); }
  if (p.list) { params.push(p.list); parts.push(`${a}list = $${params.length}`); }
  return { sql: parts.join(' AND '), params };
}

// Vault priority strings → 1..3
const vaultPriority = (p: string | null): 1 | 2 | 3 => (/high|גבוה|1/i.test(p ?? '') ? 1 : /low|נמוך|3/i.test(p ?? '') ? 3 : 2);

export async function workItems(p: Place, { includeDone = false } = {}) {
  const today = todayIL();
  const items: WorkItem[] = [];
  let ready = true;
  try {
    const w = where(p);
    const { rows } = await db().query(
      `SELECT id, title, notes, priority, status, to_char(due, 'YYYY-MM-DD') AS due, owner, list, location,
              CASE WHEN due < $${w.params.length + 1}::date AND status <> 'done' THEN ($${w.params.length + 1}::date - due) END AS days_past,
              done_at
       FROM work_items WHERE ${w.sql} ${includeDone ? '' : `AND (status <> 'done' OR done_at > now() - interval '7 days')`}`,
      [...w.params, today]);
    for (const r of rows) items.push({ ...r, source: 'dashboard', days_past: r.days_past === null ? null : Number(r.days_past),
      done_at: r.done_at ? new Date(r.done_at).toISOString() : null });
  } catch (e) {
    if (!missing(e)) throw e;
    ready = false;
  }
  // Vault tasks for the same place (read-only). Personal vault tasks have branches home / general-tasks.
  if (!p.location && !p.list) {
    const params: unknown[] = [p.domain, today];
    let sql = `SELECT id, text AS title, priority, to_char(due, 'YYYY-MM-DD') AS due, done,
                      CASE WHEN due < $2 AND NOT done THEN ($2::date - due) END AS days_past
               FROM tasks WHERE deleted_at IS NULL AND NOT done AND domain = $1`;
    if (p.branch) { params.push(p.branch); sql += ` AND branch = $3`; }
    const { rows } = await db().query(sql, params);
    for (const r of rows) items.push({
      id: r.id, source: 'vault', title: r.title, notes: null, priority: vaultPriority(r.priority), status: 'open',
      due: r.due, owner: null, list: null, location: null, days_past: r.days_past === null ? null : Number(r.days_past), done_at: null,
    });
  }
  const rank = { doing: 0, open: 1, done: 2 } as const;
  items.sort((a, b) => rank[a.status] - rank[b.status] || a.priority - b.priority
    || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title, 'he'));
  return { ready, today, items };
}

export async function goalsFor(p: Place) {
  try {
    const w = where(p);
    const { rows } = await db().query(
      `SELECT id, title, unit, target::float, current::float, to_char(due, 'YYYY-MM-DD') AS due, status, owner, location
       FROM goals WHERE ${w.sql} AND status <> 'dropped' ORDER BY status, due NULLS LAST, created_at`, w.params);
    return { ready: true, goals: rows as Goal[] };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, goals: [] as Goal[] };
  }
}

// One month of the shared household book, plus 6-month totals for the trend line
export async function householdMonth(month: string /* YYYY-MM */) {
  const start = `${month}-01`;
  try {
    const { rows } = await db().query(
      `SELECT id, kind, amount::float, category, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, note, owner
       FROM money_entries WHERE book = 'shared' AND deleted_at IS NULL
         AND occurred_on >= $1::date AND occurred_on < ($1::date + interval '1 month')
       ORDER BY occurred_on DESC, created_at DESC`, [start]);
    const { rows: months } = await db().query(
      `SELECT to_char(date_trunc('month', occurred_on), 'YYYY-MM') AS month,
              SUM(amount) FILTER (WHERE kind = 'income')::float AS income,
              SUM(amount) FILTER (WHERE kind = 'expense')::float AS expense
       FROM money_entries WHERE book = 'shared' AND deleted_at IS NULL
         AND occurred_on >= ($1::date - interval '5 months')
       GROUP BY 1 ORDER BY 1`, [start]);
    const entries = rows as MoneyEntry[];
    const sum = (k: 'income' | 'expense') => entries.filter(e => e.kind === k).reduce((a, e) => a + e.amount, 0);
    const byCat = new Map<string, number>();
    for (const e of entries.filter(x => x.kind === 'expense')) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
    const { rows: cats } = await db().query(
      `SELECT DISTINCT category FROM money_entries WHERE deleted_at IS NULL ORDER BY 1 LIMIT 50`);
    return {
      ready: true, month, entries,
      income: entries.some(e => e.kind === 'income') ? sum('income') : null,
      expense: entries.some(e => e.kind === 'expense') ? sum('expense') : null,
      by_category: [...byCat.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
      months: months as { month: string; income: number | null; expense: number | null }[],
      categories: cats.map(c => c.category as string),
    };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, month, entries: [] as MoneyEntry[], income: null, expense: null,
      by_category: [] as { category: string; total: number }[], months: [], categories: [] as string[] };
  }
}

// Open counts per place, for the overview and the area landing cards
export async function openCounts() {
  const today = todayIL();
  const out: Record<string, { open: number; overdue: number }> = {};
  const add = (k: string, overdue: boolean) => { out[k] ??= { open: 0, overdue: 0 }; out[k].open++; if (overdue) out[k].overdue++; };
  try {
    const { rows } = await db().query(
      `SELECT domain, branch, location, list, (due < $1::date) AS overdue FROM work_items WHERE deleted_at IS NULL AND status <> 'done'`, [today]);
    for (const r of rows) {
      add(r.domain, r.overdue);
      if (r.branch) add(`${r.domain}/${r.branch}`, r.overdue);
      if (r.branch && r.location) add(`${r.domain}/${r.branch}/${r.location}`, r.overdue);
      if (r.list) add(`${r.domain}:${r.list}`, r.overdue);
    }
  } catch (e) { if (!missing(e)) throw e; }
  const { rows } = await db().query(
    `SELECT domain, branch, (due < $1::date) AS overdue FROM tasks WHERE deleted_at IS NULL AND NOT done`, [today]);
  for (const r of rows) { add(r.domain, r.overdue); add(`${r.domain}/${r.branch}`, r.overdue); }
  return out;
}

// Vault records filed under one branch (read-only), counted by type, for the ventures pages
export async function vaultRecords(domain: Domain, branch: string) {
  const { rows } = await db().query(
    `SELECT type, count(*)::int AS n, max(synced_at) AS synced_at FROM entities
     WHERE domain = $1 AND branch = $2 AND deleted_at IS NULL GROUP BY type ORDER BY n DESC, type`, [domain, branch]);
  return rows.map(r => ({ type: r.type as string, n: r.n as number, synced_at: r.synced_at ? new Date(r.synced_at).toISOString() : null }));
}

export async function branchName(domain: Domain, branch: string): Promise<string | null> {
  const { rows } = await db().query(`SELECT name_he FROM branches WHERE domain = $1 AND branch = $2`, [domain, branch]);
  return rows.length ? (rows[0].name_he ?? branch) : null;
}

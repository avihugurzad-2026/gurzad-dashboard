import 'server-only';
import { db } from './db';
import { todayIL } from '@/lib/period';
import { canDeleteRow, canEditRow, requireUser, visibleSql, params, type SessionUser } from './auth';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Things typed into the dashboard: tasks, goals, household money. Vault tasks stay read-only
// and are listed next to these (source 'vault'). Missing tables (migration not applied yet)
// read as `ready: false`, never as an error page.
// Every query is filtered for the signed-in user in SQL (visibleSql), not in the screen.

export type { Domain, Place, Status } from '@/lib/places';
import { contextLabel, encodePlace, type Domain, type Place, type Status } from '@/lib/places';
import { fingerprint, similarity } from '@/lib/fingerprint';

// Names of everyone (for "who does it" labels)
export async function peopleNames(): Promise<Record<string, string>> {
  const u = await requireUser();
  const { rows } = await db().query(`SELECT DISTINCT us.id, us.name FROM users us
    WHERE us.id = $1 OR EXISTS (
      SELECT 1 FROM workspace_members mine JOIN workspace_members peer ON peer.workspace_id = mine.workspace_id
      WHERE mine.user_id = $1 AND mine.revoked_at IS NULL AND peer.user_id = us.id AND peer.revoked_at IS NULL
    )`, [u.id]);
  return Object.fromEntries(rows.map((r: any) => [r.id, r.name]));
}
export const PERSONAL_LISTS = [
  { key: 'home', label: 'בית' }, { key: 'personal', label: 'אישי' }, { key: 'study', label: 'לימודים' },
] as const;

export type WorkItem = {
  id: string; source: 'dashboard' | 'vault'; title: string; description: string | null;
  priority: 1 | 2 | 3 | 4; status: Status; waiting_on: string | null;
  due_date: string | null; due_time: string | null; owner: string | null; category_id: string | null;
  domain: string; branch: string | null; location: string | null; context: string;
  days_past: number | null; completed_at: string | null;
  assigned_to: string | null; scope: 'user' | 'shared'; event_id: string | null;
  can_edit: boolean; can_delete: boolean;   // for this user: which controls the row shows
  deleted_at?: string | null;
};
export type Goal = {
  id: string; title: string; unit: 'ils' | 'count' | 'pct'; target: number | null; current: number | null;
  due: string | null; status: 'active' | 'done' | 'dropped'; owner: string; location: string | null;
  goal_type: string | null; notes: string | null; scope: 'user' | 'shared'; domain: string; branch: string | null;
};
export type MoneyEntry = {
  id: string; kind: 'income' | 'expense'; amount: number; category: string;
  occurred_on: string; note: string | null; owner: string;
};

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';

type Filter = Partial<Place> & { domain?: Domain; category?: string | null };
type P = ReturnType<typeof params>;

function where(f: Filter, q: P) {
  const parts = ['deleted_at IS NULL'];
  if (f.domain) parts.push(`domain = ${q.p(f.domain)}`);
  if (f.branch) parts.push(`branch = ${q.p(f.branch)}`);
  if (f.location) parts.push(`location = ${q.p(f.location)}`);
  if (f.category) parts.push(`category_id = ${q.p(f.category)}`);
  return parts.join(' AND ');
}

// Vault tasks have no owner, scope or location: they are shared records of their place
const VAULT_TASKS = `(SELECT *, NULL::text AS location FROM tasks)`;
const vaultVisible = (u: SessionUser, alias: string, q: P) => visibleSql(u, 'task', alias, q.p, { owner: null, scope: null, assigned: null });

// Vault priority strings → P1..P4 (vault "high" is P2: urgent-but-not-on-fire by default)
const vaultPriority = (p: string | null): 1 | 2 | 3 | 4 => (/high|גבוה|1/i.test(p ?? '') ? 2 : /low|נמוך|3/i.test(p ?? '') ? 4 : 3);

const OPEN = `status NOT IN ('done', 'cancelled')`;

function fromRow(r: any, u: SessionUser): WorkItem {
  return {
    can_edit: canEditRow(u, 'task', r), can_delete: canDeleteRow(u, 'task', r),
    deleted_at: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
    id: r.id, source: 'dashboard', title: r.title, description: r.description, priority: r.priority, status: r.status,
    waiting_on: r.waiting_on, due_date: r.due_date, due_time: r.due_time, owner: r.owner_user_id, category_id: r.category_id,
    domain: r.domain, branch: r.branch, location: r.location, context: contextLabel(r, r.category_id),
    days_past: r.days_past === null ? null : Number(r.days_past),
    completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    assigned_to: r.assigned_to ?? null, scope: r.scope, event_id: r.event_id ?? null,
  };
}

const COLS = `id, title, description, priority, status, waiting_on, to_char(due_date, 'YYYY-MM-DD') AS due_date,
  to_char(due_time, 'HH24:MI') AS due_time, owner_user_id, category_id, domain, branch, location, completed_at,
  assigned_to, scope, event_id`;

// Tasks for one place (or everywhere when the filter is empty): dashboard rows plus read-only vault tasks.
// Done/cancelled rows stay in the open list for 7 days so a tick can be undone; with includeDone
// every closed task is returned (the board's "סגורות" view), so nothing closed is ever out of reach.
export async function workItems(p: Filter, { includeDone = false } = {}) {
  const u = await requireUser();
  const today = todayIL();
  const items: WorkItem[] = [];
  let ready = true;
  try {
    const q = params([today]);
    const w = where(p, q);
    // Dashboard and legacy vault tasks are independent reads. Starting them
    // together removes a request-time waterfall on Home, Today and task views.
    const dashboard = db().query(
      `SELECT ${COLS}, CASE WHEN due_date < $1::date AND ${OPEN} THEN ($1::date - due_date) END AS days_past
       FROM work_items WHERE ${w} AND ${visibleSql(u, 'task', '', q.p)}
         ${includeDone ? '' : `AND (${OPEN} OR completed_at > now() - interval '7 days')`}`,
      q.values);
    const vault = !p.location && !p.category ? vaultTasks(u, p, today) : Promise.resolve([] as WorkItem[]);
    const [dashboardResult, vaultResult] = await Promise.allSettled([dashboard, vault]);
    if (dashboardResult.status === 'fulfilled') {
      for (const r of dashboardResult.value.rows) items.push(fromRow(r, u));
    } else if (missing(dashboardResult.reason)) {
      ready = false;
    } else {
      throw dashboardResult.reason;
    }
    if (vaultResult.status === 'fulfilled') items.push(...vaultResult.value);
    else if (!missing(vaultResult.reason)) throw vaultResult.reason;
  } catch (e) {
    if (!missing(e)) throw e;
    ready = false;
  }
  const rank: Record<Status, number> = { in_progress: 0, todo: 1, waiting: 2, done: 3, cancelled: 4 };
  items.sort((a, b) => rank[a.status] - rank[b.status] || a.priority - b.priority
    || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.title.localeCompare(b.title, 'he'));
  return { ready, today, items };
}

async function vaultTasks(u: SessionUser, p: Filter, today: string): Promise<WorkItem[]> {
  const q = params([today]);
  let sql = `SELECT id, text AS title, priority, to_char(due, 'YYYY-MM-DD') AS due, domain, branch,
                    CASE WHEN due < $1 AND NOT done THEN ($1::date - due) END AS days_past
             FROM ${VAULT_TASKS} t WHERE deleted_at IS NULL AND NOT done AND ${vaultVisible(u, 't', q)}`;
  if (p.domain) sql += ` AND domain = ${q.p(p.domain)}`;
  if (p.branch) sql += ` AND branch = ${q.p(p.branch)}`;
  const { rows } = await db().query(sql, q.values);
  return rows.map((r: any) => {
    const place = { domain: r.domain, branch: r.domain === 'personal' ? null : r.branch, location: null };
    return {
      id: r.id, source: 'vault' as const, title: r.title, description: null, priority: vaultPriority(r.priority), status: 'todo' as const,
      waiting_on: null, due_date: r.due, due_time: null, owner: null, category_id: null, ...place,
      context: contextLabel(place, r.domain === 'personal' && r.branch === 'home' ? 'home' : null),
      days_past: r.days_past === null ? null : Number(r.days_past), completed_at: null,
      assigned_to: null, scope: 'shared' as const, event_id: null, can_edit: false, can_delete: false,
    };
  });
}

// Deleted tasks of one place this user may bring back (the board's "סל מחזור"), newest first
export async function deletedWorkItems(p: Filter): Promise<WorkItem[]> {
  const u = await requireUser();
  try {
    const q = params();
    const parts = ['deleted_at IS NOT NULL', `deleted_at > now() - interval '180 days'`];
    if (p.domain) parts.push(`domain = ${q.p(p.domain)}`);
    if (p.branch) parts.push(`branch = ${q.p(p.branch)}`);
    if (p.location) parts.push(`location = ${q.p(p.location)}`);
    if (p.category) parts.push(`category_id = ${q.p(p.category)}`);
    const { rows } = await db().query(
      `SELECT ${COLS}, deleted_at, NULL::int AS days_past FROM work_items
       WHERE ${parts.join(' AND ')} AND ${visibleSql(u, 'task', '', q.p)} ORDER BY deleted_at DESC LIMIT 100`, q.values);
    return rows.map((r: any) => fromRow(r, u)).filter(i => i.can_delete);
  } catch (e) {
    if (!missing(e)) throw e;
    return [];
  }
}

// The four groups on Home. A task sits in exactly one: waiting → overdue → today → needs attention.
export async function taskGroups() {
  const { ready, today, items } = await workItems({});
  const open = items.filter(i => i.status !== 'done' && i.status !== 'cancelled');
  const waiting = open.filter(i => i.status === 'waiting');
  const rest = open.filter(i => i.status !== 'waiting');
  const overdue = rest.filter(i => i.days_past);
  const dueToday = rest.filter(i => i.due_date === today);
  const attention = rest.filter(i => !i.days_past && i.due_date !== today && (i.priority <= 2 || i.status === 'in_progress'));
  const byTime = (a: WorkItem, b: WorkItem) => (a.due_time ?? '99').localeCompare(b.due_time ?? '99') || a.priority - b.priority;
  return {
    ready, today,
    urgent: open.filter(i => i.priority <= 2).length, overdue_count: overdue.length,
    groups: { attention, overdue, today: dueToday.sort(byTime), waiting },
  };
}

// Tasks due on one day (and, for today, everything overdue), for the Today page and the week strip
export async function tasksBetween(start: string, end: string) {
  const { items } = await workItems({});
  return items.filter(i => i.due_date && i.due_date >= start && i.due_date <= end && i.status !== 'cancelled');
}

export async function goalsFor(p: Partial<Place>, { withDropped = false } = {}) {
  const u = await requireUser();
  try {
    const q = params();
    const w = where(p, q);
    const { rows } = await db().query(
      `SELECT id, title, unit, target::float, current::float, to_char(due, 'YYYY-MM-DD') AS due, status, owner_user_id AS owner,
              location, goal_type, notes, scope, domain, branch
       FROM goals WHERE ${w} ${withDropped ? '' : `AND status <> 'dropped'`} AND ${visibleSql(u, 'goal', '', q.p)}
       ORDER BY status, due NULLS LAST, created_at`, q.values);
    return { ready: true, goals: rows as Goal[] };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, goals: [] as Goal[] };
  }
}

// One month of the shared household book, plus 6-month totals for the trend line
export async function householdMonth(month: string /* YYYY-MM */) {
  const start = `${month}-01`;
  const u = await requireUser();
  try {
    const q = params([start]);
    const vis = visibleSql(u, 'money', '', q.p);
    const { rows } = await db().query(
      `SELECT id, kind, amount::float, category, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, note, owner_user_id AS owner
       FROM money_entries WHERE book = 'shared' AND deleted_at IS NULL AND ${vis}
         AND occurred_on >= $1::date AND occurred_on < ($1::date + interval '1 month')
       ORDER BY occurred_on DESC, created_at DESC`, q.values);
    const { rows: months } = await db().query(
      `SELECT to_char(date_trunc('month', occurred_on), 'YYYY-MM') AS month,
              SUM(amount) FILTER (WHERE kind = 'income')::float AS income,
              SUM(amount) FILTER (WHERE kind = 'expense')::float AS expense
       FROM money_entries WHERE book = 'shared' AND deleted_at IS NULL AND ${vis}
         AND occurred_on >= ($1::date - interval '5 months')
       GROUP BY 1 ORDER BY 1`, q.values);
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
  const u = await requireUser();
  const today = todayIL();
  const out: Record<string, { open: number; overdue: number }> = {};
  const add = (k: string, overdue: boolean) => { out[k] ??= { open: 0, overdue: 0 }; out[k].open++; if (overdue) out[k].overdue++; };
  try {
    const q = params([today]);
    const { rows } = await db().query(
      `SELECT domain, branch, location, category_id AS list, (due_date < $1::date) AS overdue
       FROM work_items WHERE deleted_at IS NULL AND status NOT IN ('done', 'cancelled') AND ${visibleSql(u, 'task', '', q.p)}`, q.values);
    for (const r of rows) {
      add(r.domain, r.overdue);
      if (r.branch) add(`${r.domain}/${r.branch}`, r.overdue);
      if (r.branch && r.location) add(`${r.domain}/${r.branch}/${r.location}`, r.overdue);
      if (r.list) add(`${r.domain}:${r.list}`, r.overdue);
    }
  } catch (e) { if (!missing(e)) throw e; }
  const q = params([today]);
  const { rows } = await db().query(
    `SELECT domain, branch, (due < $1::date) AS overdue FROM ${VAULT_TASKS} t
     WHERE deleted_at IS NULL AND NOT done AND ${vaultVisible(u, 't', q)}`, q.values);
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

// ── Inbox ─────────────────────────────────────────────────────────────────────
export type InboxItem = {
  id: string; raw_text: string | null; status: 'unclassified' | 'classified'; created_at: string;
  file: { id: string; name: string; mime: string; size: number } | null;
  classified: { context: string; module: string | null; at: string | null } | null;
  // Smart Inbox: how the user filed the most similar earlier item
  suggestion: { place: string; category: string | null; module: string; from: string } | null;
};

// Inbox items have no place until classified; they belong to whoever captured them
const inboxVisible = (u: SessionUser, q: P) =>
  `(i.created_by = ${q.p(u.id)} OR (i.scope = 'shared' AND ${u.isAdmin ? 'TRUE' : 'FALSE'}))`;

export async function inbox() {
  const u = await requireUser();
  const q = params();
  const { rows } = await db().query(
    `SELECT i.id, i.raw_text, i.status, i.created_at, i.classified_domain, i.classified_branch, i.classified_location,
            i.classified_module, i.classified_at, i.classified_category, i.fingerprint,
            f.id AS file_id, f.name AS file_name, f.mime, f.size_bytes
     FROM inbox_items i LEFT JOIN files f ON f.id = i.file_id
     WHERE i.deleted_at IS NULL AND (i.status = 'unclassified' OR i.classified_at > now() - interval '14 days')
       AND ${inboxVisible(u, q)}
     ORDER BY i.created_at DESC LIMIT 200`, q.values);
  const items: InboxItem[] = rows.map((r: any) => ({
    id: r.id, raw_text: r.raw_text, status: r.status, created_at: new Date(r.created_at).toISOString(),
    file: r.file_id ? { id: r.file_id, name: r.file_name, mime: r.mime, size: r.size_bytes } : null,
    classified: r.status === 'classified' ? {
      context: contextLabel({ domain: r.classified_domain, branch: r.classified_branch, location: r.classified_location }),
      module: r.classified_module, at: r.classified_at ? new Date(r.classified_at).toISOString() : null,
    } : null,
    suggestion: null,
  }));
  const open = items.filter(i => i.status === 'unclassified');
  if (open.length) {
    // The user's own past decisions (last 300), most recent first
    const { rows: past } = await db().query(
      `SELECT i.fingerprint, i.raw_text, f.name AS file_name, i.classified_domain, i.classified_branch, i.classified_location,
              i.classified_category, i.classified_module, (i.file_id IS NOT NULL) AS has_file
       FROM inbox_items i LEFT JOIN files f ON f.id = i.file_id
       WHERE i.created_by = $1 AND i.status = 'classified' AND i.deleted_at IS NULL AND i.classified_domain IS NOT NULL
       ORDER BY i.classified_at DESC LIMIT 300`, [u.id]);
    const prints = past.map((r: any) => ({ r, fp: r.fingerprint || fingerprint(r.file_name ?? r.raw_text) }));
    for (const item of open) {
      const raw = rows.find((r: any) => r.id === item.id);
      const fp = raw?.fingerprint || fingerprint(item.file?.name ?? item.raw_text);
      let best: { r: any; score: number } | null = null;
      for (const p of prints) {
        if (Boolean(item.file) !== p.r.has_file) continue;            // files with files, text with text
        const score = similarity(fp, p.fp);
        if (score >= 0.5 && (!best || score > best.score)) best = { r: p.r, score };
      }
      if (best) {
        const r = best.r;
        item.suggestion = {
          place: encodePlace({ domain: r.classified_domain, branch: r.classified_branch, location: r.classified_location }),
          category: r.classified_category, module: r.classified_module,
          from: (r.file_name ?? r.raw_text ?? '').slice(0, 60),
        };
      }
    }
  }
  return { open, recent: items.filter(i => i.status === 'classified') };
}

export async function inboxCount(): Promise<number> {
  const u = await requireUser();
  try {
    const q = params();
    const { rows } = await db().query(
      `SELECT count(*)::int AS n FROM inbox_items i WHERE status = 'unclassified' AND deleted_at IS NULL AND ${inboxVisible(u, q)}`, q.values);
    return rows[0].n;
  } catch (e) {
    if (missing(e)) return 0;
    throw e;
  }
}

// ── Search (titles and inbox text; plain ILIKE, enough for one person's data) ──
export async function search(text: string) {
  const u = await requireUser();
  const like = `%${text.replace(/[\\%_]/g, m => `\\${m}`)}%`;
  const q1 = params([like]), q2 = params([like]), q3 = params([like]), q4 = params([like]);
  const [tasks, vault, inboxRows, events] = await Promise.all([
    db().query(`SELECT ${COLS}, NULL AS days_past FROM work_items WHERE deleted_at IS NULL AND (title ILIKE $1 OR description ILIKE $1)
                AND ${visibleSql(u, 'task', '', q1.p)} ORDER BY updated_at DESC LIMIT 30`, q1.values),
    db().query(`SELECT id, text, domain, branch FROM ${VAULT_TASKS} t WHERE deleted_at IS NULL AND text ILIKE $1
                AND ${vaultVisible(u, 't', q2)} LIMIT 20`, q2.values),
    db().query(`SELECT i.id, coalesce(i.raw_text, f.name) AS text, i.status FROM inbox_items i LEFT JOIN files f ON f.id = i.file_id
                WHERE i.deleted_at IS NULL AND (i.raw_text ILIKE $1 OR f.name ILIKE $1) AND ${inboxVisible(u, q3)}
                ORDER BY i.created_at DESC LIMIT 20`, q3.values),
    db().query(`SELECT id, title, start_at FROM events e WHERE deleted_at IS NULL AND status <> 'cancelled' AND title ILIKE $1
                AND ${visibleSql(u, 'event', 'e', q4.p)} ORDER BY start_at DESC LIMIT 20`, q4.values),
  ]);
  return {
    tasks: tasks.rows.map((r: any) => fromRow(r, u)),
    vault: vault.rows.map((r: any) => ({ id: r.id, text: r.text, context: contextLabel({ domain: r.domain, branch: r.domain === 'personal' ? null : r.branch, location: null }) })),
    inbox: inboxRows.rows.map((r: any) => ({ id: r.id, text: r.text as string, status: r.status as string })),
    events: events.rows.map((r: any) => ({ id: r.id, title: r.title as string, start_at: new Date(r.start_at).toISOString() })),
  };
}

export async function profile() {
  const { rows } = await db().query(`SELECT id, name, email, active FROM users ORDER BY active DESC, id`);
  return rows as { id: string; name: string; email: string | null; active: boolean }[];
}

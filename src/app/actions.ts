'use server';
import { revalidatePath } from 'next/cache';
import { canCreateIn, canDeleteRow, canEditRow, currentUser, type Kind, type SessionUser } from '@/server/auth';
import { createHash } from 'node:crypto';
import { db } from '@/server/db';
import money from '@domain/money';
import { CATEGORIES, decodePlace } from '@/lib/places';
import { fingerprint } from '@/lib/fingerprint';
import { createEventForTask, removeEventForTask } from '@/server/calendar';

// Writes from the dashboard's own forms. Supabase only; the vault is never written.
// Every action resolves the signed-in user, checks their role for the place and the row,
// validates its input, and soft-deletes.

export type ActionResult = { ok: true; warning?: string } | { ok: false; error: string };

const DOMAINS = new Set(['business', 'personal', 'household', 'ventures']);
const STATUS = new Set(['todo', 'in_progress', 'waiting', 'done', 'cancelled']);
const GOAL_TYPES = new Set(['personal', 'business', 'branch', 'financial', 'study', 'ventures']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const NO_ACCESS: ActionResult = { ok: false, error: 'אין לך הרשאה לזה' };
const NOT_SIGNED_IN: ActionResult = { ok: false, error: 'לא מחובר' };

// The signed-in user, or an error result
async function actor(): Promise<SessionUser | ActionResult> {
  return (await currentUser()) ?? NOT_SIGNED_IN;
}
const isUser = (a: SessionUser | ActionResult): a is SessionUser => 'memberships' in a;

async function activeUser(id: string): Promise<boolean> {
  const { rows } = await db().query(`SELECT 1 FROM users WHERE id = $1 AND active`, [id]);
  return rows.length > 0;
}

type RowRef = { domain: string | null; branch: string | null; location: string | null; owner_user_id: string; scope: string; assigned_to: string | null; event_id: string | null };

// A row's place, owner and scope, for a permission check
async function rowOf(table: 'work_items' | 'goals' | 'inbox_items', id: string): Promise<RowRef | undefined> {
  const cols = {
    work_items: `domain, branch, location, owner_user_id, scope, assigned_to, event_id`,
    goals: `domain, branch, location, owner_user_id, scope, NULL::text AS assigned_to, NULL::uuid AS event_id`,
    inbox_items: `classified_domain AS domain, classified_branch AS branch, classified_location AS location,
                  created_by AS owner_user_id, scope, NULL::text AS assigned_to, NULL::uuid AS event_id`,
  }[table];
  const { rows } = await db().query(`SELECT ${cols} FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return rows[0];
}

async function mayEdit(u: SessionUser, kind: Kind, table: 'work_items' | 'goals', id: string) {
  const row = await rowOf(table, id);
  return row && canEditRow(u, kind, row) ? row : null;
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

async function log(u: SessionUser, objectType: string, objectId: string, action: string, metadata: Record<string, unknown> = {}) {
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, $2, $3, $4, $5)`,
    [u.id, objectType, objectId, action, JSON.stringify(metadata)]);
}

// Where an item belongs: either one `place` field ("domain|branch|location") or separate fields
async function place(f: FormData): Promise<{ domain: string; branch: string | null; location: string | null } | string> {
  let domain = str(f, 'domain'), branch = str(f, 'branch'), location = str(f, 'location');
  const packed = str(f, 'place');
  if (packed) {
    const p = decodePlace(packed);
    if (!p) return 'שיוך לא תקין';
    ({ domain, branch, location } = p);
  }
  if (!domain || !DOMAINS.has(domain)) return 'אזור לא תקין';
  if (branch) {
    const { rows } = await db().query(`SELECT 1 FROM branches WHERE domain = $1 AND branch = $2`, [domain, branch]);
    if (!rows.length) return 'עסק לא תקין';
  }
  if (location) {
    if (!branch) return 'סניף בלי עסק';
    const { rows } = await db().query(`SELECT 1 FROM locations WHERE branch = $1 AND location = $2`, [branch, location]);
    if (!rows.length) return 'סניף לא תקין';
  }
  return { domain, branch, location };
}

function done(path: string | null): ActionResult {
  // A task mutation should refresh the active task surface, not remount the
  // application layout and refetch navigation, finance and integrations.
  revalidatePath(path && path.startsWith('/') ? path : '/');
  return { ok: true };
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export async function addTask(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  const title = str(f, 'title');
  if (!title || title.length > 300) return { ok: false, error: 'צריך כותרת (עד 300 תווים)' };
  // "Send to Inbox" from the quick add: keep the text unclassified
  if (str(f, 'mode') === 'inbox') {
    const { rows } = await db().query(
      `INSERT INTO inbox_items (raw_text, created_by, fingerprint) VALUES ($1, $2, $3) RETURNING id`, [title, u.id, fingerprint(title)]);
    await log(u, 'inbox_item', rows[0].id, 'create');
    return done(str(f, 'path'));
  }
  const p = await place(f); if (typeof p === 'string') return { ok: false, error: p };
  if (!canCreateIn(u, p, 'task')) return NO_ACCESS;
  const priority = Number(str(f, 'priority') ?? 3);
  if (![1, 2, 3, 4].includes(priority)) return { ok: false, error: 'עדיפות לא תקינה' };
  const category = str(f, 'category') ?? 'general';
  if (!CATEGORIES.some(c => c.id === category && (c.domain === null || c.domain === p.domain))) return { ok: false, error: 'קטגוריה לא תקינה' };
  const due = str(f, 'due_date');
  if (due && !DATE.test(due)) return { ok: false, error: 'תאריך לא תקין' };
  const time = str(f, 'due_time');
  if (time && (!TIME.test(time) || !due)) return { ok: false, error: 'שעה צריכה תאריך' };
  const status = str(f, 'status') ?? 'todo';
  if (!STATUS.has(status)) return { ok: false, error: 'סטטוס לא תקין' };
  const description = str(f, 'description');
  if (description && description.length > 4000) return { ok: false, error: 'התיאור ארוך מדי' };
  // Who does it: yourself by default. Handing it to someone else makes it shared, so they see it.
  const assigned = str(f, 'assigned_to') ?? str(f, 'owner');
  if (p.domain === 'personal' && ((assigned && assigned !== u.id) || str(f, 'scope') === 'shared')) return NO_ACCESS;
  if (assigned && assigned !== u.id && !(await activeUser(assigned))) return { ok: false, error: 'אחראי לא תקין' };
  const handedOver = Boolean(assigned && assigned !== u.id);
  const scope = handedOver || str(f, 'scope') === 'shared' ? 'shared' : 'user';
  if (scope === 'shared' && !u.isOwner && !canCreateIn(u, p, 'task')) return NO_ACCESS;
  const { rows } = await db().query(
    `INSERT INTO work_items (domain, branch, location, category_id, title, description, priority, status, due_date, due_time,
                             owner_user_id, assigned_to, scope)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [p.domain, p.branch, p.location, category, title, description, priority, status, due, time,
      u.id, handedOver ? assigned : null, scope]);
  const id = rows[0].id as string;
  await log(u, 'task', id, 'create', { place: p, scope, assigned_to: handedOver ? assigned : null });
  // "Show on calendar": a timed task becomes a calendar event too (best effort; the task is saved either way)
  if (str(f, 'show_in_calendar') === 'on' && due && time) {
    const r = await createEventForTask(u, { id, title, due_date: due, due_time: time, domain: p.domain, branch: p.branch, location: p.location, scope })
      .catch(() => ({ ok: false as const, error: 'calendar' }));
    // Saved: report ok (so the form closes and nobody types it again), with a warning about the calendar
    if (!r.ok) return { ...done(str(f, 'path')), warning: 'המשימה נשמרה, אבל לא נוספה ליומן (בדוק את חיבור היומן בהגדרות)' } as ActionResult;
  }
  return done(str(f, 'path'));
}

export async function setTaskStatus(id: string, status: string, path: string): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  if (!UUID.test(id) || !STATUS.has(status)) return { ok: false, error: 'בקשה לא תקינה' };
  if (!(await mayEdit(u, 'task', 'work_items', id))) return NO_ACCESS;
  await db().query(
    `UPDATE work_items SET status = $2, updated_at = now(),
       completed_at = CASE WHEN $2 IN ('done', 'cancelled') THEN coalesce(completed_at, now()) END
     WHERE id = $1 AND deleted_at IS NULL`, [id, status]);
  await log(u, 'task', id, 'status', { status });
  return done(path);
}

export async function setTaskPriority(id: string, priority: number, path: string): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  if (!UUID.test(id) || ![1, 2, 3, 4].includes(priority)) return { ok: false, error: 'בקשה לא תקינה' };
  if (!(await mayEdit(u, 'task', 'work_items', id))) return NO_ACCESS;
  await db().query(`UPDATE work_items SET priority = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id, priority]);
  await log(u, 'task', id, 'priority', { priority });
  return done(path);
}

export async function removeTask(id: string, path: string): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  if (!UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  const row = await rowOf('work_items', id);
  if (!row || !canDeleteRow(u, 'task', row)) return NO_ACCESS;
  await db().query(`UPDATE work_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (row.event_id) await removeEventForTask(u, id).catch(() => {});
  await log(u, 'task', id, 'delete');
  return done(path);
}

// ── Inbox ─────────────────────────────────────────────────────────────────────
const MAX_FILE = 4 * 1024 * 1024;

export async function addInbox(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  const text = str(f, 'text');
  if (text && text.length > 4000) return { ok: false, error: 'הטקסט ארוך מדי' };
  const file = f.get('file');
  const hasFile = file instanceof File && file.size > 0;
  if (!text && !hasFile) return { ok: false, error: 'כתוב משהו או צרף קובץ' };
  let fileId: string | null = null;
  let name: string | null = null;
  if (hasFile) {
    if (file.size > MAX_FILE) return { ok: false, error: 'הקובץ גדול מ-4MB' };
    name = (file.name || 'קובץ').slice(0, 200);
    const buf = Buffer.from(await file.arrayBuffer());
    const sha = createHash('sha256').update(buf).digest('hex');
    const { rows } = await db().query(
      `INSERT INTO files (name, mime, size_bytes, sha256, data, owner_user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, (file.type || 'application/octet-stream').slice(0, 100), buf.length, sha, buf, u.id]);
    fileId = rows[0].id;
  }
  const { rows } = await db().query(
    `INSERT INTO inbox_items (raw_text, file_id, created_by, fingerprint) VALUES ($1, $2, $3, $4) RETURNING id`,
    [text, fileId, u.id, fingerprint(name ?? text)]);
  await log(u, 'inbox_item', rows[0].id, 'create', { file: Boolean(fileId) });
  return done('/inbox');
}

// Classify: file it under a place, a category and a module. "task" also creates the task.
export async function classifyInbox(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  const id = str(f, 'id');
  if (!id || !UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  const p = await place(f); if (typeof p === 'string') return { ok: false, error: p };
  if (!canCreateIn(u, p, 'task')) return NO_ACCESS;
  const module = str(f, 'module');
  if (!module || !['task', 'note', 'document'].includes(module)) return { ok: false, error: 'בחר מה זה' };
  const category = str(f, 'category') ?? 'general';
  if (!CATEGORIES.some(c => c.id === category && (c.domain === null || c.domain === p.domain))) return { ok: false, error: 'קטגוריה לא תקינה' };
  const { rows: items } = await db().query(
    `SELECT i.raw_text, i.created_by, i.scope, f.name AS file_name FROM inbox_items i LEFT JOIN files f ON f.id = i.file_id
     WHERE i.id = $1 AND i.deleted_at IS NULL AND i.status = 'unclassified'`, [id]);
  if (!items.length) return { ok: false, error: 'הפריט כבר סווג' };
  if (items[0].created_by !== u.id && !(items[0].scope === 'shared' && u.isAdmin)) return NO_ACCESS;
  let objectId: string | null = null;
  if (module === 'task') {
    const title = (str(f, 'title') ?? items[0].raw_text ?? items[0].file_name ?? 'משימה מה-Inbox').slice(0, 300);
    const { rows } = await db().query(
      `INSERT INTO work_items (domain, branch, location, category_id, title, owner_user_id, inbox_item_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [p.domain, p.branch, p.location, category, title, u.id, id]);
    objectId = rows[0].id;
  }
  await db().query(
    `UPDATE inbox_items SET status = 'classified', classified_domain = $2, classified_branch = $3, classified_location = $4,
       classified_module = $5, classified_object_id = $6, classified_category = $7, classified_at = now() WHERE id = $1`,
    [id, p.domain, p.branch, p.location, module, objectId, category]);
  await log(u, 'inbox_item', id, 'classify', { place: p, module, category });
  return done('/inbox');
}

export async function removeInbox(id: string): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  if (!UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  const row = await rowOf('inbox_items', id);
  if (!row || (row.owner_user_id !== u.id && !u.isOwner)) return NO_ACCESS;
  await db().query(`UPDATE inbox_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  await log(u, 'inbox_item', id, 'delete');
  return done('/inbox');
}

// ── Goals ─────────────────────────────────────────────────────────────────────
// Typed numbers; anything beyond numeric(14,2) is refused here rather than failing in the database
const num = (v: string | null) => { const n = money.parseNumber(v); return n !== null && Math.abs(n) >= 1e12 ? NaN : n; };

// Spec 2.6 types; a goal without one gets the obvious type for its place
function defaultGoalType(p: { domain: string; branch: string | null; location: string | null }, unit: string): string {
  if (p.location) return 'branch';
  if (p.domain === 'ventures') return 'ventures';
  if (p.domain === 'business') return 'business';
  return unit === 'ils' ? 'financial' : 'personal';
}

export async function addGoal(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  const p = await place(f); if (typeof p === 'string') return { ok: false, error: p };
  if (!canCreateIn(u, p, 'goal')) return NO_ACCESS;
  const title = str(f, 'title');
  if (!title || title.length > 300) return { ok: false, error: 'צריך כותרת ליעד' };
  const unit = str(f, 'unit') ?? 'ils';
  if (!['ils', 'count', 'pct'].includes(unit)) return { ok: false, error: 'יחידה לא תקינה' };
  const target = num(str(f, 'target'));
  if (target !== null && !Number.isFinite(target)) return { ok: false, error: 'יעד מספרי לא תקין' };
  const current = num(str(f, 'current'));
  if (current !== null && !Number.isFinite(current)) return { ok: false, error: 'ערך נוכחי לא תקין' };
  const due = str(f, 'due');
  if (due && !DATE.test(due)) return { ok: false, error: 'תאריך לא תקין' };
  const owner = str(f, 'owner') ?? u.id;
  if (p.domain === 'personal' && (owner !== u.id || str(f, 'scope') === 'shared')) return NO_ACCESS;
  if (owner !== u.id && !(await activeUser(owner))) return { ok: false, error: 'אחראי לא תקין' };
  const goalType = str(f, 'goal_type') ?? defaultGoalType(p, unit);
  if (!GOAL_TYPES.has(goalType)) return { ok: false, error: 'סוג יעד לא תקין' };
  const notes = str(f, 'notes');
  if (notes && notes.length > 1000) return { ok: false, error: 'ההערות ארוכות מדי' };
  const scope = owner !== u.id || str(f, 'scope') === 'shared' ? 'shared' : 'user';
  const { rows } = await db().query(
    `INSERT INTO goals (domain, branch, location, title, unit, target, current, due, owner_user_id, goal_type, notes, scope)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [p.domain, p.branch, p.location, title, unit, target, current, due, owner, goalType, notes, scope]);
  await log(u, 'goal', rows[0].id, 'create', { place: p, goal_type: goalType });
  return done(str(f, 'path'));
}

export async function updateGoalCurrent(id: string, current: number | null, path: string): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  if (!UUID.test(id) || (current !== null && !Number.isFinite(current))) return { ok: false, error: 'ערך לא תקין' };
  if (!(await mayEdit(u, 'goal', 'goals', id))) return NO_ACCESS;
  await db().query(`UPDATE goals SET current = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id, current]);
  await log(u, 'goal', id, 'progress', { current });
  return done(path);
}

export async function setGoalStatus(id: string, status: 'active' | 'done' | 'dropped', path: string): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  if (!UUID.test(id) || !['active', 'done', 'dropped'].includes(status)) return { ok: false, error: 'בקשה לא תקינה' };
  if (!(await mayEdit(u, 'goal', 'goals', id))) return NO_ACCESS;
  await db().query(`UPDATE goals SET status = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id, status]);
  await log(u, 'goal', id, 'status', { status });
  return done(path);
}

// ── Household money ───────────────────────────────────────────────────────────
export async function addMoney(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  if (!u.isAdmin) return NO_ACCESS; // the old household book; replaced by transactions
  const kind = str(f, 'kind');
  if (kind !== 'income' && kind !== 'expense') return { ok: false, error: 'בחר הכנסה או הוצאה' };
  const amount = num(str(f, 'amount'));
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'סכום חייב להיות גדול מ-0' };
  const category = str(f, 'category');
  if (!category || category.length > 60) return { ok: false, error: 'צריך קטגוריה' };
  const on = str(f, 'occurred_on');
  if (!on || !DATE.test(on)) return { ok: false, error: 'צריך תאריך' };
  const owner = str(f, 'owner') ?? u.id;
  if (owner !== u.id) return NO_ACCESS;
  if (owner !== u.id && !(await activeUser(owner))) return { ok: false, error: 'לא תקין' };
  const note = str(f, 'note');
  if (note && note.length > 500) return { ok: false, error: 'ההערה ארוכה מדי' };
  await db().query(
    `INSERT INTO money_entries (kind, amount, category, occurred_on, note, owner_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [kind, amount, category, on, note, owner]);
  return done(str(f, 'path'));
}

export async function removeMoney(id: string, path: string): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  if (!u.isAdmin) return NO_ACCESS; // the old household book; replaced by transactions
  if (!UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(`UPDATE money_entries SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return done(path);
}

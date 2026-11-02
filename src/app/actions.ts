'use server';
import { revalidatePath } from 'next/cache';
import { canCreateIn, canDeleteRow, canEditRow, canManageIn, currentUser, userCanSee, type Kind, type SessionUser } from '@/server/auth';
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

// Who does a task. Personal rows are private to their creator, so they can't be handed to anyone;
// elsewhere the person must be able to see the place.
async function checkAssignee(u: SessionUser, p: { domain: string; branch: string | null; location: string | null }, assigned: string | null): Promise<string | null> {
  if (!assigned || assigned === u.id) return null;
  if (p.domain === 'personal') return 'משימה אישית נשארת שלך. לשיתוף, שייך אותה למשק הבית או לעסק.';
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(assigned) || !(await activeUser(assigned))) return 'אחראי לא תקין';
  if (!(await userCanSee(assigned, p, 'task'))) return 'לאדם הזה אין גישה למקום הזה';
  return null;
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
  if (p.domain === 'personal' && str(f, 'scope') === 'shared') return NO_ACCESS;
  const bad = await checkAssignee(u, p, assigned); if (bad) return { ok: false, error: bad };
  const handedOver = Boolean(assigned && assigned !== u.id);
  if (handedOver && !canManageIn(u, p, 'task')) return { ok: false, error: 'אין לך הרשאה להעביר משימות לאחרים כאן' };
  // Household rows are the household's: every member sees and updates them
  const scope = p.domain === 'household' || handedOver || str(f, 'scope') === 'shared' ? 'shared' : 'user';
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
  const row = await mayEdit(u, 'task', 'work_items', id);
  if (!row) return NO_ACCESS;
  await db().query(
    `UPDATE work_items SET status = $2, updated_at = now(),
       completed_at = CASE WHEN $2 IN ('done', 'cancelled') THEN coalesce(completed_at, now()) END
     WHERE id = $1 AND deleted_at IS NULL`, [id, status]);
  await log(u, 'task', id, 'status', { status });
  // A closed task leaves the calendar
  if (row.event_id && (status === 'done' || status === 'cancelled')) {
    const r = await removeEventForTask(u, id).catch(() => ({ ok: false as const }));
    if (!r.ok) return { ...done(path), warning: 'המשימה עודכנה, אבל האירוע שלה ביומן לא נמחק' } as ActionResult;
  }
  return done(path);
}

// Edit a task: text, category, priority, status, due date/time, who does it, who it waits on.
// Its place stays as it is. A linked calendar event follows the new title and time.
export async function updateTask(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  const id = str(f, 'id');
  if (!id || !UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  const { rows: found } = await db().query(
    `SELECT domain, branch, location, owner_user_id, scope, assigned_to, event_id, status, title,
            to_char(due_date, 'YYYY-MM-DD') AS due_date, to_char(due_time, 'HH24:MI') AS due_time
     FROM work_items WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const row = found[0];
  if (!row || !canEditRow(u, 'task', row)) return NO_ACCESS;
  const p = { domain: row.domain as string, branch: row.branch as string | null, location: row.location as string | null };
  const title = str(f, 'title');
  if (!title || title.length > 300) return { ok: false, error: 'צריך כותרת (עד 300 תווים)' };
  const description = str(f, 'description');
  if (description && description.length > 4000) return { ok: false, error: 'התיאור ארוך מדי' };
  const priority = Number(str(f, 'priority') ?? 3);
  if (![1, 2, 3, 4].includes(priority)) return { ok: false, error: 'עדיפות לא תקינה' };
  const category = str(f, 'category') ?? 'general';
  if (!CATEGORIES.some(c => c.id === category && (c.domain === null || c.domain === p.domain))) return { ok: false, error: 'קטגוריה לא תקינה' };
  const status = str(f, 'status') ?? 'todo';
  if (!STATUS.has(status)) return { ok: false, error: 'סטטוס לא תקין' };
  const due = str(f, 'due_date');
  if (due && !DATE.test(due)) return { ok: false, error: 'תאריך לא תקין' };
  const time = str(f, 'due_time');
  if (time && (!TIME.test(time) || !due)) return { ok: false, error: 'שעה צריכה תאריך' };
  const waitingOn = status === 'waiting' ? str(f, 'waiting_on') : null;
  if (waitingOn && waitingOn.length > 100) return { ok: false, error: '"ממתין ל" ארוך מדי' };
  // Who does it (NULL = the task's owner). Handing it over needs the same right as when adding.
  const assignedIn = f.has('assigned_to') ? (str(f, 'assigned_to') ?? row.owner_user_id) : (row.assigned_to ?? row.owner_user_id);
  const assigned: string | null = assignedIn === row.owner_user_id ? null : assignedIn;
  if (assigned !== (row.assigned_to ?? null) && assigned !== null) {
    if (!canManageIn(u, p, 'task')) return { ok: false, error: 'אין לך הרשאה להעביר את המשימה' };
    const bad = await checkAssignee(u, p, assigned); if (bad) return { ok: false, error: bad };
  }
  const scope = p.domain === 'household' || assigned ? 'shared' : row.scope;
  await db().query(
    `UPDATE work_items SET title = $2, description = $3, priority = $4, category_id = $5, status = $6, due_date = $7, due_time = $8,
       waiting_on = $9, assigned_to = $10, scope = $11, updated_at = now(),
       completed_at = CASE WHEN $6 IN ('done', 'cancelled') THEN coalesce(completed_at, now()) END
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, title, description, priority, category, status, due, time, waitingOn, assigned, scope]);
  await log(u, 'task', id, 'update', { status, assigned_to: assigned });
  if (row.event_id) {
    const closed = status === 'done' || status === 'cancelled';
    const moved = row.title !== title || row.due_date !== due || row.due_time !== time;
    if (closed || !due || (moved)) {
      const r = closed || !due
        ? await removeEventForTask(u, id).catch(() => ({ ok: false as const }))
        : await createEventForTask(u, { id, title, due_date: due, due_time: time, ...p, scope }).catch(() => ({ ok: false as const }));
      if (!r.ok) return { ...done(str(f, 'path')), warning: 'המשימה נשמרה, אבל האירוע שלה ביומן לא עודכן' } as ActionResult;
    }
  }
  return done(str(f, 'path'));
}

// Undo a delete (from the trash list). Same rule as deleting.
export async function restoreTask(id: string, path: string): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  if (!UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  const { rows } = await db().query(
    `SELECT domain, branch, location, owner_user_id, scope FROM work_items WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
  if (!rows[0] || !canDeleteRow(u, 'task', rows[0])) return NO_ACCESS;
  await db().query(`UPDATE work_items SET deleted_at = NULL, updated_at = now() WHERE id = $1`, [id]);
  await log(u, 'task', id, 'restore');
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
  await log(u, 'task', id, 'delete');
  if (row.event_id) {
    const r = await removeEventForTask(u, id).catch(() => ({ ok: false as const }));
    if (!r.ok) return { ...done(path), warning: 'המשימה נמחקה, אבל האירוע שלה ביומן לא נמחק' } as ActionResult;
  }
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
  if (!module || !['task', 'document'].includes(module)) return { ok: false, error: 'בחר מה זה' };
  const category = str(f, 'category') ?? 'general';
  if (!CATEGORIES.some(c => c.id === category && (c.domain === null || c.domain === p.domain))) return { ok: false, error: 'קטגוריה לא תקינה' };
  const { rows: items } = await db().query(
    `SELECT i.raw_text, i.created_by, i.scope, i.file_id, f.name AS file_name FROM inbox_items i LEFT JOIN files f ON f.id = i.file_id
     WHERE i.id = $1 AND i.deleted_at IS NULL AND i.status = 'unclassified'`, [id]);
  if (!items.length) return { ok: false, error: 'הפריט כבר סווג' };
  if (items[0].created_by !== u.id && !(items[0].scope === 'shared' && u.isAdmin)) return NO_ACCESS;
  let objectId: string | null = null;
  // Household rows are shared with the household; elsewhere a filed item stays the filer's own
  const scope = p.domain === 'household' ? 'shared' : 'user';
  if (module === 'task') {
    const title = (str(f, 'title') ?? items[0].raw_text ?? items[0].file_name ?? 'משימה מה-Inbox').slice(0, 300);
    const { rows } = await db().query(
      `INSERT INTO work_items (domain, branch, location, category_id, title, owner_user_id, inbox_item_id, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [p.domain, p.branch, p.location, category, title, u.id, id, scope]);
    objectId = rows[0].id;
  } else {
    // "מסמך": the attached file becomes a document of that place (first version)
    if (!items[0].file_id) return { ok: false, error: 'למסמך צריך קובץ מצורף. בחר "משימה".' };
    if (!canCreateIn(u, p, 'money')) return NO_ACCESS;
    const docScope = p.domain === 'personal' ? 'user' : 'shared';
    const title = (items[0].file_name ?? items[0].raw_text ?? 'מסמך').replace(/\.[^.]{1,8}$/, '').slice(0, 200).trim() || 'מסמך';
    const c = await db().connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(
        `INSERT INTO documents (title, doc_type, domain, branch, location, notes, owner_user_id, scope, created_by)
         VALUES ($1, 'other', $2, $3, $4, $5, $6, $7, $6) RETURNING id`,
        [title, p.domain, p.branch, p.location, items[0].file_name && items[0].raw_text ? String(items[0].raw_text).slice(0, 1000) : null, u.id, docScope]);
      await c.query(`INSERT INTO document_versions (document_id, version, file_id, created_by) VALUES ($1, 1, $2, $3)`, [rows[0].id, items[0].file_id, u.id]);
      await c.query(`UPDATE files SET scope = $2 WHERE id = $1`, [items[0].file_id, docScope]);
      await c.query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'document', $2, 'create', $3)`,
        [u.id, rows[0].id, JSON.stringify({ title, place: p, from: 'inbox' })]);
      await c.query('COMMIT');
      objectId = rows[0].id;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.error(e);
      return { ok: false, error: 'לא נשמר, נסה שוב' };
    } finally {
      c.release();
    }
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
  if (p.domain === 'personal' && str(f, 'scope') === 'shared') return NO_ACCESS;
  if (owner !== u.id) {
    if (p.domain === 'personal') return { ok: false, error: 'יעד אישי נשאר שלך. לשיתוף, שייך אותו למשק הבית או לעסק.' };
    if (!(await activeUser(owner)) || !(await userCanSee(owner, p, 'goal'))) return { ok: false, error: 'לאדם הזה אין גישה למקום הזה' };
  }
  const goalType = str(f, 'goal_type') ?? defaultGoalType(p, unit);
  if (!GOAL_TYPES.has(goalType)) return { ok: false, error: 'סוג יעד לא תקין' };
  const notes = str(f, 'notes');
  if (notes && notes.length > 1000) return { ok: false, error: 'ההערות ארוכות מדי' };
  const scope = p.domain === 'household' || owner !== u.id || str(f, 'scope') === 'shared' ? 'shared' : 'user';
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

// Edit a goal: title, target, unit, due date, type, notes. Its place and owner stay.
export async function updateGoal(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const u = await actor(); if (!isUser(u)) return u;
  const id = str(f, 'id');
  if (!id || !UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  if (!(await mayEdit(u, 'goal', 'goals', id))) return NO_ACCESS;
  const title = str(f, 'title');
  if (!title || title.length > 300) return { ok: false, error: 'צריך כותרת ליעד' };
  const unit = str(f, 'unit') ?? 'ils';
  if (!['ils', 'count', 'pct'].includes(unit)) return { ok: false, error: 'יחידה לא תקינה' };
  const target = num(str(f, 'target'));
  if (target !== null && !Number.isFinite(target)) return { ok: false, error: 'יעד מספרי לא תקין' };
  const due = str(f, 'due');
  if (due && !DATE.test(due)) return { ok: false, error: 'תאריך לא תקין' };
  const goalType = str(f, 'goal_type');
  if (goalType && !GOAL_TYPES.has(goalType)) return { ok: false, error: 'סוג יעד לא תקין' };
  const notes = str(f, 'notes');
  if (notes && notes.length > 1000) return { ok: false, error: 'ההערות ארוכות מדי' };
  await db().query(
    `UPDATE goals SET title = $2, unit = $3, target = $4, due = $5, goal_type = coalesce($6, goal_type), notes = $7, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`, [id, title, unit, target, due, goalType, notes]);
  await log(u, 'goal', id, 'update');
  return done(str(f, 'path'));
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

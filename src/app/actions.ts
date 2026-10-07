'use server';
import { revalidatePath } from 'next/cache';
import { isAuthed } from '@/server/auth';
import { createHash } from 'node:crypto';
import { db } from '@/server/db';
import { CATEGORIES, decodePlace } from '@/lib/places';
import { disconnect, setMapping, syncNow } from '@/server/calendar';

// Writes from the dashboard's own forms. Supabase only; the vault is never written.
// Every action checks the session first, validates its input, and soft-deletes.

export type ActionResult = { ok: true } | { ok: false; error: string };

const DOMAINS = new Set(['business', 'personal', 'ventures']);
const OWNERS = new Set(['avihu', 'eden']);
const STATUS = new Set(['todo', 'in_progress', 'waiting', 'done', 'cancelled']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ME = 'avihu'; // single sign-in today; the session will carry the user once Eden has her own

async function guard(): Promise<ActionResult | null> {
  return (await isAuthed()) ? null : { ok: false, error: 'לא מחובר' };
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

async function log(objectType: string, objectId: string, action: string, metadata: Record<string, unknown> = {}) {
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, $2, $3, $4, $5)`,
    [ME, objectType, objectId, action, JSON.stringify(metadata)]);
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
  revalidatePath(path && path.startsWith('/') ? path : '/', 'layout');
  return { ok: true };
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export async function addTask(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  const title = str(f, 'title');
  if (!title || title.length > 300) return { ok: false, error: 'צריך כותרת (עד 300 תווים)' };
  // "Send to Inbox" from the quick add: keep the text unclassified
  if (str(f, 'mode') === 'inbox') {
    const { rows } = await db().query(`INSERT INTO inbox_items (raw_text, created_by) VALUES ($1, $2) RETURNING id`, [title, ME]);
    await log('inbox_item', rows[0].id, 'create');
    return done(str(f, 'path'));
  }
  const p = await place(f); if (typeof p === 'string') return { ok: false, error: p };
  const priority = Number(str(f, 'priority') ?? 3);
  if (![1, 2, 3, 4].includes(priority)) return { ok: false, error: 'עדיפות לא תקינה' };
  const category = str(f, 'category') ?? 'general';
  if (!CATEGORIES.some(c => c.id === category && (c.domain === null || c.domain === p.domain))) return { ok: false, error: 'קטגוריה לא תקינה' };
  const due = str(f, 'due_date');
  if (due && !DATE.test(due)) return { ok: false, error: 'תאריך לא תקין' };
  const time = str(f, 'due_time');
  if (time && (!TIME.test(time) || !due)) return { ok: false, error: 'שעה צריכה תאריך' };
  const owner = str(f, 'owner') ?? ME;
  if (!OWNERS.has(owner)) return { ok: false, error: 'אחראי לא תקין' };
  const status = str(f, 'status') ?? 'todo';
  if (!STATUS.has(status)) return { ok: false, error: 'סטטוס לא תקין' };
  const description = str(f, 'description');
  if (description && description.length > 4000) return { ok: false, error: 'התיאור ארוך מדי' };
  const { rows } = await db().query(
    `INSERT INTO work_items (domain, branch, location, category_id, title, description, priority, status, due_date, due_time, owner_user_id, scope)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [p.domain, p.branch, p.location, category, title, description, priority, status, due, time, owner, owner === ME ? 'user' : 'shared']);
  await log('task', rows[0].id, 'create', { place: p });
  return done(str(f, 'path'));
}

export async function setTaskStatus(id: string, status: string, path: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id) || !STATUS.has(status)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(
    `UPDATE work_items SET status = $2, updated_at = now(),
       completed_at = CASE WHEN $2 IN ('done', 'cancelled') THEN coalesce(completed_at, now()) END
     WHERE id = $1 AND deleted_at IS NULL`, [id, status]);
  await log('task', id, 'status', { status });
  return done(path);
}

export async function setTaskPriority(id: string, priority: number, path: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id) || ![1, 2, 3, 4].includes(priority)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(`UPDATE work_items SET priority = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id, priority]);
  await log('task', id, 'priority', { priority });
  return done(path);
}

export async function removeTask(id: string, path: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(`UPDATE work_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  await log('task', id, 'delete');
  return done(path);
}

// ── Inbox ─────────────────────────────────────────────────────────────────────
const MAX_FILE = 4 * 1024 * 1024;

export async function addInbox(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  const text = str(f, 'text');
  if (text && text.length > 4000) return { ok: false, error: 'הטקסט ארוך מדי' };
  const file = f.get('file');
  const hasFile = file instanceof File && file.size > 0;
  if (!text && !hasFile) return { ok: false, error: 'כתוב משהו או צרף קובץ' };
  let fileId: string | null = null;
  if (hasFile) {
    if (file.size > MAX_FILE) return { ok: false, error: 'הקובץ גדול מ-4MB' };
    const name = (file.name || 'קובץ').slice(0, 200);
    const buf = Buffer.from(await file.arrayBuffer());
    const sha = createHash('sha256').update(buf).digest('hex');
    const { rows } = await db().query(
      `INSERT INTO files (name, mime, size_bytes, sha256, data, owner_user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, (file.type || 'application/octet-stream').slice(0, 100), buf.length, sha, buf, ME]);
    fileId = rows[0].id;
  }
  const { rows } = await db().query(
    `INSERT INTO inbox_items (raw_text, file_id, created_by) VALUES ($1, $2, $3) RETURNING id`, [text, fileId, ME]);
  await log('inbox_item', rows[0].id, 'create', { file: Boolean(fileId) });
  return done('/inbox');
}

// Classify: file it under a place and a module. "task" also creates the task.
export async function classifyInbox(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  const id = str(f, 'id');
  if (!id || !UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  const p = await place(f); if (typeof p === 'string') return { ok: false, error: p };
  const module = str(f, 'module');
  if (!module || !['task', 'note', 'document'].includes(module)) return { ok: false, error: 'בחר מודול' };
  const { rows: items } = await db().query(
    `SELECT i.raw_text, f.name AS file_name FROM inbox_items i LEFT JOIN files f ON f.id = i.file_id
     WHERE i.id = $1 AND i.deleted_at IS NULL AND i.status = 'unclassified'`, [id]);
  if (!items.length) return { ok: false, error: 'הפריט כבר סווג' };
  let objectId: string | null = null;
  if (module === 'task') {
    const title = (str(f, 'title') ?? items[0].raw_text ?? items[0].file_name ?? 'משימה מה-Inbox').slice(0, 300);
    const category = CATEGORIES.some(c => c.id === str(f, 'category') && (c.domain === null || c.domain === p.domain)) ? str(f, 'category')! : 'general';
    const { rows } = await db().query(
      `INSERT INTO work_items (domain, branch, location, category_id, title, owner_user_id, inbox_item_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [p.domain, p.branch, p.location, category, title, ME, id]);
    objectId = rows[0].id;
  }
  await db().query(
    `UPDATE inbox_items SET status = 'classified', classified_domain = $2, classified_branch = $3, classified_location = $4,
       classified_module = $5, classified_object_id = $6, classified_at = now() WHERE id = $1`,
    [id, p.domain, p.branch, p.location, module, objectId]);
  await log('inbox_item', id, 'classify', { place: p, module });
  return done('/inbox');
}

export async function removeInbox(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(`UPDATE inbox_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  await log('inbox_item', id, 'delete');
  return done('/inbox');
}

// ── Goals ─────────────────────────────────────────────────────────────────────
const num = (v: string | null) => (v === null ? null : Number(v.replace(/,/g, '')));

export async function addGoal(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  const p = await place(f); if (typeof p === 'string') return { ok: false, error: p };
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
  const owner = str(f, 'owner') ?? 'avihu';
  if (!OWNERS.has(owner)) return { ok: false, error: 'אחראי לא תקין' };
  await db().query(
    `INSERT INTO goals (domain, branch, location, title, unit, target, current, due, owner_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [p.domain, p.branch, p.location, title, unit, target, current, due, owner]);
  return done(str(f, 'path'));
}

export async function updateGoalCurrent(id: string, current: number | null, path: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id) || (current !== null && !Number.isFinite(current))) return { ok: false, error: 'ערך לא תקין' };
  await db().query(`UPDATE goals SET current = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id, current]);
  return done(path);
}

export async function setGoalStatus(id: string, status: 'active' | 'done' | 'dropped', path: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id) || !['active', 'done', 'dropped'].includes(status)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(`UPDATE goals SET status = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id, status]);
  return done(path);
}

// ── Household money ───────────────────────────────────────────────────────────
export async function addMoney(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  const kind = str(f, 'kind');
  if (kind !== 'income' && kind !== 'expense') return { ok: false, error: 'בחר הכנסה או הוצאה' };
  const amount = num(str(f, 'amount'));
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'סכום חייב להיות גדול מ-0' };
  const category = str(f, 'category');
  if (!category || category.length > 60) return { ok: false, error: 'צריך קטגוריה' };
  const on = str(f, 'occurred_on');
  if (!on || !DATE.test(on)) return { ok: false, error: 'צריך תאריך' };
  const owner = str(f, 'owner') ?? 'avihu';
  if (!OWNERS.has(owner)) return { ok: false, error: 'לא תקין' };
  const note = str(f, 'note');
  if (note && note.length > 500) return { ok: false, error: 'ההערה ארוכה מדי' };
  await db().query(
    `INSERT INTO money_entries (kind, amount, category, occurred_on, note, owner_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [kind, amount, category, on, note, owner]);
  return done(str(f, 'path'));
}

export async function removeMoney(id: string, path: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(`UPDATE money_entries SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return done(path);
}

// ── Calendar settings ─────────────────────────────────────────────────────────
export async function setCalendarMapping(id: string, enabled: boolean, packedPlace: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  const p = packedPlace ? decodePlace(packedPlace) : null;
  if (packedPlace && !p) return { ok: false, error: 'שיוך לא תקין' };
  try {
    await setMapping(id, { is_enabled: enabled, domain: p?.domain ?? null, branch: p?.branch ?? null, location: p?.location ?? null });
  } catch {
    return { ok: false, error: 'לא נשמר' };
  }
  await log('calendar_mapping', id, 'update', { enabled, place: p });
  return done('/settings');
}

export async function calendarRefresh(): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  const r = await syncNow();
  if (!r.ok) return { ok: false, error: r.error === 'invalid_grant' ? 'Google ביטל את ההרשאה. צריך לחבר מחדש.' : 'הסנכרון נכשל, נסה שוב' };
  return done('/');
}

export async function calendarDisconnect(): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  await disconnect();
  await log('calendar_connection', 'google', 'disconnect');
  return done('/');
}

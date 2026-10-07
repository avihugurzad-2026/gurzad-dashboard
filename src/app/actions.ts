'use server';
import { revalidatePath } from 'next/cache';
import { isAuthed } from '@/server/auth';
import { db } from '@/server/db';

// Writes from the dashboard's own forms. Supabase only; the vault is never written.
// Every action checks the session first, validates its input, and soft-deletes.

export type ActionResult = { ok: true } | { ok: false; error: string };

const DOMAINS = new Set(['business', 'personal', 'ventures']);
const LISTS = new Set(['home', 'personal', 'study']);
const OWNERS = new Set(['avihu', 'eden']);
const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function guard(): Promise<ActionResult | null> {
  return (await isAuthed()) ? null : { ok: false, error: 'לא מחובר' };
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

async function place(f: FormData): Promise<{ domain: string; branch: string | null; location: string | null; list: string | null } | string> {
  const domain = str(f, 'domain');
  if (!domain || !DOMAINS.has(domain)) return 'אזור לא תקין';
  const branch = str(f, 'branch');
  if (branch) {
    const { rows } = await db().query(`SELECT 1 FROM branches WHERE domain = $1 AND branch = $2`, [domain, branch]);
    if (!rows.length) return 'עסק לא תקין';
  }
  const location = str(f, 'location');
  if (location) {
    const { rows } = await db().query(`SELECT 1 FROM locations WHERE branch = $1 AND location = $2`, [branch, location]);
    if (!rows.length) return 'סניף לא תקין';
  }
  const list = str(f, 'list');
  if (list && !LISTS.has(list)) return 'רשימה לא תקינה';
  return { domain, branch, location, list };
}

function done(path: string | null): ActionResult {
  revalidatePath(path && path.startsWith('/') ? path : '/', 'layout');
  return { ok: true };
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export async function addTask(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  const p = await place(f); if (typeof p === 'string') return { ok: false, error: p };
  const title = str(f, 'title');
  if (!title || title.length > 300) return { ok: false, error: 'צריך כותרת (עד 300 תווים)' };
  const priority = Number(str(f, 'priority') ?? 2);
  if (![1, 2, 3].includes(priority)) return { ok: false, error: 'עדיפות לא תקינה' };
  const due = str(f, 'due');
  if (due && !DATE.test(due)) return { ok: false, error: 'תאריך לא תקין' };
  const owner = str(f, 'owner') ?? 'avihu';
  if (!OWNERS.has(owner)) return { ok: false, error: 'אחראי לא תקין' };
  await db().query(
    `INSERT INTO work_items (domain, branch, location, list, title, notes, priority, due, owner)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [p.domain, p.branch, p.location, p.list, title, str(f, 'notes'), priority, due, owner]);
  return done(str(f, 'path'));
}

export async function setTaskStatus(id: string, status: 'open' | 'doing' | 'done', path: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id) || !['open', 'doing', 'done'].includes(status)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(
    `UPDATE work_items SET status = $2, updated_at = now(), done_at = CASE WHEN $2 = 'done' THEN now() END
     WHERE id = $1 AND deleted_at IS NULL`, [id, status]);
  return done(path);
}

export async function setTaskPriority(id: string, priority: number, path: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id) || ![1, 2, 3].includes(priority)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(`UPDATE work_items SET priority = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id, priority]);
  return done(path);
}

export async function removeTask(id: string, path: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(`UPDATE work_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return done(path);
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
    `INSERT INTO goals (domain, branch, location, title, unit, target, current, due, owner)
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
    `INSERT INTO money_entries (kind, amount, category, occurred_on, note, owner) VALUES ($1, $2, $3, $4, $5, $6)`,
    [kind, amount, category, on, note, owner]);
  return done(str(f, 'path'));
}

export async function removeMoney(id: string, path: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return denied;
  if (!UUID.test(id)) return { ok: false, error: 'בקשה לא תקינה' };
  await db().query(`UPDATE money_entries SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return done(path);
}

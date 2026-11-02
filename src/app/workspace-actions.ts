'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser, type Role, type SessionUser } from '@/server/auth';
import {
  HOUSEHOLD_COOKIE, archiveWorkspace, branchesOf, canManageWorkspace, canOpenWorkspace, createBranch, createWorkspace,
  myWorkspaces, renameWorkspace, roleIn, setMemberRole, removeMember, updateBranch, workspaceById, workspaceMembers,
  type WorkspaceRow,
} from '@/server/workspaces';
import { BUSINESS_ROLES, HOUSEHOLD_ROLES, hrefOf } from '@/lib/workspaces';

// Workspaces, business branches and members (stage 2). Every action: signed in → load the workspace
// from the registry by id → permission → validate → write (the server helpers log to activity_log)
// → revalidate. Nothing is ever deleted: archiving is a soft delete.

export type WsResult = { ok: true; href?: string } | { ok: false; error: string } | null;
type Fail = { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,40}$/;
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim().replace(/\s+/g, ' ') : null;
};
const NAME_ERROR = 'כתוב שם של 2 עד 60 תווים';
const validName = (v: string | null): v is string => !!v && v.length >= 2 && v.length <= 60;
const NO_ACCESS: Fail = { ok: false, error: 'אין לך הרשאה לזה' };

const refresh = () => revalidatePath('/', 'layout');

// The workspace named by the form's `ws`, if the user may open it
async function load(u: SessionUser, f: FormData): Promise<WorkspaceRow | null> {
  const id = str(f, 'ws');
  if (!id || !UUID.test(id)) return null;
  const w = await workspaceById(id);
  return w && canOpenWorkspace(u, w) ? w : null;
}

// ── Workspaces ────────────────────────────────────────────────────────────────
export async function createWorkspaceAction(_: WsResult, f: FormData): Promise<WsResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  const kind = str(f, 'kind');
  if (kind !== 'household' && kind !== 'business') return { ok: false, error: 'סוג אזור לא תקין' };
  const name = str(f, 'name');
  if (!validName(name)) return { ok: false, error: NAME_ERROR };
  const w = await createWorkspace(u, kind, name);
  // A new household becomes the one /household shows
  if (kind === 'household') await setHouseholdCookie(w.id);
  refresh();
  return { ok: true, href: hrefOf(w) };
}

export async function renameWorkspaceAction(_: WsResult, f: FormData): Promise<WsResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  const w = await load(u, f);
  if (!w || w.kind === 'personal' || !canManageWorkspace(u, w)) return NO_ACCESS;
  const name = str(f, 'name');
  if (!validName(name)) return { ok: false, error: NAME_ERROR };
  if (name !== w.name) await renameWorkspace(u, w, name);
  refresh();
  return { ok: true };
}

export async function archiveWorkspaceAction(_: WsResult, f: FormData): Promise<WsResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  const w = await load(u, f);
  if (!w) return NO_ACCESS;
  if (w.kind === 'personal') return { ok: false, error: 'אי אפשר להעביר לארכיון את האזור האישי' };
  if (!canManageWorkspace(u, w)) return NO_ACCESS;
  await archiveWorkspace(u, w);
  refresh();
  return { ok: true, href: '/workspaces' };
}

// ── Business branches ─────────────────────────────────────────────────────────
async function business(u: SessionUser, f: FormData): Promise<WorkspaceRow | Fail> {
  const w = await load(u, f);
  if (!w || w.kind !== 'business' || !w.branch || !canManageWorkspace(u, w)) return NO_ACCESS;
  return w;
}

async function ownBranch(w: WorkspaceRow, f: FormData): Promise<string | null> {
  const loc = str(f, 'location');
  if (!loc || !SLUG.test(loc)) return null;
  return (await branchesOf(w)).some(b => b.id === loc && b.active) ? loc : null;
}

const status = (f: FormData) => {
  const s = str(f, 'status');
  return s === 'active' || s === 'setup' ? s : null;
};

export async function addBranch(_: WsResult, f: FormData): Promise<WsResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  const w = await business(u, f);
  if ('ok' in w) return w;
  const name = str(f, 'name');
  if (!validName(name)) return { ok: false, error: NAME_ERROR };
  const s = status(f) ?? 'active';
  const id = await createBranch(u, w, name, s);
  refresh();
  return { ok: true, href: `${hrefOf(w)}/${id}` };
}

export async function renameBranch(_: WsResult, f: FormData): Promise<WsResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  const w = await business(u, f);
  if ('ok' in w) return w;
  const loc = await ownBranch(w, f);
  if (!loc) return { ok: false, error: 'הסניף לא נמצא' };
  const name = str(f, 'name');
  if (!validName(name)) return { ok: false, error: NAME_ERROR };
  await updateBranch(u, w, loc, { name });
  refresh();
  return { ok: true };
}

export async function setBranchStatus(_: WsResult, f: FormData): Promise<WsResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  const w = await business(u, f);
  if ('ok' in w) return w;
  const loc = await ownBranch(w, f);
  if (!loc) return { ok: false, error: 'הסניף לא נמצא' };
  const s = status(f);
  if (!s) return { ok: false, error: 'סטטוס לא תקין' };
  await updateBranch(u, w, loc, { status: s });
  refresh();
  return { ok: true };
}

export async function archiveBranch(_: WsResult, f: FormData): Promise<WsResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  const w = await business(u, f);
  if ('ok' in w) return w;
  const loc = await ownBranch(w, f);
  if (!loc) return { ok: false, error: 'הסניף לא נמצא' };
  await updateBranch(u, w, loc, { active: false });
  refresh();
  return { ok: true };
}

// ── Members ───────────────────────────────────────────────────────────────────
const RANK: Record<Role, number> = { owner: 5, admin: 4, manager: 3, member: 3, employee: 2, viewer: 1 };

async function member(u: SessionUser, w: WorkspaceRow, f: FormData) {
  const id = str(f, 'member');
  if (!id || !UUID.test(id)) return null;
  return (await workspaceMembers(w, u)).find(m => m.id === id) ?? null;
}

export async function setMemberRoleAction(_: WsResult, f: FormData): Promise<WsResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  const w = await load(u, f);
  if (!w || w.kind === 'personal' || !canManageWorkspace(u, w)) return NO_ACCESS;
  const role = str(f, 'role') as Role | null;
  const allowed = w.kind === 'household' ? HOUSEHOLD_ROLES : BUSINESS_ROLES;
  if (!role || !(allowed as string[]).includes(role)) return { ok: false, error: 'בחר תפקיד' };
  const m = await member(u, w, f);
  if (!m) return { ok: false, error: 'החבר לא נמצא' };
  if (m.you) return { ok: false, error: 'אי אפשר לשנות את התפקיד של עצמך' };
  if (m.role === 'owner') return { ok: false, error: 'אי אפשר לשנות את התפקיד של הבעלים' };
  // An admin manages the roles below theirs: cannot appoint or change another admin
  const mine = roleIn(u, w);
  if (mine !== 'owner' && (role === 'admin' || RANK[m.role] >= RANK.admin)) return NO_ACCESS;
  if (!(await setMemberRole(u, w, m.id, role))) return { ok: false, error: 'לא הצלחנו לשנות את התפקיד' };
  refresh();
  return { ok: true };
}

// A manager removes someone; anyone (but the owner) may remove themselves = leave
export async function removeMemberAction(_: WsResult, f: FormData): Promise<WsResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  const w = await load(u, f);
  if (!w || w.kind === 'personal') return NO_ACCESS;
  const m = await member(u, w, f);
  if (!m) return { ok: false, error: 'החבר לא נמצא' };
  if (m.role === 'owner') return { ok: false, error: 'הבעלים לא יכול לעזוב. אפשר להעביר את האזור לארכיון.' };
  if (!m.you) {
    if (!canManageWorkspace(u, w)) return NO_ACCESS;
    if (roleIn(u, w) !== 'owner' && RANK[m.role] >= RANK.admin) return NO_ACCESS;
  }
  if (!(await removeMember(u, w, m.id))) return { ok: false, error: 'לא הצלחנו להסיר' };
  refresh();
  return { ok: true, href: m.you ? '/' : undefined };
}

// ── Which household /household shows ─────────────────────────────────────────
async function setHouseholdCookie(id: string) {
  (await cookies()).set(HOUSEHOLD_COOKIE, id, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 365 * 24 * 3600,
  });
}

export async function switchHousehold(f: FormData): Promise<void> {
  const u = await currentUser();
  if (!u) redirect('/login');
  const id = str(f, 'ws');
  const w = id && UUID.test(id) ? (await myWorkspaces(u)).find(x => x.id === id && x.kind === 'household') : null;
  if (w) await setHouseholdCookie(w.id);
  const next = str(f, 'next');
  redirect(next && /^\/household(\/[a-z-]*)?$/.test(next) ? next : '/household');
}

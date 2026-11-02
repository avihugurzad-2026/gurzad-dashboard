import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';
import { loadLocations } from './locations';
import { canSeePlace, type Role, type SessionUser } from './auth';
import { setEntities, type EntityRow, type LocationRow } from '@/lib/places';
import type { WorkspaceKind } from '@/lib/workspaces';

// Workspaces, their members and the business/branch registry. Everything here is user data that is
// created, renamed and archived from the UI; nothing about a person's workspaces lives in code.
// Archiving is a soft delete (deleted_at / active = false): data stays and can be restored.

export type WorkspaceRow = {
  id: string; kind: WorkspaceKind; name: string; owner_user_id: string; domain: string; branch: string | null;
  sort: number | null; created_at: string;
};
export type MemberRow = { id: string; user_id: string; name: string; email: string | null; role: Role; location: string | null; you: boolean };

const missing = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string })?.code ?? '');

// ── Registry ─────────────────────────────────────────────────────────────────
// Authorization must observe a revoked membership or archived workspace on the
// next request, so this registry intentionally has no process-global cache.
export const dropRegistry = () => {};

export async function loadWorkspaces(): Promise<WorkspaceRow[]> {
  let rows: WorkspaceRow[] = [];
  try {
    ({ rows } = await db().query(
      `SELECT id, kind, name, owner_user_id, domain, branch, sort, created_at FROM workspaces
       WHERE deleted_at IS NULL ORDER BY kind, sort NULLS LAST, created_at`));
  } catch (e) {
    if (!missing(e)) throw e;   // before the workspaces migration
  }
  applyRegistry(rows);
  return rows;
}

function applyRegistry(rows: WorkspaceRow[]) {
  setEntities(entityRows(rows));
}

export const entityRows = (rows: WorkspaceRow[]): EntityRow[] => rows
  .filter(w => (w.kind === 'business' || w.kind === 'household') && w.branch)
  .map(w => ({ domain: w.domain as EntityRow['domain'], id: w.branch!, name: w.name, workspace_id: w.id, sort: w.sort }));

// Registry + branches, before anything renders (called once per request from currentUser)
export async function loadRegistry(): Promise<{ workspaces: WorkspaceRow[]; locations: LocationRow[] }> {
  const [workspaces, locations] = await Promise.all([loadWorkspaces(), loadLocations()]);
  return { workspaces, locations };
}

// ── What a user may open ──────────────────────────────────────────────────────
export function canOpenWorkspace(u: SessionUser, w: WorkspaceRow): boolean {
  if (w.kind === 'personal') return w.owner_user_id === u.id;
  return canSeePlace(u, { domain: w.domain, branch: w.branch, location: null });
}

export async function myWorkspaces(u: SessionUser): Promise<WorkspaceRow[]> {
  return (await loadWorkspaces()).filter(w => canOpenWorkspace(u, w));
}

export async function personalWorkspace(u: SessionUser): Promise<WorkspaceRow | null> {
  return (await loadWorkspaces()).find(w => w.kind === 'personal' && w.owner_user_id === u.id) ?? null;
}

// The household the /household pages show: the one picked last (cookie), else the first one
export const HOUSEHOLD_COOKIE = 'hh';
export async function currentHousehold(u: SessionUser): Promise<WorkspaceRow | null> {
  const mine = (await myWorkspaces(u)).filter(w => w.kind === 'household');
  const picked = (await cookies()).get(HOUSEHOLD_COOKIE)?.value;
  return mine.find(w => w.id === picked) ?? mine[0] ?? null;
}

// The role `u` holds in a workspace (null = none). The account owner counts as owner of shared
// business/ventures workspaces; households and personal workspaces need their own membership.
export function roleIn(u: SessionUser, w: WorkspaceRow): Role | null {
  if (w.kind === 'personal') return w.owner_user_id === u.id ? 'owner' : null;
  const m = u.memberships.filter(x => x.workspace_id === w.id || (x.domain === w.domain && (w.kind === 'ventures' || x.branch === w.branch)));
  const order: Role[] = ['owner', 'admin', 'manager', 'member', 'employee', 'viewer'];
  const best = order.find(r => m.some(x => x.role === r)) ?? null;
  if (best) return best;
  if (u.isOwner && w.kind !== 'household') return 'owner';
  return null;
}

export const canManageWorkspace = (u: SessionUser, w: WorkspaceRow) => ['owner', 'admin'].includes(roleIn(u, w) ?? '');

// Members of a shared workspace. Names, roles and e-mail only: nothing about anyone's money.
export async function workspaceMembers(w: WorkspaceRow, u: SessionUser): Promise<MemberRow[]> {
  if (w.kind === 'personal') return [];
  try {
    const { rows } = await db().query(
      `SELECT DISTINCT ON (m.user_id) m.id, m.user_id, us.name, us.email, m.role, m.location
       FROM workspace_members m JOIN users us ON us.id = m.user_id
       WHERE m.revoked_at IS NULL AND us.active
         AND (m.workspace_id = $1 OR (m.workspace_id IS NULL AND m.domain = $2 AND ($3::text IS NULL OR m.branch = $3)))
       ORDER BY m.user_id, CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3 WHEN 'member' THEN 4 WHEN 'employee' THEN 5 ELSE 6 END`,
      [w.id, w.domain, w.branch]);
    return rows.map(r => ({ ...r, you: r.user_id === u.id }))
      .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.name.localeCompare(b.name)));
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

// ── Create / rename / archive ─────────────────────────────────────────────────
const SLUG = /^[a-z0-9-]{1,40}$/;

// A latin id for the place columns: from the name when it is latin, otherwise a short random one
async function freeSlug(domain: string, name: string): Promise<string> {
  let base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  if (base.length < 2) base = `${domain === 'household' ? 'home' : 'biz'}-${randomBytes(3).toString('hex')}`;
  for (let i = 1; i < 50; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    const { rows } = await db().query(`SELECT 1 FROM branches WHERE branch = $1 UNION ALL SELECT 1 FROM locations WHERE location = $1`, [id]);
    if (!rows.length) return id;
  }
  return `${base.slice(0, 20)}-${randomBytes(4).toString('hex')}`;
}

export async function createWorkspace(u: SessionUser, kind: 'household' | 'business' | 'ventures', name: string): Promise<WorkspaceRow> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    let branch: string | null = null;
    const domain = kind;
    if (kind !== 'ventures') {
      branch = await freeSlug(domain, name);
      await client.query(`INSERT INTO branches (domain, branch, name_he, sort, active) VALUES ($1, $2, $3,
        (SELECT coalesce(max(sort), 0) + 1 FROM branches WHERE domain = $1), true)`, [domain, branch, name]);
    }
    const { rows: [w] } = await client.query(
      `INSERT INTO workspaces (kind, name, owner_user_id, domain, branch, created_by, sort)
       VALUES ($1, $2, $3, $4, $5, $3, (SELECT coalesce(max(sort), 0) + 1 FROM workspaces WHERE kind = $1))
       RETURNING id, kind, name, owner_user_id, domain, branch, sort, created_at`, [kind, name, u.id, domain, branch]);
    await client.query(
      `INSERT INTO workspace_members (user_id, role, domain, branch, workspace_id, created_by) VALUES ($1, 'owner', $2, $3, $4, $1)`,
      [u.id, domain, branch, w.id]);
    await client.query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'workspace', $2, 'create', $3)`,
      [u.id, w.id, JSON.stringify({ kind, name })]);
    await client.query('COMMIT');
    dropRegistry();
    return w;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function renameWorkspace(u: SessionUser, w: WorkspaceRow, name: string): Promise<void> {
  await db().query(`UPDATE workspaces SET name = $2, updated_at = now() WHERE id = $1`, [w.id, name]);
  if (w.branch) await db().query(`UPDATE branches SET name_he = $3 WHERE domain = $1 AND branch = $2`, [w.domain, w.branch, name]);
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'workspace', $2, 'rename', $3)`,
    [u.id, w.id, JSON.stringify({ name })]);
  dropRegistry();
}

// Soft delete: the workspace leaves menus; its rows stay in the DB and it can be restored by an admin
export async function archiveWorkspace(u: SessionUser, w: WorkspaceRow): Promise<void> {
  await db().query(`UPDATE workspaces SET deleted_at = now(), updated_at = now() WHERE id = $1`, [w.id]);
  if (w.branch) await db().query(`UPDATE branches SET active = false WHERE domain = $1 AND branch = $2`, [w.domain, w.branch]);
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action) VALUES ($1, 'workspace', $2, 'archive')`, [u.id, w.id]);
  dropRegistry();
}

// ── Business branches (locations) ─────────────────────────────────────────────
export async function createBranch(u: SessionUser, w: WorkspaceRow, name: string, status: 'active' | 'setup'): Promise<string> {
  const id = await freeSlug('business', name);
  await db().query(
    `INSERT INTO locations (domain, branch, location, name_he, active, status, sort)
     VALUES ('business', $1, $2, $3, true, $4, (SELECT coalesce(max(sort), 0) + 1 FROM locations WHERE branch = $1))`,
    [w.branch, id, name, status]);
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'branch', $2, 'create', $3)`,
    [u.id, `${w.branch}/${id}`, JSON.stringify({ name, status })]);
  await refreshLocations();
  return id;
}

export async function updateBranch(u: SessionUser, w: WorkspaceRow, location: string, patch: { name?: string; status?: 'active' | 'setup'; active?: boolean }) {
  if (!SLUG.test(location)) return;
  await db().query(
    `UPDATE locations SET name_he = coalesce($3, name_he), status = coalesce($4, status), active = coalesce($5, active)
     WHERE branch = $1 AND location = $2`, [w.branch, location, patch.name ?? null, patch.status ?? null, patch.active ?? null]);
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'branch', $2, 'update', $3)`,
    [u.id, `${w.branch}/${location}`, JSON.stringify(patch)]);
  await refreshLocations();
}

export async function branchesOf(w: WorkspaceRow): Promise<{ id: string; name: string; status: string; active: boolean }[]> {
  if (w.kind !== 'business') return [];
  const { rows } = await db().query(
    `SELECT location AS id, name_he AS name, coalesce(status, 'active') AS status, active FROM locations WHERE branch = $1 ORDER BY active DESC, sort NULLS LAST, name_he`,
    [w.branch]).catch(e => { if (missing(e)) return { rows: [] }; throw e; });
  return rows;
}

async function refreshLocations() {
  const mod = await import('./locations');
  mod.dropLocations();
  await mod.loadLocations();
}

// ── Members ───────────────────────────────────────────────────────────────────
export async function setMemberRole(u: SessionUser, w: WorkspaceRow, memberId: string, role: Role): Promise<boolean> {
  const { rows: [m] } = await db().query(`SELECT user_id, role FROM workspace_members WHERE id = $1 AND revoked_at IS NULL AND workspace_id = $2`, [memberId, w.id]);
  if (!m || m.role === 'owner' || m.user_id === u.id) return false;
  await db().query(`UPDATE workspace_members SET role = $2 WHERE id = $1`, [memberId, role]);
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'membership', $2, 'role', $3)`,
    [u.id, memberId, JSON.stringify({ from: m.role, to: role })]);
  return true;
}

export async function removeMember(u: SessionUser, w: WorkspaceRow, memberId: string): Promise<boolean> {
  const { rows: [m] } = await db().query(`SELECT user_id, role FROM workspace_members WHERE id = $1 AND revoked_at IS NULL AND workspace_id = $2`, [memberId, w.id]);
  // The owner stays; anyone may leave a workspace themselves
  if (!m || m.role === 'owner') return false;
  await db().query(`UPDATE workspace_members SET revoked_at = now() WHERE id = $1`, [memberId]);
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action) VALUES ($1, 'membership', $2, 'revoke')`, [u.id, memberId]);
  return true;
}

export async function pendingInvites(w: WorkspaceRow): Promise<{ id: string; email: string; name: string | null; role: Role; expires_at: string }[]> {
  try {
    const { rows } = await db().query(
      `SELECT id, email, name, role, expires_at FROM invitations
       WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
         AND (workspace_id = $1 OR (workspace_id IS NULL AND domain = $2 AND ($3::text IS NULL OR branch = $3)))
       ORDER BY created_at DESC`, [w.id, w.domain, w.branch]);
    return rows.map(r => ({ ...r, expires_at: new Date(r.expires_at).toISOString() }));
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

// ── Lookups (from the cached registry) ─────────────────────────────────────────
export async function workspaceById(id: string): Promise<WorkspaceRow | null> {
  return (await loadWorkspaces()).find(w => w.id === id) ?? null;
}

export async function workspaceByBranch(kind: 'business' | 'household', branch: string): Promise<WorkspaceRow | null> {
  return (await loadWorkspaces()).find(w => w.kind === kind && w.branch === branch) ?? null;
}

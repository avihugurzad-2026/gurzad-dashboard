import 'server-only';
import { db } from './db';
import { params, type SessionUser } from './auth';
import { schemaColumns, hasCols } from './introspect';
import { crumbOf, subjectHref, tabHref } from './search';
import { describeActivity } from '@/lib/activity';
import { ilDayStart, addDays } from '@/lib/period';
import { hrefFor, type Domain, type Place } from '@/lib/places';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Activity log (3.6): who did what, when, to which object. Owner/admin see every row; everyone
// else sees the rows they did themselves. Object titles come from the object's own table, and are
// hidden when the object is someone else's private row (scope 'user').

export type ActivityItem = {
  id: number; at: string; user_id: string | null; actor: string | null; text: string;
  object_type: string; object_id: string; title: string | null; href: string | null; context: string | null;
};
export type ActivityFilter = {
  objectType?: string | null; objectId?: string | null; place?: Partial<Place> | null;
  userId?: string | null; before?: number | null; from?: string | null; to?: string | null; limit?: number;
};

// Where each object type lives: its table, a title expression, and its place/owner/scope columns
type Obj = { table: string; title: string; domain?: string; branch?: string; location?: string; owner?: string; scope?: string };
const OBJECTS: Record<string, Obj> = {
  task: { table: 'work_items', title: 'title' },
  goal: { table: 'goals', title: 'title' },
  receivable: { table: 'receivables', title: 'client_name' },
  transaction: { table: 'transactions', title: 'coalesce(x.description, x.counterparty_name)' },
  document: { table: 'documents', title: 'title' },
  inbox_item: { table: 'inbox_items', title: `left(coalesce(x.raw_text, ''), 80)`, domain: 'classified_domain', branch: 'classified_branch', location: 'classified_location', owner: 'created_by' },
  asset: { table: 'assets', title: 'name' },
  liability: { table: 'liabilities', title: 'lender' },
  investment: { table: 'investments', title: 'name' },
  legal_case: { table: 'legal_cases', title: 'title' },
  contact: { table: 'contacts', title: 'name' },
  case_deadline: { table: 'case_deadlines', title: 'title', domain: '', owner: '', scope: '' },
  integration: { table: 'integrations', title: 'provider', owner: '', scope: '' },
  calendar: { table: 'events', title: 'title' },
};
const UUID_RE = `'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`;

function objectSql(cols: Map<string, Set<string>>): string {
  const arms: string[] = [];
  for (const [type, o] of Object.entries(OBJECTS)) {
    const c = (name: string | undefined, dflt: string) => {
      const n = name === undefined ? dflt : name;
      return n && hasCols(cols, o.table, n) ? `x.${n}` : 'NULL';
    };
    const titleCol = /^[a-z_]+$/.test(o.title) ? o.title : null;
    if (!hasCols(cols, o.table, 'id') || (titleCol && !hasCols(cols, o.table, titleCol))) continue;
    const title = titleCol ? `x.${titleCol}` : o.title;
    arms.push(`WHEN '${type}' THEN (SELECT json_build_object('t', ${title}, 'd', ${c(o.domain, 'domain')}, 'b', ${c(o.branch, 'branch')},
      'l', ${c(o.location, 'location')}, 'o', ${c(o.owner, 'owner_user_id')}, 's', ${c(o.scope, 'scope')})
      FROM ${o.table} x WHERE x.id = a.object_id::uuid)`);
  }
  if (!arms.length) return 'NULL::json';
  return `CASE WHEN a.object_id ~* ${UUID_RE} THEN CASE a.object_type ${arms.join('\n')} END END`;
}

function hrefOf(type: string, id: string, p: Place | null): string | null {
  switch (type) {
    case 'task': return p ? tabHref(p, 'tasks') : null;
    case 'goal': return p ? tabHref(p, 'goals') : null;
    case 'receivable': return p ? tabHref(p, 'collections') : null;
    case 'transaction': return '/finance';
    case 'document': return `/documents#doc-${id}`;
    case 'inbox_item': return '/inbox';
    case 'asset': case 'liability': return subjectHref('real-estate', type, id);
    case 'investment': return subjectHref('investments', type, id);
    case 'legal_case': return subjectHref('legal-and-tasks', type, id);
    case 'case_deadline': return '/ventures/legal-and-tasks';
    case 'contact': case 'integration': return p ? hrefFor(p) : null;
    case 'calendar': return '/calendar';
    case 'invitation': case 'membership': return '/settings';
    default: return null;
  }
}

export async function activityFeed(u: SessionUser, f: ActivityFilter = {}): Promise<{ ready: boolean; items: ActivityItem[]; next: number | null }> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const cols = await schemaColumns();
  if (!hasCols(cols, 'activity_log', 'object_type')) return { ready: false, items: [], next: null };
  const q = params();
  const where: string[] = [];
  if (!u.isAdmin) where.push(`a.user_id = ${q.p(u.id)}`);
  if (f.userId) where.push(`a.user_id = ${q.p(f.userId)}`);
  if (f.objectType && f.objectId) {
    const t = q.p(f.objectType), id = q.p(f.objectId);
    // The object itself, and things filed against it (a task or a document about a property …)
    where.push(`((a.object_type = ${t} AND a.object_id = ${id})
      OR (a.metadata_json->>'subject_type' = ${t} AND a.metadata_json->>'subject_id' = ${id}))`);
  } else if (f.objectType) where.push(`a.object_type = ${q.p(f.objectType)}`);
  if (f.before) where.push(`a.id < ${q.p(f.before)}`);
  if (f.from) where.push(`a.created_at >= ${q.p(ilDayStart(f.from).toISOString())}::timestamptz`);
  if (f.to) where.push(`a.created_at < ${q.p(ilDayStart(addDays(f.to, 1)).toISOString())}::timestamptz`);
  if (f.place?.domain) {
    // The object's place, or (when the object is gone or has none) the place stored with the action
    const part = (key: 'd' | 'b' | 'l', meta: string, v: string) =>
      `coalesce(obj.o->>'${key}', a.metadata_json->'place'->>'${meta}', a.metadata_json->>'${meta}') = ${q.p(v)}`;
    const conds = [part('d', 'domain', f.place.domain)];
    if (f.place.branch) conds.push(part('b', 'branch', f.place.branch));
    if (f.place.location) conds.push(part('l', 'location', f.place.location));
    where.push(`(${conds.join(' AND ')})`);
  }
  try {
    const { rows } = await db().query(
      `SELECT a.id, a.created_at, a.user_id, usr.name AS user_name, a.object_type, a.object_id, a.action, a.metadata_json, obj.o
       FROM activity_log a
       LEFT JOIN users usr ON usr.id = a.user_id
       LEFT JOIN LATERAL (SELECT ${objectSql(cols)} AS o) obj ON TRUE
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.id DESC
       LIMIT ${limit + 1}`, q.values);
    const items = rows.slice(0, limit).map((r: any): ActivityItem => {
      const o = r.o ?? null;
      const meta = r.metadata_json ?? {};
      const d = o?.d ?? meta.place?.domain ?? (r.object_type === 'integration' ? meta.domain ?? (meta.branch ? 'business' : null) : null);
      const place: Place | null = d ? {
        domain: d as Domain, branch: o?.b ?? meta.place?.branch ?? meta.branch ?? null, location: o?.l ?? meta.place?.location ?? meta.location ?? null,
      } : null;
      const hidden = (o && o.s === 'user' && o.o && o.o !== u.id) || r.object_type === 'integration';
      const title = hidden ? null : (o?.t ?? meta.title ?? meta.name ?? null);
      const { actor, text } = describeActivity({ user_id: r.user_id, user_name: r.user_name, object_type: r.object_type, object_id: r.object_id, action: r.action, metadata: meta });
      return {
        id: Number(r.id), at: new Date(r.created_at).toISOString(), user_id: r.user_id, actor, text,
        object_type: r.object_type, object_id: r.object_id, title: title ? String(title) : null,
        href: r.action === 'delete' ? null : hrefOf(r.object_type, r.object_id, place),
        context: place ? crumbOf(place) : null,
      };
    });
    return { ready: true, items, next: rows.length > limit ? items[items.length - 1].id : null };
  } catch (e: any) {
    if (e?.code === '42P01' || e?.code === '42703') return { ready: false, items: [], next: null };
    throw e;
  }
}

export async function activityUsers(): Promise<{ id: string; name: string }[]> {
  const { rows } = await db().query(`SELECT id, name FROM users ORDER BY active DESC, name`);
  return rows;
}

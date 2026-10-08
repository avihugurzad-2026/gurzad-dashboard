import { ils } from '@/lib/format';
import 'server-only';
import { db } from './db';
import { canSeePlace, params, visibleSql, type Kind, type SessionUser } from './auth';
import { schemaColumns, hasCols, pickCol } from './introspect';
import { likePattern } from './documents';
import { AREAS, ENTITIES, LOCATIONS, contextLabel, entity, hrefFor, type Domain, type Place } from '@/lib/places';
import { docTypeLabel } from '@/lib/documents';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Global search (3.5, ⌘K): one query string over every kind of object, results grouped by type,
// each with a breadcrumb. Every group is filtered for the user in SQL (visibleSql) and runs in
// parallel; a table or column that does not exist on this database yields an empty group.
// ILIKE '%…%' with trigram GIN indexes (stage 3 migration) keeps it fast as data grows.

export type SearchType =
  | 'task' | 'client' | 'document' | 'entity' | 'branch' | 'goal'
  | 'property' | 'investment' | 'legal' | 'event' | 'transaction' | 'inbox';
export type SearchResult = { type: SearchType; id: string; title: string; subtitle: string | null; href: string; crumbs: string };
export type SearchGroup = { type: SearchType; label: string; items: SearchResult[] };

export const GROUP_LABEL: Record<SearchType, string> = {
  task: 'משימות', client: 'לקוחות', document: 'מסמכים', entity: 'ישויות', branch: 'סניפים', goal: 'יעדים',
  property: 'נכסים', investment: 'השקעות', legal: 'תיקים משפטיים', event: 'אירועים', transaction: 'תנועות', inbox: 'Inbox',
};
const ORDER: SearchType[] = ['task', 'client', 'document', 'entity', 'branch', 'goal', 'property', 'investment', 'legal', 'event', 'transaction', 'inbox'];

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
const placeOf = (r: any): Place => ({ domain: r.domain as Domain, branch: r.branch ?? null, location: r.location ?? null });
export const crumbOf = (p: Place) => {
  const area = AREAS.find(a => a.id === p.domain)?.label ?? p.domain;
  const ctx = contextLabel(p);
  return ctx === area || p.domain === 'personal' ? ctx : `${area} / ${ctx.replace(/^יזמות · /, '').replace(' · ', ' / ')}`;
};
// The tab of a place page that lists a kind of object
export const tabHref = (p: Place, tab: 'tasks' | 'goals' | 'collections' | 'clients') => {
  if (p.domain === 'personal') return tab === 'goals' ? '/personal/goals' : '/personal/tasks';
  return `${hrefFor(p)}?tab=${tab}`;
};
// Ventures objects open on their entity page (the ventures work may add detail pages; adjust here)
// Properties, investments and legal cases have their own pages; anything else lands on its section.
const DETAIL_TYPES = new Set(['asset', 'investment', 'legal_case']);
export const subjectHref = (branch: string, type: string, id: string) =>
  DETAIL_TYPES.has(type) && entity(branch) ? `${entity(branch)!.href}/${id}` : `${entity(branch)?.href ?? '/ventures'}#${type}-${id}`;
const ilDay = (ts: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(ts);
const ilDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jerusalem' });

type Ctx = { u: SessionUser; like: string; text: string; limit: number; cols: Map<string, Set<string>> };

// One group: run `sql` with the pattern as $1, map rows; missing table/column → empty
async function group(ctx: Ctx, build: (q: ReturnType<typeof params>) => string | null, map: (r: any) => SearchResult | null): Promise<SearchResult[]> {
  const q = params([ctx.like]);
  const sql = build(q);
  if (!sql) return [];
  try {
    const { rows } = await db().query(sql, q.values);
    return rows.map(map).filter((x): x is SearchResult => x !== null);
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

const vis = (ctx: Ctx, kind: Kind, alias: string, q: ReturnType<typeof params>, cols?: Parameters<typeof visibleSql>[4]) =>
  visibleSql(ctx.u, kind, alias, q.p, cols);

async function tasks(ctx: Ctx): Promise<SearchResult[]> {
  const [mine, vault] = await Promise.all([
    group(ctx, q => hasCols(ctx.cols, 'work_items', 'title') ? `
      SELECT id, title, status, domain, branch, location FROM work_items w
      WHERE deleted_at IS NULL AND title ILIKE $1 AND ${vis(ctx, 'task', 'w', q)}
      ORDER BY (status IN ('done', 'cancelled')), updated_at DESC LIMIT ${ctx.limit}` : null,
    r => {
      const p = placeOf(r);
      return { type: 'task', id: r.id, title: r.title, subtitle: r.status === 'done' ? 'בוצע' : r.status === 'cancelled' ? 'בוטל' : null, href: tabHref(p, 'tasks'), crumbs: crumbOf(p) };
    }),
    group(ctx, q => hasCols(ctx.cols, 'tasks', 'text') ? `
      SELECT id, text, domain, branch FROM (SELECT *, NULL::text AS location FROM tasks) t
      WHERE deleted_at IS NULL AND NOT done AND text ILIKE $1
        AND ${vis(ctx, 'task', 't', q, { owner: null, scope: null, assigned: null })} LIMIT ${ctx.limit}` : null,
    r => {
      const p: Place = { domain: r.domain, branch: r.domain === 'personal' ? null : r.branch, location: null };
      return { type: 'task', id: `vault:${r.id}`, title: r.text, subtitle: 'מהוואלט', href: tabHref(p, 'tasks'), crumbs: crumbOf(p) };
    }),
  ]);
  return [...mine, ...vault].slice(0, ctx.limit);
}

async function clients(ctx: Ctx): Promise<SearchResult[]> {
  const [rec, ret] = await Promise.all([
    group(ctx, q => hasCols(ctx.cols, 'receivables', 'client_name') ? `
      SELECT client_name, domain, branch, location, count(*)::int AS n,
             sum(amount - amount_paid) FILTER (WHERE status <> 'paid')::float AS open
      FROM receivables r WHERE deleted_at IS NULL AND client_name ILIKE $1 AND ${vis(ctx, 'money', 'r', q)}
      GROUP BY client_name, domain, branch, location ORDER BY max(updated_at) DESC LIMIT ${ctx.limit}` : null,
    r => {
      const p = placeOf(r);
      return { type: 'client', id: `rec:${p.branch ?? p.domain}:${r.client_name}`, title: r.client_name,
        subtitle: r.open ? 'יש חוב פתוח' : `${r.n} חיובים`, href: tabHref(p, 'collections'), crumbs: crumbOf(p) };
    }),
    // a-digital retainer clients from the vault (read-only), for users who may see that place's money
    group(ctx, q => hasCols(ctx.cols, 'entities', 'data', 'type') ? `
      SELECT id, data->>'client' AS client, domain, branch, status FROM (SELECT *, NULL::text AS location FROM entities) e
      WHERE type = 'retainer' AND deleted_at IS NULL AND data->>'client' ILIKE $1
        AND ${vis(ctx, 'money', 'e', q, { owner: null, scope: null })} LIMIT ${ctx.limit}` : null,
    r => {
      const p = placeOf(r);
      return { type: 'client', id: `ret:${r.id}`, title: r.client, subtitle: r.status === 'active' ? 'ריטיינר פעיל' : 'ריטיינר',
        href: tabHref(p, 'clients'), crumbs: crumbOf(p) };
    }),
  ]);
  // One row per client name (a retainer client who also has a receivable shows once, as the retainer)
  const seen = new Set<string>();
  return [...ret, ...rec].filter(r => !seen.has(r.title) && seen.add(r.title)).slice(0, ctx.limit);
}

async function documents(ctx: Ctx): Promise<SearchResult[]> {
  return group(ctx, q => hasCols(ctx.cols, 'documents', 'title') && hasCols(ctx.cols, 'document_versions', 'file_id') ? `
    SELECT d.id, d.title, d.doc_type, d.domain, d.branch, d.location, to_char(d.doc_date, 'YYYY-MM-DD') AS doc_date
    FROM documents d
    WHERE d.deleted_at IS NULL AND ${vis(ctx, 'money', 'd', q)}
      AND (d.title ILIKE $1 OR d.id IN (SELECT v.document_id FROM document_versions v JOIN files f ON f.id = v.file_id WHERE f.name ILIKE $1))
    ORDER BY d.updated_at DESC LIMIT ${ctx.limit}` : null,
  r => {
    const p = placeOf(r);
    return { type: 'document', id: r.id, title: r.title, subtitle: docTypeLabel(r.doc_type) + (r.doc_date ? ` · ${r.doc_date}` : ''),
      href: `/documents?q=${encodeURIComponent(r.title.slice(0, 100))}#doc-${r.id}`, crumbs: crumbOf(p) };
  });
}

// Entities (branches rows) and branches (locations rows): small tables, matched on the Hebrew name
// in the DB and on the labels the app shows (English names like "Head Spa Israel").
async function places(ctx: Ctx): Promise<{ entity: SearchResult[]; branch: SearchResult[] }> {
  const t = ctx.text.toLocaleLowerCase('he');
  const hit = (...s: (string | null | undefined)[]) => s.some(x => x && x.toLocaleLowerCase('he').includes(t));
  let br: any[] = [], loc: any[] = [];
  try {
    [br, loc] = await Promise.all([
      db().query(`SELECT domain, branch, name_he FROM branches ORDER BY domain, sort NULLS LAST`).then(r => r.rows),
      db().query(`SELECT domain, branch, location, name_he FROM locations ORDER BY branch, sort NULLS LAST`).then(r => r.rows),
    ]);
  } catch (e) { if (!missing(e)) throw e; }
  const ents: SearchResult[] = [];
  for (const r of br) {
    const e = ENTITIES.find(x => x.id === r.branch && x.domain === r.domain);
    const p: Place = { domain: r.domain, branch: r.domain === 'personal' ? null : r.branch, location: null };
    if (!hit(r.name_he, r.branch, e?.label, e?.short) || !canSeePlace(ctx.u, { domain: r.domain, branch: r.branch })) continue;
    const area = AREAS.find(a => a.id === r.domain)?.label ?? r.domain;
    ents.push({ type: 'entity', id: `${r.domain}/${r.branch}`, title: e?.label ?? r.name_he ?? r.branch,
      subtitle: e && r.name_he && r.name_he !== e.label ? r.name_he : null, href: e?.href ?? hrefFor(p), crumbs: area });
  }
  const locs: SearchResult[] = [];
  for (const r of loc) {
    const l = LOCATIONS.find(x => x.entity === r.branch && x.id === r.location);
    const p: Place = { domain: r.domain, branch: r.branch, location: r.location };
    if (!hit(r.name_he, r.location, l?.label) || !canSeePlace(ctx.u, p)) continue;
    const e = entity(r.branch);
    locs.push({ type: 'branch', id: `${r.branch}/${r.location}`, title: l?.label ?? r.name_he,
      subtitle: l?.status === 'setup' ? 'בהקמה' : null, href: hrefFor(p),
      crumbs: `${AREAS.find(a => a.id === r.domain)?.label ?? r.domain} / ${e?.label ?? r.branch}` });
  }
  return { entity: ents.slice(0, ctx.limit), branch: locs.slice(0, ctx.limit) };
}

async function goals(ctx: Ctx): Promise<SearchResult[]> {
  return group(ctx, q => hasCols(ctx.cols, 'goals', 'title') ? `
    SELECT id, title, status, domain, branch, location FROM goals g
    WHERE deleted_at IS NULL AND status <> 'dropped' AND title ILIKE $1 AND ${vis(ctx, 'goal', 'g', q)}
    ORDER BY (status = 'done'), updated_at DESC LIMIT ${ctx.limit}` : null,
  r => {
    const p = placeOf(r);
    return { type: 'goal', id: r.id, title: r.title, subtitle: r.status === 'done' ? 'הושג' : null, href: tabHref(p, 'goals'), crumbs: crumbOf(p) };
  });
}

// Ventures objects (built by the ventures work; skipped until their tables exist)
async function venture(ctx: Ctx, type: 'property' | 'investment' | 'legal', table: string, kind: Kind, subjectType: string, extra: string[]): Promise<SearchResult[]> {
  const title = pickCol(ctx.cols, table, 'name', 'title');
  if (!title || !hasCols(ctx.cols, table, 'domain', 'branch', 'location', 'owner_user_id', 'scope', 'deleted_at')) return [];
  const sub = extra.find(c => ctx.cols.get(table)?.has(c)) ?? null;
  return group(ctx, q => `
    SELECT id, ${title} AS title, ${sub ?? 'NULL'} AS sub, domain, branch, location FROM ${table} x
    WHERE deleted_at IS NULL AND (${title} ILIKE $1${sub ? ` OR ${sub} ILIKE $1` : ''}) AND ${vis(ctx, kind, 'x', q, { assigned: null })}
    ORDER BY updated_at DESC NULLS LAST LIMIT ${ctx.limit}`,
  r => {
    const p = placeOf(r);
    return { type, id: r.id, title: r.title, subtitle: r.sub ?? null, href: subjectHref(r.branch, subjectType, r.id), crumbs: crumbOf(p) };
  });
}

async function events(ctx: Ctx): Promise<SearchResult[]> {
  return group(ctx, q => hasCols(ctx.cols, 'events', 'title') ? `
    SELECT id, title, start_at, domain, branch, location FROM events e
    WHERE deleted_at IS NULL AND status <> 'cancelled' AND title ILIKE $1 AND ${vis(ctx, 'event', 'e', q)}
    ORDER BY abs(extract(epoch FROM start_at - now())) LIMIT ${ctx.limit}` : null,
  r => {
    const start = new Date(r.start_at);
    const p = r.domain ? placeOf(r) : null;
    return { type: 'event', id: r.id, title: r.title || '(ללא כותרת)', subtitle: ilDate.format(start),
      href: `/calendar?view=day&d=${ilDay(start)}`, crumbs: p ? crumbOf(p) : 'לוח שנה' };
  });
}

async function transactions(ctx: Ctx): Promise<SearchResult[]> {
  return group(ctx, q => hasCols(ctx.cols, 'transactions', 'description', 'counterparty_name') ? `
    SELECT id, description, counterparty_name, direction, amount_gross::float AS amount, to_char(occurred_on, 'YYYY-MM-DD') AS d,
           domain, branch, location
    FROM transactions t
    WHERE deleted_at IS NULL AND (description ILIKE $1 OR counterparty_name ILIKE $1) AND ${vis(ctx, 'money', 't', q)}
    ORDER BY occurred_on DESC LIMIT ${ctx.limit}` : null,
  r => {
    const p = placeOf(r);
    const amount = ils(Number(r.amount)) ?? '';
    return { type: 'transaction', id: r.id, title: r.description || r.counterparty_name,
      subtitle: `${r.direction === 'income' ? 'הכנסה' : 'הוצאה'} ${amount} · ${r.d}${r.description && r.counterparty_name ? ` · ${r.counterparty_name}` : ''}`,
      href: `/finance?p=custom&from=${r.d}&to=${r.d}`, crumbs: crumbOf(p) };
  });
}

// Inbox items belong to whoever captured them (shared ones also to admins), like the Inbox screen
async function inbox(ctx: Ctx): Promise<SearchResult[]> {
  return group(ctx, q => hasCols(ctx.cols, 'inbox_items', 'raw_text', 'created_by') ? `
    SELECT i.id, coalesce(i.raw_text, f.name) AS text, i.status FROM inbox_items i LEFT JOIN files f ON f.id = i.file_id
    WHERE i.deleted_at IS NULL AND (i.raw_text ILIKE $1 OR f.name ILIKE $1)
      AND (i.created_by = ${q.p(ctx.u.id)} OR (i.scope = 'shared' AND ${ctx.u.isAdmin ? 'TRUE' : 'FALSE'}))
    ORDER BY i.created_at DESC LIMIT ${ctx.limit}` : null,
  r => ({ type: 'inbox', id: r.id, title: String(r.text ?? '').slice(0, 120), subtitle: r.status === 'classified' ? 'שויך' : 'ממתין לשיוך', href: '/inbox', crumbs: 'Inbox' }));
}

export async function globalSearch(u: SessionUser, text: string, limit = 6): Promise<{ q: string; groups: SearchGroup[]; total: number; ms: number }> {
  const t0 = performance.now();
  const q = text.trim().slice(0, 100);
  if (q.length < 2) return { q, groups: [], total: 0, ms: 0 };
  const ctx: Ctx = { u, like: likePattern(q), text: q, limit: Math.min(Math.max(limit, 1), 30), cols: await schemaColumns() };
  const [tk, cl, dc, pl, gl, pr, inv, lg, ev, tx, ib] = await Promise.all([
    tasks(ctx), clients(ctx), documents(ctx), places(ctx), goals(ctx),
    venture(ctx, 'property', 'assets', 'money', 'asset', ['address']),
    venture(ctx, 'investment', 'investments', 'money', 'investment', ['ticker']),
    venture(ctx, 'legal', 'legal_cases', 'task', 'legal_case', ['case_number']),
    events(ctx), transactions(ctx), inbox(ctx),
  ]);
  const by: Record<SearchType, SearchResult[]> = {
    task: tk, client: cl, document: dc, entity: pl.entity, branch: pl.branch, goal: gl,
    property: pr, investment: inv, legal: lg, event: ev, transaction: tx, inbox: ib,
  };
  const groups = ORDER.filter(k => by[k].length).map(k => ({ type: k, label: GROUP_LABEL[k], items: by[k] }));
  return { q, groups, total: groups.reduce((a, g) => a + g.items.length, 0), ms: Math.round(performance.now() - t0) };
}

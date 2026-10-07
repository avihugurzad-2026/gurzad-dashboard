import 'server-only';
import { db } from './db';
import { canCreateIn, canDeleteRow, canEditRow, params, visibleSql, type SessionUser } from './auth';
import { contextLabel, encodePlace, hrefFor, placeOptions, type Place } from '@/lib/places';
import type { DocType } from '@/lib/documents';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Documents (3.4). Every read goes through visibleSql with kind 'money': documents are mostly
// invoices, receipts and contracts, so they open to the same roles as the books (admin, manager,
// viewer of the place), plus the uploader's own rows. A missing table (migration not applied)
// reads as `ready: false`.

export type DocVersion = {
  version: number; file_id: string; name: string; size: number; mime: string;
  note: string | null; by: string | null; created_at: string;
};
export type DocumentItem = {
  id: string; title: string; doc_type: DocType; domain: string; branch: string | null; location: string | null;
  context: string; place_href: string; subject_type: string | null; subject_id: string | null;
  doc_date: string | null; notes: string | null; current_version: number; scope: 'user' | 'shared';
  owner: string; owner_name: string | null; created_at: string; updated_at: string;
  versions: DocVersion[];               // newest first
  can_edit: boolean; can_delete: boolean;
};
export type DocFilter = {
  q?: string | null; type?: DocType | null; place?: Partial<Place> | null;
  from?: string | null; to?: string | null;          // doc_date range (falls back to the upload day)
  subject?: { type: string; id: string } | null;
  limit?: number;
};

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
export const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, m => `\\${m}`)}%`;

export async function listDocuments(u: SessionUser, f: DocFilter = {}): Promise<{ ready: boolean; items: DocumentItem[]; more: boolean }> {
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 300);
  const q = params();
  const where = ['d.deleted_at IS NULL', visibleSql(u, 'money', 'd', q.p)];
  if (f.q) {
    const like = q.p(likePattern(f.q));
    where.push(`(d.title ILIKE ${like} OR d.notes ILIKE ${like} OR EXISTS (
      SELECT 1 FROM document_versions v JOIN files fl ON fl.id = v.file_id WHERE v.document_id = d.id AND fl.name ILIKE ${like}))`);
  }
  if (f.type) where.push(`d.doc_type = ${q.p(f.type)}`);
  if (f.place?.domain) where.push(`d.domain = ${q.p(f.place.domain)}`);
  if (f.place?.branch) where.push(`d.branch = ${q.p(f.place.branch)}`);
  if (f.place?.location) where.push(`d.location = ${q.p(f.place.location)}`);
  if (f.subject) where.push(`d.subject_type = ${q.p(f.subject.type)} AND d.subject_id = ${q.p(f.subject.id)}::uuid`);
  const day = `coalesce(d.doc_date, (d.created_at AT TIME ZONE 'Asia/Jerusalem')::date)`;
  if (f.from) where.push(`${day} >= ${q.p(f.from)}::date`);
  if (f.to) where.push(`${day} <= ${q.p(f.to)}::date`);
  try {
    const { rows } = await db().query(
      `SELECT d.id, d.title, d.doc_type, d.domain, d.branch, d.location, d.subject_type, d.subject_id,
              to_char(d.doc_date, 'YYYY-MM-DD') AS doc_date, d.notes, d.current_version, d.scope, d.owner_user_id,
              ou.name AS owner_name, d.created_at, d.updated_at,
              (SELECT coalesce(json_agg(json_build_object(
                  'version', v.version, 'file_id', v.file_id, 'name', fl.name, 'size', fl.size_bytes, 'mime', fl.mime,
                  'note', v.note, 'by', vu.name, 'created_at', v.created_at) ORDER BY v.version DESC), '[]'::json)
               FROM document_versions v JOIN files fl ON fl.id = v.file_id LEFT JOIN users vu ON vu.id = v.created_by
               WHERE v.document_id = d.id) AS versions
       FROM documents d LEFT JOIN users ou ON ou.id = d.owner_user_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${day} DESC, d.created_at DESC
       LIMIT ${limit + 1}`, q.values);
    const items = rows.slice(0, limit).map((r: any): DocumentItem => {
      const place = { domain: r.domain, branch: r.branch, location: r.location };
      const row = { ...place, owner_user_id: r.owner_user_id, scope: r.scope };
      return {
        id: r.id, title: r.title, doc_type: r.doc_type, ...place,
        context: contextLabel(place), place_href: hrefFor(place as Place),
        subject_type: r.subject_type, subject_id: r.subject_id, doc_date: r.doc_date, notes: r.notes,
        current_version: r.current_version, scope: r.scope, owner: r.owner_user_id, owner_name: r.owner_name,
        created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString(),
        versions: (r.versions as any[]).map(v => ({ ...v, created_at: new Date(v.created_at).toISOString() })),
        can_edit: canEditRow(u, 'money', row), can_delete: canDeleteRow(u, 'money', row),
      };
    });
    return { ready: true, items, more: rows.length > limit };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, items: [], more: false };
  }
}

// Places this user may file a document under, optionally only inside `within`
export function documentPlaces(u: SessionUser, within?: Partial<Place> | null): { value: string; label: string }[] {
  return placeOptions()
    .filter(o => canCreateIn(u, o.place, 'money'))
    .filter(o => !within?.domain || (o.place.domain === within.domain
      && (!within.branch || o.place.branch === within.branch)
      && (!within.location || o.place.location === within.location)))
    .map(o => ({ value: encodePlace(o.place), label: o.label }));
}

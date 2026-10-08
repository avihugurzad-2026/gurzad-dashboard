'use server';
import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { canCreateIn, canDeleteRow, canEditRow, currentUser, type SessionUser } from '@/server/auth';
import { db } from '@/server/db';
import { decodePlace } from '@/lib/places';
import { isDocType, isSubjectType, MAX_DOC_BYTES } from '@/lib/documents';

// Writes for documents (3.4): session → permission (kind 'money') → validate → write in one DB
// transaction (file + document + version) → activity_log → revalidate. Soft delete only.
// Files are stored in `files` (≤4 MB, sha256) and downloaded only as attachments.

export type DocResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (error: string): DocResult => ({ ok: false, error });
const NO_ACCESS = fail('אין לך הרשאה לזה');
const NOT_READY = fail('טבלת המסמכים עוד לא נוצרה במסד');

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const tableMissing = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string })?.code ?? '');

function finish(path: string | null): DocResult {
  revalidatePath('/documents');
  revalidatePath('/activity');
  if (path && path.startsWith('/') && !path.startsWith('//')) revalidatePath(path.split('?')[0], 'layout');
  return { ok: true };
}

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function log(c: PoolClient, u: SessionUser, id: string, action: string, meta: Record<string, unknown> = {}) {
  await c.query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'document', $2, $3, $4)`,
    [u.id, id, action, JSON.stringify(meta)]);
}

type Upload = { name: string; mime: string; buf: Buffer; sha: string };
async function readFile(f: FormData): Promise<Upload | string> {
  const file = f.get('file');
  if (!(file instanceof File) || file.size === 0) return 'צרף קובץ';
  if (file.size > MAX_DOC_BYTES) return 'הקובץ גדול מ-4MB';
  const buf = Buffer.from(await file.arrayBuffer());
  return {
    name: (file.name || 'מסמך').slice(0, 200),
    mime: (file.type || 'application/octet-stream').slice(0, 100),
    buf, sha: createHash('sha256').update(buf).digest('hex'),
  };
}

async function insertFile(c: PoolClient, u: SessionUser, up: Upload, scope: string): Promise<string> {
  const { rows } = await c.query(
    `INSERT INTO files (name, mime, size_bytes, sha256, data, owner_user_id, scope) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [up.name, up.mime, up.buf.length, up.sha, up.buf, u.id, scope]);
  return rows[0].id;
}

// New document with its first version
export async function uploadDocument(_: DocResult | null, f: FormData): Promise<DocResult> {
  const u = await currentUser(); if (!u) return fail('לא מחובר');
  const p = decodePlace(str(f, 'place') ?? '');
  if (!p) return fail('בחר לאן המסמך שייך');
  if (!canCreateIn(u, p, 'money')) return NO_ACCESS;
  const docType = str(f, 'doc_type') ?? 'other';
  if (!isDocType(docType)) return fail('סוג מסמך לא תקין');
  const date = str(f, 'doc_date');
  if (date && (!DATE.test(date) || Number.isNaN(Date.parse(date)))) return fail('תאריך לא תקין');
  const notes = str(f, 'notes');
  if (notes && notes.length > 1000) return fail('ההערות ארוכות מדי (עד 1000 תווים)');
  const subjectType = str(f, 'subject_type'), subjectId = str(f, 'subject_id');
  if ((subjectType || subjectId) && !(isSubjectType(subjectType) && subjectId && UUID.test(subjectId))) return fail('שיוך לאובייקט לא תקין');
  const scope = str(f, 'scope') === 'user' ? 'user' : 'shared';
  const up = await readFile(f); if (typeof up === 'string') return fail(up);
  const title = (str(f, 'title') ?? up.name.replace(/\.[^.]{1,8}$/, '')).slice(0, 200).trim() || 'מסמך';
  try {
    await inTx(async c => {
      // The FKs reject an entity/branch that is not in the DB; check first for a friendly message
      if (p.branch) {
        const { rows } = await c.query(`SELECT 1 FROM branches WHERE domain = $1 AND branch = $2`, [p.domain, p.branch]);
        if (!rows.length) throw new Error('bad-place');
      }
      if (p.location) {
        const { rows } = await c.query(`SELECT 1 FROM locations WHERE branch = $1 AND location = $2`, [p.branch, p.location]);
        if (!rows.length) throw new Error('bad-place');
      }
      const fileId = await insertFile(c, u, up, scope);
      const { rows } = await c.query(
        `INSERT INTO documents (title, doc_type, domain, branch, location, subject_type, subject_id, doc_date, notes,
                                owner_user_id, scope, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10) RETURNING id`,
        [title, docType, p.domain, p.branch, p.location, subjectType, subjectId, date, notes, u.id, scope]);
      await c.query(`INSERT INTO document_versions (document_id, version, file_id, created_by) VALUES ($1, 1, $2, $3)`,
        [rows[0].id, fileId, u.id]);
      await log(c, u, rows[0].id, 'create', { title, doc_type: docType, place: p, file: up.name, size: up.buf.length, subject_type: subjectType, subject_id: subjectId });
    });
  } catch (e) {
    if ((e as Error).message === 'bad-place') return fail('שיוך לא תקין');
    if (tableMissing(e)) return NOT_READY;
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
  return finish(str(f, 'path'));
}

// Another version of an existing document. The newest version becomes the current one.
export async function addDocumentVersion(_: DocResult | null, f: FormData): Promise<DocResult> {
  const u = await currentUser(); if (!u) return fail('לא מחובר');
  const id = str(f, 'id');
  if (!id || !UUID.test(id)) return fail('בקשה לא תקינה');
  const note = str(f, 'note');
  if (note && note.length > 300) return fail('ההערה ארוכה מדי (עד 300 תווים)');
  const up = await readFile(f); if (typeof up === 'string') return fail(up);
  try {
    const r = await inTx(async c => {
      const { rows } = await c.query(
        `SELECT domain, branch, location, owner_user_id, scope, current_version FROM documents WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      const doc = rows[0];
      if (!doc || !canEditRow(u, 'money', doc)) return NO_ACCESS;
      const { rows: same } = await c.query(
        `SELECT 1 FROM document_versions v JOIN files fl ON fl.id = v.file_id WHERE v.document_id = $1 AND v.version = $2 AND fl.sha256 = $3`,
        [id, doc.current_version, up.sha]);
      if (same.length) return fail('הקובץ זהה לגרסה הנוכחית');
      const version = doc.current_version + 1;
      const fileId = await insertFile(c, u, up, doc.scope);
      await c.query(`INSERT INTO document_versions (document_id, version, file_id, note, created_by) VALUES ($1, $2, $3, $4, $5)`,
        [id, version, fileId, note, u.id]);
      await c.query(`UPDATE documents SET current_version = $2, updated_at = now() WHERE id = $1`, [id, version]);
      await log(c, u, id, 'version', { version, file: up.name, size: up.buf.length, note });
      return null;
    });
    if (r) return r;
  } catch (e) {
    if (tableMissing(e)) return NOT_READY;
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
  return finish(str(f, 'path'));
}

export async function removeDocument(id: string, path: string | null = null): Promise<DocResult> {
  const u = await currentUser(); if (!u) return fail('לא מחובר');
  if (!UUID.test(id)) return fail('בקשה לא תקינה');
  try {
    const r = await inTx(async c => {
      const { rows } = await c.query(
        `SELECT title, domain, branch, location, owner_user_id, scope FROM documents WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      if (!rows[0] || !canDeleteRow(u, 'money', rows[0])) return NO_ACCESS;
      await c.query(`UPDATE documents SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
      await log(c, u, id, 'delete', { title: rows[0].title });
      return null;
    });
    if (r) return r;
  } catch (e) {
    if (tableMissing(e)) return NOT_READY;
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
  return finish(path);
}

import { NextResponse } from 'next/server';
import { authed, json } from '@/server/http';
import { db } from '@/server/db';
import { currentUser, params, visibleSql } from '@/server/auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Download a stored file. Always as an attachment, never rendered inline (no stored-XSS via uploads).
// You get a file you uploaded, or one attached to a transaction, collection or document version you may see.
export const GET = authed(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return json({ error: 'לא נמצא' }, 404);
  const u = (await currentUser())!;
  const q = params([id, u.id]);
  // Documents (3.4) may not be migrated yet on every database
  const docs = (await db().query(`SELECT to_regclass('public.document_versions') IS NOT NULL AS ok`)).rows[0].ok as boolean;
  const { rows } = await db().query(
    `SELECT f.name, f.data FROM files f WHERE f.id = $1 AND f.deleted_at IS NULL AND (
       f.owner_user_id = $2 ${u.isOwner ? `OR (f.scope = 'shared' ${docs ? `AND NOT EXISTS (SELECT 1 FROM document_versions dv JOIN documents d ON d.id = dv.document_id
                  WHERE dv.file_id = f.id AND d.domain IN ('household', 'personal'))` : ''})` : ''}
       OR EXISTS (SELECT 1 FROM transactions t WHERE t.file_id = f.id AND t.deleted_at IS NULL AND ${visibleSql(u, 'money', 't', q.p)})
       OR EXISTS (SELECT 1 FROM receivables r WHERE r.invoice_file_id = f.id AND r.deleted_at IS NULL AND ${visibleSql(u, 'money', 'r', q.p)})
       ${docs ? `OR EXISTS (SELECT 1 FROM document_versions dv JOIN documents d ON d.id = dv.document_id
                  WHERE dv.file_id = f.id AND d.deleted_at IS NULL AND ${visibleSql(u, 'money', 'd', q.p)})` : ''})`,
    q.values);
  if (!rows.length) return json({ error: 'לא נמצא' }, 404);
  return new NextResponse(new Uint8Array(rows[0].data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}, { admin: false });

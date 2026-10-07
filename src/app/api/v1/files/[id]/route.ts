import { NextResponse } from 'next/server';
import { authed, json } from '@/server/http';
import { db } from '@/server/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Download a stored file. Always as an attachment, never rendered inline (no stored-XSS via uploads).
export const GET = authed(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return json({ error: 'לא נמצא' }, 404);
  const { rows } = await db().query(`SELECT name, data FROM files WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows.length) return json({ error: 'לא נמצא' }, 404);
  return new NextResponse(new Uint8Array(rows[0].data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

import { authed, json } from '@/server/http';
import { currentUser } from '@/server/auth';
import { globalSearch } from '@/server/search';

export const dynamic = 'force-dynamic';

// GET /api/v1/search?q=…&limit=6 → { q, groups: [{ type, label, items: [{ type, id, title, subtitle, href, crumbs }] }], total, ms }
// Signed-in users only (401 otherwise); results are filtered per user. Used by the ⌘K palette.
export const GET = authed(async (req: Request) => {
  const u = (await currentUser())!;
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').slice(0, 100);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 6, 1), 20);
  return json(await globalSearch(u, q, limit));
}, { admin: false });

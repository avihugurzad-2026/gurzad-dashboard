import { authed, json } from '@/server/http';
import { reviewById } from '@/server/data';
import reviewLib from '@domain/review';

// Markdown checklist for pasting into the vault by hand (the app never writes there)
export const GET = authed(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'מזהה לא תקין' }, 400);
  const r = await reviewById(id);
  if (!r) return json({ error: 'סקירה לא נמצאה' }, 404);
  return new Response(reviewLib.exportMarkdown(r), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="review-${r.period}.md"`,
      'Cache-Control': 'no-store',
    },
  });
});

import { after } from 'next/server';
import { handlePush } from '@/server/calendar';

export const dynamic = 'force-dynamic';

// Google Calendar push notifications (events.watch). Public on purpose: Google can't sign in.
// Trust comes from the channel: the X-Goog-Channel-ID must be one of ours and the
// X-Goog-Channel-Token must match the per-channel secret (only its sha256 is stored). The answer
// is always an immediate empty 204, whatever happened — no details leak, and the check + sync run
// after the response (`after`). There is no middleware/proxy gating routes in this app, so
// nothing needs exempting; route handlers check auth themselves.
export async function POST(req: Request) {
  const h = {
    channelId: req.headers.get('x-goog-channel-id'),
    token: req.headers.get('x-goog-channel-token'),
    state: req.headers.get('x-goog-resource-state'),
    resourceId: req.headers.get('x-goog-resource-id'),
  };
  if (h.channelId && h.token) {
    after(async () => {
      try {
        await handlePush(h);
      } catch {
        console.error('Calendar push handling failed');
      }
    });
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

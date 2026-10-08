'use server';
import { revalidatePath } from 'next/cache';
import { currentUser } from '@/server/auth';
import { disconnect } from '@/server/calendar';
import { log, secondsSinceLastGmailImport, syncGmail, type GmailError } from '@/server/gmail';

// Gmail import actions (stage 4). Private to the signed-in user: a sync only creates candidates
// for them to review; nothing is shared until they approve it at /finance-import. Errors are Hebrew.

export type GmailSyncResult =
  | { ok: true; importId: string; added: number; skipped: number; rejected: number; failed: number; more: boolean }
  | { ok: false; error: string };

const MIN_GAP_S = 120;

const MESSAGES: Record<GmailError, string> = {
  not_configured: 'החיבור ל-Google עוד לא הוגדר בשרת.',
  not_connected: 'חשבון Google לא מחובר. חבר אותו קודם.',
  no_scope: 'אין הרשאת קריאה ל-Gmail. לחץ "הוסף הרשאת Gmail" ואשר את ההרשאה.',
  reconnect: 'Google ביטל את ההרשאה. צריך לחבר מחדש.',
  no_workspace: 'לא נמצא המרחב האישי שלך, אין לאן לייבא.',
  busy: 'סנכרון כבר רץ. חכה שיסתיים.',
  google: 'Google לא החזיר תשובה תקינה. נסה שוב בעוד כמה דקות.',
  failed: 'הסנכרון נכשל. לא נשמר כלום, נסה שוב.',
};

export async function syncGmailNow(): Promise<GmailSyncResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  try {
    const since = await secondsSinceLastGmailImport(u);
    if (since !== null && since < MIN_GAP_S) {
      const wait = Math.max(1, Math.ceil((MIN_GAP_S - since) / 60));
      return { ok: false, error: `סנכרון רץ לפני רגע. אפשר לסנכרן שוב בעוד ${wait === 1 ? 'דקה' : `${wait} דקות`}.` };
    }
    const r = await syncGmail(u);
    if (!r.ok) return { ok: false, error: MESSAGES[r.error] };
    revalidatePath('/finance-import', 'layout');
    return r;
  } catch (e) {
    console.error('syncGmailNow failed:', e instanceof Error ? e.name : 'error');
    return { ok: false, error: MESSAGES.failed };
  }
}

// Revokes the user's Google grant and marks the connection disconnected. One Google grant holds
// both Gmail and Calendar, so this disconnects Calendar too (the confirm text says so). Imports
// and candidates already created stay.
export async function disconnectGmail(): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  try {
    await disconnect(u);
    await log(u, u.id, 'gmail_disconnected');
  } catch (e) {
    console.error('disconnectGmail failed:', e instanceof Error ? e.name : 'error');
    return { ok: false, error: 'הניתוק נכשל, נסה שוב.' };
  }
  revalidatePath('/finance-import', 'layout');
  revalidatePath('/settings');
  return { ok: true };
}

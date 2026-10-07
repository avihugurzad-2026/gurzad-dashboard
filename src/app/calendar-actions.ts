'use server';
import { revalidatePath } from 'next/cache';
import { currentUser } from '@/server/auth';
import { decodePlace } from '@/lib/places';
import {
  createEvent, deleteEvent, disconnect, resolveConflict, setMapping, syncNow, updateEvent, type EventInput,
} from '@/server/calendar';

// Google Calendar actions (stage 2.2): event create/edit/delete, conflict choice, and the
// Settings controls. Every action reads the signed-in user; Google is written first, and a
// failed Google call leaves the local data untouched. Errors are Hebrew, for the UI.

export type CalendarActionResult = { ok: true } | { ok: false; error: string; conflict?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_SIGNED_IN: CalendarActionResult = { ok: false, error: 'לא מחובר' };
const BAD: CalendarActionResult = { ok: false, error: 'בקשה לא תקינה' };

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

function done(path?: string | null): CalendarActionResult {
  revalidatePath(path && path.startsWith('/') && !path.startsWith('//') ? path : '/', 'layout');
  return { ok: true };
}

// Create (no `id`) or edit (with `id`) an event from the event dialog's form
export async function saveEventAction(_prev: CalendarActionResult | null, f: FormData): Promise<CalendarActionResult> {
  const u = await currentUser();
  if (!u) return NOT_SIGNED_IN;
  const id = str(f, 'id');
  if (id && !UUID.test(id)) return BAD;
  const packed = str(f, 'place');
  const place = packed ? decodePlace(packed) : null;
  if (packed && !place) return { ok: false, error: 'שיוך לא תקין' };
  const allDay = f.get('all_day') === 'on' || f.get('all_day') === 'true';
  const input: EventInput = {
    title: str(f, 'title') ?? '',
    date: str(f, 'date') ?? '',
    end_date: allDay ? str(f, 'end_date') : null,
    all_day: allDay,
    start_time: allDay ? null : str(f, 'start_time'),
    end_time: allDay ? null : str(f, 'end_time'),
    domain: place?.domain ?? null, branch: place?.branch ?? null, location: place?.location ?? null,
    mapping_id: id ? undefined : str(f, 'mapping_id'),
    description: str(f, 'description'),
  };
  try {
    const r = id ? await updateEvent(u, id, input) : await createEvent(u, input);
    if (!r.ok) {
      if (r.conflict) revalidatePath('/', 'layout');
      return { ok: false, error: r.error, conflict: r.conflict };
    }
  } catch (e) {
    console.error('saveEvent failed:', e instanceof Error ? e.name : 'error');
    return { ok: false, error: 'לא נשמר, נסה שוב' };
  }
  return done(str(f, 'path'));
}

export async function deleteEventAction(id: string, path?: string): Promise<CalendarActionResult> {
  const u = await currentUser();
  if (!u) return NOT_SIGNED_IN;
  if (!UUID.test(id)) return BAD;
  try {
    const r = await deleteEvent(u, id);
    if (!r.ok) return r;
  } catch {
    return { ok: false, error: 'לא נמחק, נסה שוב' };
  }
  return done(path);
}

export async function resolveConflictAction(id: string, choice: 'mine' | 'google', path?: string): Promise<CalendarActionResult> {
  const u = await currentUser();
  if (!u) return NOT_SIGNED_IN;
  if (!UUID.test(id) || (choice !== 'mine' && choice !== 'google')) return BAD;
  try {
    const r = await resolveConflict(u, id, choice);
    if (!r.ok) {
      revalidatePath('/', 'layout');
      return { ok: false, error: r.error, conflict: r.conflict };
    }
  } catch {
    return { ok: false, error: 'לא נשמר, נסה שוב' };
  }
  return done(path);
}

// ── Settings ──────────────────────────────────────────────────────────────────
export async function setCalendarMappingAction(id: string, enabled: boolean, packedPlace: string): Promise<CalendarActionResult> {
  const u = await currentUser();
  if (!u) return NOT_SIGNED_IN;
  if (!UUID.test(id)) return BAD;
  const p = packedPlace ? decodePlace(packedPlace) : null;
  if (packedPlace && !p) return { ok: false, error: 'שיוך לא תקין' };
  try {
    await setMapping(id, { is_enabled: enabled, domain: p?.domain ?? null, branch: p?.branch ?? null, location: p?.location ?? null }, u);
  } catch {
    return { ok: false, error: 'לא נשמר' };
  }
  return done('/settings');
}

export async function setCalendarShareAction(id: string, shared: boolean): Promise<CalendarActionResult> {
  const u = await currentUser();
  if (!u) return NOT_SIGNED_IN;
  if (!UUID.test(id)) return BAD;
  try {
    await setMapping(id, { scope: shared ? 'shared' : 'user' }, u);
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message === 'Not allowed' ? 'אין לך הרשאה לשתף יומן במקום הזה' : 'לא נשמר' };
  }
  return done('/');
}

export async function setDefaultWriteCalendarAction(id: string): Promise<CalendarActionResult> {
  const u = await currentUser();
  if (!u) return NOT_SIGNED_IN;
  if (!UUID.test(id)) return BAD;
  try {
    await setMapping(id, { is_default_write: true }, u);
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message === 'Calendar is not writable' ? 'אי אפשר לכתוב ליומן הזה' : 'לא נשמר' };
  }
  return done('/settings');
}

export async function calendarRefreshAction(): Promise<CalendarActionResult> {
  const u = await currentUser();
  if (!u) return NOT_SIGNED_IN;
  const r = await syncNow(u);
  if (!r.ok) {
    revalidatePath('/settings');
    return { ok: false, error: ['invalid_grant', 'http_401', 'unauthorized_client', 'token_unreadable'].includes(r.error ?? '') ? 'Google ביטל את ההרשאה. צריך לחבר מחדש.' : 'הסנכרון נכשל, נסה שוב' };
  }
  return done('/');
}

export async function calendarDisconnectAction(): Promise<CalendarActionResult> {
  const u = await currentUser();
  if (!u) return NOT_SIGNED_IN;
  await disconnect(u);
  return done('/');
}

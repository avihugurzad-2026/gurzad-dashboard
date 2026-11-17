import { DEMO } from './config';
import { api } from './api';
import { store, useCollection } from '../data/store';
import { mergeReminders, PLAN_COLLECTIONS, SETTINGS_KEY, type ReminderSettings } from '../../shared/planner';

/** The owner's reminder templates live in one record of the `settings` collection. */
export function useReminderSettings(): ReminderSettings {
  const rows = useCollection('settings');
  return mergeReminders(rows.find((r) => r.key === SETTINGS_KEY));
}
export function saveReminderSettings(patch: Partial<ReminderSettings>) {
  const cur = store.all('settings').find((r) => r.key === SETTINGS_KEY);
  if (cur) store.update('settings', cur.id, patch);
  else store.add('settings', { key: SETTINGS_KEY, ...patch });
}

/** After a task or event is saved: if someone new was assigned, the server emails them (template "on assignment").
    The server re-reads the record itself and only writes to addresses of workspace members. */
export function notifyAssigned(collection: string, id: string, data: Record<string, any>, prev: Record<string, any> | null, toast: (t: string) => void) {
  if (!(PLAN_COLLECTIONS as readonly string[]).includes(collection)) return;
  const email = data.assignee_email;
  if (!email || email === prev?.assignee_email) return;
  const s = mergeReminders(store.all('settings').find((r) => r.key === SETTINGS_KEY));
  if (!s.enabled || !s.on_assign) return;
  if (DEMO) { setTimeout(() => toast(`בהדגמה לא נשלח מייל. בחיבור אמיתי ${data.assignee} מקבל הודעה`), 900); return; }
  const send = (left: number) => {
    api('/api/notify', { body: { action: 'assigned', collection, id } })
      .then((r) => { if (r.sent) toast(`נשלח מייל אל ${data.assignee}`); })
      .catch(() => { if (left > 0) setTimeout(() => send(left - 1), 3000); });
  };
  setTimeout(() => send(1), 1500); // let the record reach the database first
}

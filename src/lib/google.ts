import { useCallback, useEffect, useState } from 'react';
import { DEMO } from './config';
import { api } from './api';
import { addDays, today } from './format';

export type GoogleEvent = { id: string; title: string; date: string; time?: string; end_time?: string; place?: string; link?: string; allDay?: boolean };
export type GoogleStatus = { ready: boolean; connected: boolean; email?: string; push?: boolean; synced_at?: string | null };

/** Each signed-in user connects their own Google Calendar. Tokens stay on the server; the app only sees events. */
let demoConnected = (() => { try { return localStorage.getItem('gd-demo-google') === '1'; } catch { return false; } })();
const DEMO_EVENTS = (): GoogleEvent[] => [
  { id: 'g1', title: 'שיחת זום עם רו״ח', date: today(), time: '15:00', end_time: '15:45' },
  { id: 'g2', title: 'יום הולדת לאמא', date: addDays(today(), 3), allDay: true },
  { id: 'g3', title: 'טיסה לאילת', date: addDays(today(), 6), time: '06:40' },
  { id: 'g4', title: 'כנס שיווק דיגיטלי', date: addDays(today(), 11), time: '09:00', place: 'תל אביב' },
];

let lastAuto = 0;
export function useGoogle(from: string, to: string) {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [events, setEvents] = useState<GoogleEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (DEMO) {
      setStatus({ ready: true, connected: demoConnected, email: demoConnected ? 'you@gmail.com' : undefined, push: true });
      setEvents(demoConnected ? DEMO_EVENTS().filter((e) => e.date >= from && e.date <= to) : []);
      return;
    }
    try {
      const s = await api<GoogleStatus>('/api/google?action=status');
      setStatus(s);
      if (s.connected) setEvents((await api<{ events: GoogleEvent[] }>(`/api/google?action=events&from=${from}&to=${to}`)).events);
      else setEvents([]);
      setError('');
    } catch (e: any) { setStatus((x) => x ?? { ready: false, connected: false }); setError(e.message); }
  }, [from, to]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Pull from Google again every 5 minutes while the app is open, and whenever the app comes back to the screen.
  useEffect(() => {
    if (DEMO) return;
    const again = () => { if (document.visibilityState === 'visible') void refresh(); };
    const t = setInterval(again, 5 * 60e3);
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again); };
  }, [refresh]);

  // Send dashboard changes to Google automatically: when the last send is over 30 minutes old (at most once per 30 minutes).
  useEffect(() => {
    if (DEMO || !status?.connected || status.push === false) return;
    const last = status.synced_at ? Date.parse(status.synced_at) : 0;
    if (Date.now() - last < 30 * 60e3 || Date.now() - lastAuto < 30 * 60e3) return;
    lastAuto = Date.now();
    void api('/api/google?action=sync', { body: {} }).catch(() => null);
  }, [status]);

  const connect = async () => {
    if (DEMO) { demoConnected = true; try { localStorage.setItem('gd-demo-google', '1'); } catch { /* */ } await refresh(); return; }
    const { url } = await api<{ url: string }>('/api/google?action=start');
    location.href = url;
  };
  const disconnect = async () => {
    if (DEMO) { demoConnected = false; try { localStorage.removeItem('gd-demo-google'); } catch { /* */ } await refresh(); return; }
    await api('/api/google?action=disconnect', { method: 'POST', body: {} });
    await refresh();
  };
  const syncNow = async () => {
    setBusy(true);
    try {
      if (DEMO) { await new Promise((r) => setTimeout(r, 700)); return { pushed: 5 }; }
      const r = await api<{ pushed: number }>('/api/google?action=sync', { body: {} });
      await refresh();
      return r;
    } finally { setBusy(false); }
  };
  const setPush = async (push: boolean) => {
    if (!DEMO) await api('/api/google?action=prefs', { body: { push } });
    setStatus((s) => (s ? { ...s, push } : s));
  };
  return { status, events, busy, error, connect, disconnect, syncNow, setPush, refresh };
}

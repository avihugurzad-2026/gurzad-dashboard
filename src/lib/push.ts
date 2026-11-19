import { useEffect, useState, useCallback } from 'react';
import { DEMO } from './config';
import { api } from './api';
import { ls } from './safeStorage';
import { isIOS, isStandalone, swRegistration, swSupported } from './pwa';
import { DEFAULT_NOTIFY_PREFS, type NotifyPrefs } from '../../shared/alerts';

/* Phone notifications (Web Push). On iPhone/iPad this only works after the app was added to the home screen. */
export type PushState = 'unsupported' | 'needs-install' | 'blocked' | 'off' | 'on' | 'server-off';
const PREFS = 'gurzad-v3-notify';
const DEMO_ON = 'gurzad-v3-notify-demo';

export const loadPrefs = (): NotifyPrefs => { try { return { ...DEFAULT_NOTIFY_PREFS, ...JSON.parse(ls.get(PREFS) || '{}') }; } catch { return DEFAULT_NOTIFY_PREFS; } };
const supported = () => swSupported && 'PushManager' in window && 'Notification' in window;
const device = () => (isIOS ? 'iPhone / iPad' : /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'מחשב') + (isStandalone() ? ' · אפליקציה' : ' · דפדפן');
const b64 = (s: string) => Uint8Array.from(atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIOS && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (DEMO) return Notification.permission === 'granted' && ls.get(DEMO_ON) ? 'on' : 'off';
  const reg = await swRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush(prefs: NotifyPrefs): Promise<PushState> {
  if (!supported()) return pushState();
  const perm = await Notification.requestPermission();   // must run from a tap
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
  ls.set(PREFS, JSON.stringify(prefs));
  if (DEMO) { ls.set(DEMO_ON, '1'); return 'on'; }
  const { ready, publicKey } = await api<{ ready: boolean; publicKey: string }>('/api/push');
  if (!ready || !publicKey) return 'server-off';
  const reg = await swRegistration();
  if (!reg) return 'unsupported';
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) }));
  await api('/api/push', { body: { subscription: sub.toJSON(), prefs, device: device() } });
  return 'on';
}

export async function savePrefs(prefs: NotifyPrefs) {
  ls.set(PREFS, JSON.stringify(prefs));
  if (DEMO) return;
  const sub = await (await swRegistration())?.pushManager.getSubscription();
  if (sub) await api('/api/push', { body: { subscription: sub.toJSON(), prefs, device: device() } });
}

export async function disablePush() {
  if (DEMO) { ls.del(DEMO_ON); return; }
  const sub = await (await swRegistration())?.pushManager.getSubscription();
  if (!sub) return;
  await api('/api/push', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => { /* still unsubscribe locally */ });
  await sub.unsubscribe();
}

/** Sends a real notification to this device (through the server when connected, locally in demo mode). */
export async function testPush(sample?: { title: string; body: string; url: string }) {
  const reg = await swRegistration();
  if (DEMO || !reg) {
    const msg = sample ?? { title: 'ההתראות פועלות', body: 'כך ייראו התראות מהדשבורד בטלפון שלך.', url: '/notifications' };
    if (reg?.active) reg.active.postMessage({ type: 'notify', tag: 'test', ...msg });
    else new Notification(msg.title, { body: msg.body, dir: 'rtl', lang: 'he' });
    return;
  }
  const sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('המכשיר הזה לא רשום להתראות');
  await api('/api/push', { body: { endpoint: sub.endpoint, test: true } });
}

export function usePush() {
  const [state, setState] = useState<PushState | null>(null);
  const refresh = useCallback(() => { void pushState().then(setState).catch(() => setState('unsupported')); }, []);
  useEffect(() => { refresh(); document.addEventListener('visibilitychange', refresh); return () => document.removeEventListener('visibilitychange', refresh); }, [refresh]);
  return { state, setState, refresh };
}

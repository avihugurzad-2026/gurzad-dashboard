import { useSyncExternalStore } from 'react';
import { ls } from './safeStorage';

/* Installable-app plumbing: service worker, install prompt, standalone detection, app badge. */
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const ua = navigator.userAgent;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();
export const swSupported = 'serviceWorker' in navigator && location.protocol.startsWith('http') && !framed;

let deferred: BIP | null = null;
let reg: ServiceWorkerRegistration | null = null;
const subs = new Set<() => void>();
const emit = () => { snap = { ...snap, canPrompt: !!deferred, standalone: isStandalone() }; subs.forEach((s) => s()); };
const DISMISS = 'gurzad-v3-install-dismissed';
let snap = { canPrompt: false, standalone: isStandalone(), dismissed: !!ls.get(DISMISS) };

export function initPwa(onNavigate: (url: string) => void) {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIP; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
  matchMedia('(display-mode: standalone)').addEventListener?.('change', emit);
  if (!swSupported) return;
  if (import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').then((r) => { reg = r; }).catch(() => { /* app still works without it */ });
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'navigate' && typeof e.data.url === 'string') onNavigate(e.data.url); });
}
export const swRegistration = async () => reg ?? (swSupported ? (await navigator.serviceWorker.getRegistration()) ?? null : null);

export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null; emit();
  return outcome === 'accepted';
}
export function dismissInstall() { ls.set(DISMISS, '1'); snap = { ...snap, dismissed: true }; subs.forEach((s) => s()); }
export function useInstall() {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => snap);
}

/** Number on the home-screen icon (installed app only; silently ignored elsewhere). */
export function setBadge(n: number) {
  const nav = navigator as any;
  try { if (n > 0) nav.setAppBadge?.(n); else nav.clearAppBadge?.(); } catch { /* unsupported */ }
}

/** Short tactile tick on Android; iOS ignores it. */
export const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* ignore */ } };

import { useSyncExternalStore } from 'react';
import { ls } from './safeStorage';
import { setHideAmounts } from './format';

type Prefs = { theme: 'auto' | 'light' | 'dark'; hide: boolean };
const KEY = 'gurzad-v3-prefs';
let prefs: Prefs = { theme: 'auto', hide: false };
try { prefs = { ...prefs, ...JSON.parse(ls.get(KEY) || '{}') }; } catch { /* ignore */ }
const subs = new Set<() => void>();

function apply() {
  const el = document.documentElement;
  if (prefs.theme === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', prefs.theme);
  setHideAmounts(prefs.hide);
}
apply();

export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...prefs, ...p };
  ls.set(KEY, JSON.stringify(prefs));
  apply();
  subs.forEach((s) => s());
}
export function usePrefs() {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => prefs);
}
export const isDark = () => prefs.theme === 'dark' || (prefs.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);

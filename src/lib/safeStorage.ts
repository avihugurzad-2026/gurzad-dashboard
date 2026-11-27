// localStorage can throw (private mode, sandboxed iframes). Never let it break the app.
export const ls = {
  get(key: string): string | null {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  },
  set(key: string, value: string) {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* quota / blocked */ }
  },
  del(key: string) {
    try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ }
  },
};

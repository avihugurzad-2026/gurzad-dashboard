import { useMemo, useSyncExternalStore } from 'react';
import { PLAN_COLLECTIONS } from '../../shared/planner';
import type { Collection, Rec } from './types';
import { buildSeed } from './seed';
import { DEMO } from '../lib/config';
import { ls } from '../lib/safeStorage';
import { supabase } from '../lib/supabase';
import { uid } from '../lib/format';

// A change to a task/event is sent to the user's Google Calendar a few seconds later (one send for a burst of edits).
const PLAN = new Set<string>(PLAN_COLLECTIONS);
let pushTimer: ReturnType<typeof setTimeout> | undefined;
function pushSoon(c: string) {
  if (!PLAN.has(c)) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void import('../lib/api').then(({ api }) => api('/api/google?action=sync', { body: {} })).catch(() => null); }, 4000);
}

type DB = Record<string, Rec[]>;
const KEY = 'gurzad-v3.3-demo';
const EMPTY: Rec[] = [];

let db: DB = {};
let ready = false;
let workspaceId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/* ---------- adapters ---------- */
const demoAdapter = {
  async load(): Promise<DB> {
    const raw = ls.get(KEY);
    if (raw) { try { return JSON.parse(raw); } catch { /* fallthrough */ } }
    const seed = buildSeed();
    ls.set(KEY, JSON.stringify(seed));
    return seed;
  },
  persist() { ls.set(KEY, JSON.stringify(db)); },
  async put(_c: string, _r: Rec) { this.persist(); },
  async del(_c: string, _id: string) { this.persist(); },
};

const sbAdapter = {
  async load(): Promise<DB> {
    const sb = supabase!;
    const { data: m } = await sb.from('gd_memberships').select('workspace_id').limit(1).maybeSingle();
    workspaceId = m?.workspace_id ?? null;
    if (!workspaceId) return {};
    const out: DB = {};
    // paginate in case the workspace grows
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('gd_records').select('id, collection, data, created_at')
        .eq('workspace_id', workspaceId).range(from, from + 999);
      if (error) throw error;
      (data ?? []).forEach((row) => {
        (out[row.collection] ||= []).push({ ...(row.data as object), id: row.id, created_at: row.created_at });
      });
      if (!data || data.length < 1000) break;
    }
    return out;
  },
  async put(c: string, r: Rec) {
    const { id, created_at, ...data } = r;
    void created_at;
    const { error } = await supabase!.from('gd_records').upsert({ id, workspace_id: workspaceId, collection: c, data });
    if (error) throw error;
    pushSoon(c);
  },
  async del(c: string, id: string) {
    const { error } = await supabase!.from('gd_records').delete().eq('id', id);
    if (error) throw error;
    pushSoon(c);
  },
};

const adapter = DEMO ? demoAdapter : sbAdapter;

/* ---------- public API ---------- */
export async function initStore() {
  db = await adapter.load();
  ready = true;
  emit();
  if (!DEMO) startLiveSync();
}

/* ---------- live sync (Supabase Realtime) ----------
   Another device or member changes a record → it appears here without a reload. RLS applies to the stream.
   Coming back to the app after a while re-reads everything, which also covers a dropped socket. */
let live = false;
let lastLoad = Date.now();
function startLiveSync() {
  if (live || !workspaceId) return;
  live = true;
  const strip = (row: any): Rec => ({ ...(row.data as object), id: row.id, created_at: row.created_at });
  supabase!.channel('gd-records')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gd_records', filter: `workspace_id=eq.${workspaceId}` }, (p) => {
      if (p.eventType === 'DELETE') {
        const id = (p.old as any)?.id;
        if (!id) return;
        const next: DB = {};
        let hit = false;
        for (const [c, rows] of Object.entries(db)) { const f = rows.filter((r) => r.id !== id); hit ||= f.length !== rows.length; next[c] = f; }
        if (hit) { db = next; emit(); }
        return;
      }
      const row = p.new as any;
      const cur = db[row.collection] ?? [];
      const rec = strip(row);
      const i = cur.findIndex((r) => r.id === rec.id);
      if (i >= 0 && JSON.stringify(cur[i]) === JSON.stringify(rec)) return; // our own write echoing back
      setCol(row.collection, i >= 0 ? cur.map((r) => (r.id === rec.id ? rec : r)) : [rec, ...cur]);
    })
    .subscribe();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastLoad < 60_000) return;
    lastLoad = Date.now();
    void adapter.load().then((fresh) => { db = fresh; emit(); }).catch(() => { /* keep what we have */ });
  });
}
export const isReady = () => ready;

export function resetDemo() {
  if (!DEMO) return;
  db = buildSeed();
  demoAdapter.persist();
  emit();
}

function setCol(c: string, rows: Rec[]) {
  db = { ...db, [c]: rows };
  emit();
}

export const store = {
  all(c: Collection): Rec[] { return db[c] ?? EMPTY; },
  get(c: Collection, id: string) { return (db[c] ?? EMPTY).find((r) => r.id === id); },
  add(c: Collection, data: Record<string, any>): Rec {
    const rec: Rec = { id: uid(), created_at: new Date().toISOString(), ...data };
    setCol(c, [rec, ...(db[c] ?? [])]);
    void adapter.put(c, rec).catch(onError);
    return rec;
  },
  update(c: Collection, id: string, patch: Record<string, any>) {
    let next: Rec | undefined;
    setCol(c, (db[c] ?? []).map((r) => (r.id === id ? (next = { ...r, ...patch }) : r)));
    if (next) void adapter.put(c, next).catch(onError);
  },
  remove(c: Collection, id: string): () => void {
    const prev = db[c] ?? [];
    const idx = prev.findIndex((r) => r.id === id);
    const rec = prev[idx];
    setCol(c, prev.filter((r) => r.id !== id));
    void adapter.del(c, id).catch(onError);
    return () => {
      if (!rec) return;
      const cur = [...(db[c] ?? [])];
      cur.splice(Math.min(idx, cur.length), 0, rec);
      setCol(c, cur);
      void adapter.put(c, rec).catch(onError);
    };
  },
  removeWhere(c: Collection, pred: (r: Rec) => boolean): () => void {
    const prev = db[c] ?? [];
    const gone = prev.filter(pred);
    setCol(c, prev.filter((r) => !pred(r)));
    gone.forEach((g) => void adapter.del(c, g.id).catch(onError));
    return () => { setCol(c, [...gone, ...(db[c] ?? [])]); gone.forEach((g) => void adapter.put(c, g).catch(onError)); };
  },
};

let errorHandler: (e: unknown) => void = (e) => console.error(e);
export const onStoreError = (fn: (e: unknown) => void) => { errorHandler = fn; };
function onError(e: unknown) { errorHandler(e); }

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function useCollection(c: Collection, filter?: (r: Rec) => boolean, deps: unknown[] = []): Rec[] {
  const rows = useSyncExternalStore(subscribe, () => db[c] ?? EMPTY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (filter ? rows.filter(filter) : rows), [rows, ...deps]);
}
export function useRecord(c: Collection, id?: string) {
  const rows = useSyncExternalStore(subscribe, () => db[c] ?? EMPTY);
  return useMemo(() => rows.find((r) => r.id === id), [rows, id]);
}
export function useStoreReady() { return useSyncExternalStore(subscribe, () => ready); }

/* ---------- photos ---------- */
export async function uploadPhoto(file: File, propertyId: string): Promise<{ url: string; path?: string }> {
  if (DEMO) return { url: await downscale(file, 1200) };
  const path = `${workspaceId}/${propertyId}/${uid()}.jpg`;
  const blob = await downscaleBlob(file, 2000);
  const { error } = await supabase!.storage.from('gd-property-photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  const { data } = await supabase!.storage.from('gd-property-photos').createSignedUrl(path, 60 * 60 * 24 * 7);
  return { url: data?.signedUrl ?? '', path };
}
export async function signedPhotoUrl(path: string) {
  if (DEMO || !path) return '';
  const { data } = await supabase!.storage.from('gd-property-photos').createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? '';
}

async function downscaleBlob(file: File, max: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob((b) => res(b!), 'image/jpeg', 0.82));
}
async function downscale(file: File, max: number): Promise<string> {
  const b = await downscaleBlob(file, max);
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(b); });
}

/** Recompute a derived value whenever any collection changes. */
export function useDerived<T>(fn: () => T, deps: unknown[] = []): T {
  const snap = useSyncExternalStore(subscribe, () => db);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(fn, [snap, ...deps]);
}

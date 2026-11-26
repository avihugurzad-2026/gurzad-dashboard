import { useSyncExternalStore } from 'react';
import { api } from './api';
import { DEMO } from './config';
import type { ConnectionView, OpsSnapshot, ProviderInfo, RevenueSnapshot } from '../../shared/integrations';

// Live revenue pulled from each business's connected systems (Buyz, Morning…).
// Fetched once per app session, refreshed every few minutes while the app is open and when the tab
// becomes visible again. The server re-syncs a connection when its data is older than 15 minutes,
// and a daily cron keeps it fresh even when nobody opens the app.

type State = { providers: ProviderInfo[]; byBusiness: Record<string, ConnectionView[]>; loadedAt: number };
let state: State = { providers: [], byBusiness: {}, loadedAt: 0 };
const subs = new Set<() => void>();
let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 5 * 60e3;

function emit() { subs.forEach((f) => f()); }

export function refreshBizRevenue(): Promise<void> {
  if (DEMO) return Promise.resolve();
  if (!inflight) {
    inflight = api<{ providers: ProviderInfo[]; byBusiness: Record<string, ConnectionView[]> }>('/api/integrations')
      .then((r) => { state = { providers: r.providers, byBusiness: r.byBusiness ?? {}, loadedAt: Date.now() }; emit(); })
      .catch(() => { /* keep the last data; the next poll retries */ })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Replace one business's connections after a connect/sync/disconnect from the settings screen. */
export function setBizConnections(bizId: string, conns: ConnectionView[]) {
  state = { ...state, byBusiness: { ...state.byBusiness, [bizId]: conns } };
  emit();
}

function onVisible() { if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > 60e3) refreshBizRevenue(); }

function subscribe(f: () => void) {
  subs.add(f);
  if (subs.size === 1) {
    if (Date.now() - state.loadedAt > 60e3) refreshBizRevenue();
    timer = setInterval(refreshBizRevenue, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
  }
  return () => {
    subs.delete(f);
    if (!subs.size) { if (timer) clearInterval(timer); timer = null; document.removeEventListener('visibilitychange', onVisible); }
  };
}

export function useBizRevenueState(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export type BizRevenue = { provider: string; name: string; snap: RevenueSnapshot; lastSyncAt: string | null };

/** Revenue snapshots of one business (one per connected system that pulled revenue). */
export function revenueOf(s: State, bizId: string): BizRevenue[] {
  return (s.byBusiness[bizId] ?? [])
    .filter((c) => c.status !== 'disconnected' && c.snapshots.revenue)
    .map((c) => ({ provider: c.provider, name: s.providers.find((p) => p.id === c.provider)?.name ?? c.provider, snap: c.snapshots.revenue.data as RevenueSnapshot, lastSyncAt: c.lastSyncAt }));
}

/**
 * Monthly income before VAT from the connected systems, as { 'YYYY-MM': amount }.
 * Buyz reports amounts as issued (VAT included), so they are divided by 1 + VAT of that month.
 */
export function externalIncome(revs: BizRevenue[], vatRate: (date: string) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of revs) {
    const incl = r.snap.vatIncluded !== false;
    for (const m of r.snap.monthly) {
      const net = incl ? m.total / (1 + vatRate(m.month + '-01')) : m.total;
      out[m.month] = (out[m.month] ?? 0) + net;
    }
  }
  return out;
}

export function useBizRevenue(bizId: string) {
  const s = useBizRevenueState();
  return revenueOf(s, bizId);
}

/** Operational data from the Buyz database connection, if connected. */
export function opsOf(s: State, bizId: string): OpsSnapshot | null {
  const c = (s.byBusiness[bizId] ?? []).find((x) => x.status !== 'disconnected' && x.snapshots.ops);
  return c ? (c.snapshots.ops.data as OpsSnapshot) : null;
}
export function useBizOps(bizId: string) { return opsOf(useBizRevenueState(), bizId); }

/** Monthly expenses from the connected system (Buyz fixed/variable expenses), as { 'YYYY-MM': amount }. */
export function externalExpense(ops: OpsSnapshot | null): Record<string, number> {
  return Object.fromEntries((ops?.expenses.byMonth ?? []).map((m) => [m.month, m.total]));
}

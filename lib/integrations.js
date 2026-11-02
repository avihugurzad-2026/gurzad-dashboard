// Integrations (stage 3.2): pull a branch's data source into local tables, one row per sync in
// activity_log. Today the only provider is Buyz (Head Spa Israel). Pure helpers + a sync that
// takes the pg pool and fetch as arguments, so tests run with a fake pool and a mocked fetch.
//
// Security rules (owner's): the Buyz key lives only in an env var named by credentials_ref
// ('env:BUYZ_API_KEY'); it is never stored, logged or returned. `transactions` (customer names)
// is never requested, and nothing personal is stored: customers/cancellations are kept only as
// aggregate numbers, and only when Buyz returns them.
'use strict';

const { ingestBuyz } = require('./revenue');

const BUYZ_ENDPOINT = 'https://buyz.co.il/api/revenue.php';
const BUYZ_PARTS = 'summary,daily,methods,sales';       // never 'transactions'

// Only names of the provider's own variables may be read: a row can never point the sync at
// JWT_SECRET or DATABASE_URL and send it to a third party.
const ENV_ALLOWED = { buyz: /^BUYZ_API_KEY(_[A-Z0-9]{1,40})?$/ };

class SyncError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Hebrew, safe to show and store: never contains the key or a response body
const ERROR_TEXT = {
  no_ref: 'לחיבור אין הפניה למפתח (credentials_ref)',
  bad_ref: 'הפניה למפתח לא חוקית (מותר רק env:BUYZ_API_KEY…)',
  no_key: 'המפתח לא מוגדר בסביבת השרת',
  bad_config: 'הגדרות החיבור חסרות (source_account / amounts_include_vat)',
  unauthorized: 'Buyz דחה את המפתח',
  unreachable: 'Buyz לא זמין כרגע',
  bad_response: 'Buyz החזיר תשובה במבנה לא צפוי',
  account_mismatch: 'המפתח שייך לחשבון Buyz אחר מזה שמוגדר לסניף',
  unmapped: 'חשבון Buyz לא ממופה לסניף',
  failed: 'הסנכרון נכשל',
};

function resolveCredential(provider, ref, env = process.env) {
  if (!ref) throw new SyncError('no_ref', ERROR_TEXT.no_ref);
  const m = /^env:([A-Z][A-Z0-9_]{0,63})$/.exec(ref);
  const allowed = ENV_ALLOWED[provider];
  if (!m || !allowed || !allowed.test(m[1])) throw new SyncError('bad_ref', ERROR_TEXT.bad_ref);
  const v = env[m[1]];
  if (!v) throw new SyncError('no_key', ERROR_TEXT.no_key);
  return v;
}

// Numbers only: a string like "1,200" is fine; arrays/objects (e.g. a customer list) are not numbers
function num(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const x = typeof v === 'number' ? v : Number(v.replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
}
const int = v => { const x = num(v); return x === null ? null : Math.round(x); };
const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, max);
const arr = v => (Array.isArray(v) ? v : []);
const first = (o, keys) => { for (const k of keys) { const x = num(o?.[k]); if (x !== null) return x; } return null; };

// summary.by_source items are {total, count}; daily rows carry plain numbers
const part = v => (v && typeof v === 'object' ? { total: num(v.total), count: int(v.count) } : { total: num(v), count: null });

// Month range for a 'YYYY-MM' (to = last day, or today when the month is current)
function monthRange(month, today) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: today && today < last ? today : last };
}
function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Raw Buyz response for one month → rows for the local tables. Nothing personal is read:
// `transactions` is ignored even if present; names come only from items and sellers (staff).
function mapBuyzMonth(raw, month) {
  if (!raw || typeof raw !== 'object' || raw.success === false) throw new SyncError('bad_response', ERROR_TEXT.bad_response);
  const d = raw.data && typeof raw.data === 'object' && !raw.summary ? raw.data : raw;
  if (!d.summary || typeof d.summary !== 'object') throw new SyncError('bad_response', ERROR_TEXT.bad_response);
  const supplier = raw.supplier ?? d.supplier;
  const account = supplier?.id === undefined || supplier?.id === null ? null : String(supplier.id);
  const sm = d.summary;
  const src = sm.by_source ?? {};
  const b = part(src.bookings), v = part(src.vouchers), s = part(src.sales);
  const sales = d.sales && typeof d.sales === 'object' ? d.sales : null;
  const summary = {
    month: `${month}-01`,
    revenue_total: num(sm.revenue_total), tx_count: int(sm.transactions_count),
    average_transaction: num(sm.average_transaction), unpaid_total: num(sm.unpaid_total),
    bookings_total: b.total, bookings_count: b.count, vouchers_total: v.total, vouchers_count: v.count,
    sales_total: s.total, sales_count: s.count, orders_count: int(sales?.orders_count),
    // Aggregates only, and only if Buyz sends them. Never counted from a list of people.
    customers_count: int(first(sm, ['customers_count', 'unique_customers', 'customers_total'])),
    new_customers_count: int(first(sm, ['new_customers_count', 'new_customers'])),
    cancellations_count: int(first(sm, ['cancellations_count', 'cancelled_count', 'canceled_count', 'cancellations'])),
  };
  const inMonth = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && x.slice(0, 7) === month;
  const daily = [];
  for (const r of arr(d.daily)) {
    const day = str(r?.date ?? r?.day, 10);
    const total = num(r?.revenue_total);
    if (!inMonth(day) || total === null) continue;
    daily.push({ day, revenue_total: total, tx_count: int(r.count), bookings: part(r.bookings).total, vouchers: part(r.vouchers).total, sales: part(r.sales).total });
  }
  const named = list => {
    const out = new Map();
    for (const x of arr(list)) {
      const name = str(x?.name ?? x?.title ?? x?.label ?? x?.seller, 200);
      if (!name || out.has(name)) continue;
      out.set(name, { name, count: num(x?.count ?? x?.qty ?? x?.quantity), total: num(x?.total ?? x?.revenue) });
    }
    return [...out.values()];
  };
  const methods = [];
  const seen = new Set();
  for (const m of arr(d.by_payment_method ?? d.methods)) {
    const method = str(m?.method, 100);
    if (!method || seen.has(method)) continue;
    seen.add(method);
    methods.push({ method, label: str(m.label || method, 100), count: int(m.count), total: num(m.total) });
  }
  return { account, summary, daily, items: named(sales?.top_items), staff: named(sales?.by_seller), methods };
}

async function fetchBuyzMonth({ key, month, today, fetchImpl = fetch }) {
  const url = new URL(BUYZ_ENDPOINT);
  const { from, to } = monthRange(month, today);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('include', BUYZ_PARTS);
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'X-API-Key': key, Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    throw new SyncError('unreachable', ERROR_TEXT.unreachable);
  }
  if (res.status === 401 || res.status === 403) throw new SyncError('unauthorized', ERROR_TEXT.unauthorized);
  const raw = await res.json().catch(() => null);
  if (raw && (raw.error === 'invalid_api_key' || raw.error === 'missing_api_key')) throw new SyncError('unauthorized', ERROR_TEXT.unauthorized);
  if (!res.ok && !raw) throw new SyncError('unreachable', ERROR_TEXT.unreachable);
  return raw;
}

// Company overview: sum the branches. A total is null when no branch has the number (never 0);
// the average ticket is revenue / transactions over the branches that have both.
const AGG_KEYS = ['today_incl', 'today_ex', 'month_incl', 'month_ex', 'last_month_ex', 'ytd_ex', 'tx', 'bookings_count', 'customers', 'cancellations', 'unpaid_incl'];
function aggregateBranches(branches) {
  const out = {};
  for (const k of AGG_KEYS) {
    const vals = branches.map(b => b[k]).filter(v => v !== null && v !== undefined);
    out[k] = vals.length ? vals.reduce((a, x) => a + x, 0) : null;
  }
  const both = branches.filter(b => b.month_incl != null && b.tx != null && b.tx > 0);
  const rev = both.reduce((a, b) => a + b.month_incl, 0), tx = both.reduce((a, b) => a + b.tx, 0);
  out.avg_ticket_incl = tx > 0 ? rev / tx : null;
  out.branches_with_data = branches.filter(b => b.month_incl != null || b.today_incl != null).length;
  return out;
}

// Goals → a progress summary. null when there are no goals (shown as "אין נתונים עדיין").
function goalsProgress(goals) {
  const live = goals.filter(g => g.status !== 'dropped');
  if (!live.length) return null;
  const done = live.filter(g => g.status === 'done').length;
  const measured = live.filter(g => g.status === 'active' && g.target && g.current !== null && g.current !== undefined);
  const pct = measured.length
    ? measured.reduce((a, g) => a + Math.max(0, Math.min(1, Number(g.current) / Number(g.target))), 0) / measured.length
    : null;
  return { total: live.length, done, active: live.length - done, avg_pct: pct };
}

// ── Sync ───────────────────────────────────────────────────────────────────────

async function upsertMonth(client, integrationId, m) {
  const s = m.summary;
  const cols = ['revenue_total', 'tx_count', 'average_transaction', 'unpaid_total', 'bookings_total', 'bookings_count',
    'vouchers_total', 'vouchers_count', 'sales_total', 'sales_count', 'orders_count', 'customers_count', 'new_customers_count', 'cancellations_count'];
  await client.query(
    `INSERT INTO revenue_month_summary (integration_id, month, ${cols.join(', ')}, fetched_at)
     VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}, now())
     ON CONFLICT (integration_id, month) DO UPDATE SET ${cols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, fetched_at = now()`,
    [integrationId, s.month, ...cols.map(c => s[c])]);
  for (const r of m.daily) {
    await client.query(
      `INSERT INTO revenue_daily (integration_id, day, revenue_total, tx_count, bookings, vouchers, sales, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (integration_id, day) DO UPDATE SET revenue_total = EXCLUDED.revenue_total, tx_count = EXCLUDED.tx_count,
         bookings = EXCLUDED.bookings, vouchers = EXCLUDED.vouchers, sales = EXCLUDED.sales, fetched_at = now()`,
      [integrationId, r.day, r.revenue_total, r.tx_count, r.bookings, r.vouchers, r.sales]);
  }
  // Same now() as the summary (one transaction): readers keep only this report's rows
  for (const [table, rows] of [['revenue_items_monthly', m.items], ['revenue_staff_monthly', m.staff]]) {
    for (const r of rows) {
      await client.query(
        `INSERT INTO ${table} (integration_id, month, name, count, total, fetched_at) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (integration_id, month, name) DO UPDATE SET count = EXCLUDED.count, total = EXCLUDED.total, fetched_at = now()`,
        [integrationId, s.month, r.name, r.count, r.total]);
    }
  }
  for (const r of m.methods) {
    await client.query(
      `INSERT INTO revenue_methods_monthly (integration_id, month, method, label, count, total, fetched_at) VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (integration_id, month, method) DO UPDATE SET label = EXCLUDED.label, count = EXCLUDED.count, total = EXCLUDED.total, fetched_at = now()`,
      [integrationId, s.month, r.method, r.label, r.count, r.total]);
  }
}

function classify(e) {
  if (e instanceof SyncError) return e;
  const msg = e && e.message ? String(e.message) : '';
  if (/invalid_api_key|missing_api_key|HTTP 40[13]/.test(msg)) return new SyncError('unauthorized', ERROR_TEXT.unauthorized);
  if (/Unmapped/.test(msg)) return new SyncError('unmapped', ERROR_TEXT.unmapped);
  if (/supplier|Buyz error/.test(msg)) return new SyncError('bad_response', ERROR_TEXT.bad_response);
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|HTTP 5/.test(msg)) return new SyncError('unreachable', ERROR_TEXT.unreachable);
  return new SyncError('failed', ERROR_TEXT.failed);
}

// One Buyz integration row: monthly history (revenue_monthly via ingestBuyz) + last and this
// month's detail. Updates the row's status and writes one activity_log row. Never throws for a
// provider failure; returns { ok, ... } with counts only.
async function syncBuyz(pool, integ, { env = process.env, fetchImpl = fetch, today, userId = null } = {}) {
  const startedAt = Date.now();
  const counts = { months_added: 0, months_changed: 0, days: 0, items: 0, staff: 0, methods: 0, months_detail: 0 };
  let error = null;
  try {
    const cfg = integ.config || {};
    const account = cfg.source_account == null ? null : String(cfg.source_account);
    if (!account || typeof cfg.amounts_include_vat !== 'boolean') throw new SyncError('bad_config', ERROR_TEXT.bad_config);
    const key = resolveCredential('buyz', integ.credentials_ref, env);

    // The monthly history table is keyed by revenue_sources; an integration row is enough configuration
    await pool.query(
      `INSERT INTO revenue_sources (source, source_account, domain, branch, location, name_he, amounts_include_vat)
       SELECT 'buyz', $1, l.domain, l.branch, l.location, l.name_he, $4 FROM locations l WHERE l.branch = $2 AND l.location = $3
       ON CONFLICT DO NOTHING`, [account, integ.branch, integ.location, cfg.amounts_include_vat]);

    const { rows: hist } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM revenue_monthly WHERE source = 'buyz' AND source_account = $1`, [account]);
    const r = await ingestBuyz(pool, { key, query: { months: hist[0].n === 0 ? 24 : 3 }, fetchImpl });
    if (r.account !== account) throw new SyncError('account_mismatch', ERROR_TEXT.account_mismatch);
    counts.months_added = r.added; counts.months_changed = r.changed;

    const thisMonth = today.slice(0, 7);
    const mapped = [];
    for (const month of [prevMonth(thisMonth), thisMonth]) {
      const m = mapBuyzMonth(await fetchBuyzMonth({ key, month, today, fetchImpl }), month);
      if (m.account !== null && m.account !== account) throw new SyncError('account_mismatch', ERROR_TEXT.account_mismatch);
      mapped.push(m);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const m of mapped) {
        await upsertMonth(client, integ.id, m);
        counts.months_detail++; counts.days += m.daily.length; counts.items += m.items.length;
        counts.staff += m.staff.length; counts.methods += m.methods.length;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    error = classify(e);
  }

  const status = error ? 'error' : 'ok';
  await pool.query(
    `UPDATE integrations SET status = $2, last_error = $3, updated_at = now()${error ? '' : ', last_sync_at = now()'} WHERE id = $1`,
    [integ.id, status, error ? error.message : null]);
  const metadata = { provider: 'buyz', branch: integ.branch, location: integ.location, status, ms: Date.now() - startedAt, ...counts };
  if (error) metadata.error_code = error.code;
  await pool.query(
    `INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'integration', $2, 'sync', $3)`,
    [userId, String(integ.id), JSON.stringify(metadata)]);
  return error ? { ok: false, id: integ.id, location: integ.location, code: error.code, error: error.message, ...counts }
    : { ok: true, id: integ.id, location: integ.location, ...counts };
}

const PROVIDERS = { buyz: syncBuyz };

// Every integration that is not disabled. One failing source does not stop the others.
async function syncAll(pool, opts = {}) {
  const { rows } = await pool.query(
    `SELECT id, provider, domain, branch, location, credentials_ref, config FROM integrations
     WHERE status <> 'disabled' ORDER BY branch, location, provider`);
  const results = [];
  for (const integ of rows) {
    const run = PROVIDERS[integ.provider];
    if (run) results.push(await run(pool, integ, opts));
  }
  return results;
}

module.exports = {
  ERROR_TEXT, SyncError, resolveCredential, mapBuyzMonth, fetchBuyzMonth, monthRange, prevMonth,
  aggregateBranches, goalsProgress, syncBuyz, syncAll, BUYZ_PARTS,
};

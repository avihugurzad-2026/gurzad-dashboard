import 'server-only';
import { db } from './db';
import { addDays, daysBetween, periodBounds, todayIL, type RangeKey } from '@/lib/period';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Domain logic stays in the tested CommonJS modules under lib/ (shared with the sync script)
import kpi from '@domain/kpi';
import alertsLib from '@domain/alerts';
import forecastLib from '@domain/forecast';
import scorecardLib from '@domain/scorecard';
import snapshotsLib from '@domain/snapshots';

type Row = Record<string, any>;

export type SyncRun = {
  id: number; mode: string; dry_run: boolean;
  started_at: string | null; finished_at: string | null;
  added: number; changed: number; soft_deleted: number; error_count: number;
};

export type Task = {
  id: string; domain: string; branch: string; text: string;
  priority: string | null; due: string | null; done: boolean;
  source_path: string | null; days_past: number | null;
};

export type ScorecardMeasure = {
  key: string; domain: string; branch: string; name_he: string; owner: string | null;
  weekly_goal: number | null; direction: 'higher_better' | 'lower_better';
  effective_from: string | null; locked_until: string | null; source_kpi: string | null;
  cells: { period: string; value: number | null; status: 'on' | 'off' | null }[];
  suggest_issue: boolean;
};

async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await db().query(sql, params);
  return rows as T[];
}

// ── Parameters (never hardcoded: a missing value is null and reported) ─────────
export async function getParam(key: string, dateIso: string): Promise<any> {
  const [r] = await q(
    `SELECT value FROM parameters WHERE key = $1 AND effective_from <= $2::date
     ORDER BY effective_from DESC LIMIT 1`, [key, dateIso]);
  return r?.value ?? null;
}

async function vatRate(dateIso: string): Promise<number | null> {
  const v = await getParam('vat_rate', dateIso);
  return typeof v?.rate === 'number' ? v.rate : null;
}

async function allocationThreshold(dateIso: string): Promise<number | null> {
  const v = await getParam('allocation_threshold', dateIso);
  return typeof v?.amount === 'number' ? v.amount : null;
}

async function numParam(key: string, dateIso: string): Promise<number | null> {
  const v = await getParam(key, dateIso);
  return typeof v?.value === 'number' ? v.value : null;
}

function missingParams(values: Record<string, unknown>): string[] {
  return Object.entries(values).filter(([, v]) => v === null).map(([k]) => k);
}

// ── Workspaces (branches) ─────────────────────────────────────────────────────
export type Workspace = { domain: string; branch: string; name_he: string | null; entity_count: number; last_synced: string | null };

export async function workspaces(): Promise<Workspace[]> {
  const rows = await q(`
    SELECT b.domain, b.branch, b.name_he,
           COUNT(e.id) FILTER (WHERE e.deleted_at IS NULL) AS entity_count,
           MAX(e.synced_at) FILTER (WHERE e.deleted_at IS NULL) AS last_synced
    FROM branches b LEFT JOIN entities e ON e.branch = b.branch
    GROUP BY b.domain, b.branch, b.name_he, b.sort ORDER BY b.domain, b.sort`);
  return rows.map(r => ({ ...r, entity_count: Number(r.entity_count), last_synced: r.last_synced ? new Date(r.last_synced).toISOString() : null })) as Workspace[];
}

// A workspace key from the URL, validated against the branches table (null = all)
export async function resolveWorkspace(w: unknown): Promise<string | null> {
  if (typeof w !== 'string' || !w || w === 'all') return null;
  const [r] = await q(`SELECT branch FROM branches WHERE branch = $1`, [w]);
  return r ? r.branch : null;
}

async function entityRecords(type: string, branch: string | null = null): Promise<Row[]> {
  const params: unknown[] = [type];
  let sql = `SELECT id, branch, status, data FROM entities WHERE type = $1 AND deleted_at IS NULL`;
  if (branch) { params.push(branch); sql += ` AND branch = $2`; }
  const rows = await q(sql, params);
  return rows.map(r => ({ ...r.data, id: r.id, branch: r.branch, status: r.status }));
}

// ── Alerts ────────────────────────────────────────────────────────────────────
export async function openAlerts(branch: string | null = null): Promise<Row[]> {
  const params: unknown[] = [];
  let sql = `SELECT id, rule_id, severity, level, entity_id, domain, branch, title, amount, days,
                    counterparty, suggested_action, owner, first_seen, last_seen,
                    to_char(snoozed_until, 'YYYY-MM-DD') AS snoozed_until
             FROM alerts WHERE resolved_at IS NULL`;
  if (branch) { params.push(branch); sql += ` AND branch = $1`; }
  const rows = await q(sql, params);
  return rows.map(r => ({ ...r, amount: r.amount !== null ? Number(r.amount) : null }));
}

async function lastFullSync(): Promise<string | null> {
  const [r] = await q(`SELECT MAX(finished_at) AS at FROM sync_runs WHERE NOT dry_run AND finished_at IS NOT NULL`);
  return r?.at ? new Date(r.at).toISOString() : null;
}

export async function lastReview(): Promise<Row | null> {
  const [r] = await q(`SELECT id, reviewed_at, period, decisions FROM weekly_reviews ORDER BY reviewed_at DESC LIMIT 1`);
  return r ?? null;
}

export type AttentionItem = {
  id: number | null; rule_id: string; severity: 'red' | 'orange'; title: string;
  amount?: number | null; days?: number | null; open_days: number | null;
  counterparty?: string | null; suggested_action?: string | null; owner?: string | null; branch?: string | null;
};

// Persistent alerts (written by sync --apply) plus two computed checks: stale data and stale review
export async function attention(today: string, branch: string | null) {
  const [open, lastSync, staleDays, last, reviewStale] = await Promise.all([
    openAlerts(branch), lastFullSync(), numParam('stale_days', today), lastReview(), numParam('review_stale_days', today),
  ]);
  const panel = alertsLib.panelItems(open, today);
  const items: AttentionItem[] = panel.items;
  let more: number = panel.more;

  if (!branch && lastSync && staleDays !== null) {
    const age = daysBetween(lastSync.slice(0, 10), today);
    if (age > staleDays) {
      const firstOrange = items.findIndex(i => i.severity !== 'red');
      items.splice(firstOrange === -1 ? items.length : firstOrange, 0, {
        id: null, rule_id: 'stale_data', severity: 'orange', title: `הנתונים לא סונכרנו ${age} ימים`,
        days: age, open_days: null, suggested_action: 'להריץ סנכרון' });
    }
  }
  if (!branch && reviewStale !== null) {
    const age = last ? daysBetween(new Date(last.reviewed_at).toISOString().slice(0, 10), today) : null;
    if (age === null || age > reviewStale) {
      items.push({ id: null, rule_id: 'review_stale', severity: 'orange',
        title: age === null ? 'עוד לא נעשתה סקירה שבועית' : `סקירה שבועית אחרונה לפני ${age} ימים`,
        days: age, open_days: null, suggested_action: 'לפתוח סקירה שבועית' });
    }
  }
  while (items.length > 7) { items.pop(); more++; }

  return {
    items, more, snoozed: panel.snoozed as number,
    // "הכול תקין" only means something after a real sync evaluated the rules
    evaluated: lastSync !== null,
    last_sync: lastSync,
    last_review: last ? new Date(last.reviewed_at).toISOString() : null,
  };
}

export async function snoozeAlert(id: number, until: string, today: string): Promise<'ok' | 'invalid' | 'not_found'> {
  if (!Number.isInteger(id) || id <= 0) return 'invalid';
  if (!alertsLib.validSnooze(until, today)) return 'invalid';
  const { rowCount } = await db().query(
    `UPDATE alerts SET snoozed_until = $2 WHERE id = $1 AND resolved_at IS NULL`, [id, until]);
  return rowCount ? 'ok' : 'not_found';
}

// ── Overview ──────────────────────────────────────────────────────────────────
export async function overview(branch: string | null, range: RangeKey) {
  const today = todayIL();
  const period = periodBounds(range, today);
  const [vat, threshold, retainers, debts, att, trend, horizonItems, cash] = await Promise.all([
    vatRate(today), allocationThreshold(today), entityRecords('retainer', branch), entityRecords('debt', branch),
    attention(today, branch), kpiTrend(branch, today), horizon(today, period.end < today ? today : period.end, branch),
    // Cash is group-wide, so it ignores the workspace filter
    forecastInput(today).then(i => forecastLib.buildForecast(i)),
  ]);

  const mrr: number | null = kpi.mrr(retainers);
  const openDebts = debts.filter(d => kpi.isOpen(d.status));
  const debtTotal: number | null = kpi.openDebtsGross(debts);
  const dated = openDebts.filter(d => d.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));

  const taskParams: unknown[] = [today];
  let taskSql = `SELECT COUNT(*) AS total,
                        COUNT(*) FILTER (WHERE NOT done) AS open,
                        COUNT(*) FILTER (WHERE NOT done AND due IS NOT NULL AND due < $1) AS overdue
                 FROM tasks WHERE deleted_at IS NULL`;
  if (branch) { taskParams.push(branch); taskSql += ` AND branch = $2`; }
  const [t] = await q(taskSql, taskParams);
  const tasksSynced = Number(t.total) > 0;

  return {
    today, range, period,
    vat_rate: vat,
    missing_params: missingParams({ vat_rate: vat, allocation_threshold: threshold }),
    mrr: { net: mrr, gross: kpi.grossFromNet(mrr, vat) as number | null, clients: retainers.filter(r => r.status === 'active').length },
    concentration: kpi.concentration(retainers) as { max_pct: number; top_3: { name: string | null; pct: number }[] } | null,
    receivables: {
      total: debtTotal,
      count: openDebts.length,
      clients: new Set(openDebts.map(d => d.client).filter(Boolean)).size,
      oldest_due: dated[0]?.due_date ?? null,
      oldest_days: dated[0] ? Math.max(0, daysBetween(String(dated[0].due_date), today)) : null,
      with_due: dated.length,
    },
    tasks: tasksSynced ? { open: Number(t.open), overdue: Number(t.overdue) } : null,
    attention: att,
    trend,
    horizon: horizonItems,
    cash: {
      operating: cash.cash.operating,
      trough: cash.trough,
      floor: cash.floor,
      below_floor: cash.below_floor,
      weeks_of_spend: cash.weeks_of_spend,
      partial: cash.partial,
    },
  };
}

// Weekly snapshots of MRR and open debts, last 13 ISO weeks; a missing week is null, not 0
async function kpiTrend(branch: string | null, today: string) {
  const weeks: string[] = scorecardLib.lastWeeks(today);
  const params: unknown[] = [weeks];
  let sql = `SELECT period, kpi_key, SUM(value) AS value FROM kpi_snapshots
             WHERE period = ANY($1::text[]) AND kpi_key IN ('mrr','open_debts') AND branch <> '_all'`;
  if (branch) { params.push(branch); sql += ` AND branch = $2`; }
  sql += ` GROUP BY period, kpi_key`;
  const rows = await q(sql, params);
  const pick = (key: string) => weeks.map(w => {
    const r = rows.find(x => x.period === w && x.kpi_key === key);
    return { period: w, value: r ? Number(r.value) : null };
  });
  return { mrr: pick('mrr'), open_debts: pick('open_debts') };
}

// Upcoming items until `end`: open tasks, retainer notice deadlines, fixed payments
export type HorizonItem = { kind: 'task' | 'notice' | 'payment'; title: string; date: string; branch?: string | null; amount?: number | null; overdue?: boolean };

export async function horizon(today: string, end: string, branch: string | null = null): Promise<HorizonItem[]> {
  const params: unknown[] = [today, end];
  let sql = `SELECT text AS title, branch, to_char(due, 'YYYY-MM-DD') AS date FROM tasks
             WHERE NOT done AND deleted_at IS NULL AND due BETWEEN $1 AND $2`;
  if (branch) { params.push(branch); sql += ` AND branch = $3`; }
  const items: HorizonItem[] = (await q(sql, params)).map(t => ({ kind: 'task', title: t.title, branch: t.branch, date: t.date }));
  for (const r of await entityRecords('retainer', branch)) {
    const d = alertsLib.noticeDeadline(r);
    if (r.status === 'active' && d && d >= today && d <= end) items.push({ kind: 'notice', title: `מועד הודעה על חידוש: ${r.client ?? ''}`, date: d, branch: r.branch });
  }
  for (const c of await entityRecords('fixed-commitment', branch)) {
    for (const d of forecastLib.occurrences(c.next_due, c.frequency, end) as string[]) {
      if (d >= today) items.push({ kind: 'payment', title: c.payee, amount: kpi.toNum(c.amount), date: d, branch: c.branch });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Tasks (read-only: tasks live in the Obsidian vault) ───────────────────────
export async function tasks(branch: string | null) {
  const today = todayIL();
  const params: unknown[] = [today];
  let sql = `SELECT id, domain, branch, text, priority, to_char(due, 'YYYY-MM-DD') AS due, done, source_path,
                    CASE WHEN due < $1 AND NOT done THEN ($1::date - due) ELSE NULL END AS days_past
             FROM tasks WHERE deleted_at IS NULL AND NOT done`;
  if (branch) { params.push(branch); sql += ` AND branch = $2`; }
  sql += ` ORDER BY due ASC NULLS LAST, priority DESC`;
  const rows = await q(sql, params);
  const [{ n }] = await q(`SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL`);
  const list: Task[] = rows.map(r => ({ ...r, days_past: r.days_past === null ? null : Number(r.days_past) })) as Task[];
  return { today, synced: Number(n) > 0, tasks: list };
}

// ── Finance (one workspace: retainers and open balances) ──────────────────────
export async function finance(branch: string | null) {
  const today = todayIL();
  const vat = await vatRate(today);
  const retainers = (await entityRecords('retainer', branch)).filter(r => r.status === 'active');
  const debts = (await entityRecords('debt', branch)).filter(d => kpi.isOpen(d.status));
  const mrr: number | null = kpi.mrr(retainers);
  return {
    today, vat_rate: vat, missing_params: missingParams({ vat_rate: vat }),
    mrr, mrr_gross: kpi.grossFromNet(mrr, vat) as number | null,
    concentration: kpi.concentration(retainers),
    retainers: retainers
      .map(r => ({ id: r.id, branch: r.branch, client: r.client ?? null, fee_net: kpi.toNum(r.amount_net ?? r.monthly_fee_net),
        contract_end: r.contract_end ?? null, notice_deadline: alertsLib.noticeDeadline(r), auto_renew: r.auto_renew ?? null }))
      .sort((a, b) => (b.fee_net ?? 0) - (a.fee_net ?? 0)),
    debts: debts
      .map(d => ({ id: d.id, branch: d.branch, client: d.client ?? null, amount: kpi.outstandingGross(d) as number | null,
        due_date: d.due_date ?? null, days_overdue: d.due_date ? Math.max(0, daysBetween(String(d.due_date), today)) : null }))
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
    debt_total: kpi.openDebtsGross(debts) as number | null,
    aging: kpi.aging(debts, today),
  };
}

// ── Data integrity ────────────────────────────────────────────────────────────
export async function integrity() {
  const today = todayIL();
  const [vat, threshold, ws] = await Promise.all([vatRate(today), allocationThreshold(today), workspaces()]);
  const runs = await q(`
    SELECT id, mode, dry_run, started_at, finished_at, added, changed, soft_deleted,
           COALESCE(jsonb_array_length(errors), 0) AS error_count
    FROM sync_runs ORDER BY id DESC LIMIT 5`);
  const types = await q(`
    SELECT type, COUNT(*) AS n,
           COUNT(*) FILTER (WHERE data ? 'due_date' AND data->>'due_date' <> '') AS with_due
    FROM entities WHERE deleted_at IS NULL GROUP BY type`);
  const n = (t: string) => Number(types.find(r => r.type === t)?.n ?? 0);
  const withDue = types.filter(r => ['debt', 'invoice'].includes(r.type)).reduce((s, r) => s + Number(r.with_due), 0);
  const estimates = await q(`
    SELECT DISTINCT ON (key) key, value, source FROM parameters
    WHERE confidence = 'estimate' ORDER BY key, effective_from DESC`);

  const gaps: { kpi: string; text: string }[] = [];
  if (n('debt') + n('invoice') > 0 && withDue === 0) gaps.push({ kpi: 'aging', text: 'גיול חובות: לאף חוב אין due_date' });
  if (n('invoice') === 0) gaps.push({ kpi: 'allocation', text: 'מספרי הקצאה: אין חשבוניות מס, הבדיקה לא רצה' });
  if (n('cash-account') === 0) gaps.push({ kpi: 'cash', text: 'מזומן, רצפה ושבוע שפל: אין רשומות cash-account' });
  if (n('fixed-commitment') === 0) gaps.push({ kpi: 'forecast', text: 'תחזית 13 שבועות: אין רשומות fixed-commitment' });
  if (n('expense') === 0) gaps.push({ kpi: 'profit', text: 'רווח והוצאות: אין עדיין הוצאות' });
  for (const b of ws) if (b.entity_count === 0) gaps.push({ kpi: `branch:${b.branch}`, text: `${b.name_he || b.branch}: אין נתונים עדיין` });

  const open = await openAlerts();
  const active = open.filter(a => !(a.snoozed_until && a.snoozed_until > today));
  // Red before orange, then oldest first — the same order as the home panel
  const sorted = [...open].sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'red' ? -1 : 1)
    || (new Date(a.first_seen).getTime() - new Date(b.first_seen).getTime()));
  return {
    today,
    missing_params: missingParams({ vat_rate: vat, allocation_threshold: threshold }),
    params_today: { vat_rate: vat, allocation_threshold: threshold },
    branches: ws,
    runs: runs.map(r => ({ ...r, started_at: r.started_at ? new Date(r.started_at).toISOString() : null,
      finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null, error_count: Number(r.error_count) })) as SyncRun[],
    gaps,
    estimates: estimates.map(e => ({ key: e.key as string, value: e.value?.value ?? e.value, source: e.source as string | null })),
    alerts: {
      red: active.filter(a => a.severity === 'red').length,
      orange: active.filter(a => a.severity === 'orange').length,
      snoozed: open.length - active.length,
      list: sorted,
    },
  };
}

// ── Forecast ──────────────────────────────────────────────────────────────────
async function forecastInput(today: string) {
  const [vat, floorMonths] = await Promise.all([vatRate(today), numParam('cash_floor_months', today)]);
  const [cashAccounts, debts, invoices, retainers, commitments, loans] = await Promise.all(
    ['cash-account', 'debt', 'invoice', 'retainer', 'fixed-commitment', 'loan'].map(t => entityRecords(t)));
  return { todayIso: today, vatRate: vat, floorMonths, cashAccounts, receivables: [...debts, ...invoices], retainers, commitments, loans };
}

export async function forecast() {
  return forecastLib.buildScenarios(await forecastInput(todayIL()));
}

// ── Scorecard ─────────────────────────────────────────────────────────────────
export async function scorecard() {
  const today = todayIL();
  const weeks: string[] = scorecardLib.lastWeeks(today);
  const measures = await q(`
    SELECT key, domain, branch, name_he, owner, weekly_goal, direction,
           to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
           to_char(locked_until, 'YYYY-MM-DD') AS locked_until, source_kpi
    FROM scorecard_measures WHERE active ORDER BY sort, key`);
  const snaps = await q(`SELECT period, kpi_key, domain, branch, basis, value FROM kpi_snapshots WHERE period = ANY($1::text[])`, [weeks]);
  return {
    today, weeks,
    measures: measures.map(m => scorecardLib.measureRow(
      { ...m, weekly_goal: m.weekly_goal !== null ? Number(m.weekly_goal) : null }, snaps, weeks)) as unknown as ScorecardMeasure[],
  };
}

export async function setGoal(key: string, goal: unknown, quarterlyPlanning: boolean):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const today = todayIL();
  if (!scorecardLib.validGoal(goal)) return { status: 400, body: { error: 'היעד חייב להיות מספר, או ריק' } };
  const [m] = await q(`SELECT key, weekly_goal, to_char(locked_until, 'YYYY-MM-DD') AS locked_until FROM scorecard_measures WHERE key = $1`, [key]);
  if (!m) return { status: 404, body: { error: 'מדד לא נמצא' } };
  const change = scorecardLib.goalChange(m, today, { quarterlyPlanning });
  if (!change.ok) return { status: 409, body: { error: change.reason } };
  await db().query(`UPDATE scorecard_measures SET weekly_goal = $2, effective_from = $3, locked_until = $4 WHERE key = $1`,
    [m.key, goal, change.effective_from, change.locked_until]);
  return { status: 200, body: { ok: true, key: m.key, weekly_goal: goal, locked_until: change.locked_until } };
}

// ── Weekly review ─────────────────────────────────────────────────────────────
export async function review() {
  const today = todayIL();
  const [scenarios, sc, open, h90, last] = await Promise.all([
    forecast(), scorecard(), openAlerts(), horizon(today, addDays(today, 90)), lastReview(),
  ]);
  const reviews = await q(`SELECT id, period, reviewed_at, decisions FROM weekly_reviews ORDER BY reviewed_at DESC LIMIT 4`);
  return {
    today, period: snapshotsLib.isoWeek(today) as string,
    last_review: last ? { id: last.id as number, reviewed_at: new Date(last.reviewed_at).toISOString(), period: last.period as string } : null,
    forecast: scenarios, scorecard: sc,
    attention: alertsLib.panelItems(open, today, Infinity).items as AttentionItem[],
    horizon_30: h90.filter(i => i.date <= addDays(today, 30)), horizon_90: h90,
    recent_decisions: reviews.flatMap(r => (r.decisions || []).map((d: Row) => ({ ...d, review_id: r.id, period: r.period }))),
  };
}

export async function saveReview(decisions: unknown, notes: unknown, validate: (d: unknown) => { ok: boolean; errors: unknown[] }) {
  const today = todayIL();
  const list = Array.isArray(decisions) ? decisions : [];
  const v = validate(list);
  if (!v.ok) return { status: 400, body: { error: 'הסקירה לא נשמרה', errors: v.errors } };
  const base = forecastLib.buildForecast(await forecastInput(today));
  const clean = list.map((d: Row) => ({ text: String(d.text).trim(), owner: String(d.owner).trim(), due_week: d.due_week }));
  const [r] = await q(
    `INSERT INTO weekly_reviews (period, trough_week, trough_amount, decisions, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, reviewed_at`,
    [snapshotsLib.isoWeek(today), base.trough?.week ?? null, base.trough?.amount ?? null, JSON.stringify(clean),
     typeof notes === 'string' ? notes.slice(0, 5000) : null]);
  return { status: 200, body: { ok: true, id: r.id, reviewed_at: r.reviewed_at } };
}

export async function reviewById(id: number) {
  const [r] = await q(`SELECT period, reviewed_at, decisions, notes FROM weekly_reviews WHERE id = $1`, [id]);
  return r ?? null;
}

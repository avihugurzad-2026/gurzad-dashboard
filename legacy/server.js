'use strict';
const express      = require('express');
const { Pool }     = require('pg');
const cors         = require('cors');
const jwt          = require('jsonwebtoken');
const bcrypt       = require('bcryptjs');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const kpi          = require('./lib/kpi');
const alertsLib    = require('./lib/alerts');
const forecastLib  = require('./lib/forecast');
const scorecardLib = require('./lib/scorecard');
const reviewLib    = require('./lib/review');
const { isoWeek }  = require('./lib/snapshots');
require('dotenv').config();

// ── Startup guards ────────────────────────────────────────────────────────────
if (!process.env.JWT_SECRET)          throw new Error('JWT_SECRET env var is required');
if (!process.env.OWNER_PASSWORD_HASH) throw new Error('OWNER_PASSWORD_HASH env var is required');

const app    = express();
const PORT   = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── DB Pool ───────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || false, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use((_req, res, next) => {
  res.setHeader('X-Robots-Tag',         'noindex, nofollow');
  res.setHeader('Cache-Control',        'no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options',      'DENY');
  next();
});

// Absolute path so it works inside the Vercel function bundle; index:false so "/" hits the login route below
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── Auth middleware ───────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'לא מחובר' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'טוקן לא תקין' });
  }
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message:       { error: 'יותר מדי ניסיונות. נסה שוב בעוד 15 דקות.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Parameter helpers ─────────────────────────────────────────────────────────
async function getParam(key, dateStr) {
  const { rows } = await pool.query(
    `SELECT value FROM parameters
     WHERE key = $1 AND effective_from <= $2::date
     ORDER BY effective_from DESC LIMIT 1`,
    [key, dateStr]
  );
  return rows[0]?.value ?? null;
}

// No hardcoded fallbacks (CLAUDE.md): a missing parameter is null and is reported
// to the client in missing_params, which shows it instead of a guessed number.
async function getVatRate(dateStr) {
  const v = await getParam('vat_rate', dateStr);
  return typeof v?.rate === 'number' ? v.rate : null;
}

async function getAllocationThreshold(dateStr) {
  const v = await getParam('allocation_threshold', dateStr);
  return typeof v?.amount === 'number' ? v.amount : null;
}

// Active entities of a type as plain records (data + status), for lib/kpi
async function entityRecords(type, branch) {
  const params = [type];
  let sql = `SELECT status, data FROM entities WHERE type = $1 AND deleted_at IS NULL`;
  if (branch) { params.push(branch); sql += ` AND branch = $2`; }
  const { rows } = await pool.query(sql, params);
  return rows.map(r => ({ ...r.data, status: r.status }));
}

// ── Auth endpoints ────────────────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'סיסמה נדרשת' });

    const valid = await bcrypt.compare(password, process.env.OWNER_PASSWORD_HASH);
    if (!valid) return res.status(401).json({ error: 'סיסמה שגויה' });

    const token = jwt.sign({ role: 'owner' }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure:   isProd,       // false on localhost so Safari accepts it
      sameSite: 'strict',
      maxAge:   8 * 3600 * 1000
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

function missingParams(values) {
  return Object.entries(values).filter(([, v]) => v === null).map(([k]) => k);
}

// ── KPI: Home (L0) ────────────────────────────────────────────────────────────
app.get('/api/kpi/home', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [vatRate, threshold] = await Promise.all([
      getVatRate(today),
      getAllocationThreshold(today)
    ]);

    // Last sync timestamp per domain
    const { rows: syncRows } = await pool.query(`
      SELECT domain, MAX(synced_at) AS last_sync
      FROM entities WHERE deleted_at IS NULL
      GROUP BY domain
    `);
    const lastSync = Object.fromEntries(syncRows.map(r => [r.domain, r.last_sync]));

    // MRR (ex-VAT) and open debts (incl. VAT); null when there are no records
    const mrr       = kpi.mrr(await entityRecords('retainer'));
    const openDebts = kpi.openDebtsGross(await entityRecords('debt'));

    // Overdue tasks; null when no tasks were synced at all (0 is a real zero)
    const { rows: [taskRow] } = await pool.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE NOT done AND due IS NOT NULL AND due < $1) AS overdue
      FROM tasks WHERE deleted_at IS NULL
    `, [today]);
    const overdueTasks = parseInt(taskRow.total) > 0 ? parseInt(taskRow.overdue) : null;

    // Attention panel: persistent alerts (written by sync --apply) + stale-data check
    const attention = await buildAttention(today);

    // Domain cards
    const { rows: branchRows } = await pool.query(`
      SELECT b.domain, b.branch, b.name_he, b.sort,
             COUNT(e.id)     FILTER (WHERE e.deleted_at IS NULL) AS entity_count,
             MAX(e.synced_at) FILTER (WHERE e.deleted_at IS NULL) AS last_synced
      FROM branches b
      LEFT JOIN entities e ON e.branch = b.branch
      GROUP BY b.domain, b.branch, b.name_he, b.sort
      ORDER BY b.domain, b.sort
    `);

    // 30-day horizon
    const d30 = new Date(today); d30.setDate(d30.getDate() + 30);
    const { rows: horizonRows } = await pool.query(`
      SELECT 'task' AS item_type, text AS title, branch, due, priority
      FROM tasks
      WHERE NOT done AND due BETWEEN $1 AND $2 AND deleted_at IS NULL
      ORDER BY due ASC LIMIT 20
    `, [today, d30.toISOString().split('T')[0]]);

    res.json({
      today, vat_rate: vatRate,
      missing_params: missingParams({ vat_rate: vatRate, allocation_threshold: threshold }),
      last_sync: lastSync,
      hero: {
        mrr:           { value: mrr },
        open_debts:    { value: openDebts },
        overdue_tasks: { value: overdueTasks }
      },
      attention_items: attention.items,
      attention_more:  attention.more,
      attention_snoozed: attention.snoozed,
      alerts_evaluated: attention.evaluated,
      last_review: attention.last_review,
      domain_cards:    branchRows,
      horizon_30:      horizonRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Alerts ─────────────────────────────────────────────────────────────────
async function lastFullSync() {
  const { rows: [r] } = await pool.query(
    `SELECT MAX(finished_at) AS at FROM sync_runs WHERE NOT dry_run AND finished_at IS NOT NULL`);
  return r?.at ?? null;
}

async function openAlerts() {
  const { rows } = await pool.query(`
    SELECT id, rule_id, severity, level, entity_id, domain, branch, title, amount, days,
           counterparty, suggested_action, owner, first_seen, last_seen,
           to_char(snoozed_until, 'YYYY-MM-DD') AS snoozed_until
    FROM alerts WHERE resolved_at IS NULL`);
  return rows.map(r => ({ ...r, amount: r.amount !== null ? Number(r.amount) : null }));
}

async function buildAttention(today) {
  const [open, lastSync, staleParam] = await Promise.all([openAlerts(), lastFullSync(), getParam('stale_days', today)]);
  const panel = alertsLib.panelItems(open, today);

  // Data older than stale_days is itself an alert (BUILD-SPEC §8, orange). Computed, not stored.
  const staleDays = typeof staleParam?.value === 'number' ? staleParam.value : null;
  if (lastSync && staleDays !== null) {
    const age = kpi.daysBetween(new Date(lastSync).toISOString().slice(0, 10), today);
    if (age > staleDays) {
      const firstOrange = panel.items.findIndex(i => i.severity !== 'red');
      panel.items.splice(firstOrange === -1 ? panel.items.length : firstOrange, 0, { id: null, rule_id: 'stale_data', severity: 'orange', title: `הנתונים לא סונכרנו ${age} ימים`,
        days: age, open_days: null, suggested_action: 'הרץ סנכרון' });
      if (panel.items.length > 7) { panel.items.pop(); panel.more++; }
    }
  }
  // Weekly review older than review_stale_days (v2 §6, orange). Computed, not stored.
  const [last, reviewParam] = await Promise.all([lastReview(), getParam('review_stale_days', today)]);
  const reviewStale = typeof reviewParam?.value === 'number' ? reviewParam.value : null;
  if (reviewStale !== null) {
    const age = last ? kpi.daysBetween(new Date(last.reviewed_at).toISOString().slice(0, 10), today) : null;
    if (age === null || age > reviewStale) {
      panel.items.push({ id: null, rule_id: 'review_stale', severity: 'orange',
        title: age === null ? 'עוד לא נעשתה סקירה שבועית' : `סקירה שבועית אחרונה לפני ${age} ימים`,
        days: age, open_days: null, suggested_action: 'לפתוח סקירה שבועית' });
      if (panel.items.length > 7) { panel.items.pop(); panel.more++; }
    }
  }
  panel.last_review = last ? last.reviewed_at : null;

  // "הכול תקין" only means something after at least one real sync evaluated the rules
  return { ...panel, evaluated: lastSync !== null };
}

app.get('/api/alerts', authenticate, async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const open = await openAlerts();
    const all = alertsLib.panelItems(open, today, Infinity).items;
    const snoozed = open.filter(a => a.snoozed_until && a.snoozed_until > today);
    res.json({ today, open: all, snoozed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Snooze is the dashboard's only write: Supabase only, never the vault
app.post('/api/alerts/:id/snooze', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const id = Number(req.params.id);
    const until = req.body?.until;
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'מזהה לא תקין' });
    if (!alertsLib.validSnooze(until, today)) return res.status(400).json({ error: 'תאריך דחייה חייב להיות תאריך עתידי (YYYY-MM-DD)' });
    const { rowCount } = await pool.query(
      `UPDATE alerts SET snoozed_until = $2 WHERE id = $1 AND resolved_at IS NULL`, [id, until]);
    if (!rowCount) return res.status(404).json({ error: 'ההתראה לא נמצאה או כבר נסגרה' });
    res.json({ ok: true, id, snoozed_until: until });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Data integrity (/health page) ─────────────────────────────────────────────
app.get('/api/integrity', authenticate, async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [vatRate, threshold] = await Promise.all([getVatRate(today), getAllocationThreshold(today)]);

    const { rows: branches } = await pool.query(`
      SELECT b.domain, b.branch, b.name_he,
             COUNT(e.id) FILTER (WHERE e.deleted_at IS NULL) AS entity_count,
             MAX(e.synced_at) FILTER (WHERE e.deleted_at IS NULL) AS last_synced
      FROM branches b LEFT JOIN entities e ON e.branch = b.branch
      GROUP BY b.domain, b.branch, b.name_he, b.sort ORDER BY b.domain, b.sort`);

    const { rows: runs } = await pool.query(`
      SELECT id, mode, dry_run, started_at, finished_at, added, changed, soft_deleted,
             COALESCE(jsonb_array_length(errors), 0) AS error_count, errors
      FROM sync_runs ORDER BY id DESC LIMIT 5`);

    const { rows: types } = await pool.query(`
      SELECT type, COUNT(*) AS n,
             COUNT(*) FILTER (WHERE data ? 'due_date' AND data->>'due_date' <> '') AS with_due
      FROM entities WHERE deleted_at IS NULL GROUP BY type`);
    const n = t => Number(types.find(r => r.type === t)?.n ?? 0);
    const withDue = types.filter(r => ['debt', 'invoice'].includes(r.type)).reduce((s, r) => s + Number(r.with_due), 0);

    const { rows: estimates } = await pool.query(`
      SELECT DISTINCT ON (key) key, value, source FROM parameters
      WHERE confidence = 'estimate' ORDER BY key, effective_from DESC`);

    // Why a number shows "אין נתונים עדיין"
    const gaps = [];
    if (n('debt') + n('invoice') > 0 && withDue === 0) gaps.push({ kpi: 'aging', text: 'גיול חובות: לאף חוב אין due_date (ממתין לייבוא Paperless)' });
    if (n('invoice') === 0) gaps.push({ kpi: 'allocation', text: 'מספרי הקצאה: אין חשבוניות מס בוואלט, הבדיקה לא רצה' });
    if (n('cash-account') === 0) gaps.push({ kpi: 'cash', text: 'מזומן נגיש, רצפה ושבוע שפל: אין רשומות cash-account' });
    if (n('fixed-commitment') === 0) gaps.push({ kpi: 'forecast', text: 'תחזית 13 שבועות: אין רשומות fixed-commitment' });
    if (n('expense') === 0) gaps.push({ kpi: 'profit', text: 'רווח חודשי: אין רשומות expense' });
    for (const b of branches) {
      if (Number(b.entity_count) === 0) gaps.push({ kpi: `branch:${b.branch}`, text: `${b.name_he || b.branch}: אין נתונים עדיין` });
    }

    const open = await openAlerts();
    const active = open.filter(a => !(a.snoozed_until && a.snoozed_until > today));
    res.json({
      today,
      missing_params: missingParams({ vat_rate: vatRate, allocation_threshold: threshold }),
      params_today: { vat_rate: vatRate, allocation_threshold: threshold },
      branches, runs, gaps,
      estimates: estimates.map(e => ({ key: e.key, value: e.value?.value ?? e.value, source: e.source })),
      alerts: {
        red: active.filter(a => a.severity === 'red').length,
        orange: active.filter(a => a.severity === 'orange').length,
        snoozed: open.length - active.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cash forecast (13 weeks) ──────────────────────────────────────────────────
async function forecastInput(today) {
  const [vatRate, floorParam] = await Promise.all([getVatRate(today), getParam('cash_floor_months', today)]);
  const [cashAccounts, debts, invoices, retainers, commitments, loans] = await Promise.all(
    ['cash-account', 'debt', 'invoice', 'retainer', 'fixed-commitment', 'loan'].map(t => entityRecords(t)));
  return {
    todayIso: today, vatRate,
    floorMonths: typeof floorParam?.value === 'number' ? floorParam.value : null,
    cashAccounts, receivables: [...debts, ...invoices], retainers, commitments, loans,
  };
}

app.get('/api/forecast', authenticate, async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    res.json(forecastLib.buildScenarios(await forecastInput(today)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Scorecard ─────────────────────────────────────────────────────────────────
async function scorecardRows(today) {
  const weeks = scorecardLib.lastWeeks(today);
  const { rows: measures } = await pool.query(`
    SELECT key, domain, branch, name_he, owner, weekly_goal, direction,
           to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
           to_char(locked_until, 'YYYY-MM-DD') AS locked_until, source_kpi
    FROM scorecard_measures WHERE active ORDER BY sort, key`);
  const { rows: snaps } = await pool.query(
    `SELECT period, kpi_key, domain, branch, basis, value FROM kpi_snapshots WHERE period = ANY($1::text[])`, [weeks]);
  return {
    weeks,
    measures: measures.map(m => scorecardLib.measureRow(
      { ...m, weekly_goal: m.weekly_goal !== null ? Number(m.weekly_goal) : null }, snaps, weeks)),
  };
}

app.get('/api/scorecard', authenticate, async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    res.json({ today, ...(await scorecardRows(today)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Goals are locked for 13 weeks; quarterly_planning:true is the explicit override
app.put('/api/scorecard/:key/goal', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const goal = req.body?.weekly_goal;
    if (!scorecardLib.validGoal(goal)) return res.status(400).json({ error: 'weekly_goal חייב להיות מספר או null' });
    const { rows: [m] } = await pool.query(
      `SELECT key, weekly_goal, to_char(locked_until, 'YYYY-MM-DD') AS locked_until FROM scorecard_measures WHERE key = $1`,
      [req.params.key]);
    if (!m) return res.status(404).json({ error: 'מדד לא נמצא' });
    const change = scorecardLib.goalChange(m, today, { quarterlyPlanning: req.body?.quarterly_planning === true });
    if (!change.ok) return res.status(409).json({ error: change.reason });
    await pool.query(
      `UPDATE scorecard_measures SET weekly_goal = $2, effective_from = $3, locked_until = $4 WHERE key = $1`,
      [m.key, goal, change.effective_from, change.locked_until]);
    res.json({ ok: true, key: m.key, weekly_goal: goal, locked_until: change.locked_until });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Weekly review ─────────────────────────────────────────────────────────────
async function lastReview() {
  const { rows: [r] } = await pool.query(
    `SELECT id, reviewed_at, period, decisions FROM weekly_reviews ORDER BY reviewed_at DESC LIMIT 1`);
  return r ?? null;
}

// Next 90 days: tasks, renewal notice deadlines, fixed payments
async function horizon(today, days) {
  const end = forecastLib.addDaysIso(today, days);
  const { rows: tasks } = await pool.query(`
    SELECT text AS title, branch, to_char(due, 'YYYY-MM-DD') AS date FROM tasks
    WHERE NOT done AND deleted_at IS NULL AND due BETWEEN $1 AND $2`, [today, end]);
  const items = tasks.map(t => ({ kind: 'task', ...t }));
  for (const r of await entityRecords('retainer')) {
    const d = alertsLib.noticeDeadline(r);
    if (r.status === 'active' && d && d >= today && d <= end) items.push({ kind: 'notice', title: `מועד הודעה: ${r.client ?? ''}`, date: d });
  }
  for (const c of await entityRecords('fixed-commitment')) {
    for (const d of forecastLib.occurrences(c.next_due, c.frequency, end)) {
      if (d >= today) items.push({ kind: 'payment', title: c.payee, amount: kpi.toNum(c.amount), date: d });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

app.get('/api/review', authenticate, async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [scenarios, scorecard, attention, h90, last] = await Promise.all([
      forecastInput(today).then(forecastLib.buildScenarios), scorecardRows(today),
      openAlerts().then(open => alertsLib.panelItems(open, today, Infinity)), horizon(today, 90), lastReview(),
    ]);
    const { rows: reviews } = await pool.query(
      `SELECT id, period, reviewed_at, decisions FROM weekly_reviews ORDER BY reviewed_at DESC LIMIT 4`);
    res.json({
      today, period: isoWeek(today),
      last_review: last ? { id: last.id, reviewed_at: last.reviewed_at, period: last.period } : null,
      forecast: scenarios, scorecard, attention: attention.items,
      horizon_30: h90.filter(i => i.date <= forecastLib.addDaysIso(today, 30)), horizon_90: h90,
      recent_decisions: reviews.flatMap(r => (r.decisions || []).map(d => ({ ...d, review_id: r.id, period: r.period }))),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/review', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const decisions = req.body?.decisions ?? [];
    const v = reviewLib.validateDecisions(decisions);
    if (!v.ok) return res.status(400).json({ error: 'הסקירה לא נשמרה', errors: v.errors });
    const base = forecastLib.buildForecast(await forecastInput(today));
    const clean = decisions.map(d => ({ text: d.text.trim(), owner: d.owner.trim(), due_week: d.due_week }));
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 5000) : null;
    const { rows: [r] } = await pool.query(
      `INSERT INTO weekly_reviews (period, trough_week, trough_amount, decisions, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, reviewed_at`,
      [isoWeek(today), base.trough?.week ?? null, base.trough?.amount ?? null, JSON.stringify(clean), notes]);
    res.json({ ok: true, id: r.id, reviewed_at: r.reviewed_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/review/:id/export', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'מזהה לא תקין' });
    const { rows: [r] } = await pool.query(
      `SELECT period, reviewed_at, decisions, notes FROM weekly_reviews WHERE id = $1`, [id]);
    if (!r) return res.status(404).json({ error: 'סקירה לא נמצאה' });
    res.type('text/markdown; charset=utf-8')
       .set('Content-Disposition', `attachment; filename="review-${r.period}.md"`)
       .send(reviewLib.exportMarkdown(r));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── KPI: adigital (L2) ────────────────────────────────────────────────────────
app.get('/api/kpi/adigital', authenticate, async (req, res) => {
  try {
    const today   = new Date().toISOString().split('T')[0];
    const vatRate = await getVatRate(today);

    // Active retainers
    const { rows: retainers } = await pool.query(`
      SELECT id,
             data->>'client'             AS client,
             (data->>'amount_net')::numeric AS fee_net,
             data->>'contract_start'     AS contract_start,
             data->>'contract_end'       AS contract_end,
             data->>'notice_deadline'    AS notice_deadline,
             data->>'auto_renew'         AS auto_renew,
             data->>'notice_period_days' AS notice_period_days,
             data->>'note'               AS note
      FROM entities
      WHERE type = 'retainer' AND status = 'active'
        AND branch = 'adigital' AND deleted_at IS NULL
      ORDER BY (data->>'amount_net')::numeric DESC
    `);

    const retainerRecs = retainers.map(r => ({ client: r.client, amount_net: r.fee_net, status: 'active' }));
    const mrr = kpi.mrr(retainerRecs);

    // Open debts
    const { rows: debts } = await pool.query(`
      SELECT id,
             data->>'client'                AS client,
             (data->>'amount_gross')::numeric AS amount_gross
      FROM entities
      WHERE type = 'debt' AND branch = 'adigital'
        AND (status IS NULL OR status NOT IN ('paid','void','archived'))
        AND deleted_at IS NULL
      ORDER BY (data->>'amount_gross')::numeric DESC
    `);
    const totalDebts = kpi.sumOrNull(debts.map(d => d.amount_gross));

    // Tasks
    const { rows: tasks } = await pool.query(`
      SELECT id, text, priority, due, done,
             CASE WHEN due < $1 AND NOT done
               THEN CURRENT_DATE - due ELSE NULL END AS days_past
      FROM tasks
      WHERE branch = 'adigital' AND NOT done AND deleted_at IS NULL
      ORDER BY due ASC NULLS LAST, priority DESC
    `, [today]);

    // Last sync
    const { rows: [syncRow] } = await pool.query(`
      SELECT MAX(synced_at) AS last_sync
      FROM entities WHERE branch = 'adigital' AND deleted_at IS NULL
    `);

    res.json({
      branch: 'adigital', name_he: 'אדיג׳יטל',
      today, vat_rate: vatRate,
      missing_params: missingParams({ vat_rate: vatRate }),
      last_sync:   syncRow?.last_sync ?? null,
      mrr,
      mrr_gross:   kpi.grossFromNet(mrr, vatRate),
      retainers,
      concentration: kpi.concentration(retainerRecs),
      aging:       null, // ממתין לייבוא Paperless עם due_date
      open_debts:  { total: totalDebts, items: debts },
      tasks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/tasks', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const conds  = ['deleted_at IS NULL'];
    const params = [today];

    if (req.query.branch) {
      params.push(req.query.branch);
      conds.push(`branch = $${params.length}`);
    }
    if (req.query.done !== undefined) {
      params.push(req.query.done === 'true');
      conds.push(`done = $${params.length}`);
    } else {
      conds.push('NOT done');
    }

    const { rows } = await pool.query(`
      SELECT id, domain, branch, text, priority, due, done,
             CASE WHEN due < $1 AND NOT done
               THEN CURRENT_DATE - due ELSE NULL END AS days_past
      FROM tasks
      WHERE ${conds.join(' AND ')}
      ORDER BY due ASC NULLS LAST, priority DESC
    `, params);

    res.json({ tasks: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Entities ──────────────────────────────────────────────────────────────────
app.get('/api/entities', authenticate, async (req, res) => {
  try {
    const conds  = ['deleted_at IS NULL'];
    const params = [];

    for (const [col, val] of [
      ['type', req.query.type],
      ['branch', req.query.branch],
      ['domain', req.query.domain]
    ]) {
      if (val) { params.push(val); conds.push(`${col} = $${params.length}`); }
    }

    const { rows } = await pool.query(
      `SELECT id, type, domain, branch, status, data, source_path, updated_at, synced_at
       FROM entities WHERE ${conds.join(' AND ')}
       ORDER BY synced_at DESC LIMIT 200`,
      params
    );
    res.json({ entities: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health (no auth) ──────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/review', (_req, res) => res.sendFile(path.join(__dirname, 'public/review.html')));
app.get('/scorecard', (_req, res) => res.sendFile(path.join(__dirname, 'public/scorecard.html')));

app.get('/health', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/health.html'));
});

// ── Serve root ────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/login.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
}

module.exports = app;

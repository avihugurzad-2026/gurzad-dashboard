'use strict';
const express      = require('express');
const { Pool }     = require('pg');
const cors         = require('cors');
const jwt          = require('jsonwebtoken');
const bcrypt       = require('bcryptjs');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
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

app.use(express.static('public'));

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

async function getVatRate(dateStr) {
  const v = await getParam('vat_rate', dateStr);
  return v?.rate ?? 0.18;
}

async function getAllocationThreshold(dateStr) {
  const v = await getParam('allocation_threshold', dateStr);
  return v?.amount ?? 5000;
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

    // MRR: Σ amount_net for active retainers (ex-VAT; vault field is amount_net)
    const { rows: [mrrRow] } = await pool.query(`
      SELECT COALESCE(SUM((data->>'amount_net')::numeric), 0) AS mrr
      FROM entities
      WHERE type = 'retainer' AND status = 'active' AND deleted_at IS NULL
    `);
    const mrr = parseFloat(mrrRow.mrr);

    // Open debts (incl VAT; vault field is amount_gross)
    const { rows: [debtRow] } = await pool.query(`
      SELECT COALESCE(SUM((data->>'amount_gross')::numeric), 0) AS total
      FROM entities
      WHERE type = 'debt'
        AND (status IS NULL OR status NOT IN ('paid','void','archived'))
        AND deleted_at IS NULL
    `);
    const openDebts = parseFloat(debtRow.total);

    // Overdue tasks
    const { rows: [taskRow] } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM tasks
      WHERE NOT done AND due IS NOT NULL AND due < $1 AND deleted_at IS NULL
    `, [today]);
    const overdueTasks = parseInt(taskRow.cnt);

    // Attention items
    const attentionItems = await buildAttentionItems(today, threshold);

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
      last_sync: lastSync,
      hero: {
        mrr:           { value: mrr },
        open_debts:    { value: openDebts },
        overdue_tasks: { value: overdueTasks }
      },
      attention_items: attentionItems,
      domain_cards:    branchRows,
      horizon_30:      horizonRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function buildAttentionItems(today, threshold) {
  const items = [];

  // RED: allocation required but missing
  const { rows: allocRows } = await pool.query(`
    SELECT id, branch,
           data->>'client'     AS client,
           (data->>'amount_net')::numeric AS amount_net
    FROM entities
    WHERE (data->>'allocation_required')::boolean = true
      AND (data->>'allocation_number' IS NULL OR data->>'allocation_number' = '')
      AND deleted_at IS NULL
    LIMIT 7
  `);
  for (const r of allocRows) {
    items.push({
      severity: 'red',
      type: 'allocation_missing',
      entity_id: r.id,
      branch: r.branch,
      text: `חשבונית ₪${r.amount_net} ל${r.client || '?'} — חסר מספר הקצאה`,
      action: 'השלם מספר הקצאה'
    });
  }

  // RED/ORANGE: overdue tasks
  const { rows: overdueRows } = await pool.query(`
    SELECT id, branch, text, due,
           (CURRENT_DATE - due) AS days_past
    FROM tasks
    WHERE NOT done AND due < $1 AND deleted_at IS NULL
    ORDER BY due ASC LIMIT 7
  `, [today]);
  for (const r of overdueRows) {
    items.push({
      severity:  r.days_past > 30 ? 'red' : 'orange',
      type:      'task_overdue',
      entity_id: r.id,
      branch:    r.branch,
      text:      r.text,
      days_past: r.days_past,
      action:    'טפל במשימה'
    });
  }

  items.sort((a, b) => {
    const s = { red: 0, orange: 1 };
    const d = (s[a.severity] ?? 2) - (s[b.severity] ?? 2);
    return d !== 0 ? d : (b.days_past ?? 0) - (a.days_past ?? 0);
  });
  return items.slice(0, 7);
}

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

    const mrr = retainers.reduce((s, r) => s + parseFloat(r.fee_net || 0), 0);

    // Concentration (top 3 by monthly fee)
    const top3 = retainers.slice(0, 3).map(r => ({
      name:    r.client,
      fee_net: parseFloat(r.fee_net || 0),
      pct:     mrr > 0 ? Math.round(parseFloat(r.fee_net || 0) / mrr * 100) : 0
    }));

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
    const totalDebts = debts.reduce((s, r) => s + parseFloat(r.amount_gross || 0), 0);

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
      last_sync:   syncRow?.last_sync ?? null,
      mrr,
      mrr_gross:   Math.round(mrr * (1 + vatRate)),
      retainers,
      concentration: {
        top_3:         top3,
        max_pct:       top3[0]?.pct ?? 0,
        total_clients: retainers.length
      },
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

// ── Serve root ────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/login.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
}

module.exports = app;

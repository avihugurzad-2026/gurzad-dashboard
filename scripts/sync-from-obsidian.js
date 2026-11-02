#!/usr/bin/env node
// sync-from-obsidian.js v2
// Usage: node scripts/sync-from-obsidian.js [--dry] [--apply] [--force] [--branch <name>]
// Default: --dry (no writes). --apply required for DB writes.
// GUARD: vault is read-only. This script never writes to OBSIDIAN_VAULT.
'use strict';

const path   = require('path');
const fs     = require('fs');
const { glob } = require('glob');
const { Pool } = require('pg');
require('dotenv').config();

const {
  ENTITY_TYPES, contentHash, parseFrontmatter, inferLocation,
  parseMarkdownTable, parseTaskLines, validateEntity,
} = require('../lib/vault');
const kpi = require('../lib/kpi');
const { buildSnapshotRows, writeSnapshots } = require('../lib/snapshots');
const { alertParams, evaluateRules, applyAlerts } = require('../lib/alerts');
const { buildScenarios } = require('../lib/forecast');
const { isoWeek } = require('../lib/snapshots');
const { vatRateAt, paramAt } = require('../lib/params');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args          = process.argv.slice(2);
const DRY_RUN       = !args.includes('--apply');
const FORCE         = args.includes('--force');
const BRANCH_FILTER = args.includes('--branch') ? args[args.indexOf('--branch') + 1] : null;

const VAULT = process.env.OBSIDIAN_VAULT;
if (!VAULT) { console.error('OBSIDIAN_VAULT not set in .env'); process.exit(1); }
// A dry run only reads the vault; the DB is needed for --apply (and to log dry runs).
if (!DRY_RUN && !process.env.DATABASE_URL) { console.error('DATABASE_URL not set in .env'); process.exit(1); }

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

// Map parameter filename → parameters.key (for time-series tables with a 'from' column)
const PARAM_FILE_KEY = {
  'vat-rates':             'vat_rate',
  'allocation-thresholds': 'allocation_threshold',
};

const today = () => new Date().toISOString().split('T')[0];

// ── Parameter syncing ─────────────────────────────────────────────────────────
async function syncParameterFile(client, filePath) {
  const parsed = parseFrontmatter(filePath);
  if (!parsed) return;
  const { fm, body } = parsed;
  if (fm.type !== 'parameter') return;

  const baseName = path.basename(filePath, '.md');
  const rows = parseMarkdownTable(body);
  if (!rows.length) return;

  if (Object.prototype.hasOwnProperty.call(rows[0], 'from')) {
    // Time-series parameter: each row → one (key, effective_from) pair
    const key = PARAM_FILE_KEY[baseName];
    if (!key) return;

    for (const row of rows) {
      const effectiveFrom = row['from'];
      if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) continue;

      const value = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === 'from') continue;
        const n = parseFloat(v);
        value[k.replace('threshold_net', 'amount')] = isNaN(n) ? v : n;
      }

      await client.query(
        `INSERT INTO parameters (key, effective_from, value, source, confidence)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source`,
        [key, effectiveFrom, JSON.stringify(value), `vault:Parameters/${baseName}.md`, fm.confidence ?? 'unknown']
      );
    }
  } else {
    // Key-value table (e.g. thresholds.md): each row → parameter with effective_from 2000-01-01
    const keyCol   = Object.prototype.hasOwnProperty.call(rows[0], 'key')   ? 'key'   : Object.keys(rows[0])[0];
    const valueCol = Object.prototype.hasOwnProperty.call(rows[0], 'value') ? 'value' : Object.keys(rows[0])[1];

    for (const row of rows) {
      const k = row[keyCol];
      if (!k || k.startsWith('---')) continue;
      const rawVal = row[valueCol] ?? '';
      const n = parseFloat(rawVal);
      const val = { value: isNaN(n) ? rawVal : n };

      await client.query(
        `INSERT INTO parameters (key, effective_from, value, source, confidence)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source`,
        [k, '2000-01-01', JSON.stringify(val), `vault:Parameters/${baseName}.md`, fm.confidence ?? 'unknown']
      );
    }
  }
}

// ── Task syncing ──────────────────────────────────────────────────────────────
async function syncTaskFile(client, filePath, stats) {
  const relPath = path.relative(VAULT, filePath);
  const loc     = inferLocation(VAULT, filePath);
  if (!loc?.branch) return;
  if (BRANCH_FILTER && loc.branch !== BRANCH_FILTER) return;

  const tasks = parseTaskLines(fs.readFileSync(filePath, 'utf8'), relPath);
  for (const t of tasks) {
    const { rows } = await client.query('SELECT done FROM tasks WHERE id = $1', [t.id]);
    if (rows.length === 0) {
      await client.query(
        `INSERT INTO tasks (id, domain, branch, text, priority, due, done, source_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [t.id, loc.domain, loc.branch, t.text, t.priority, t.due, t.done, relPath]
      );
      stats.added++;
    } else {
      await client.query(
        `UPDATE tasks SET done=$2, priority=$3, due=$4, deleted_at=NULL WHERE id=$1`,
        [t.id, t.done, t.priority, t.due]
      );
    }
  }
  return new Set(tasks.map(t => t.id));
}

// ── Threshold helper (inside transaction). Missing → null, never a hardcoded default.
async function getThresholdInTx(client, dateStr) {
  const { rows } = await client.query(
    `SELECT (value->>'amount')::numeric AS amount FROM parameters
     WHERE key = 'allocation_threshold' AND effective_from <= $1::date
     ORDER BY effective_from DESC LIMIT 1`,
    [dateStr]
  );
  return rows[0]?.amount != null ? Number(rows[0].amount) : null;
}

// ── Dry-run summary: what the vault holds, by type (BUILD-SPEC §10 check) ─────
function printDrySummary(entityFiles, taskFiles, stats) {
  const byType = {};
  for (const { fm } of entityFiles) byType[fm.type] = (byType[fm.type] || 0) + 1;

  const asRows = type => entityFiles.filter(e => e.fm.type === type).map(e => e.fm);
  const tasks  = taskFiles.flatMap(f => parseTaskLines(fs.readFileSync(f, 'utf8'), path.relative(VAULT, f)));
  const fmt    = n => (n === null ? 'אין נתונים' : n.toLocaleString('he-IL'));

  console.log(`\n📋 Dry-run — לא בוצעה כתיבה ל-DB:`);
  console.log(`   ישויות שנמצאו: ${entityFiles.length}`);
  for (const [t, n] of Object.entries(byType).sort()) console.log(`     ${t}: ${n}`);
  console.log(`   retainers פעילים (ex-VAT, חודשי): ${fmt(kpi.mrr(asRows('retainer')))}`);
  console.log(`   חובות פתוחים (כולל מע"מ):        ${fmt(kpi.openDebtsGross(asRows('debt')))}`);
  console.log(`   משימות: ${tasks.length} (פתוחות ${tasks.filter(t => !t.done).length}) ב-${taskFiles.length} קבצים`);
  console.log(`   אזהרות: ${stats.warnings.length}`);
  stats.warnings.forEach(w => console.warn(`   ⚠️  ${w.file}: ${w.warnings.join('; ')}`));

  const snap = buildSnapshotRows({
    todayIso: today(),
    entities: entityFiles.map(e => ({
      type: e.fm.type, status: e.fm.status ?? 'active', data: e.fm,
      branch: e.fm.branch ?? inferLocation(VAULT, e.filePath)?.branch,
    })),
    tasks,
  });
  const alerts = evaluateRules({
    todayIso: today(),
    entities: entityFiles.map(e => ({ id: e.fm.id, type: e.fm.type, status: e.fm.status ?? 'active', data: e.fm,
      ...inferLocation(VAULT, e.filePath) })),
    tasks, params: {},
  });
  const bySev = s => alerts.filter(a => a.severity === s).length;
  console.log(`   התראות שיחושבו ב---apply: ${alerts.length} (אדום ${bySev('red')}, כתום ${bySev('orange')})`);
  console.log(`   snapshot שייכתב ב---apply (${snap[0]?.period ?? '-'}): ${snap.map(r => `${r.kpi_key}/${r.branch}=${r.value}`).join(', ') || 'אין'}`);
  console.log(`\n   להחיל: node scripts/sync-from-obsidian.js --apply`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🔍 sync-from-obsidian v2 — ${DRY_RUN ? 'dry-run' : 'APPLY'} — ${new Date().toISOString()}`);
  if (FORCE) console.log('⚠️  --force: guard de-activated');

  const startedAt   = new Date();
  const stats       = { added: 0, changed: 0, soft_deleted: 0, snapshots: 0, warnings: [], errors: [] };
  const seenIds     = new Set();
  const seenTaskIds = new Set();

  // ── Scan entity files ──────────────────────────────────────────────────────
  const allFiles = await glob(`${VAULT}/{10_Business,20_Personal,30_Ventures}/**/*.md`, { nodir: true });

  const entityFiles = [];
  const taskFiles   = [];

  for (const f of allFiles) {
    const parsed = parseFrontmatter(f);
    if (!parsed?.fm?.type) continue;
    const { fm } = parsed;

    if (fm.type === 'tasks') { taskFiles.push(f); continue; }
    if (!ENTITY_TYPES.has(fm.type)) continue; // branch/overview/parameter/other meta files

    if (BRANCH_FILTER && fm.branch && fm.branch !== BRANCH_FILTER) continue;
    entityFiles.push({ filePath: f, parsed, fm });
  }

  // ── Validate all entity files ──────────────────────────────────────────────
  let validationFailed = false;

  for (const { filePath, fm } of entityFiles) {
    const rel = path.relative(VAULT, filePath);

    if (!fm.id) { stats.errors.push({ file: rel, errors: ['חסר id'] }); validationFailed = true; continue; }
    if (seenIds.has(fm.id)) {
      stats.errors.push({ file: rel, errors: [`id כפול: ${fm.id}`] });
      validationFailed = true; continue;
    }
    seenIds.add(fm.id);

    const { errors, warnings } = validateEntity(fm);
    if (errors.length)   { stats.errors.push({ file: rel, errors }); validationFailed = true; }
    if (warnings.length) stats.warnings.push({ file: rel, warnings });
  }

  if (validationFailed) {
    console.error(`\n❌ ${stats.errors.length} שגיאות אימות — מפסיק (לא בוצעו שינויים):`);
    stats.errors.forEach(e => console.error(`   ${e.file}: ${e.errors.join('; ')}`));
    if (pool) await pool.end();
    process.exit(1);
  }

  // ── Dry run ────────────────────────────────────────────────────────────────
  if (DRY_RUN) {
    printDrySummary(entityFiles, taskFiles, stats);
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO sync_runs (started_at, finished_at, mode, added, changed, soft_deleted, errors, dry_run)
           VALUES ($1, NOW(), 'dry', 0, 0, 0, $2, true)`,
          [startedAt, JSON.stringify(stats.errors)]
        );
      } catch (err) {
        console.warn(`   (ה-DB לא זמין, הריצה לא נרשמה ב-sync_runs: ${err.code || err.message})`);
      }
      await pool.end();
    }
    return;
  }

  // ── Guard: >20% entities missing ──────────────────────────────────────────
  if (!FORCE) {
    const { rows: [prev] } = await pool.query(`SELECT COUNT(*) AS cnt FROM entities WHERE deleted_at IS NULL`);
    const prevCount = parseInt(prev.cnt);
    const newCount  = seenIds.size;
    if (prevCount > 0 && newCount < prevCount * 0.8) {
      console.error(`\n⛔ Guard: ${newCount} ישויות נמצאו, ${prevCount} קיימות ב-DB (${Math.round((1 - newCount / prevCount) * 100)}% ירידה).`);
      console.error(`הרץ עם --force כדי להמשיך בכל זאת.`);
      await pool.end(); process.exit(1);
    }
  }

  // ── Apply: single transaction ──────────────────────────────────────────────
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Sync Parameters/ from vault
    const paramFiles = await glob(`${VAULT}/Parameters/*.md`, { nodir: true });
    for (const pf of paramFiles) await syncParameterFile(client, pf);

    // 2. Upsert entities
    for (const { filePath, parsed, fm } of entityFiles) {
      const rel  = path.relative(VAULT, filePath);
      const hash = contentHash(parsed.raw);
      const loc  = inferLocation(VAULT, filePath);

      const domain = fm.domain ?? loc?.domain;
      const branch = fm.branch ?? loc?.branch;
      if (!domain || !branch) {
        console.warn(`⚠️  לא ניתן לקבוע domain/branch עבור ${rel}`);
        continue;
      }

      // allocation_required: computed here for tax invoices only (BUILD-SPEC §2.3)
      const record = { ...fm };
      if (fm.type === 'invoice') {
        const issueDate = String(fm.issue_date ?? fm.date ?? today());
        const threshold = await getThresholdInTx(client, issueDate);
        record.allocation_required = kpi.allocationRequired(fm, threshold);
        if (threshold === null) stats.warnings.push({ file: rel, warnings: [`אין סף הקצאה בפרמטרים לתאריך ${issueDate}`] });
        else if (record.allocation_required && !fm.allocation_number) {
          stats.warnings.push({ file: rel, warnings: ['חשבונית מעל הסף בלי allocation_number'] });
        }
      }
      const data = JSON.stringify(record);
      const updatedAt = fm.updated ?? fm.updated_at ?? new Date().toISOString();

      const { rows: existing } = await client.query(`SELECT content_hash, data FROM entities WHERE id = $1`, [fm.id]);

      if (existing.length === 0) {
        await client.query(
          `INSERT INTO entities (id, type, domain, branch, status, data, source_path, content_hash, updated_at, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
          [fm.id, fm.type, domain, branch, fm.status ?? 'active', data, rel, hash, updatedAt]
        );
        stats.added++;
      } else if (existing[0].content_hash !== hash) {
        await client.query(
          `INSERT INTO entity_history (entity_id, changed_at, old, new) VALUES ($1, NOW(), $2, $3)`,
          [fm.id, existing[0].data, data]
        );
        await client.query(
          `UPDATE entities SET type=$2, domain=$3, branch=$4, status=$5, data=$6,
           source_path=$7, content_hash=$8, updated_at=$9, synced_at=NOW(), deleted_at=NULL
           WHERE id=$1`,
          [fm.id, fm.type, domain, branch, fm.status ?? 'active', data, rel, hash, updatedAt]
        );
        stats.changed++;
      } else {
        // Unchanged content: refresh the sync stamp so "last synced" stays honest
        await client.query(`UPDATE entities SET synced_at = NOW(), deleted_at = NULL WHERE id = $1`, [fm.id]);
      }
    }

    // 3. Soft-delete entities no longer in vault
    if (seenIds.size > 0 && !BRANCH_FILTER) {
      const { rowCount } = await client.query(
        `UPDATE entities SET deleted_at = NOW() WHERE id != ALL($1::text[]) AND deleted_at IS NULL`,
        [Array.from(seenIds)]
      );
      stats.soft_deleted += rowCount;
    }

    // 4. Sync tasks
    for (const tf of taskFiles) {
      const tasksSeen = await syncTaskFile(client, tf, stats);
      if (tasksSeen) tasksSeen.forEach(id => seenTaskIds.add(id));
    }
    if (seenTaskIds.size > 0 && !BRANCH_FILTER) {
      const { rowCount } = await client.query(
        `UPDATE tasks SET deleted_at = NOW() WHERE id != ALL($1::text[]) AND deleted_at IS NULL`,
        [Array.from(seenTaskIds)]
      );
      stats.soft_deleted += rowCount;
    }

    // 5. Weekly KPI snapshot (upsert: one row per week per KPI)
    const { rows: liveEntities } = await client.query(
      `SELECT type, branch, status, data FROM entities WHERE deleted_at IS NULL`);
    const { rows: liveTasks } = await client.query(
      `SELECT done, to_char(due, 'YYYY-MM-DD') AS due FROM tasks WHERE deleted_at IS NULL`);
    stats.snapshots = await writeSnapshots(client,
      buildSnapshotRows({ todayIso: today(), entities: liveEntities, tasks: liveTasks }));

    // 6. Persistent alerts: insert new, touch last_seen, resolve the ones that disappeared
    const { rows: paramRows } = await client.query(
      `SELECT key, to_char(effective_from, 'YYYY-MM-DD') AS effective_from, value FROM parameters`);
    const { rows: alertEntities } = await client.query(
      `SELECT id, type, domain, branch, status, data FROM entities WHERE deleted_at IS NULL`);
    const { rows: alertTasks } = await client.query(
      `SELECT id, domain, branch, text, done, to_char(due, 'YYYY-MM-DD') AS due FROM tasks WHERE deleted_at IS NULL`);
    stats.alerts = await applyAlerts(client, evaluateRules({
      todayIso: today(), entities: alertEntities, tasks: alertTasks, params: alertParams(paramRows, today()),
    }));

    // 7. Cash forecast snapshot (v2 §4.1): only with an opening cash position, one per week
    const recs = type => alertEntities.filter(e => e.type === type).map(e => ({ ...e.data, status: e.status }));
    const scenarios = buildScenarios({
      todayIso: today(), vatRate: vatRateAt(paramRows, today()),
      floorMonths: paramAt(paramRows, 'cash_floor_months', today())?.value ?? null,
      cashAccounts: recs('cash-account'), receivables: [...recs('debt'), ...recs('invoice')],
      retainers: recs('retainer'), commitments: recs('fixed-commitment'), loans: recs('loan'),
    });
    stats.forecast = 0;
    if (scenarios.base.cash.operating !== null) {
      for (const [name, fc] of Object.entries(scenarios)) {
        for (const w of fc.weeks) {
          await client.query(
            `INSERT INTO cash_forecast_snapshots (taken_at, period, week_start, scenario, expected_in, expected_out, closing_cash)
             VALUES (NOW(), $1, $2, $3, $4, $5, $6)
             ON CONFLICT (period, week_start, scenario) DO UPDATE SET taken_at = NOW(),
               expected_in = EXCLUDED.expected_in, expected_out = EXCLUDED.expected_out, closing_cash = EXCLUDED.closing_cash`,
            [isoWeek(today()), w.start, name, w.in, w.out, w.closing]);
          stats.forecast++;
        }
      }
    }

    // 8. Log sync_run
    await client.query(
      `INSERT INTO sync_runs (started_at, finished_at, mode, added, changed, soft_deleted, errors, dry_run)
       VALUES ($1, NOW(), 'full', $2, $3, $4, $5, false)`,
      [startedAt, stats.added, stats.changed, stats.soft_deleted, JSON.stringify(stats.errors)]
    );

    await client.query('COMMIT');

    console.log(`\n✅ סנכרון הושלם:`);
    console.log(`   נוסף:          ${stats.added}`);
    console.log(`   שונה:          ${stats.changed}`);
    console.log(`   נמחק (soft):   ${stats.soft_deleted}`);
    console.log(`   snapshots:     ${stats.snapshots}`);
    console.log(`   תחזית מזומן:   ${stats.forecast ? `${stats.forecast} שורות` : 'לא נשמרה (אין cash-account)'}`);
    console.log(`   התראות:        ${stats.alerts.inserted} חדשות, ${stats.alerts.touched} עודכנו, ${stats.alerts.resolved} נסגרו`);
    console.log(`   אזהרות:        ${stats.warnings.length}`);
    stats.warnings.forEach(w => console.warn(`   ⚠️  ${w.file}: ${w.warnings.join('; ')}`));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ שגיאה — rollback:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });

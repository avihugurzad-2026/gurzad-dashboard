#!/usr/bin/env node
// sync-from-obsidian.js v2
// Usage: node scripts/sync-from-obsidian.js [--dry] [--apply] [--force] [--branch <name>]
// Default: --dry (no writes). --apply required for DB writes.
// GUARD: vault is read-only. This script never writes to OBSIDIAN_VAULT.
'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { glob } = require('glob');
const yaml   = require('js-yaml');
const { Pool } = require('pg');
require('dotenv').config();

// ── CLI args ──────────────────────────────────────────────────────────────────
const args         = process.argv.slice(2);
const DRY_RUN      = !args.includes('--apply');
const FORCE        = args.includes('--force');
const BRANCH_FILTER = args.includes('--branch') ? args[args.indexOf('--branch') + 1] : null;

const VAULT = process.env.OBSIDIAN_VAULT;
if (!VAULT) { console.error('OBSIDIAN_VAULT not set in .env'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set in .env'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Vault structure mapping ───────────────────────────────────────────────────
const TOP_DIR_DOMAIN = {
  '10_Business': 'business',
  '20_Personal': 'personal',
  '30_Ventures': 'ventures',
};

const SUBDIR_BRANCH = {
  'Adigital':         'adigital',
  'Head-Spa-Israel':  'head-spa-israel',
  'Home':             'home',
  'General-Tasks':    'general-tasks',
  'Real-Estate':      'real-estate',
  'Legal-And-Tasks':  'legal-and-tasks',
  'Investments':      'investments',
  'Finance':          'finance',
};

// Entity types the sync cares about — everything else (branch, overview, …) is silently skipped
const ENTITY_TYPES = new Set(['retainer', 'debt', 'invoice', 'contract', 'asset', 'expense']);

// Map parameter filename → parameters.key (for time-series tables with a 'from' column)
const PARAM_FILE_KEY = {
  'vat-rates':            'vat_rate',
  'allocation-thresholds':'allocation_threshold',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripBidi(s) {
  return typeof s === 'string'
    ? s.replace(/[‎‏‪-‮⁦-⁩]/g, '')
    : s;
}

function deepStripBidi(v) {
  if (typeof v === 'string') return stripBidi(v);
  if (Array.isArray(v))      return v.map(deepStripBidi);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = deepStripBidi(val);
    return o;
  }
  return v;
}

function contentHash(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

// Returns { fm, raw } or null if no valid frontmatter
function parseFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  try {
    const fm = yaml.load(m[1]);
    if (!fm || typeof fm !== 'object') return null;
    return { fm: deepStripBidi(fm), raw: m[1], body: content.slice(m[0].length) };
  } catch {
    return null;
  }
}

function inferLocation(filePath) {
  const rel   = path.relative(VAULT, filePath);
  const parts = rel.split(path.sep);
  const domain = TOP_DIR_DOMAIN[parts[0]];
  if (!domain) return null;
  const branch = parts[1] ? (SUBDIR_BRANCH[parts[1]] ?? parts[1].toLowerCase().replace(/\s+/g, '-')) : null;
  return { domain, branch };
}

// Parse a Markdown table from body text → array of row objects
function parseMarkdownTable(body) {
  const lines = body.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
  if (lines.length < 2) return [];
  // Skip separator row (--- cells)
  const dataLines = lines.filter(l => !l.match(/^\|[\s|:-]+\|$/));
  if (dataLines.length < 2) return [];

  const headers = dataLines[0].split('|').map(h => h.trim()).filter(Boolean);
  const rows = [];
  for (const line of dataLines.slice(1)) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (!cells.length) continue;
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    rows.push(row);
  }
  return rows;
}

// Validate a financial entity. Returns { errors, warnings }.
function validateEntity(fm) {
  const errors   = [];
  const warnings = [];

  if (!fm.type) errors.push('חסר type');
  if (!fm.id)   errors.push('חסר id');

  const hasAmount = fm.amount_net !== undefined;
  if (hasAmount) {
    if (fm.vat_rate === undefined) errors.push('חסר vat_rate');
    if (fm.vat_amount !== undefined) {
      const expected = parseFloat(fm.amount_net) * parseFloat(fm.vat_rate);
      if (Math.abs(expected - parseFloat(fm.vat_amount)) > 0.01) {
        errors.push(`vat_amount לא תואם: צפוי ${expected.toFixed(2)}, בפועל ${fm.vat_amount}`);
      }
    }
  }

  // Date format validation
  for (const f of ['date','issue_date','due_date','contract_start','contract_end']) {
    const v = fm[f];
    if (v !== undefined && v !== null && v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      errors.push(`${f} לא בפורמט ISO: "${v}"`);
    }
  }

  if (fm.allocation_required && !fm.allocation_number) {
    warnings.push('allocation_required=true אך allocation_number חסר');
  }

  return { errors, warnings };
}

// ── Parameter syncing ─────────────────────────────────────────────────────────
async function syncParameterFile(client, filePath) {
  const parsed = parseFrontmatter(filePath);
  if (!parsed) return;
  const { fm, body } = parsed;
  if (fm.type !== 'parameter') return;

  const baseName = path.basename(filePath, '.md');
  const rows = parseMarkdownTable(body);
  if (!rows.length) return;

  const hasFrom = rows[0].hasOwnProperty('from');

  if (hasFrom) {
    // Time-series parameter: each row → one (key, effective_from) pair
    const key = PARAM_FILE_KEY[baseName];
    if (!key) return; // unknown file, skip

    for (const row of rows) {
      const effectiveFrom = row['from'];
      if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) continue;

      // Build value from all non-'from' columns
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
    // Key-value table (e.g. thresholds.md): key column + value column, no time axis
    // Each row becomes its own parameter with effective_from='2000-01-01'
    const keyCol   = rows[0].hasOwnProperty('key')   ? 'key'   : Object.keys(rows[0])[0];
    const valueCol = rows[0].hasOwnProperty('value') ? 'value' : Object.keys(rows[0])[1];

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
  const content = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(VAULT, filePath);
  const loc     = inferLocation(filePath);
  if (!loc?.branch) return;

  if (BRANCH_FILTER && loc.branch !== BRANCH_FILTER) return;

  const seen = new Set();
  const lines = content.split('\n');

  for (const line of lines) {
    const m = line.match(/^- \[([ xX])\] (.+)/);
    if (!m) continue;

    const done = m[1].toLowerCase() === 'x';
    let   text = stripBidi(m[2]).trim();

    const priorityM = text.match(/#(high|medium|low)/i);
    const priority  = priorityM ? priorityM[1].toLowerCase() : 'medium';
    text = text.replace(/#(high|medium|low)/gi, '').trim();

    const dueM = text.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
    const due  = dueM ? dueM[1] : null;
    text = text.replace(/📅\s*\d{4}-\d{2}-\d{2}/, '').trim();

    if (!text) continue;

    const id = crypto.createHash('sha256')
      .update(`${relPath}::${text}`)
      .digest('hex').slice(0, 16);

    if (seen.has(id)) continue;
    seen.add(id);

    const { rows } = await client.query('SELECT done FROM tasks WHERE id = $1', [id]);
    if (rows.length === 0) {
      await client.query(
        `INSERT INTO tasks (id, domain, branch, text, priority, due, done, source_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, loc.domain, loc.branch, text, priority, due, done, relPath]
      );
      stats.added++;
    } else {
      await client.query(
        `UPDATE tasks SET done=$2, priority=$3, due=$4, deleted_at=NULL WHERE id=$1`,
        [id, done, priority, due]
      );
    }
  }

  return seen;
}

// ── Threshold helper (inside transaction) ────────────────────────────────────
async function getThresholdInTx(client, dateStr) {
  const { rows } = await client.query(
    `SELECT (value->>'amount')::numeric AS amount FROM parameters
     WHERE key = 'allocation_threshold' AND effective_from <= $1::date
     ORDER BY effective_from DESC LIMIT 1`,
    [dateStr]
  );
  return rows[0]?.amount ?? 5000;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🔍 sync-from-obsidian v2 — ${DRY_RUN ? 'dry-run' : 'APPLY'} — ${new Date().toISOString()}`);
  if (FORCE) console.log('⚠️  --force: guard de-activated');

  const startedAt = new Date();
  const stats  = { added: 0, changed: 0, soft_deleted: 0, warnings: [], errors: [] };
  const seenIds    = new Set();
  const seenTaskIds = new Set();

  // ── Scan entity files ──────────────────────────────────────────────────────
  const entityGlob = `${VAULT}/{10_Business,20_Personal,30_Ventures}/**/*.md`;
  const allFiles   = await glob(entityGlob, { nodir: true });

  const entityFiles = [];
  const taskFiles   = [];

  for (const f of allFiles) {
    const parsed = parseFrontmatter(f);
    if (!parsed) continue;
    const { fm } = parsed;
    if (!fm?.type) continue;

    if (fm.type === 'tasks') { taskFiles.push(f); continue; }
    if (fm.type === 'parameter') continue; // handled separately below
    if (!ENTITY_TYPES.has(fm.type)) continue; // skip branch/overview/other meta files

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
    if (errors.length) {
      stats.errors.push({ file: rel, errors });
      validationFailed = true;
    }
    if (warnings.length) {
      stats.warnings.push({ file: rel, warnings });
      console.warn(`⚠️  ${rel}: ${warnings.join('; ')}`);
    }
  }

  if (validationFailed) {
    console.error(`\n❌ ${stats.errors.length} שגיאות אימות — מפסיק (לא בוצעו שינויים):`);
    stats.errors.forEach(e => console.error(`   ${e.file}: ${e.errors.join('; ')}`));
    await pool.end(); process.exit(1);
  }

  // ── Guard: >20% entities missing ──────────────────────────────────────────
  if (!FORCE && !DRY_RUN) {
    const { rows: [prev] } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM entities WHERE deleted_at IS NULL`
    );
    const prevCount = parseInt(prev.cnt);
    const newCount  = seenIds.size;
    if (prevCount > 0 && newCount < prevCount * 0.8) {
      console.error(`\n⛔ Guard: ${newCount} ישויות נמצאו, ${prevCount} קיימות בDB (${Math.round((1 - newCount / prevCount) * 100)}% ירידה).`);
      console.error(`הרץ עם --force כדי להמשיך בכל זאת.`);
      await pool.end(); process.exit(1);
    }
  }

  // ── Dry-run summary ────────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log(`\n📋 Dry-run — לא בוצעה כתיבה לDB:`);
    console.log(`   ישויות שנמצאו: ${seenIds.size}`);
    console.log(`   קבצי משימות:   ${taskFiles.length}`);
    console.log(`   אזהרות:        ${stats.warnings.length}`);
    if (stats.warnings.length) stats.warnings.forEach(w => console.warn(`   ⚠️  ${w.file}: ${w.warnings.join('; ')}`));
    console.log(`\n   להחיל: node scripts/sync-from-obsidian.js --apply`);

    // Still log the dry run to sync_runs
    await pool.query(
      `INSERT INTO sync_runs (started_at, finished_at, mode, added, changed, soft_deleted, errors, dry_run)
       VALUES ($1, NOW(), 'dry', 0, 0, 0, $2, true)`,
      [startedAt, JSON.stringify(stats.errors)]
    );
    await pool.end(); return;
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
      const loc  = inferLocation(filePath);

      const domain = fm.domain ?? loc?.domain;
      const branch = fm.branch ?? loc?.branch;

      if (!domain || !branch) {
        console.warn(`⚠️  לא ניתן לקבוע domain/branch עבור ${rel}`);
        continue;
      }

      // Compute allocation_required
      const issueDate = fm.issue_date ?? fm.date ?? new Date().toISOString().split('T')[0];
      const threshold = await getThresholdInTx(client, issueDate);
      const amountNet = parseFloat(fm.amount_net ?? fm.monthly_fee_net ?? 0);
      const allocationRequired = amountNet > 0 && amountNet > threshold;

      const data = JSON.stringify({ ...fm, allocation_required: allocationRequired });

      const { rows: existing } = await client.query(
        `SELECT content_hash FROM entities WHERE id = $1`, [fm.id]
      );

      if (existing.length === 0) {
        await client.query(
          `INSERT INTO entities (id, type, domain, branch, status, data, source_path, content_hash, updated_at, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
          [fm.id, fm.type, domain, branch, fm.status ?? 'active',
           data, rel, hash, fm.updated ?? fm.updated_at ?? new Date().toISOString()]
        );
        stats.added++;
      } else if (existing[0].content_hash !== hash) {
        const { rows: [old] } = await client.query(`SELECT data FROM entities WHERE id = $1`, [fm.id]);
        await client.query(
          `INSERT INTO entity_history (entity_id, changed_at, old, new) VALUES ($1, NOW(), $2, $3)`,
          [fm.id, old.data, data]
        );
        await client.query(
          `UPDATE entities SET type=$2, domain=$3, branch=$4, status=$5, data=$6,
           source_path=$7, content_hash=$8, updated_at=$9, synced_at=NOW(), deleted_at=NULL
           WHERE id=$1`,
          [fm.id, fm.type, domain, branch, fm.status ?? 'active',
           data, rel, hash, fm.updated ?? fm.updated_at ?? new Date().toISOString()]
        );
        stats.changed++;
      }
    }

    // 3. Soft-delete entities no longer in vault
    if (seenIds.size > 0 && !BRANCH_FILTER) {
      const { rowCount } = await client.query(
        `UPDATE entities SET deleted_at = NOW()
         WHERE id != ALL($1::text[]) AND deleted_at IS NULL`,
        [Array.from(seenIds)]
      );
      stats.soft_deleted += rowCount;
    }

    // 4. Sync tasks
    for (const tf of taskFiles) {
      const tasksSeen = await syncTaskFile(client, tf, stats);
      if (tasksSeen) tasksSeen.forEach(id => seenTaskIds.add(id));
    }

    // Soft-delete tasks no longer in vault (only if no branch filter)
    if (seenTaskIds.size > 0 && !BRANCH_FILTER) {
      const { rowCount } = await client.query(
        `UPDATE tasks SET deleted_at = NOW()
         WHERE id != ALL($1::text[]) AND deleted_at IS NULL`,
        [Array.from(seenTaskIds)]
      );
      stats.soft_deleted += rowCount;
    }

    // 5. Log sync_run
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
    console.log(`   אזהרות:        ${stats.warnings.length}`);
    if (stats.warnings.length) {
      stats.warnings.forEach(w => console.warn(`   ⚠️  ${w.file}: ${w.warnings.join('; ')}`));
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ שגיאה — rollback:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });

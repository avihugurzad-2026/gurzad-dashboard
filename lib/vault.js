// Pure helpers for reading the Obsidian vault: frontmatter, locations, tables,
// task lines and entity validation. No I/O except reading a file, never writes.
'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const yaml   = require('js-yaml');

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

// Entity types the sync stores. BUILD-SPEC §5 + DASHBOARD-SPEC-v2 §3.
// Anything else (branch, overview, tasks, parameter, …) is not an entity.
const ENTITY_TYPES = new Set([
  'retainer', 'debt', 'invoice', 'contract', 'asset', 'expense',
  'ospa-monthly', 'partner', 'property', 'loan', 'matter',
  'investment-account', 'bill',
  'cash-account', 'fixed-commitment',
]);

const CASH_CLASSES       = ['operating', 'restricted', 'reserve'];
const RESTRICTED_REASONS = ['vat_reserve', 'deferred_revenue', 'tax', 'deposit', 'other'];
const CASH_SOURCES       = ['bank', 'paperless', 'manual'];
const FREQUENCIES        = ['weekly', 'monthly', 'bimonthly', 'quarterly', 'yearly', 'once'];

const DATE_FIELDS = [
  'date', 'issue_date', 'due_date', 'contract_start', 'contract_end',
  'promise_to_pay_date', 'balance_date', 'next_due', 'valuation_date',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function stripBidi(s) {
  return typeof s === 'string'
    ? s.replace(/[‎‏‪-‮⁦-⁩]/g, '')
    : s;
}

function deepStripBidi(v) {
  if (typeof v === 'string') return stripBidi(v);
  if (Array.isArray(v))      return v.map(deepStripBidi);
  // js-yaml parses bare YAML dates into Date objects (UTC midnight) → ISO date string
  if (v instanceof Date)     return v.toISOString().split('T')[0];
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

// Returns { fm, raw, body } or null if no valid frontmatter
function parseFrontmatterText(content) {
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

function parseFrontmatter(filePath) {
  return parseFrontmatterText(fs.readFileSync(filePath, 'utf8'));
}

function inferLocation(vault, filePath) {
  const parts  = path.relative(vault, filePath).split(path.sep);
  const domain = TOP_DIR_DOMAIN[parts[0]];
  if (!domain) return null;
  const branch = parts[1] ? (SUBDIR_BRANCH[parts[1]] ?? parts[1].toLowerCase().replace(/\s+/g, '-')) : null;
  return { domain, branch };
}

// Markdown table in a note body → array of row objects
function parseMarkdownTable(body) {
  const lines = body.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
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

// Checklist lines (Tasks-plugin format) → tasks. id = hash(source path + text)
function parseTaskLines(content, relPath) {
  const tasks = [];
  const seen  = new Set();
  for (const line of content.split('\n')) {
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

    const id = crypto.createHash('sha256').update(`${relPath}::${text}`).digest('hex').slice(0, 16);
    if (seen.has(id)) continue;
    seen.add(id);
    tasks.push({ id, done, text, priority, due });
  }
  return tasks;
}

const isNumber = v => v !== null && v !== '' && v !== undefined && !Number.isNaN(Number(v));

// Validate one entity's frontmatter. Errors stop the sync; warnings don't.
function validateEntity(fm) {
  const errors   = [];
  const warnings = [];

  if (!fm.type) errors.push('חסר type');
  if (!fm.id)   errors.push('חסר id');

  if (fm.amount_net !== undefined) {
    if (fm.vat_rate === undefined) errors.push('חסר vat_rate');
    else if (fm.vat_amount !== undefined) {
      const expected = parseFloat(fm.amount_net) * parseFloat(fm.vat_rate);
      if (Math.abs(expected - parseFloat(fm.vat_amount)) > 0.01) {
        errors.push(`vat_amount לא תואם: צפוי ${expected.toFixed(2)}, בפועל ${fm.vat_amount}`);
      }
    }
  }

  for (const f of DATE_FIELDS) {
    const v = fm[f];
    if (v !== undefined && v !== null && v !== '' && !ISO_DATE.test(String(v))) {
      errors.push(`${f} לא בפורמט ISO: "${v}"`);
    }
  }

  if (fm.type === 'cash-account') {
    if (!CASH_CLASSES.includes(fm.cash_class)) errors.push(`cash_class לא תקין: "${fm.cash_class ?? ''}"`);
    if (fm.cash_class === 'restricted' && !RESTRICTED_REASONS.includes(fm.restricted_reason)) {
      errors.push(`restricted_reason חסר או לא תקין: "${fm.restricted_reason ?? ''}"`);
    }
    if (!isNumber(fm.balance)) errors.push('balance חסר או לא מספר');
    if (!fm.balance_date)      errors.push('חסר balance_date');
    if (fm.source !== undefined && !CASH_SOURCES.includes(fm.source)) errors.push(`source לא תקין: "${fm.source}"`);
  }

  if (fm.type === 'fixed-commitment') {
    if (!fm.payee)                         errors.push('חסר payee');
    if (!isNumber(fm.amount))              errors.push('amount חסר או לא מספר');
    if (!FREQUENCIES.includes(fm.frequency)) errors.push(`frequency לא תקין: "${fm.frequency ?? ''}"`);
    if (!fm.next_due)                      errors.push('חסר next_due');
    if (typeof fm.vat_included !== 'boolean') errors.push('vat_included חייב להיות true או false');
  }

  if (fm.allocation_required && !fm.allocation_number) {
    warnings.push('allocation_required=true אך allocation_number חסר');
  }

  return { errors, warnings };
}

module.exports = {
  TOP_DIR_DOMAIN, SUBDIR_BRANCH, ENTITY_TYPES,
  CASH_CLASSES, RESTRICTED_REASONS, CASH_SOURCES, FREQUENCIES,
  stripBidi, deepStripBidi, contentHash,
  parseFrontmatter, parseFrontmatterText, inferLocation,
  parseMarkdownTable, parseTaskLines, validateEntity,
};

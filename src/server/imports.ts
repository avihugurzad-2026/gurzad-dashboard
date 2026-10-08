import 'server-only';
import type { PoolClient } from 'pg';
import { db } from './db';
import type { SessionUser } from './auth';
import L from '@domain/ledger';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Imports never write a transaction directly. A file, a receipt or an e-mail becomes a
// statement_imports row plus import_candidates; the user reviews them and only then they are
// saved (src/app/import-actions.ts → commitImport). Candidates and imports are private to their owner.

export type ParsedRow = {
  occurred_on: string | null; amount: number | null; direction: 'income' | 'expense' | null; merchant: string | null; description?: string | null;
  currency?: string | null; reference?: string | null; vat_amount?: number | null; document_number?: string | null; external_id?: string | null;
};

export type ImportSource = 'statement' | 'receipt' | 'gmail';
export type ImportFormat = 'csv' | 'xlsx' | 'pdf' | 'image' | 'url' | 'email';

export async function createImport(c: PoolClient, u: SessionUser, x: {
  workspace_id: string; account_id?: string | null; source: ImportSource; format: ImportFormat; file_id?: string | null; file_name?: string | null; error?: string | null;
}): Promise<string> {
  const { rows } = await c.query(
    `INSERT INTO statement_imports (owner_user_id, workspace_id, account_id, source, format, file_id, file_name, status, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [u.id, x.workspace_id, x.account_id ?? null, x.source, x.format, x.file_id ?? null, x.file_name?.slice(0, 200) ?? null, x.error ? 'failed' : 'review', x.error?.slice(0, 500) ?? null]);
  return rows[0].id;
}

// Rows → candidates. Each row gets: the default workspace (the account's, else the import's), the
// first matching rule of this user (→ "auto"), a duplicate check against saved rows in the target
// workspace and earlier rows of the same file (→ "duplicate"), or "review" / "unrecognized".
export async function addCandidates(c: PoolClient, u: SessionUser, importId: string, defaultWs: string, rows: ParsedRow[]): Promise<{ added: number; skipped: number }> {
  const { rows: rules } = await c.query(
    `SELECT id, match_field, match_type, pattern, target_workspace_id, category_id, subcategory_id, fixed_or_variable, frequency, priority, active
     FROM categorization_rules WHERE owner_user_id = $1 AND deleted_at IS NULL AND active`, [u.id]);
  const dated = rows.map(r => r.occurred_on).filter(Boolean).sort() as string[];
  const existing: any[] = dated.length ? (await c.query(
    `SELECT id, workspace_id, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, amount_gross::float AS amount, merchant, description
     FROM transactions WHERE deleted_at IS NULL AND owner_user_id = $1 AND occurred_on BETWEEN ($2::date - 3) AND ($3::date + 3)`,
    [u.id, dated[0], dated[dated.length - 1]])).rows : [];
  const seen: any[] = [];
  let added = 0, skipped = 0, sort = 0;
  for (const r of rows) {
    const rule = L.matchRule(rules, { merchant: r.merchant ?? '', description: r.description ?? '' }) as any;
    const ws = rule?.target_workspace_id ?? defaultWs;
    const cand = { occurred_on: r.occurred_on ?? '', amount: r.amount ?? 0, merchant: r.merchant, description: r.description };
    const dupSaved = r.occurred_on && r.amount ? L.isDuplicate(cand, existing) as any : null;
    const dupFile = r.occurred_on && r.amount ? L.isDuplicate(cand, seen) : null;
    const complete = !!(r.occurred_on && r.amount && r.direction);
    const status = dupSaved || dupFile ? 'duplicate' : !complete ? 'unrecognized' : rule ? 'auto' : 'review';
    const res = await c.query(
      `INSERT INTO import_candidates (import_id, owner_user_id, occurred_on, merchant, merchant_normalized, description, amount, currency, direction, vat_amount,
         document_number, target_workspace_id, category_id, subcategory_id, fixed_or_variable, frequency, rule_id, status, duplicate_of, external_id, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       ON CONFLICT (owner_user_id, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING id`,
      [importId, u.id, r.occurred_on, r.merchant?.slice(0, 120) ?? null, L.normalizeMerchant(r.merchant) || null, r.description?.slice(0, 500) ?? null,
        r.amount, /^[A-Z]{3}$/.test(r.currency ?? '') ? r.currency : 'ILS', r.direction, r.vat_amount ?? null, r.document_number?.slice(0, 40) ?? null,
        ws, rule?.category_id ?? null, rule?.subcategory_id ?? null, rule?.fixed_or_variable ?? null, rule?.frequency ?? null, rule?.id ?? null,
        status, dupSaved?.id ?? null, r.external_id?.slice(0, 200) ?? null, sort++]);
    if (res.rowCount) { added++; seen.push({ ...cand, id: res.rows[0].id }); } else skipped++;
  }
  await c.query(`UPDATE statement_imports SET row_count = row_count + $2 WHERE id = $1`, [importId, added]);
  return { added, skipped };
}

// ── Reads for the review screen ───────────────────────────────────────────────
export type ImportRow = {
  id: string; workspace_id: string; account_id: string | null; source: ImportSource; format: ImportFormat; file_id: string | null; file_name: string | null;
  status: string; row_count: number; imported_count: number; error: string | null; created_at: string;
};
export type Candidate = {
  id: string; occurred_on: string | null; merchant: string | null; merchant_normalized: string | null; description: string | null; amount: number | null;
  currency: string; direction: 'income' | 'expense' | null; vat_amount: number | null; document_number: string | null; target_workspace_id: string | null;
  category_id: string | null; subcategory_id: string | null; fixed_or_variable: string | null; frequency: string | null; rule_id: string | null;
  status: string; duplicate_of: string | null; matched_transaction_id: string | null; imported_transaction_id: string | null; first_time: boolean;
};

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';

export async function getImport(u: SessionUser, id: string): Promise<{ imp: ImportRow; candidates: Candidate[] } | null> {
  try {
    const { rows: [imp] } = await db().query(
      `SELECT id, workspace_id, account_id, source, format, file_id, file_name, status, row_count, imported_count, error, created_at
       FROM statement_imports WHERE id = $1 AND owner_user_id = $2`, [id, u.id]);
    if (!imp) return null;
    const { rows } = await db().query(
      `SELECT c.id, to_char(c.occurred_on, 'YYYY-MM-DD') AS occurred_on, c.merchant, c.merchant_normalized, c.description, c.amount::float, c.currency, c.direction,
              c.vat_amount::float, c.document_number, c.target_workspace_id, c.category_id, c.subcategory_id, c.fixed_or_variable, c.frequency, c.rule_id,
              c.status, c.duplicate_of, c.matched_transaction_id, c.imported_transaction_id,
              (c.rule_id IS NULL AND c.merchant_normalized IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM transactions t WHERE t.owner_user_id = $2 AND t.deleted_at IS NULL AND lower(t.merchant) LIKE '%' || c.merchant_normalized || '%')) AS first_time
       FROM import_candidates c WHERE c.import_id = $1 ORDER BY c.sort NULLS LAST, c.created_at`, [id, u.id]);
    return { imp, candidates: rows };
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

export async function listImports(u: SessionUser, limit = 30): Promise<ImportRow[]> {
  try {
    const { rows } = await db().query(
      `SELECT id, workspace_id, account_id, source, format, file_id, file_name, status, row_count, imported_count, error, created_at
       FROM statement_imports WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT $2`, [u.id, limit]);
    return rows;
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

// Saved transactions a receipt could belong to: same amount, within ±7 days, in my workspaces
export async function receiptMatches(u: SessionUser, wsIds: string[], amount: number | null, date: string | null) {
  if (!amount || !wsIds.length) return [];
  const { rows } = await db().query(
    `SELECT t.id, t.workspace_id, to_char(t.occurred_on, 'YYYY-MM-DD') AS occurred_on, t.amount_gross::float AS amount, t.merchant, t.description,
            t.document_id IS NOT NULL AS has_document
     FROM transactions t WHERE t.deleted_at IS NULL AND t.workspace_id = ANY($1::uuid[]) AND t.direction = 'expense'
       AND abs(t.amount_gross - $2) < 0.01 AND ($3::date IS NULL OR t.occurred_on BETWEEN $3::date - 7 AND $3::date + 7)
     ORDER BY CASE WHEN $3::date IS NULL THEN 0 ELSE abs(t.occurred_on - $3::date) END, t.occurred_on DESC LIMIT 8`, [wsIds, amount, date]);
  return rows as { id: string; workspace_id: string; occurred_on: string; amount: number; merchant: string | null; description: string | null; has_document: boolean }[];
}

import { NextResponse } from 'next/server';
import { currentUser, params, visibleSql } from '@/server/auth';
import { db } from '@/server/db';
import { placeSql, TX_SELECT } from '@/server/finance';
import { decodePlace } from '@/lib/places';
import { categoryName, CLASSIFICATIONS, DOCUMENT_TYPES, isIsoDate, labelOf, PAYMENT_METHODS, type Direction } from '@/lib/finance';
import money from '@domain/money';

export const dynamic = 'force-dynamic';

// GET /api/v1/finance/export?from=YYYY-MM-DD&to=YYYY-MM-DD[&place=domain|branch|location]
// The signed-in user's visible transactions as CSV (UTF-8 BOM, CRLF, quoted, formula-injection guard).
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: 'לא מחובר' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from'), to = sp.get('to'), packed = sp.get('place');
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    return NextResponse.json({ error: 'צריך from ו-to בתבנית YYYY-MM-DD' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const place = packed ? decodePlace(packed) : null;
  if (packed && !place) return NextResponse.json({ error: 'שיוך לא תקין' }, { status: 400 });

  const q = params([from, to]);
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await db().query(
      `SELECT ${TX_SELECT}, to_char(t.created_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') AS created_il
       FROM transactions t LEFT JOIN files f ON f.id = t.file_id
       WHERE t.deleted_at IS NULL AND t.occurred_on BETWEEN $1::date AND $2::date AND t.direction IN ('income', 'expense')
         AND ${visibleSql(u, 'money', 't', q.p)} AND ${placeSql(place, 't', q.p)}
       ORDER BY t.occurred_on, t.created_at`, q.values));
  } catch (e) {
    if ((e as { code?: string })?.code !== '42P01') { console.error(e); return NextResponse.json({ error: 'שגיאת שרת' }, { status: 500 }); }
    rows = [];
  }

  const header = ['id', 'תאריך', 'כיוון', 'סכום ברוטו', 'כולל מע״מ', 'שיעור מע״מ', 'סכום מע״מ', 'סכום ללא מע״מ',
    'קטגוריה', 'קוד קטגוריה', 'תיאור', 'סוג מסמך', 'מספר מסמך', 'צד שני', 'ח״פ/ע״מ', 'אמצעי תשלום', 'תאריך תשלום',
    'סיווג', 'אזור', 'עסק', 'סניף', 'קובץ', 'חוב מקושר', 'בעלים', 'הרשאה', 'נוצר ע״י', 'נוצר', 'חלוקה', 'מטבע'];
  const out = rows.map((r: any) => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    r.id, r.occurred_on, r.direction === 'income' ? 'הכנסה' : 'הוצאה', r.amount_gross.toFixed(2), r.vat_included ? 'כן' : 'לא',
    r.vat_rate === null ? '' : String(r.vat_rate), r.vat_amount.toFixed(2), money.round2(r.amount_gross - r.vat_amount).toFixed(2),
    categoryName(r.direction as Direction, r.category), r.category, r.description, labelOf(DOCUMENT_TYPES, r.document_type),
    r.document_number, r.counterparty_name, r.counterparty_tax_id, r.payment_method ? labelOf(PAYMENT_METHODS, r.payment_method) : '',
    r.payment_date, labelOf(CLASSIFICATIONS, r.classification), r.domain, r.branch, r.location, r.file_name, r.receivable_id,
    r.owner_user_id, r.scope, r.created_by, r.created_il,
    (r.splits as { user_id: string; share_pct: number }[]).map(s => `${s.user_id}:${s.share_pct}%`).join('; '), r.currency,
  ]);

  return new NextResponse(money.toCsv(header, out), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="transactions-${from}-${to}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

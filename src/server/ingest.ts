import 'server-only';
import { db } from './db';
import revenueLib from '@domain/revenue';

// Pull Buyz months into revenue_monthly + kpi_snapshots. 3 months covers late corrections;
// the first run (empty table) backfills 24.
export async function ingestOspa() {
  let months = 3;
  try {
    const { rows } = await db().query(`SELECT COUNT(*)::int AS n FROM revenue_monthly WHERE source = 'buyz'`);
    if (rows[0].n === 0) months = 24;
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === '42P01') return { ok: false as const, error: 'הטבלאות עוד לא נוצרו (migration לא הורץ)' };
    throw e;
  }
  try {
    const r = await revenueLib.ingestBuyz(db(), { key: process.env.BUYZ_API_KEY, query: { months } });
    return { ok: true as const, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    console.error('Buyz ingest failed:', msg); // messages never include the key
    return { ok: false as const, error: /BUYZ_API_KEY/.test(msg) ? 'חסר BUYZ_API_KEY בסביבה הזו' : 'המשיכה מ-Buyz נכשלה' };
  }
}

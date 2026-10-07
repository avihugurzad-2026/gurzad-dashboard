import 'server-only';
import { db } from './db';
import { SEED_LOCATIONS, setLocations, type LocationRow } from '@/lib/places';

// The branch registry from the DB `locations` table (cached ~60s per server instance). Every
// caller also refreshes the shared registry in src/lib/places.ts, so placeOptions, contextLabel,
// crumbs and placeFromPath know about a branch added in the DB without a code change.
const TTL_MS = 60_000;
let cached: { at: number; rows: LocationRow[] } | null = null;

const SQL = (withStatus: boolean) => `
  SELECT domain, branch, location, name_he, active, ${withStatus ? 'status' : 'NULL::text AS status'}, sort
  FROM locations ORDER BY branch, sort NULLS LAST, location`;

export async function loadLocations(): Promise<LocationRow[]> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    setLocations(cached.rows);
    return cached.rows;
  }
  let rows: LocationRow[];
  try {
    rows = (await db().query(SQL(true))).rows;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '42703') rows = (await db().query(SQL(false))).rows;  // stage 3 migration not applied yet
    else if (code === '42P01') rows = SEED_LOCATIONS;                  // no locations table yet
    else throw e;
  }
  cached = { at: Date.now(), rows };
  setLocations(rows);
  return rows;
}

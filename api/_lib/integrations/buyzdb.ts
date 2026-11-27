import dns from 'node:dns/promises';
import net from 'node:net';
import mysql from 'mysql2/promise';
import { HttpError } from '../server.js';
import type { Adapter } from './index.js';
import { BUYZ_SQL, buyzSync, buyzTest, type Run } from './buyzQueries.js';

// Buyz database, read-only MySQL user. Queries follow the Buyz data guide from Buyz's developer (kept in the project files, not in the repo):
// always filtered by supplier_id and a date range, aggregated here, never copying secrets tables.
// The DB host must allow connections from Vercel (dynamic IPs), so the read-only user is created for host '%'.

function isPrivate(ip: string) {
  if (net.isIPv6(ip)) return ip === '::1' || /^f[cd]|^fe80/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
}

async function connect(config: Record<string, string>, password: string) {
  const host = (config.host || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new HttpError(400, 'כתובת שרת לא תקינה');
  const port = Number(config.port || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'פורט לא תקין');
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new HttpError(400, 'כתובת שרת לא מורשית');
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(424, 'לא נמצא שרת בכתובת הזו'); }
  const base = { host, port, user: config.user, password, database: config.database, connectTimeout: 10000, dateStrings: true, charset: 'utf8mb4' };
  try {
    return await mysql.createConnection({ ...base, ssl: { rejectUnauthorized: false } });
  } catch {
    try { return await mysql.createConnection(base); } // shared hosts often have no TLS on MySQL
    catch (e: any) {
      const code = String(e?.code || '');
      if (code === 'ER_ACCESS_DENIED_ERROR') throw new HttpError(424, 'המסד דחה את שם המשתמש או הסיסמה, או שהשרת לא מאשר חיבור מכתובת ה־IP של הדשבורד (צריך לאשר host % למשתמש הזה).');
      if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED') throw new HttpError(424, 'השרת לא עונה בפורט הזה. כנראה שצריך לפתוח גישה מרחוק (Remote MySQL) לכל כתובת.');
      throw new HttpError(424, `החיבור למסד נכשל (${code || 'שגיאה'})`);
    }
  }
}

export const buyzdb: Adapter = {
  async test(config, secret) {
    const c = await connect(config, secret);
    try { return await buyzTest(runner(c), config.slug || 'ospa'); } finally { await c.end().catch(() => null); }
  },
  async sync(config, secret) {
    const c = await connect(config, secret);
    try { return await buyzSync(runner(c), config.slug || 'ospa'); } finally { await c.end().catch(() => null); }
  },
};

const runner = (c: mysql.Connection): Run => async (name, params = []) => (await c.query(BUYZ_SQL[name], params))[0] as any[];

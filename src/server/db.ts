import 'server-only';
import { Pool } from 'pg';

// One pool per server instance (survives hot reload in dev).
const g = globalThis as unknown as { __gdPool?: Pool };

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env var is required');
  // Supabase needs TLS; a local test database opts out with ?sslmode=disable in its URL
  const ssl = url.includes('sslmode=disable') ? false : { rejectUnauthorized: false };
  return new Pool({ connectionString: url, ssl, max: 5 });
}

export function db(): Pool {
  if (!g.__gdPool) g.__gdPool = makePool();
  return g.__gdPool;
}

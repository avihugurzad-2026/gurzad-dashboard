import { cookies } from 'next/headers';
import { COOKIE } from '@/server/auth';
import { json } from '@/server/http';

export async function POST() {
  (await cookies()).delete(COOKIE);
  return json({ ok: true });
}

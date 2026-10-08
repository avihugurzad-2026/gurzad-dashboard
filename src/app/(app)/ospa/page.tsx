import { redirect } from 'next/navigation';

// The Head Spa page moved under Business → Head Spa Israel → Modiin
export default async function OspaRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  redirect(`/business/head-spa-israel/modiin${sp.basis === 'mine' ? '?basis=mine' : ''}`);
}

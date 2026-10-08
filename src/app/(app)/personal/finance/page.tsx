import { redirect } from 'next/navigation';

// The shared household book moved to its own workspace, "הבית שלנו"
export default async function PersonalFinanceMoved({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const m = (await searchParams).m;
  redirect(m && /^\d{4}-\d{2}$/.test(m) ? `/household/finance?m=${m}` : '/household/finance');
}

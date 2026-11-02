import { FixedSection } from '@/components/ledger/ledger-view';
import { HouseholdLedgerPage } from '../ledger-page';

export const metadata = { title: 'הוצאות קבועות — דשבורד גורזד' };

export default async function HouseholdFixedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <HouseholdLedgerPage title="הוצאות קבועות" subtitle="שכירות, ביטוחים, מנויים: מה יורד, כמה ומתי" path="/household/fixed" sp={sp} month={false}>
      {c => <FixedSection c={c} />}
    </HouseholdLedgerPage>
  );
}

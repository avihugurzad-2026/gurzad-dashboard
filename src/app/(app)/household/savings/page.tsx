import { SavingsSection } from '@/components/ledger/ledger-view';
import { HouseholdLedgerPage } from '../ledger-page';

export const metadata = { title: 'יעדי חיסכון — דשבורד גורזד' };

export default async function HouseholdSavingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <HouseholdLedgerPage title="יעדי חיסכון" subtitle="יעדים משותפים, גלויים לכל חברי הבית" path="/household/savings" sp={sp} month={false}>
      {c => <SavingsSection c={c} />}
    </HouseholdLedgerPage>
  );
}

import { AccountsSection } from '@/components/ledger/ledger-view';
import { HouseholdLedgerPage } from '../ledger-page';

export const metadata = { title: 'חשבונות הבית — דשבורד גורזד' };

export default async function HouseholdBillsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <HouseholdLedgerPage title="חשבונות" subtitle="חשבונות בנק וכרטיסי אשראי משותפים של הבית" path="/household/bills" sp={sp}>
      {c => <AccountsSection c={c} />}
    </HouseholdLedgerPage>
  );
}

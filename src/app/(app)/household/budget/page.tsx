import { BudgetSection } from '@/components/ledger/ledger-view';
import { HouseholdLedgerPage } from '../ledger-page';

export const metadata = { title: 'תקציב הבית — דשבורד גורזד' };

export default async function HouseholdBudgetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <HouseholdLedgerPage title="תקציב" subtitle="תקציב חודשי לפי קטגוריה: תקציב, בפועל, נשאר וחריגה" path="/household/budget" sp={sp}>
      {c => <BudgetSection c={c} />}
    </HouseholdLedgerPage>
  );
}

import { pickTab } from '@/components/shell/tabs';
import { HouseholdContributionsCard, OverviewSection, TransactionsSection } from '@/components/ledger/ledger-view';
import { HouseholdLedgerPage } from '../ledger-page';

export const metadata = { title: 'פיננסים משותפים — דשבורד גורזד' };

const TABS = [{ key: 'overview', label: 'סקירה' }, { key: 'transactions', label: 'תנועות' }, { key: 'contributions', label: 'העברות חברים' }];

export default async function HouseholdFinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = pickTab(sp.tab, TABS.map(t => t.key));
  const path = '/household/finance';
  return (
    <HouseholdLedgerPage title="פיננסים משותפים" subtitle="ההכנסות וההוצאות של הבית. מכל חבר רואים רק את ההעברה שלו, לא את ההכנסה." path={path} sp={sp}
      tabs={{ base: path, active: tab, items: TABS }}>
      {c => tab === 'transactions' ? <TransactionsSection c={c} sp={sp} path={`${path}?tab=transactions`} />
        : tab === 'contributions' ? <HouseholdContributionsCard c={c} /> : <OverviewSection c={c} />}
    </HouseholdLedgerPage>
  );
}

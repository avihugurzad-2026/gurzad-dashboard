import { PageHeader } from '@/components/shell/page-header';
import { Tabs } from '@/components/shell/tabs';
import { LedgerActions, MonthNav, ledgerContext, type LedgerCtx } from '@/components/ledger/ledger-view';
import { notFound } from 'next/navigation';
import { HouseholdBadge, HouseholdNav } from './area-nav';
import { householdContext } from './context';

type SP = Record<string, string | string[] | undefined>;

// The frame of every household money page: header, area menu, action bar, month picker
export async function HouseholdLedgerPage({ title, subtitle, path, sp, tabs, month = true, children }: {
  title: string; subtitle: string; path: string; sp: SP; month?: boolean;
  tabs?: { base: string; active: string; items: { key: string; label: string }[] };
  children: (c: LedgerCtx) => React.ReactNode;
}) {
  const { u, w, members } = await householdContext();
  const c = await ledgerContext(u, w.id, path, sp);
  if (!c) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} subtitle={subtitle} status={<HouseholdBadge members={members.length} />} tabs={<HouseholdNav />}
        actions={month ? <MonthNav c={c} path={tabs && tabs.active !== tabs.items[0].key ? `${path}?tab=${tabs.active}` : path} /> : undefined} />
      <LedgerActions c={c} />
      {tabs && <Tabs base={tabs.base} active={tabs.active} tabs={tabs.items} />}
      {children(c)}
    </div>
  );
}

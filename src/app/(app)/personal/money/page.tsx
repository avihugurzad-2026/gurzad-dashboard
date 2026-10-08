import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileUp } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { listImports } from '@/server/imports';
import { personalWorkspace } from '@/server/workspaces';
import { PageHeader } from '@/components/shell/page-header';
import { Tabs, pickTab } from '@/components/shell/tabs';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import {
  AccountsSection, BudgetSection, FixedSection, LedgerActions, MonthNav, OverviewSection, PERSONAL_FINANCE_TABS, RulesSection, SavingsSection,
  TransactionsSection, ledgerContext, type LedgerCtx,
} from '@/components/ledger/ledger-view';
import { stamp } from '@/lib/format';
import { PersonalBadge, PersonalNav } from '../area-nav';

export const metadata = { title: 'פיננסים אישיים — דשבורד גורזד' };

const BASE = '/personal/money';
const MONTHLY = new Set(['overview', 'transactions', 'budget', 'accounts']);

// Imported statements and receipts (the documents of personal finance); private to their owner
async function DocumentsSection({ c }: { c: LedgerCtx }) {
  const items = await listImports(c.u, 50);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Link href={`/finance-import?ws=${c.ws}&mode=statement`} className={buttonClass('secondary', 'sm')}>ייבוא דוח</Link>
        <Link href={`/finance-import?ws=${c.ws}&mode=receipt`} className={buttonClass('secondary', 'sm')}>העלה חשבונית</Link>
        <Link href="/personal/documents" className={buttonClass('ghost', 'sm')}>כל המסמכים האישיים</Link>
      </div>
      <Card className="p-0">
        {items.length ? (
          <ul className="divide-y divide-[color:var(--border)]">
            {items.map(r => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link href={`/finance-import?import=${r.id}`} className="font-medium hover:text-accent"><bdi>{r.file_name ?? (r.source === 'gmail' ? 'Gmail' : 'ייבוא')}</bdi></Link>
                  <p className="text-xs text-muted">{r.source === 'statement' ? 'דוח' : r.source === 'receipt' ? 'קבלה / חשבונית' : 'Gmail'} · {stamp(r.created_at)}</p>
                </div>
                <Badge tone={r.status === 'imported' ? 'good' : r.status === 'review' ? 'warning' : 'neutral'}>
                  {r.status === 'imported' ? `${r.imported_count} יובאו` : r.status === 'review' ? 'ממתין לסקירה' : r.status === 'failed' ? 'נכשל' : 'בוטל'}
                </Badge>
              </li>
            ))}
          </ul>
        ) : <Empty icon={<FileUp />} title="העלה דוח או חשבונית">דוחות בנק ואשראי, חשבוניות וקבלות שתייבא יופיעו כאן.</Empty>}
      </Card>
    </div>
  );
}

export default async function PersonalMoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const w = await personalWorkspace(u);
  if (!w) notFound();
  const c = await ledgerContext(u, w.id, BASE, sp);
  if (!c) notFound();
  const tab = pickTab(sp.tab, PERSONAL_FINANCE_TABS.map(t => t.key));
  const path = tab === 'overview' ? BASE : `${BASE}?tab=${tab}`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="פיננסים אישיים" subtitle="פרטי לגמרי: רק אתה רואה את ההכנסות, ההוצאות והחשבונות שלך" status={<PersonalBadge />} tabs={<PersonalNav />}
        actions={MONTHLY.has(tab) ? <MonthNav c={c} path={path} /> : undefined} />
      <LedgerActions c={c} />
      <Tabs base={BASE} active={tab} tabs={[...PERSONAL_FINANCE_TABS]} />
      {tab === 'transactions' ? <TransactionsSection c={c} sp={sp} path={path} />
        : tab === 'budget' ? <BudgetSection c={c} />
        : tab === 'fixed' ? <FixedSection c={c} />
        : tab === 'accounts' ? <AccountsSection c={c} />
        : tab === 'documents' ? <DocumentsSection c={c} />
        : tab === 'savings' ? <SavingsSection c={c} />
        : tab === 'rules' ? <RulesSection c={c} />
        : <OverviewSection c={c} />}
    </div>
  );
}

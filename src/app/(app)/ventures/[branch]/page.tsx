import { notFound } from 'next/navigation';
import { requirePlace } from '@/server/auth';
import { CasesSection, InvestmentsSection, PropertiesSection } from '@/components/ventures/lists';
import { FolderOpen } from 'lucide-react';
import { branchName, vaultRecords } from '@/server/entries';
import { stamp } from '@/lib/format';
import { TaskBoard } from '@/components/work/task-board';
import { GoalsPanel } from '@/components/work/goals-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';

export const dynamic = 'force-dynamic';

// Nav labels win over the vault's branch names (e.g. real-estate is "נכסים" here)
const LABEL: Record<string, string> = { 'real-estate': 'נכסים', investments: 'השקעות', 'legal-and-tasks': 'משפטי', finance: 'פיננסים' };
const TYPE_LABEL: Record<string, string> = {
  'cash-account': 'חשבונות', 'fixed-commitment': 'התחייבויות קבועות', debt: 'חובות', retainer: 'ריטיינרים', invoice: 'חשבוניות',
};

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }) {
  const { branch } = await params;
  return { title: `${LABEL[branch] ?? 'יזמות'} — דשבורד גורזד` };
}

export default async function VenturePage({ params }: { params: Promise<{ branch: string }> }) {
  const u = await requirePlace({ domain: 'ventures', branch: (await params).branch });
  const { branch } = await params;
  if (!/^[a-z0-9-]{1,40}$/.test(branch)) notFound();
  const name = await branchName('ventures', branch);
  if (name === null) notFound();
  const title = LABEL[branch] ?? name;
  const path = `/ventures/${branch}`;
  const place = { domain: 'ventures', branch, location: null } as const;
  const records = await vaultRecords('ventures', branch);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page font-bold">{title}</h1>
        <p className="text-sm text-muted">יזמות</p>
      </div>
      {branch === 'real-estate' && <PropertiesSection u={u} path={path} />}
      {branch === 'investments' && <InvestmentsSection u={u} path={path} />}
      {branch === 'legal-and-tasks' && <CasesSection u={u} path={path} />}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <TaskBoard place={place} path={path} title={`משימות ${title}`} />
        <GoalsPanel place={place} path={path} title={`יעדי ${title}`} />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">רשומות מהוואלט</CardTitle><span className="text-sm text-muted">קריאה בלבד</span></CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <Empty icon={<FolderOpen className="size-6" />} title="אין נתונים עדיין">
              רשומות שיתויקו בוואלט תחת {title} (נכס, הסכם, חשבון) יופיעו כאן אחרי הסנכרון.
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--border)] text-sm">
              {records.map(r => (
                <li key={r.type} className="flex items-center justify-between py-2">
                  <bdi>{TYPE_LABEL[r.type] ?? r.type}</bdi>
                  <span className="text-muted">{r.n}{r.synced_at ? ` · עודכן ${stamp(r.synced_at)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

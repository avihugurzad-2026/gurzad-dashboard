import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Camera, FileUp, Link2, Mail, Receipt } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { getImport, listImports, receiptMatches } from '@/server/imports';
import { ledgerAccess, listAccounts, listCategories } from '@/server/ledger';
import { myWorkspaces, personalWorkspace } from '@/server/workspaces';
import { PageHeader } from '@/components/shell/page-header';
import { TabBar, tabClass } from '@/components/shell/tabs';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { ImportUpload, ReceiptReview, StatementReview, type Mode } from '@/components/ledger/import-forms';
import type { AccOpt, CatOpt, WsOpt } from '@/components/ledger/forms';
import { stamp } from '@/lib/format';
import { todayIL } from '@/lib/period';

const MODES: { key: Mode; label: string; icon: React.ReactNode }[] = [
  { key: 'statement', label: 'ייבוא דוח', icon: <FileUp aria-hidden /> },
  { key: 'receipt', label: 'העלה חשבונית', icon: <Receipt aria-hidden /> },
  { key: 'camera', label: 'צלם קבלה', icon: <Camera aria-hidden /> },
  { key: 'url', label: 'הדבק קישור', icon: <Link2 aria-hidden /> },
];

export const metadata = { title: 'ייבוא — דשבורד גורזד' };

type SP = Record<string, string | string[] | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, { label: string; tone: 'good' | 'warning' | 'neutral' | 'critical' }> = {
  review: { label: 'ממתין לסקירה', tone: 'warning' }, imported: { label: 'יובא', tone: 'good' }, cancelled: { label: 'בוטל', tone: 'neutral' }, failed: { label: 'נכשל', tone: 'critical' },
};
const SOURCE: Record<string, string> = { statement: 'דוח', receipt: 'קבלה', gmail: 'Gmail' };

// Personal + households I can write to: where imported rows may go
async function targetsFor(u: Awaited<ReturnType<typeof requireUser>>) {
  const [mine, personal] = await Promise.all([myWorkspaces(u), personalWorkspace(u)]);
  const out: WsOpt[] = personal ? [{ id: personal.id, name: 'אישי', kind: 'personal' }] : [];
  for (const w of mine.filter(x => x.kind === 'household')) if ((await ledgerAccess(u, w.id))?.canWrite) out.push({ id: w.id, name: w.name, kind: 'household' });
  return out;
}
const catOpts = async (ws: string): Promise<CatOpt[]> => (await listCategories(ws)).map(c => ({ id: c.id, kind: c.kind, name: c.name, parent_id: c.parent_id }));

export default async function FinanceImportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const targets = await targetsFor(u);
  const back = (ws?: string | null) => ws && targets.find(t => t.id === ws)?.kind === 'household' ? '/household/finance?tab=transactions' : '/personal/money?tab=transactions';

  // ── Review one import ──
  const importId = typeof sp.import === 'string' && UUID.test(sp.import) ? sp.import : null;
  if (importId) {
    const got = await getImport(u, importId);
    if (!got) notFound();
    const { imp, candidates } = got;
    const catsByWs: Record<string, CatOpt[]> = {};
    for (const t of targets) catsByWs[t.id] = await catOpts(t.id);
    const st = STATUS[imp.status] ?? STATUS.review;
    const header = (
      <PageHeader title={imp.source === 'receipt' ? 'סקירת קבלה' : 'סקירת ייבוא'} crumb={imp.file_name ?? undefined}
        subtitle={<><bdi>{imp.file_name ?? SOURCE[imp.source]}</bdi> · {stamp(imp.created_at)}</>} status={<Badge tone={st.tone}>{st.label}</Badge>}
        actions={<Link href="/finance-import" className={buttonClass('secondary', 'sm')}>ייבוא חדש</Link>} />
    );
    if (imp.status !== 'review') {
      return (
        <div className="flex flex-col gap-6">{header}
          <Card><Empty icon={<FileUp />} title={imp.status === 'imported' ? `יובאו ${imp.imported_count} תנועות` : imp.status === 'cancelled' ? 'הייבוא בוטל. שום דבר לא נשמר.' : 'הקריאה נכשלה'}
            action={{ href: back(imp.workspace_id), label: 'לתנועות' }}>{imp.status === 'failed' ? imp.error : null}</Empty></Card>
        </div>
      );
    }
    const today = todayIL();
    if (imp.source === 'receipt') {
      const cand = candidates[0];
      if (!cand) notFound();
      const matches = await receiptMatches(u, targets.map(t => t.id), cand.amount, cand.occurred_on);
      return (
        <div className="flex flex-col gap-6">{header}
          <Card className="p-5 sm:p-6">
            <ReceiptReview importId={imp.id} cand={cand} note={imp.error} targets={targets} catsByWs={catsByWs} matches={matches}
              fileHref={imp.file_id ? `/api/v1/files/${imp.file_id}` : null} today={today} />
          </Card>
        </div>
      );
    }
    const open = candidates.filter(c => c.status !== 'imported' && c.status !== 'skipped');
    return (
      <div className="flex flex-col gap-6">{header}
        <p className="text-sm text-muted">
          נקראו {imp.row_count} שורות. בדוק את הסיווג, בחר לכל שורה אם היא שלך או של משק הבית, וסמן &quot;זכור את הבחירה&quot; כדי שבפעם הבאה זה יקרה לבד.
          {imp.error && <><br /><span className="text-warning-ink">{imp.error}</span></>}
        </p>
        {open.length
          ? <StatementReview importId={imp.id} candidates={open} targets={targets} catsByWs={catsByWs} />
          : <Card><Empty title="אין שורות לייבא" /></Card>}
      </div>
    );
  }

  // ── Upload ──
  const mode = MODES.some(m => m.key === sp.mode) ? (sp.mode as (typeof MODES)[number]['key']) : 'statement';
  const wantWs = typeof sp.ws === 'string' && targets.some(t => t.id === sp.ws) ? sp.ws : targets[0]?.id;
  if (!wantWs) return <Empty title="אין אזור שאפשר לייבא אליו" />;
  const accountsByWs: Record<string, AccOpt[]> = {};
  for (const t of targets) accountsByWs[t.id] = (await listAccounts(t.id)).items.map(a => ({ id: a.id, name: a.name, kind: a.kind, last4: a.last4 }));
  const recent = await listImports(u, 20);
  const wsName = (id: string) => { const t = targets.find(x => x.id === id); return t ? (t.kind === 'personal' ? 'אישי' : t.name) : ''; };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="ייבוא" subtitle="דוחות בנק ואשראי, חשבוניות וקבלות. כל שורה נבדקת לפני שהיא נשמרת."
        actions={<Link href="/finance-import/gmail" className={buttonClass('secondary', 'sm')}><Mail aria-hidden />חבר Gmail</Link>}
        tabs={
          <TabBar label="סוג ייבוא">
            {MODES.map(m => (
              <li key={m.key}><Link href={`/finance-import?mode=${m.key}&ws=${wantWs}`} aria-current={m.key === mode ? 'page' : undefined} className={tabClass(m.key === mode)}>{m.icon}{m.label}</Link></li>
            ))}
          </TabBar>
        } />
      <Card className="p-5 sm:p-6"><ImportUpload key={mode} mode={mode} targets={targets} accountsByWs={accountsByWs} defaultWs={wantWs} /></Card>
      <section className="flex flex-col gap-3">
        <h2 className="text-section font-semibold">ייבואים אחרונים</h2>
        <Card className="p-0">
          {recent.length ? (
            <ul className="divide-y divide-[color:var(--border)]">
              {recent.map(r => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/finance-import?import=${r.id}`} className="truncate font-medium hover:text-accent"><bdi>{r.file_name ?? SOURCE[r.source]}</bdi></Link>
                    <p className="text-xs text-muted">{SOURCE[r.source]} · {wsName(r.workspace_id)} · {stamp(r.created_at)} · {r.status === 'imported' ? `${r.imported_count} יובאו` : `${r.row_count} שורות`}</p>
                  </div>
                  <Badge tone={(STATUS[r.status] ?? STATUS.review).tone}>{(STATUS[r.status] ?? STATUS.review).label}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty compact icon={<FileUp />} title="עוד לא ייבאת כלום">העלה דוח אשראי או בנק (CSV, Excel או PDF) כדי להתחיל.</Empty>}
        </Card>
      </section>
    </div>
  );
}

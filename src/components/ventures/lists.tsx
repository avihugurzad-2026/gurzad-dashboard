import Link from 'next/link';
import { AlertTriangle, Building2, Gavel, LineChart } from 'lucide-react';
import type { SessionUser } from '@/server/auth';
import { CASE_STATUSES, labelIn, listCases, listInvestments, listProperties, ASSET_KINDS } from '@/server/ventures';
import { todayIL } from '@/lib/period';
import { ils, shortDate } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type Tone } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';
import { NotReady } from '@/components/work/not-ready';
import { cn } from '@/lib/utils';
import { AddCaseDialog, AddInvestmentDialog, AddPropertyDialog } from './forms';
import { Pct, ValueNote, pctText, rowTh } from './sections';

const sum = (xs: (number | null)[]) => (xs.some(x => x !== null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null);

// ── נכסים ─────────────────────────────────────────────────────────────────────
export async function PropertiesSection({ u, path }: { u: SessionUser; path: string }) {
  const d = await listProperties(u);
  const today = todayIL();
  const value = sum(d.items.map(p => p.current_value));
  const balance = sum(d.items.map(p => p.loan_balance));
  const monthly = sum(d.items.map(p => p.monthly_payment));
  const estimate = d.items.some(p => p.value_source === 'estimate');
  return (
    <div className="flex flex-col gap-4">
      {d.ready && d.items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard label="שווי הנכסים" value={ils(value)} hint={estimate ? 'כולל הערכה, לא שמאות' : undefined} reason="לא הוזן שווי לאף נכס" />
          <KpiCard label="יתרת הלוואות" value={ils(balance)} reason="אין הלוואות" />
          <KpiCard label="החזר חודשי" value={ils(monthly)} hint="כל ההלוואות, לפני חלוקה ליזמות/אישי" reason="אין הלוואות" />
        </div>
      )}
      <Card>
        <CardHeader className="flex-wrap">
          <div><CardTitle>נכסים</CardTitle><p className="text-sm text-muted">שווי, הלוואה ותשואה ב-12 החודשים האחרונים</p></div>
          {d.ready && d.can_add && <AddPropertyDialog path={path} today={today} />}
        </CardHeader>
        <CardContent>
          {!d.ready ? <NotReady what="נכסים" /> : d.items.length === 0 ? (
            <Empty icon={<Building2 />} title="אין נכסים עדיין">
              הוסף נכס עם &quot;+ נכס&quot;. לכל נכס יש דף משלו: הלוואה, החזרים, הכנסות, הוצאות ותשואה.
            </Empty>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th scope="col">נכס</th><th scope="col" className="num">שווי</th>
                    <th scope="col" className="num">יתרת הלוואה</th><th scope="col" className="num">החזר חודשי</th>
                    <th scope="col" className="num">תשואה ברוטו</th><th scope="col" className="num">תשואה נטו על ההון</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map(p => (
                    <tr key={p.id} className="align-top">
                      <th scope="row" className={rowTh}>
                        <Link href={`/ventures/real-estate/${p.id}`} className="font-medium hover:underline"><bdi>{p.name}</bdi></Link>
                        <p className="text-xs text-muted">{labelIn(ASSET_KINDS, p.kind)}{p.address ? <> · <bdi>{p.address}</bdi></> : null}</p>
                      </th>
                      <td className="num"><Money value={p.current_value} empty="–" /><div className="mt-1"><ValueNote source={p.value_source} date={null} /></div></td>
                      <td className="num"><Money value={p.loan_balance} empty="אין הלוואה" /></td>
                      <td className="num"><Money value={p.monthly_payment} empty="–" /></td>
                      <td className="num"><Pct value={p.yields.gross} empty="–" /></td>
                      <td className="num"><Pct value={p.yields.net} empty="–" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted">תשואה מוצגת רק כשיש הכנסות רשומות לנכס. &quot;–&quot; = אין נתונים עדיין.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── השקעות ────────────────────────────────────────────────────────────────────
export async function InvestmentsSection({ u, path }: { u: SessionUser; path: string }) {
  const d = await listInvestments(u);
  const today = todayIL();
  const t = d.totals;
  return (
    <div className="flex flex-col gap-4">
      {d.ready && d.items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard label="הושקע (פעילות)" value={ils(t.invested)} reason="אין השקעות פעילות" />
          <KpiCard label="שווי נוכחי" value={ils(t.value)}
            hint={[t.has_estimate ? 'כולל הערכה' : '', t.unvalued ? `${t.unvalued} בלי שווי` : ''].filter(Boolean).join(' · ') || undefined}
            reason="לא הוזן שווי" />
          <KpiCard label="תשואה" value={t.gain === null ? null : `${ils(t.gain)} · ${pctText(t.pct) ?? ''}`} hint="על ההשקעות שיש להן שווי" reason="צריך שווי נוכחי" />
        </div>
      )}
      <Card>
        <CardHeader className="flex-wrap">
          <div><CardTitle>השקעות</CardTitle><p className="text-sm text-muted">סכום, שווי ותשואה לכל השקעה</p></div>
          {d.ready && d.can_add && <AddInvestmentDialog path={path} today={today} />}
        </CardHeader>
        <CardContent>
          {!d.ready ? <NotReady what="השקעות" /> : d.items.length === 0 ? (
            <Empty icon={<LineChart />} title="אין השקעות עדיין">הוסף השקעה עם &quot;+ השקעה&quot;.</Empty>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="data-table min-w-[680px]">
                <thead>
                  <tr>
                    <th scope="col">השקעה</th><th scope="col" className="num">הושקע</th>
                    <th scope="col" className="num">שווי</th><th scope="col" className="num">תשואה</th><th scope="col" className="num">שנתית</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map(i => (
                    <tr key={i.id} className={cn('align-top', i.status === 'exited' && 'text-muted')}>
                      <th scope="row" className={rowTh}>
                        <Link href={`/ventures/investments/${i.id}`} className="font-medium hover:underline"><bdi>{i.name}</bdi></Link>
                        <p className="text-xs text-muted">{i.category_label} · <bdi>{shortDate(i.invested_on)}</bdi>{i.status === 'exited' ? ' · מומשה' : ''}</p>
                      </th>
                      <td className="num"><Money value={i.amount_invested} /></td>
                      <td className="num"><Money value={i.current_value} empty="–" /><div className="mt-1"><ValueNote source={i.value_source} date={null} /></div></td>
                      <td className="num"><Pct value={i.pct} empty="–" /></td>
                      <td className="num"><Pct value={i.annualized} empty="–" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted">תשואה שנתית מוצגת אחרי שנה לפחות מתאריך ההשקעה.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── משפטי ─────────────────────────────────────────────────────────────────────
const STATUS_TONE: Record<string, Tone> = { open: 'accent', waiting: 'warning', closed: 'neutral' };

export async function CasesSection({ u, path }: { u: SessionUser; path: string }) {
  const d = await listCases(u);
  const open = d.items.filter(c => c.status !== 'closed');
  const overdue = open.reduce((s, c) => s + c.overdue_count, 0);
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>תיקים משפטיים</CardTitle>
          <p className="text-sm text-muted">
            {d.ready ? `${open.length} פתוחים` : ''}
            {overdue > 0 && <span className="ms-1 font-medium text-critical-ink">· {overdue} מועדים שעברו</span>}
          </p>
        </div>
        {d.ready && d.can_add && <AddCaseDialog path={path} today={d.today} />}
      </CardHeader>
      <CardContent>
        {!d.ready ? <NotReady what="תיקים" /> : d.items.length === 0 ? (
          <Empty icon={<Gavel />} title="אין תיקים עדיין">פתח תיק עם &quot;+ תיק&quot;, והוסף לו מועדים, משימות ותשלומים.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {d.items.map(c => {
              const nd = c.next_deadline;
              return (
                <li key={c.id} className={cn('flex flex-col gap-1.5 py-4 first:pt-0 last:pb-0', c.status === 'closed' && 'opacity-70')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/ventures/legal-and-tasks/${c.id}`} className="font-semibold text-ink hover:underline"><bdi>{c.title}</bdi></Link>
                    <Badge tone={STATUS_TONE[c.status]}>{labelIn(CASE_STATUSES, c.status)}</Badge>
                    {c.overdue_count > 0 && <Badge tone="critical"><AlertTriangle aria-hidden />{c.overdue_count} באיחור</Badge>}
                  </div>
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                    {c.parties && <bdi>{c.parties}</bdi>}
                    {c.lawyer && <span>עו״ד <bdi>{c.lawyer}</bdi></span>}
                  </p>
                  <p className={cn('text-sm', nd?.state === 'overdue' ? 'font-medium text-critical-ink' : nd?.state === 'soon' ? 'text-warning-ink' : 'text-ink-2')}>
                    {nd ? <>המועד הבא: <bdi>{nd.title}</bdi> · <bdi>{shortDate(nd.due_on)}</bdi>{nd.state === 'overdue' ? ' (עבר)' : ''}</> : <span className="text-muted">אין מועדים פתוחים</span>}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

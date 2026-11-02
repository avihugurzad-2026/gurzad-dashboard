import Link from 'next/link';
import { requireAdmin } from '@/server/auth';
import { CircleCheck, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { integrity } from '@/server/data';
import { daysAgo, longDate, shortDate, stamp } from '@/lib/format';
import { daysBetween, todayIL } from '@/lib/period';
import { Card, CardContent, CardHeader, CardTitle, Section } from '@/components/ui/card';
import { buttonClass } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/page-header';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';

export const metadata = { title: 'שלמות נתונים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const DOMAIN: Record<string, string> = { business: 'עסקים', personal: 'אישי', ventures: 'השקעות' };

export default async function HealthPage() {
  await requireAdmin();
  const d = await integrity();
  const today = todayIL();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="שלמות נתונים" subtitle={<>{longDate(d.today)}. מה ידוע, מה חסר, ולמה מספר מסוים לא מוצג.</>} />

      <Section id="alerts" title="התראות" className="scroll-mt-20">
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-5"><p className="text-sm font-medium text-ink-2">דחוף</p><p className={cn('mt-2 text-kpi font-bold tabular', d.alerts.red > 0 && 'text-critical-ink')}>{d.alerts.red}</p></Card>
          <Card className="p-5"><p className="text-sm font-medium text-ink-2">לטיפול</p><p className="mt-2 text-kpi font-bold tabular">{d.alerts.orange}</p></Card>
          <Card className="p-5"><p className="text-sm font-medium text-ink-2">נדחו</p><p className="mt-2 text-kpi font-bold tabular">{d.alerts.snoozed}</p></Card>
        </div>
        <Card><CardContent className="pt-5">
          {d.alerts.list.length === 0 ? (
            <Empty icon={<CircleCheck className="text-good" />} title="אין התראות פתוחות" />
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {d.alerts.list.map(a => {
                const snoozed = a.snoozed_until && a.snoozed_until > today;
                const Icon = a.severity === 'red' ? OctagonAlert : TriangleAlert;
                return (
                  <li key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                    <Icon className={a.severity === 'red' ? 'mt-0.5 size-[18px] shrink-0 text-critical' : 'mt-0.5 size-[18px] shrink-0 text-warning'} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink"><bdi>{a.title}</bdi></p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                        <bdi>{a.rule_id}</bdi>
                        {a.amount != null && <Money value={a.amount} className="text-ink-2" />}
                        <span>נפתח {daysAgo(daysBetween(new Date(a.first_seen).toISOString().slice(0, 10), today))}</span>
                        {a.suggested_action && <span className="text-ink-2">{a.suggested_action}</span>}
                      </div>
                    </div>
                    {snoozed && <Badge>נדחה עד {shortDate(a.snoozed_until)}</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent></Card>
      </Section>

      <Card>
        <CardHeader><CardTitle>למה מופיע &quot;אין נתונים עדיין&quot;</CardTitle></CardHeader>
        <CardContent>
          {d.gaps.length === 0 ? (
            <Empty icon={<CircleCheck className="text-good" />} title="לכל המדדים יש נתונים" />
          ) : (
            <ul className="flex flex-col gap-3">
              {d.gaps.map(g => (
                <li key={g.kpi} className="flex items-start gap-2 text-sm">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  <span className="text-ink-2"><bdi>{g.text}</bdi></span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>גיל סנכרון לפי עסק</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {d.branches.map(b => (
                <li key={b.branch} className="flex items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
                  <span><bdi className="font-medium">{b.name_he || b.branch}</bdi>
                    <span className="text-muted"> · {DOMAIN[b.domain] ?? b.domain}</span></span>
                  {b.entity_count === 0 ? <Badge>אין נתונים עדיין</Badge>
                    : <span className="text-muted">{b.entity_count} רשומות · {stamp(b.last_synced)}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>ריצות סנכרון אחרונות</CardTitle></CardHeader>
          <CardContent>
            {d.runs.length === 0 ? <Empty title="עוד לא רץ סנכרון" /> : (
              <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                {d.runs.map(r => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 text-sm first:pt-0 last:pb-0">
                    <span className="text-ink-2">{stamp(r.finished_at ?? r.started_at)}
                      {r.dry_run && <Badge className="ms-2">בדיקה</Badge>}</span>
                    <span className="text-xs text-muted tabular">
                      נוסף {r.added} · שונה {r.changed} · נמחק {r.soft_deleted}
                      {r.error_count > 0 && <span className="text-critical-ink"> · {r.error_count} שגיאות</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>פרמטרים</CardTitle>
          <span className="text-sm text-muted">מע״מ וספים לפי תאריך, לא קבועים בקוד</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {d.missing_params.length > 0 && (
            <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning-ink">
              חסרים: <bdi>{d.missing_params.join(', ')}</bdi>. כל מספר שתלוי בהם לא מוצג.
            </p>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-ink-2">מע״מ היום: <b className="font-semibold tabular">{d.params_today.vat_rate !== null ? `${Math.round(d.params_today.vat_rate * 100)}%` : 'חסר'}</b></span>
            <span className="text-ink-2">סף מספר הקצאה: {d.params_today.allocation_threshold !== null
              ? <Money value={d.params_today.allocation_threshold} className="font-semibold" /> : <b className="font-semibold">חסר</b>}</span>
          </div>
          <div>
            <p className="mb-2 text-xs text-muted">מסומנים כהערכה ({d.estimates.length}). לא להציג כעובדה:</p>
            <ul className="flex flex-wrap gap-1.5">
              {d.estimates.map(e => (
                <li key={e.key}><Badge tone="warning" className="h-auto max-w-full whitespace-normal break-all py-0.5"><bdi>{e.key}</bdi>: <bdi>{String(e.value)}</bdi></Badge></li>
              ))}
            </ul>
          </div>
          <div><Link href="/" className={buttonClass('secondary', 'sm')}>חזרה לסקירה</Link></div>
        </CardContent>
      </Card>
    </div>
  );
}

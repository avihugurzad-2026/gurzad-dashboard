import Link from 'next/link';
import { requireAdmin } from '@/server/auth';
import { CircleCheck, Download, OctagonAlert, TriangleAlert } from 'lucide-react';
import { review } from '@/server/data';
import { ils, longDate, shortDate, stamp } from '@/lib/format';
import { ForecastChart } from '@/components/charts/forecast-chart';
import { ScorecardTable } from '@/components/dash/scorecard-table';
import { DecisionsForm } from './decisions-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';
import { buttonClass } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/page-header';

export const metadata = { title: 'סקירה שבועית — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const SCENARIOS = [
  { key: 'base', label: 'בסיס' },
  { key: 'late_collection', label: 'גבייה מאוחרת ב-30 יום' },
  { key: 'lose_top_client', label: 'אובדן הלקוח הגדול' },
] as const;

export default async function ReviewPage() {
  await requireAdmin();
  const d = await review();
  const base = d.forecast.base;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="סקירה שבועית"
        subtitle={<>{longDate(d.today)} · <bdi>{d.period}</bdi>{d.last_review ? <> · אחרונה: {stamp(d.last_review.reviewed_at)}</> : <> · עוד לא נעשתה סקירה</>}</>}
        actions={d.last_review ? (
          <a href={`/api/v1/review/${d.last_review.id}/export`} className={buttonClass('secondary')}>
            <Download className="size-4" aria-hidden />
            ייצוא ההחלטות ל-<bdi>Obsidian</bdi>
          </a>
        ) : undefined} />

      {/* 1. Alerts */}
      <Card>
        <CardHeader>
          <CardTitle>1. חריגות</CardTitle>
          <span className="text-sm text-muted">{d.attention.length} פתוחות</span>
        </CardHeader>
        <CardContent>
          {d.attention.length === 0 ? (
            <Empty icon={<CircleCheck className="text-good" />} title="אין חריגות פתוחות" />
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {d.attention.map((a, i) => {
                const Icon = a.severity === 'red' ? OctagonAlert : TriangleAlert;
                return (
                  <li key={a.id ?? i} className="flex items-start gap-3 py-3 text-sm first:pt-0 last:pb-0">
                    <Icon className={a.severity === 'red' ? 'mt-0.5 size-4 shrink-0 text-critical' : 'mt-0.5 size-4 shrink-0 text-warning'} aria-hidden />
                    <span className="flex-1"><bdi>{a.title}</bdi></span>
                    {a.amount != null && <Money value={a.amount} className="text-ink-2" />}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 2. Scorecard */}
      <Card>
        <CardHeader>
          <CardTitle>2. יעדים</CardTitle>
          <Link href="/scorecard" className={buttonClass('ghost', 'sm')}>עריכת יעדים</Link>
        </CardHeader>
        <CardContent>
          <ScorecardTable weeks={d.scorecard.weeks} measures={d.scorecard.measures} />
        </CardContent>
      </Card>

      {/* 3. Forecast */}
      <Card>
        <CardHeader>
          <CardTitle>3. תחזית מזומן, 13 שבועות</CardTitle>
          {base.partial && <Badge tone="warning">נתונים חלקיים</Badge>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {base.partial && (
            <div className="rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning-ink">
              <p className="font-medium">מה שחסר כדי שהתחזית תהיה מלאה:</p>
              <ul className="mt-1 list-inside list-disc">
                {base.missing.map((m: { key: string; text: string }) => <li key={m.key}><bdi>{m.text}</bdi></li>)}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="מזומן תפעולי" value={ils(base.cash.operating)} />
            <Stat label="מוגבל" value={ils(base.cash.restricted)} />
            <Stat label="רזרבה" value={ils(base.cash.reserve)} />
            <Stat label="רצפת מזומן" value={ils(base.floor)} />
          </div>

          {base.trough ? (
            <>
              <ForecastChart weeks={base.weeks} floor={base.floor} />
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <Stat label="שבוע השפל" value={`${shortDate(base.trough.week)} · ${ils(base.trough.amount)}`} />
                <Stat label="מתחת לרצפה" value={base.below_floor === null ? null : base.below_floor ? 'כן' : 'לא'} />
                <Stat label="שבועות הוצאה שהמזומן מכסה" value={base.weeks_of_spend !== null ? String(base.weeks_of_spend) : null} />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-ink-2">תרחישים</p>
                <ul className="flex flex-col gap-2 text-sm">
                  {SCENARIOS.map(s => {
                    const sc = d.forecast[s.key];
                    return (
                      <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2.5">
                        <span className="text-ink-2">{s.label}</span>
                        {sc.trough
                          ? <span className="text-muted">שפל {shortDate(sc.trough.week)}: <Money value={sc.trough.amount} className="text-ink" /></span>
                          : <span className="text-muted">אין נתונים עדיין</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          ) : (
            <Empty title="אין יתרת פתיחה" action={{ href: '/health', label: 'מה חסר' }}>
              בלי רשומת cash-account אין נקודת התחלה לתחזית, ולכן לא מוצג גרף ולא שבוע שפל.
            </Empty>
          )}
        </CardContent>
      </Card>

      {/* 4. Decisions */}
      <Card>
        <CardHeader>
          <CardTitle>4. החלטות</CardTitle>
          <span className="text-sm text-muted">כל החלטה: טקסט, בעלים ושבוע יעד</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <DecisionsForm period={d.period} />
          {d.recent_decisions.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-2">החלטות מהסקירות האחרונות</p>
              <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                {d.recent_decisions.map((x: { text: string; owner: string; due_week: string; period: string }, i: number) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0">
                    <span className="flex-1"><bdi>{x.text}</bdi></span>
                    <span className="text-xs text-muted"><bdi>{x.owner}</bdi> · עד <bdi>{x.due_week}</bdi> · נקבע ב-<bdi>{x.period}</bdi></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      {value === null
        ? <p className="mt-0.5 text-sm text-muted">אין נתונים עדיין</p>
        : <p className="mt-0.5 font-semibold tabular amount"><bdi>{value}</bdi></p>}
    </div>
  );
}

import Link from 'next/link';
import { CircleDollarSign, Clock, Receipt, Sparkles, TrendingUp } from 'lucide-react';
import type { ospa, Basis } from '@/server/revenue';
import { ils, num, stamp } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { RefreshButton } from '@/components/dash/refresh-button';
import { MonthlyBars } from '@/components/charts/monthly-bars';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';
import { cn } from '@/lib/utils';

export type OspaData = Awaited<ReturnType<typeof ospa>>;

const SOURCE_LABEL = { bookings: 'טיפולים (תורים)', vouchers: 'שוברים', sales: 'מוצרים' } as const;

export function BasisToggle({ basis, share, base }: { basis: Basis; share: number | null; base: string }) {
  const opts: { key: Basis; label: string }[] = [
    { key: 'all', label: '100% מהעסק' },
    { key: 'mine', label: share !== null ? `החלק שלי (${Math.round(share * 100)}%)` : 'החלק שלי' },
  ];
  return (
    <div role="group" aria-label="בסיס חישוב" className="inline-flex rounded-lg border border-line-strong p-0.5 text-sm">
      {opts.map(o => (
        <Link key={o.key} href={o.key === 'all' ? base : `${base}?basis=mine`} aria-current={o.key === basis ? 'true' : undefined}
          className={cn('rounded-md px-3 py-1.5', o.key === basis ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:text-ink')}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function Share({ part, whole }: { part: number | null; whole: number | null }) {
  if (part === null || !whole) return null;
  return <span className="text-xs text-muted tabular">{Math.round((part / whole) * 100)}%</span>;
}

// Revenue view of Head Spa Israel: the whole business, or one branch (same layout, that branch's data)
export function OspaView({ d, base, title, subtitle, tabs, children }: {
  d: OspaData; base: string; title: string; subtitle?: string; tabs?: React.ReactNode; children?: React.ReactNode;
}) {
  const mine = d.basis === 'mine';
  const vatPct = d.vat_rate !== null ? `${Math.round(d.vat_rate * 100)}%` : null;
  const chart = d.monthly.slice(-12).map(m => ({ month: m.month, value: m.ex_vat }));
  const src = d.live?.by_source;
  const srcTotal = src ? [src.bookings, src.vouchers, src.sales].reduce<number>((a, b) => a + (b ?? 0), 0) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-page font-bold">{title}</h1>
          <p className="text-sm text-muted">{subtitle ?? 'עסקים'} · הכנסה לפני מע״מ{vatPct ? ` (${vatPct})` : ''}, מתוך Buyz</p>
          {d.locations.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="סניפים">
              {d.locations.map(l => (
                <li key={l.location}>
                  <Badge tone={l.has_data ? 'good' : undefined}>
                    סניף {l.name_he}{l.has_data ? '' : l.connected ? ' · אין נתונים עדיין' : ' · בהקמה'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BasisToggle basis={d.basis} share={d.share} base={base} />
          {d.ready && <RefreshButton />}
        </div>
      </div>

      {tabs}

      {!d.ready && (
        <Card className="border-warning/40 bg-warning-soft">
          <CardContent className="pt-4 text-sm text-warning-ink">
            טבלאות ההכנסות עוד לא נוצרו במסד, ולכן אין היסטוריה חודשית. מוצגים רק נתוני החודש מ-Buyz.
          </CardContent>
        </Card>
      )}
      {d.live_error && (
        <Card className="border-warning/40 bg-warning-soft">
          <CardContent className="pt-4 text-sm text-warning-ink">
            {d.live_error}. {d.monthly.length ? 'מוצגים הנתונים האחרונים שנשמרו.' : ''}
          </CardContent>
        </Card>
      )}
      {mine && d.share === null && (
        <Card className="border-warning/40 bg-warning-soft">
          <CardContent className="pt-4 text-sm text-warning-ink">חסר פרמטר אחוז הבעלות, ולכן אי אפשר לחשב את החלק שלך.</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={mine ? 'החלק שלי בהכנסה החודש' : 'הכנסה החודש'} icon={<TrendingUp className="size-4" />}
          value={ils(d.this_month)}
          hint={d.this_month_incl !== null ? `${ils(d.this_month_incl)} כולל מע״מ` : undefined}
          reason="אין נתונים מ-Buyz לחודש הזה"
          foot={d.last_month !== null ? <>חודש קודם (מלא): <Money value={d.last_month} /></> : null} />
        <KpiCard label={mine ? 'החלק שלי מתחילת השנה' : 'הכנסה מתחילת השנה'} icon={<CircleDollarSign className="size-4" />}
          value={ils(d.ytd)} hint={d.ytd !== null ? `${d.ytd_months} חודשים, לפני מע״מ` : undefined}
          reason={d.ready ? 'עוד לא נמשכו חודשים מ-Buyz' : 'אין היסטוריה חודשית עדיין'} />
        <KpiCard label="עסקאות החודש" icon={<Receipt className="size-4" />} amount={false}
          value={num(d.live?.tx ?? null)}
          hint={d.live?.avg_incl != null ? `עסקה ממוצעת ${ils(d.live.avg_incl)} כולל מע״מ` : undefined}
          reason="אין נתונים מ-Buyz לחודש הזה" />
        <KpiCard label="טרם שולם" icon={<Clock className="size-4" />}
          value={ils(d.live?.unpaid_incl ?? null)} hint={d.live ? 'כולל מע״מ, 100% מהעסק' : undefined}
          reason="אין נתונים מ-Buyz לחודש הזה" />
      </div>

      {children}

      <Card>
        <CardHeader>
          <CardTitle>{mine ? 'החלק שלי בהכנסה לפי חודש' : 'הכנסה לפי חודש'}</CardTitle>
          <span className="text-sm text-muted">לפני מע״מ · 12 חודשים</span>
        </CardHeader>
        <CardContent>
          {chart.length >= 2 ? <MonthlyBars data={chart} caption="הכנסה חודשית לפני מע״מ, 12 החודשים האחרונים" /> : (
            <Empty icon={<Sparkles className="size-6" />} title="עוד אין היסטוריה חודשית">
              {d.ready ? 'לחץ "רענן מ-Buyz" כדי למשוך עד 24 חודשים אחורה.' : 'ההיסטוריה תופיע אחרי שהטבלאות ייווצרו והנתונים יימשכו מ-Buyz.'}
            </Empty>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>מאיפה ההכנסה החודש</CardTitle><span className="text-sm text-muted">כולל מע״מ</span></CardHeader>
          <CardContent>
            {!src ? <p className="text-sm text-muted">אין נתונים עדיין</p> : (
              <ul className="flex flex-col gap-3">
                {(Object.keys(SOURCE_LABEL) as (keyof typeof SOURCE_LABEL)[]).map(k => (
                  <li key={k} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink-2">{SOURCE_LABEL[k]}</span>
                      <span className="flex items-center gap-2"><Share part={src[k]} whole={srcTotal} /><Money value={src[k]} className="font-medium" /></span>
                    </div>
                    {src[k] !== null && srcTotal ? (
                      <div className="h-1.5 rounded-full bg-[color:var(--grid)]" aria-hidden>
                        <div className="h-1.5 rounded-full bg-[color:var(--series-1)]" style={{ width: `${Math.max(2, (src[k]! / srcTotal) * 100)}%` }} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>אמצעי תשלום החודש</CardTitle><span className="text-sm text-muted">כולל מע״מ</span></CardHeader>
          <CardContent>
            {!d.live?.methods.length ? <p className="text-sm text-muted">אין נתונים עדיין</p> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-xs text-muted">
                  <th scope="col" className="py-2 text-start font-medium">אמצעי</th>
                  <th scope="col" className="py-2 text-start font-medium">עסקאות</th>
                  <th scope="col" className="py-2 text-end font-medium">סכום</th>
                </tr></thead>
                <tbody>
                  {d.live.methods.map(m => (
                    <tr key={m.method} className="border-b border-line last:border-0">
                      <th scope="row" className="py-2 text-start font-normal"><bdi>{m.label}</bdi></th>
                      <td className="py-2 tabular">{num(m.count) ?? '–'}</td>
                      <td className="py-2 text-end"><Money value={m.total} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>מוצרים מובילים החודש</CardTitle></CardHeader>
          <CardContent>
            {!d.live?.sales?.top_items.length ? <p className="text-sm text-muted">אין נתונים עדיין</p> : (
              <ul className="flex flex-col divide-y divide-[color:var(--border)] text-sm">
                {d.live.sales.top_items.slice(0, 8).map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate"><bdi>{it.name || '—'}</bdi>{it.count !== null && <span className="text-muted"> · {num(it.count)}</span>}</span>
                    <Money value={it.total} className="shrink-0" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>מכירות לפי מוכר/ת</CardTitle></CardHeader>
          <CardContent>
            {!d.live?.sales?.by_seller.length ? <p className="text-sm text-muted">אין נתונים עדיין</p> : (
              <ul className="flex flex-col divide-y divide-[color:var(--border)] text-sm">
                {d.live.sales.by_seller.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate"><bdi>{it.name || '—'}</bdi>{it.count !== null && <span className="text-muted"> · {num(it.count)}</span>}</span>
                    <Money value={it.total} className="shrink-0" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>רווח</CardTitle><Badge>אין נתונים עדיין</Badge></CardHeader>
        <CardContent className="text-sm text-muted">
          Buyz מדווח הכנסות בלבד, בלי הוצאות, ולכן רווח{mine ? ' וחלקך ברווח' : ''} לא מוצגים עד שיתחבר מקור להוצאות.
          {d.fetched_at && <span className="block pt-2 text-xs">Buyz עודכן {stamp(d.fetched_at)}</span>}
        </CardContent>
      </Card>
    </div>
  );
}

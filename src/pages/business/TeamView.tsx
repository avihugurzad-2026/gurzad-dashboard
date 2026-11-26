import { useState } from 'react';
import { Award, Clock, ShoppingBag, TrendingUp, Users } from 'lucide-react';
import type { Rec } from '../../data/types';
import { useBizRevenue } from '../../lib/bizRevenue';
import { money, number, percent } from '../../lib/format';
import { Card, CardHead, Empty, Kpi, Meter, PillTabs, Stagger } from '../../ui/kit';
import type { StaffRow } from '../../../shared/integrations';

const TONE = 'var(--tone-business)';
const time = (d: string) => (d.length > 10 ? d.slice(11, 16) : '');

/** Sales today and performance per employee, from the business's connected system (Buyz). */
export function TeamView({ biz }: { biz: Rec }) {
  const revs = useBizRevenue(biz.id).filter((r) => r.snap.staff || r.snap.today);
  const [period, setPeriod] = useState<'today' | 'month' | 'last'>('today');
  if (!revs.length) return <Stagger><Card className="lg-12"><Empty icon={Users} title="אין נתונים עדיין" text="הנתונים מגיעים מ־Buyz אחרי הסנכרון הבא (עד כמה דקות). אם העסק לא מחובר, מחברים בהגדרות ← העסקים שלי." /></Card></Stagger>;
  const r = revs[0];
  const t = r.snap.today;
  const st = r.snap.staff;
  const rows: StaffRow[] = period === 'today' ? t?.staff ?? [] : period === 'month' ? st?.thisMonth ?? [] : st?.lastMonth ?? [];
  const prevOf = (name: string) => (period === 'month' ? st?.lastMonth.find((x) => x.name === name) : undefined);
  const total = rows.reduce((a, x) => a + x.total, 0);
  const max = Math.max(1, ...rows.map((x) => x.total));
  const best = rows.find((x) => x.name !== 'ללא שיוך');

  return (
    <Stagger>
      <Card className="lg-3 md-6 sm-6"><Kpi label="מכירות היום" icon={TrendingUp} tone={TONE} value={money(t?.total ?? 0)} foot={`${r.name} · כולל מע״מ`} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="עסקאות היום" icon={ShoppingBag} tone={TONE} value={number(t?.count ?? 0)} foot={t?.average ? `ממוצע ${money(t.average)}` : undefined} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="אמצעי תשלום מוביל היום" tone={TONE} value={t?.methods[0]?.label || 'אין עדיין'} foot={t?.methods[0] ? money(t.methods[0].total) : undefined} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label={period === 'today' ? 'המובילה היום' : period === 'month' ? 'המובילה החודש' : 'המובילה בחודש שעבר'} icon={Award} tone={TONE} value={best?.name ?? 'אין עדיין'} foot={best ? money(best.total) : undefined} /></Card>

      <Card className="lg-8 md-12">
        <CardHead title="ביצועים לפי עובדת" sub="סכום העסקאות שכל עובדת ביצעה · כולל מע״מ">
          <PillTabs id={'staff-' + biz.id} items={[{ value: 'today', label: 'היום' }, { value: 'month', label: 'החודש' }, { value: 'last', label: 'חודש שעבר' }]} value={period} onChange={(v) => setPeriod(v as typeof period)} />
        </CardHead>
        {rows.length === 0 ? <p className="meta">אין עסקאות בתקופה הזו.</p> : (
          <div className="stack" style={{ gap: 16 }}>
            {rows.map((x) => {
              const prev = prevOf(x.name);
              const delta = prev && prev.total ? (x.total - prev.total) / prev.total : null;
              return (
                <div key={x.name}>
                  <div className="spread" style={{ marginBottom: 6, gap: 10 }}>
                    <span className="label"><bdi>{x.name}</bdi><span className="meta"> · {x.count} עסקאות · ממוצע {money(x.count ? x.total / x.count : 0)}{total ? ` · ${percent(x.total / total)}` : ''}</span></span>
                    <span className="row" style={{ gap: 8 }}>
                      {delta != null && <span className={delta < 0 ? 'neg meta' : 'pos meta'}>{delta > 0 ? '+' : ''}{percent(delta)} מחודש שעבר</span>}
                      <b className="num" style={{ fontWeight: 500 }}>{money(x.total)}</b>
                    </span>
                  </div>
                  <Meter small value={x.total} max={max} tone={TONE} label={x.name} />
                  <div className="meta" style={{ marginTop: 4 }}>{Object.entries(x.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${money(v)}`).join(' · ')}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="flush lg-4 md-12">
        <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 6 }}><div><h2>עסקאות היום</h2><div className="sub">האחרונות למעלה</div></div></div>
        {!t?.transactions.length ? <Empty icon={Clock} title="עוד אין עסקאות היום" /> : (
          <div className="list">
            {t.transactions.map((x) => (
              <div key={x.id + x.date} className="li">
                <span className="li-main"><span className="li-title" style={{ display: 'block' }}><bdi>{x.customer || x.description || x.type}</bdi></span><span className="li-meta">{time(x.date)} · {x.type}{x.seller && x.seller !== 'ללא שיוך' ? ` · ${x.seller}` : ''}</span></span>
                <span className="li-amount">{money(x.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Stagger>
  );
}

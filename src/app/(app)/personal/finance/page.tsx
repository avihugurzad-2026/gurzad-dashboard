import Link from 'next/link';
import { ChevronLeft, ChevronRight, Scale, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { householdTransactions } from '@/server/finance';
import { SPLIT_PEOPLE } from '@/lib/finance';
import { addDays, todayIL } from '@/lib/period';
import { ils } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { HouseholdForm } from '@/components/finance/household-form';
import { RemoveButton } from '@/components/finance/remove-button';
import { shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { NotReady } from '@/components/work/not-ready';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';

export const metadata = { title: 'כספים משותפים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const BASE = '/personal/finance';
const monthName = (m: string) => new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
const shift = (m: string, n: number) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

// The shared household book: what came in and what went out, typed in by hand
export default async function PersonalFinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const today = todayIL();
  const current = today.slice(0, 7);
  const req = (await searchParams).m;
  const month = req && /^\d{4}-(0[1-9]|1[0-2])$/.test(req) && req <= current ? req : current;
  const d = await householdTransactions(u, month);
  const balance = d.income !== null || d.expense !== null ? (d.income ?? 0) - (d.expense ?? 0) : null;
  const name = (id: string) => SPLIT_PEOPLE.find(p => p.id === id)?.name ?? id;
  const path = month === current ? BASE : `${BASE}?m=${month}`;
  const formDate = month === current ? today : addDays(`${shift(month, 1)}-01`, -1);
  const maxCat = d.by_category[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">כספים משותפים</h1>
          <p className="text-sm text-muted">אישי · הכנסות והוצאות של הבית, כפי ששולמו</p>
        </div>
        <nav aria-label="בחירת חודש" className="flex items-center gap-1 text-sm">
          <Link href={`${BASE}?m=${shift(month, -1)}`} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="חודש קודם"><ChevronRight className="size-4" aria-hidden /></Link>
          <span className="min-w-28 text-center font-medium">{monthName(month)}</span>
          {month < current
            ? <Link href={shift(month, 1) === current ? BASE : `${BASE}?m=${shift(month, 1)}`} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="חודש הבא"><ChevronLeft className="size-4" aria-hidden /></Link>
            : <span className="p-1.5 text-line-strong" aria-hidden><ChevronLeft className="size-4" /></span>}
        </nav>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="הכנסות החודש" icon={<TrendingUp className="size-4" />} value={ils(d.income)} reason="עוד לא הוזנו הכנסות לחודש הזה" />
        <KpiCard label="הוצאות החודש" icon={<TrendingDown className="size-4" />} value={ils(d.expense)} reason="עוד לא הוזנו הוצאות לחודש הזה" />
        <KpiCard label="מאזן החודש" icon={<Scale className="size-4" />} value={ils(balance)}
          hint={balance !== null ? (balance >= 0 ? 'נשאר בצד החיובי' : 'יותר הוצאות מהכנסות') : undefined}
          reason="יופיע אחרי הרשומה הראשונה" />
      </div>

      <Card>
        <CardHeader><CardTitle>רשומה חדשה</CardTitle><span className="text-sm text-muted">הוצאה או הכנסה, בשקלים</span></CardHeader>
        <CardContent>
          {d.ready ? <HouseholdForm path={path} today={formDate} /> : <NotReady what="הכנסות והוצאות" />}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>רשומות {monthName(month)}</CardTitle><span className="text-sm text-muted">{d.entries.length} רשומות</span></CardHeader>
          <CardContent>
            {d.entries.length === 0 ? (
              <Empty icon={<Wallet className="size-6" />} title="אין רשומות בחודש הזה">כל הוצאה או הכנסה שתזין למעלה תופיע כאן.</Empty>
            ) : (
              <div className="relative -mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-md text-sm">
                  <thead><tr className="border-b border-line text-xs text-muted">
                    <th scope="col" className="py-2 text-start font-medium">תאריך</th>
                    <th scope="col" className="py-2 text-start font-medium">קטגוריה</th>
                    <th scope="col" className="py-2 text-start font-medium">של מי</th>
                    <th scope="col" className="py-2 text-end font-medium">סכום</th>
                    <th scope="col"><span className="sr-only">פעולות</span></th>
                  </tr></thead>
                  <tbody>{d.entries.map(e => (
                    <tr key={e.id} className="border-b border-line last:border-0">
                      <td className="py-2 text-xs text-muted whitespace-nowrap">{shortDate(e.occurred_on)}</td>
                      <th scope="row" className="py-2 text-start font-normal">
                        <bdi>{e.category_label}</bdi>
                        {e.description && <span className="block text-xs text-muted"><bdi>{e.description}</bdi></span>}
                      </th>
                      <td className="py-2 text-xs text-muted">
                        {e.splits.length ? e.splits.map(s => `${name(s.user_id)} ${s.share_pct}%`).join(' · ') : name(e.owner_user_id)}
                      </td>
                      <td className={cn('py-2 text-end font-medium whitespace-nowrap', e.direction === 'income' ? 'text-good-ink' : 'text-ink')}>
                        <bdi>{e.direction === 'income' ? '+' : '−'}</bdi><Money value={e.amount_gross} />
                      </td>
                      <td className="w-8 py-2 text-end">{e.can_delete && <RemoveButton kind="transaction" id={e.id} path={path} label="מחק רשומה" />}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>לאן הלך הכסף</CardTitle><span className="text-sm text-muted">הוצאות לפי קטגוריה</span></CardHeader>
            <CardContent>
              {d.by_category.length === 0 ? <p className="text-sm text-muted">אין נתונים עדיין</p> : (
                <ul className="flex flex-col gap-3">
                  {d.by_category.map(c => (
                    <li key={c.category} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <bdi className="text-ink-2">{c.label}</bdi>
                        <span className="flex items-center gap-2">
                          {d.expense ? <span className="text-xs text-muted tabular">{Math.round((c.total / d.expense) * 100)}%</span> : null}
                          <Money value={c.total} className="font-medium" />
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[color:var(--grid)]" aria-hidden>
                        <div className="h-1.5 rounded-full bg-[color:var(--series-1)]" style={{ width: `${Math.max(2, (c.total / maxCat) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>6 חודשים אחרונים</CardTitle></CardHeader>
            <CardContent>
              {d.months.length === 0 ? <p className="text-sm text-muted">אין נתונים עדיין</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-line text-xs text-muted">
                    <th scope="col" className="py-2 text-start font-medium">חודש</th>
                    <th scope="col" className="py-2 text-end font-medium">הכנסות</th>
                    <th scope="col" className="py-2 text-end font-medium">הוצאות</th>
                    <th scope="col" className="py-2 text-end font-medium">מאזן</th>
                  </tr></thead>
                  <tbody>
                    {d.months.map(m => {
                      const bal = (m.income ?? 0) - (m.expense ?? 0);
                      return (
                        <tr key={m.month} className="border-b border-line last:border-0">
                          <th scope="row" className="py-2 text-start font-normal">
                            <Link href={m.month === current ? BASE : `${BASE}?m=${m.month}`} className="hover:underline">{monthName(m.month)}</Link>
                          </th>
                          <td className="py-2 text-end"><Money value={m.income} empty="–" /></td>
                          <td className="py-2 text-end"><Money value={m.expense} empty="–" /></td>
                          <td className={bal < 0 ? 'py-2 text-end text-critical-ink' : 'py-2 text-end'}><Money value={bal} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

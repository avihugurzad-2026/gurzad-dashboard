import Link from 'next/link';
import { Download, FileText, Landmark, Receipt, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { financeSummary, vatMonthly, vatRateRows, type FinanceSummary } from '@/server/finance';
import { CLASSIFICATIONS, DIRECTIONS, PAYMENT_METHODS, PERIODS, labelOf, resolvePeriod, type Classification, type Direction } from '@/lib/finance';
import { decodePlace, encodePlace, placeOptions } from '@/lib/places';
import { ils, shortDate, amountIn } from '@/lib/format';
import { todayIL } from '@/lib/period';
import { KpiCard } from '@/components/dash/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';
import { buttonClass } from '@/components/ui/button';
import { NotReady } from '@/components/work/not-ready';
import { labelClass, selectClass } from '@/components/work/fields';
import { DateField } from '@/components/ui/date-field';
import { PageHeader } from '@/components/shell/page-header';
import { BarList } from '@/components/finance/bar-list';
import { RemoveButton } from '@/components/finance/remove-button';
import { TransactionDialog } from '@/components/finance/transaction-form';
import { cn } from '@/lib/utils';

export const metadata = { title: 'כספים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const BASE = '/finance';
const monthName = (m: string) => new Intl.DateTimeFormat('he-IL', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

type SP = Record<string, string | undefined>;

// Income, expenses and VAT for a period, across every place the user may see (filtered in SQL)
export default async function FinancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const today = todayIL();
  const period = resolvePeriod(sp.p, sp.from, sp.to, today);
  const direction = DIRECTIONS.some(d => d.id === sp.dir) ? (sp.dir as Direction) : null;
  const classification = CLASSIFICATIONS.some(c => c.id === sp.cls) ? (sp.cls as Classification) : null;
  const place = sp.place ? decodePlace(sp.place) : null;

  const [d, vat, rates] = await Promise.all([
    financeSummary(u, { from: period.from, to: period.to, place, classification, direction }),
    vatMonthly(u, 6, place),
    vatRateRows(),
  ]);

  // Keep the current period/filters when changing one of them
  const qs = (over: SP) => {
    const all: SP = { p: period.key, from: period.key === 'custom' ? period.from : undefined, to: period.key === 'custom' ? period.to : undefined,
      dir: direction ?? undefined, cls: classification ?? undefined, place: place ? encodePlace(place) : undefined, ...over };
    const s = new URLSearchParams(Object.entries(all).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `${BASE}?${s}` : BASE;
  };
  const exportHref = `/api/v1/finance/export?${new URLSearchParams({ from: period.from, to: period.to, ...(place ? { place: encodePlace(place) } : {}) })}`;
  const path = qs({});

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="כספים"
        subtitle={<>הכנסות והוצאות שהוזנו בדשבורד · <bdi>{shortDate(period.from)}</bdi>–<bdi>{shortDate(period.to)}</bdi></>}
        actions={<>
          <a href={exportHref} className={buttonClass('secondary', 'md')} download><Download aria-hidden />ייצוא CSV</a>
          {d.ready && <TransactionDialog vatRates={rates} today={today} path={BASE} />}
        </>} />

      {/* Period picker */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <nav aria-label="תקופה" className="relative -mx-1 overflow-x-auto px-1">
          <ul className="flex w-fit min-w-max gap-0.5 rounded-lg border border-line-strong bg-surface p-0.5">
            {PERIODS.filter(x => x.key !== 'custom').map(x => (
              <li key={x.key}>
                <Link href={qs({ p: x.key, from: undefined, to: undefined })} aria-current={period.key === x.key ? 'true' : undefined}
                  className={cn('flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors', period.key === x.key ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
                  {x.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <form method="get" action={BASE} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="p" value="custom" />
          {direction && <input type="hidden" name="dir" value={direction} />}
          {classification && <input type="hidden" name="cls" value={classification} />}
          {place && <input type="hidden" name="place" value={encodePlace(place)} />}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="f-from" className={labelClass}>מתאריך</label>
            <DateField id="f-from" name="from" defaultValue={period.from} required className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="f-to" className={labelClass}>עד תאריך</label>
            <DateField id="f-to" name="to" defaultValue={period.to} required className="w-40" />
          </div>
          <button type="submit" className={buttonClass(period.key === 'custom' ? 'primary' : 'secondary', 'md')}>טווח מותאם</button>
        </form>
      </div>

      {!d.ready ? <Card><CardContent className="pt-5 sm:pt-6"><NotReady what="תנועות כספים" /></CardContent></Card> : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="הכנסות" icon={<TrendingUp />} value={ils(d.income?.net)}
              hint={d.income ? `ללא מע״מ · ${ils(d.income.gross)} כולל` : undefined} reason="אין הכנסות בתקופה" />
            <KpiCard label="הוצאות" icon={<TrendingDown />} value={ils(d.expense?.net)}
              hint={d.expense ? `ללא מע״מ · ${ils(d.expense.gross)} כולל` : undefined} reason="אין הוצאות בתקופה" />
            <KpiCard label="נטו" icon={<Scale />} value={ils(d.net?.net)}
              hint={d.net ? `הכנסות פחות הוצאות, ללא מע״מ` : undefined} reason="יופיע אחרי התנועה הראשונה" />
            <KpiCard label="יתרת מע״מ (עסקי)" icon={<Landmark />} value={ils(d.vat.balance)}
              hint={d.vat.balance !== null ? `${d.vat.balance >= 0 ? 'לתשלום' : 'להחזר'} · הערכה, לאישור רו״ח` : undefined}
              reason="אין תנועות עסקיות עם מע״מ" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 [&>*]:min-w-0">
            <ClassificationCard d={d} />
            <Card>
              <CardHeader><CardTitle>הוצאות לפי קטגוריה</CardTitle><span className="text-sm text-muted">כולל מע״מ</span></CardHeader>
              <CardContent>
                <BarList items={d.by_category.filter(c => c.direction === 'expense').map(c => ({ key: c.category, label: c.label, value: c.amounts.gross }))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>הכנסות לפי קטגוריה</CardTitle><span className="text-sm text-muted">כולל מע״מ</span></CardHeader>
              <CardContent>
                <BarList items={d.by_category.filter(c => c.direction === 'income').map(c => ({ key: c.category, label: c.label, value: c.amounts.gross }))} />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader><CardTitle>לפי מקום</CardTitle><span className="text-sm text-muted">ללא מע״מ</span></CardHeader>
              <CardContent>
                {d.by_place.length === 0 ? <p className="text-sm text-muted">אין נתונים עדיין</p> : (
                  <div className="relative overflow-x-auto">
                    <table className="data-table min-w-sm">
                      <thead><tr>
                        <th scope="col">מקום</th><th scope="col" className="num">הכנסות</th>
                        <th scope="col" className="num">הוצאות</th><th scope="col" className="num">נטו</th>
                      </tr></thead>
                      <tbody>
                        {d.by_place.map(p => {
                          const net = (p.income?.net ?? 0) - (p.expense?.net ?? 0);
                          return (
                            <tr key={p.key}>
                              <th scope="row" className="font-normal">
                                <Link href={qs({ place: p.key })} className="hover:underline"><bdi>{p.label}</bdi></Link>
                              </th>
                              <td className="num"><Money value={p.income?.net ?? null} empty="–" /></td>
                              <td className="num"><Money value={p.expense?.net ?? null} empty="–" /></td>
                              <td className={cn('num', net < 0 && 'text-critical-ink')}><Money value={net} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            <VatCard months={vat.months} />
          </div>

          <Card>
            <CardHeader className="flex-wrap">
              <div className="flex flex-col gap-1">
                <CardTitle>תנועות</CardTitle>
                <p className="text-sm text-muted">{d.transactions.length}{d.truncated ? '+ (מוצגות 500 האחרונות; הייצוא כולל הכול)' : ''} תנועות</p>
              </div>
              <form method="get" action={BASE} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="p" value={period.key} />
                {period.key === 'custom' && <><input type="hidden" name="from" value={period.from} /><input type="hidden" name="to" value={period.to} /></>}
                <label className="sr-only" htmlFor="f-dir">כיוון</label>
                <select id="f-dir" name="dir" defaultValue={direction ?? ''} className={cn(selectClass, 'w-auto')}>
                  <option value="">הכנסות והוצאות</option>
                  {DIRECTIONS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                <label className="sr-only" htmlFor="f-cls">סיווג</label>
                <select id="f-cls" name="cls" defaultValue={classification ?? ''} className={cn(selectClass, 'w-auto')}>
                  <option value="">כל הסיווגים</option>
                  {CLASSIFICATIONS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                <label className="sr-only" htmlFor="f-place">מקום</label>
                <select id="f-place" name="place" defaultValue={place ? encodePlace(place) : ''} className={cn(selectClass, 'w-auto max-w-48')}>
                  <option value="">כל המקומות</option>
                  {placeOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button type="submit" className={buttonClass('secondary', 'md')}>סנן</button>
                {(direction || classification || place) && <Link href={qs({ dir: undefined, cls: undefined, place: undefined })} className={buttonClass('ghost', 'md')}>נקה</Link>}
              </form>
            </CardHeader>
            <CardContent>
              {d.transactions.length === 0 ? (
                <Empty icon={<Receipt aria-hidden />} title="אין תנועות בתקופה ובסינון הזה">
                  כל הכנסה או הוצאה שתוסיף עם &quot;+ תנועה&quot; תופיע כאן.
                </Empty>
              ) : (
                <div className="relative overflow-x-auto">
                  <table className="data-table min-w-[760px]">
                    <thead><tr>
                      <th scope="col">תאריך</th>
                      <th scope="col">תיאור</th>
                      <th scope="col">מקום</th>
                      <th scope="col">סיווג</th>
                      <th scope="col">מסמך</th>
                      <th scope="col" className="num">סכום</th>
                      <th scope="col" className="num">מע״מ</th>
                      <th scope="col"><span className="sr-only">פעולות</span></th>
                    </tr></thead>
                    <tbody>
                      {d.transactions.map(t => (
                        <tr key={t.id}>
                          <td className="whitespace-nowrap text-muted tabular">{shortDate(t.occurred_on)}</td>
                          <th scope="row" className="font-normal">
                            <bdi className="font-medium">{t.description || t.category_label}</bdi>
                            <span className="block text-xs text-muted">
                              <bdi>{t.category_label}</bdi>
                              {t.counterparty_name && <> · <bdi>{t.counterparty_name}</bdi></>}
                              {t.payment_method && <> · {labelOf(PAYMENT_METHODS, t.payment_method)}</>}
                              {t.splits.length > 0 && <> · חלוקה {t.splits.map(s => `${s.share_pct}%`).join('/')}</>}
                            </span>
                          </th>
                          <td className="text-ink-2"><bdi>{t.context}</bdi></td>
                          <td><Badge tone={t.classification === 'business' ? 'accent' : t.classification === 'mixed' ? 'warning' : 'neutral'}>{labelOf(CLASSIFICATIONS, t.classification)}</Badge></td>
                          <td className="text-ink-2">
                            {t.document_type === 'none' ? <span className="text-muted">—</span> : <>{labelOf(DOC_SHORT, t.document_type)}{t.document_number && <> <bdi dir="ltr">{t.document_number}</bdi></>}</>}
                            {t.file_id && <a href={`/api/v1/files/${t.file_id}`} className="ms-1 inline-flex align-middle text-accent-ink hover:text-ink" aria-label="הורד מסמך"><FileText className="size-4" aria-hidden /></a>}
                          </td>
                          <td className={cn('num font-medium', t.direction === 'income' ? 'text-good-ink' : 'text-ink')}>
                            <bdi>{t.direction === 'income' ? '+' : '−'}</bdi>{t.currency === 'ILS' ? <Money value={t.amount_gross} /> : <bdi dir="ltr" className="tabular">{amountIn(t.amount_gross, t.currency)}</bdi>}
                          </td>
                          <td className="num text-muted">{t.vat_included ? <Money value={t.vat_amount} /> : 'ללא'}</td>
                          <td className="w-10 text-end">
                            {t.can_delete && <RemoveButton kind="transaction" id={t.id} path={path} label="מחק תנועה" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

const DOC_SHORT = [
  { id: 'tax_invoice', label: 'חשבונית מס' }, { id: 'receipt', label: 'קבלה' }, { id: 'tax_invoice_receipt', label: 'חש׳ מס/קבלה' },
  { id: 'transaction_invoice', label: 'חשבון עסקה' }, { id: 'other', label: 'אחר' },
];

function ClassificationCard({ d }: { d: FinanceSummary }) {
  return (
    <Card>
      <CardHeader><CardTitle>עסקי מול פרטי</CardTitle><span className="text-sm text-muted">ללא מע״מ</span></CardHeader>
      <CardContent>
        <table className="data-table">
          <thead><tr>
            <th scope="col">סיווג</th><th scope="col" className="num">הכנסות</th><th scope="col" className="num">הוצאות</th>
          </tr></thead>
          <tbody>
            {d.by_classification.map(c => (
              <tr key={c.classification}>
                <th scope="row" className="font-normal">{labelOf(CLASSIFICATIONS, c.classification)}</th>
                <td className="num"><Money value={c.income?.net ?? null} empty="–" /></td>
                <td className="num"><Money value={c.expense?.net ?? null} empty="–" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.by_classification.some(c => c.classification === 'mixed' && (c.income || c.expense)) && (
          <p className="mt-4 text-xs text-muted">תנועות &quot;מעורב&quot; לא נספרות במע״מ. החלק העסקי שלהן לבירור עם רו״ח.</p>
        )}
      </CardContent>
    </Card>
  );
}

function VatCard({ months }: { months: { month: string; output: number | null; input: number | null; balance: number | null; mixed_output: number | null; mixed_input: number | null }[] }) {
  const anyMixed = months.some(m => m.mixed_input !== null || m.mixed_output !== null);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardTitle>מע״מ חודשי</CardTitle>
          <p className="text-sm text-muted">עסקאות (הכנסות עסקיות) מול תשומות (הוצאות עסקיות). הערכה בלבד, לאישור רו״ח.</p>
        </div>
      </CardHeader>
      <CardContent>
        {months.every(m => m.balance === null && m.mixed_input === null && m.mixed_output === null) ? <p className="text-sm text-muted">אין נתונים עדיין</p> : (
          <div className="relative overflow-x-auto">
            <table className="data-table min-w-md">
              <thead><tr>
                <th scope="col">חודש</th><th scope="col" className="num">מע״מ עסקאות</th>
                <th scope="col" className="num">מע״מ תשומות</th><th scope="col" className="num">יתרה</th>
                {anyMixed && <th scope="col">מעורב (לא נספר)</th>}
              </tr></thead>
              <tbody>
                {months.map(m => (
                  <tr key={m.month}>
                    <th scope="row" className="whitespace-nowrap font-normal">{monthName(m.month)}</th>
                    <td className="num"><Money value={m.output} empty="–" /></td>
                    <td className="num"><Money value={m.input} empty="–" /></td>
                    <td className="num">
                      {m.balance === null ? <span className="text-muted">–</span> : (
                        <span className="inline-flex items-center gap-1.5"><Money value={Math.abs(m.balance)} className="font-medium" />
                          <span className="text-xs text-muted">{m.balance >= 0 ? 'לתשלום' : 'להחזר'}</span></span>
                      )}
                    </td>
                    {anyMixed && (
                      <td className="text-xs text-muted">
                        {m.mixed_output === null && m.mixed_input === null ? '–' : <>
                          {m.mixed_output !== null && <>עסקאות <Money value={m.mixed_output} /> </>}
                          {m.mixed_input !== null && <>תשומות <Money value={m.mixed_input} /></>}
                          <span className="block">לבדוק עם רו״ח</span>
                        </>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

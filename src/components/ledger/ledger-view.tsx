import Link from 'next/link';
import {
  ArrowDownLeft, ArrowUpRight, Camera, ChevronLeft, ChevronRight, CreditCard, FileUp, Landmark, Link2, Mail, PiggyBank, Plus, Receipt, Repeat,
  Search, Tags, UserPlus, Wallet,
} from 'lucide-react';
import type { SessionUser } from '@/server/auth';
import {
  budgetFor, householdContributions, latestBudgetBefore, ledgerAccess, listAccounts, listCategories, listRecurring, listRules, listSavings,
  listTransactions, monthSummary, myContributions, type Access,
} from '@/server/ledger';
import { myWorkspaces, personalWorkspace } from '@/server/workspaces';
import { BarList } from '@/components/finance/bar-list';
import { KpiCard } from '@/components/dash/kpi-card';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Section } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';
import { compactInputClass } from '@/components/work/fields';
import { ils, shortDate } from '@/lib/format';
import { todayIL } from '@/lib/period';
import { cn } from '@/lib/utils';
import L from '@domain/ledger';
import { ACCOUNT_LABEL, FREQ_LABEL } from '@/lib/ledger-labels';
import {
  AccountDialog, BudgetDialog, CancelPaymentButton, CategoryDialog, ContributionDialog, CopyBudgetButton, DepositDialog,
  EndContributionButton, ExecuteContributionDialog, RecordPaymentDialog, RecurringDialog, Remove, RuleDialog, SavingsDialog, TxDialog,
  TxRowActions, type AccOpt, type CatOpt, type WsOpt,
} from './forms';

// Personal and household finance: one engine, separated by workspace. Every section shows the
// workspace's own rows; with none it says so and offers the action that adds the first one.

export type LedgerCtx = {
  u: SessionUser; a: Access; ws: string; kind: 'personal' | 'household'; today: string; month: string;
  cats: CatOpt[]; accounts: AccOpt[]; moveTo: WsOpt[]; households: WsOpt[]; personalId: string | null; base: string;
};

const MONTH = /^\d{4}-\d{2}$/;
const monthName = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const monthLabel = (m: string) => monthName.format(new Date(`${m}-01T00:00:00Z`));

export async function ledgerContext(u: SessionUser, wsId: string, base: string, sp: Record<string, string | string[] | undefined>): Promise<LedgerCtx | null> {
  const a = await ledgerAccess(u, wsId);
  if (!a) return null;
  const today = todayIL();
  const m = typeof sp.month === 'string' && MONTH.test(sp.month) ? sp.month : today.slice(0, 7);
  const [cats, accounts, mine, personal] = await Promise.all([listCategories(wsId), listAccounts(wsId, m), myWorkspaces(u), personalWorkspace(u)]);
  const households = mine.filter(w => w.kind === 'household').map(w => ({ id: w.id, name: w.name, kind: 'household' as const }));
  const writable: WsOpt[] = [];
  for (const h of households) if ((await ledgerAccess(u, h.id))?.canWrite) writable.push(h);
  const moveTo: WsOpt[] = a.w.kind === 'personal' ? writable : personal ? [{ id: personal.id, name: 'אישי', kind: 'personal' }] : [];
  return {
    u, a, ws: wsId, kind: a.w.kind as 'personal' | 'household', today, month: m, base,
    cats: cats.map(c => ({ id: c.id, kind: c.kind, name: c.name, parent_id: c.parent_id })),
    accounts: accounts.items.map(x => ({ id: x.id, name: x.name, kind: x.kind, last4: x.last4 })),
    moveTo, households: writable, personalId: personal?.id ?? null,
  };
}

// ── Action bar ────────────────────────────────────────────────────────────────
const sm = buttonClass('secondary', 'sm');
export function LedgerActions({ c }: { c: LedgerCtx }) {
  if (!c.a.canWrite) return <p className="text-sm text-muted">יש לך הרשאת צפייה בלבד במשק הבית הזה.</p>;
  const common = { ws: c.ws, cats: c.cats, accounts: c.accounts, today: c.today };
  const imp = (mode: string) => `/finance-import?ws=${c.ws}&mode=${mode}`;
  if (c.kind === 'personal') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <TxDialog {...common} trigger={<><ArrowDownLeft aria-hidden />הכנסה</>} title="הכנסה חדשה" initial={{ direction: 'income', occurred_on: c.today }} triggerClass={buttonClass('primary', 'sm')} />
          <TxDialog {...common} trigger={<><ArrowUpRight aria-hidden />הוצאה</>} title="הוצאה חדשה" initial={{ direction: 'expense', occurred_on: c.today }} triggerClass={buttonClass('primary', 'sm')} />
          <AccountDialog ws={c.ws} initial={{ kind: 'bank' }} trigger={<><Landmark aria-hidden />חשבון</>} title="חשבון חדש" triggerClass={sm} />
          <AccountDialog ws={c.ws} initial={{ kind: 'credit_card' }} trigger={<><CreditCard aria-hidden />כרטיס אשראי</>} title="כרטיס אשראי חדש" triggerClass={sm} />
          <RecurringDialog {...common} trigger={<><Repeat aria-hidden />הוצאה קבועה</>} title="הוצאה קבועה חדשה" triggerClass={sm} />
          <SavingsDialog ws={c.ws} accounts={c.accounts} trigger={<><PiggyBank aria-hidden />יעד חיסכון</>} title="יעד חיסכון חדש" triggerClass={sm} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={imp('statement')} className={buttonClass('ghost', 'sm')}><FileUp aria-hidden />ייבוא דוח</Link>
          <Link href={imp('receipt')} className={buttonClass('ghost', 'sm')}><Receipt aria-hidden />העלה חשבונית</Link>
          <Link href={imp('camera')} className={buttonClass('ghost', 'sm')}><Camera aria-hidden />צלם קבלה</Link>
          <Link href={imp('url')} className={buttonClass('ghost', 'sm')}><Link2 aria-hidden />הדבק קישור</Link>
          <Link href="/finance-import/gmail" className={buttonClass('ghost', 'sm')}><Mail aria-hidden />חבר Gmail</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Link href="/household/finance?tab=contributions" className={buttonClass('primary', 'sm')}><Wallet aria-hidden />Contribution</Link>
        <TxDialog {...common} trigger={<><ArrowUpRight aria-hidden />הוצאה משותפת</>} title="הוצאה משותפת" initial={{ direction: 'expense', occurred_on: c.today }} triggerClass={buttonClass('primary', 'sm')} />
        <Link href={`/household/budget?month=${c.month}`} className={sm}><Plus aria-hidden />תקציב</Link>
        <RecurringDialog {...common} trigger={<><Repeat aria-hidden />הוצאה קבועה</>} title="הוצאה קבועה משותפת" triggerClass={sm} />
        <SavingsDialog ws={c.ws} accounts={c.accounts} trigger={<><PiggyBank aria-hidden />יעד חיסכון</>} title="יעד חיסכון משותף" triggerClass={sm} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/household/members" className={buttonClass('ghost', 'sm')}><UserPlus aria-hidden />הזמן חבר למשק הבית</Link>
        <AccountDialog ws={c.ws} initial={{ kind: 'bank' }} trigger={<><Landmark aria-hidden />חבר חשבון משותף</>} title="חשבון משותף" triggerClass={buttonClass('ghost', 'sm')} />
        <Link href={imp('statement')} className={buttonClass('ghost', 'sm')}><FileUp aria-hidden />ייבוא חיובי אשראי</Link>
      </div>
    </div>
  );
}

// Month picker: ‹ previous | month | next ›
export function MonthNav({ c, path }: { c: LedgerCtx; path: string }) {
  const prev = L.addMonths(`${c.month}-01`, -1).slice(0, 7);
  const next = L.addMonths(`${c.month}-01`, 1).slice(0, 7);
  const href = (m: string) => `${path}${path.includes('?') ? '&' : '?'}month=${m}`;
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-line-strong bg-surface p-0.5">
      <Link href={href(prev)} className={buttonClass('ghost', 'icon', 'size-8')} aria-label="החודש הקודם"><ChevronRight aria-hidden /></Link>
      <span className="min-w-28 text-center text-sm font-medium">{monthLabel(c.month)}</span>
      <Link href={href(next)} className={buttonClass('ghost', 'icon', 'size-8')} aria-label="החודש הבא"><ChevronLeft aria-hidden /></Link>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
export async function OverviewSection({ c }: { c: LedgerCtx }) {
  const [s, rec, sav, budget] = await Promise.all([
    monthSummary(c.ws, c.month), listRecurring(c.ws), listSavings(c.ws, c.today), budgetFor(c.ws, c.month),
  ]);
  if (s === null) return <Empty icon={<Wallet />} title="טבלאות הפיננסים עוד לא נוצרו במסד">צריך להריץ את המיגרציה של שלב הפיננסים.</Empty>;
  const nothing = s.income === null && s.expense === null && s.transfersOut === null && s.transfersIn === null;
  const upcoming = rec.items.filter(r => r.status === 'active' && r.next_due && r.next_due <= L.addMonths(c.today, 1)).slice(0, 6);
  return (
    <div className="flex flex-col gap-8">
      {c.kind === 'personal' && <MyContributions c={c} />}
      {c.kind === 'household' && <HouseholdContributionsCard c={c} compact />}
      {nothing ? (
        <Card>
          <Empty icon={<Wallet />} title={c.kind === 'personal' ? 'הוסף את ההכנסה הראשונה' : 'הוסף את ההוצאה המשותפת הראשונה'}>
            {c.kind === 'personal'
              ? 'אין עדיין תנועות ב' + monthLabel(c.month) + '. אפשר להוסיף ידנית, לייבא דוח אשראי או בנק, או לחבר Gmail לחשבוניות.'
              : 'אין עדיין תנועות משותפות ב' + monthLabel(c.month) + '. העברות של חברים נרשמות כאן אוטומטית כשהן מבוצעות.'}
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label={c.kind === 'household' ? 'הכנסות (כולל העברות חברים)' : 'הכנסות'} value={ils(s.income)} />
            <KpiCard label="הוצאות" value={ils(s.expense)} hint={s.fixed !== null ? `קבועות ${ils(s.fixed)}` : undefined} />
            {c.kind === 'personal'
              ? <KpiCard label="העברות למשק הבית" value={ils(s.transfersOut)} reason="לא בוצעו העברות החודש" />
              : <KpiCard label="קבועות החודש" value={ils(rec.monthlyTotal)} reason="אין הוצאות קבועות" />}
            <KpiCard label="נטו" value={ils(s.net)} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="הוצאות לפי קטגוריה">
              <Card className="p-5"><BarList items={s.byCategory.map(x => ({ key: x.category_id ?? 'none', label: x.name, value: x.total }))} /></Card>
            </Section>
            <Section title="חצי שנה אחרונה">
              <Card className="p-0">
                <div className="relative overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>חודש</th><th className="num">הכנסות</th><th className="num">הוצאות</th></tr></thead>
                    <tbody>{s.months.map(m => (
                      <tr key={m.month}><td>{monthLabel(m.month)}</td><td className="num"><Money value={m.income} empty="—" /></td><td className="num"><Money value={m.expense} empty="—" /></td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </Card>
            </Section>
          </div>
        </>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="תשלומים קרובים" action={<Link href={c.kind === 'personal' ? `${c.base}?tab=fixed` : '/household/fixed'} className={buttonClass('ghost', 'sm')}>כל הקבועות</Link>}>
          <Card className="p-0">
            {upcoming.length ? (
              <ul className="divide-y divide-[color:var(--border)]">
                {upcoming.map(r => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0"><p className="truncate font-medium"><bdi>{r.name}</bdi></p><p className="text-xs text-muted">{shortDate(r.next_due)}</p></div>
                    <Money value={r.amount} className="font-medium" />
                  </li>
                ))}
              </ul>
            ) : <Empty compact icon={<Repeat />} title="אין תשלומים קבועים בחודש הקרוב">הוסף הוצאה קבועה כדי לראות מה יורד ומתי.</Empty>}
          </Card>
        </Section>
        <Section title="תקציב החודש" action={<Link href={c.kind === 'personal' ? `${c.base}?tab=budget&month=${c.month}` : `/household/budget?month=${c.month}`} className={buttonClass('ghost', 'sm')}>לתקציב</Link>}>
          <Card className="p-5">
            {budget.view ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-ink-2">נוצלו <Money value={budget.view.totals.actual} className="font-semibold" /> מתוך <Money value={budget.view.totals.budget} className="font-semibold" /></p>
                <Progress pct={budget.view.totals.budget > 0 ? (budget.view.totals.actual / budget.view.totals.budget) * 100 : null} over={budget.view.totals.variance > 0} />
                {budget.view.rows.filter(r => r.over).length > 0 && (
                  <p className="text-sm text-critical-ink">חריגה ב: {budget.view.rows.filter(r => r.over).map(r => r.name).join(', ')}</p>
                )}
              </div>
            ) : <Empty compact icon={<Tags />} title="צור תקציב חודשי">קבע כמה מתכננים להוציא בכל קטגוריה, וראה בזמן אמת כמה נשאר.</Empty>}
          </Card>
        </Section>
      </div>
      {sav.items.length > 0 && (
        <Section title="יעדי חיסכון">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{sav.items.filter(g => g.status === 'active').slice(0, 3).map(g => <GoalCard key={g.id} g={g} c={c} />)}</div>
        </Section>
      )}
    </div>
  );
}

function Progress({ pct, over }: { pct: number | null; over?: boolean }) {
  return (
    <div className="h-2 rounded-full bg-[color:var(--grid)]" role="img" aria-label={pct === null ? 'אין נתונים' : `${Math.round(pct)}%`}>
      <div className={cn('h-2 rounded-full', over ? 'bg-critical' : 'bg-[color:var(--series-1)]')} style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
    </div>
  );
}

// ── Transactions ──────────────────────────────────────────────────────────────
export async function TransactionsSection({ c, sp, path }: { c: LedgerCtx; sp: Record<string, string | string[] | undefined>; path: string }) {
  const one = (k: string) => (typeof sp[k] === 'string' && sp[k] ? String(sp[k]) : null);
  const UUID = /^[0-9a-f-]{36}$/i;
  const filter = {
    from: `${c.month}-01`, to: L.addMonths(`${c.month}-01`, 1).replace(/-01$/, '-01'),
    direction: one('dir'), account: one('acc') && UUID.test(one('acc')!) ? one('acc') : null,
    category: one('cat') && UUID.test(one('cat')!) ? one('cat') : null, q: one('q')?.slice(0, 80) ?? null,
  };
  filter.to = new Date(Date.parse(`${filter.to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const { ready, items, more } = await listTransactions(c.ws, filter);
  if (!ready) return <Empty title="טבלאות הפיננסים עוד לא נוצרו במסד" />;
  const [pathname, query] = path.split('?');
  const keep = new URLSearchParams(query ?? '');
  const filtered = !!(filter.direction || filter.account || filter.category || filter.q);
  return (
    <div className="flex flex-col gap-4">
      <form action={pathname} className="flex flex-wrap items-center gap-2">
        {keep.get('tab') && <input type="hidden" name="tab" value={keep.get('tab')!} />}
        <input type="hidden" name="month" value={c.month} />
        <label className="relative">
          <Search aria-hidden className="pointer-events-none absolute start-2.5 top-2 size-4 text-muted" />
          <input name="q" defaultValue={filter.q ?? ''} placeholder="חיפוש" aria-label="חיפוש" className={cn(compactInputClass, 'w-44 ps-8')} />
        </label>
        <select name="dir" defaultValue={filter.direction ?? ''} aria-label="סוג" className={cn(compactInputClass, 'w-auto pe-8')}>
          <option value="">הכל</option><option value="income">הכנסות</option><option value="expense">הוצאות</option><option value="transfer">העברות</option>
        </select>
        {c.accounts.length > 0 && (
          <select name="acc" defaultValue={filter.account ?? ''} aria-label="חשבון" className={cn(compactInputClass, 'w-auto pe-8')}>
            <option value="">כל החשבונות</option>{c.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select name="cat" defaultValue={filter.category ?? ''} aria-label="קטגוריה" className={cn(compactInputClass, 'w-auto pe-8')}>
          <option value="">כל הקטגוריות</option>{c.cats.filter(x => !x.parent_id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className={buttonClass('secondary', 'sm')}>סנן</button>
        {filtered && <Link href={`${pathname}?${keep.get('tab') ? `tab=${keep.get('tab')}&` : ''}month=${c.month}`} className={buttonClass('ghost', 'sm')}>נקה</Link>}
      </form>
      <Card className="p-0">
        {items.length === 0 ? (
          <Empty icon={<Wallet />} title={filtered ? 'אין תנועות שמתאימות לסינון' : `אין תנועות ב${monthLabel(c.month)}`}>
            {filtered ? 'נסה סינון אחר.' : c.kind === 'personal' ? 'הוסף הכנסה או הוצאה, או ייבא דוח בנק / אשראי.' : 'הוסף הוצאה משותפת או ייבא חיובי אשראי.'}
          </Empty>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>תאריך</th><th>בית עסק / תיאור</th><th>קטגוריה</th><th>חשבון</th>{c.kind === 'household' && <th>נרשם ע״י</th>}<th className="num">סכום</th><th><span className="sr-only">פעולות</span></th></tr></thead>
              <tbody>
                {items.map(t => {
                  const sign = t.direction === 'income' || t.flow === 'in' ? 1 : -1;
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap">{shortDate(t.occurred_on)}</td>
                      <td className="max-w-64">
                        <p className="truncate font-medium"><bdi>{t.merchant ?? t.description}</bdi></p>
                        <p className="flex flex-wrap gap-1.5 text-xs text-muted">
                          {t.merchant && t.description && t.description !== t.merchant && <bdi className="truncate">{t.description}</bdi>}
                          {t.direction === 'transfer' && <Badge tone="accent">העברה</Badge>}
                          {t.source === 'contribution' && t.direction === 'income' && <Badge tone="accent">העברת חבר</Badge>}
                          {t.fixed_or_variable === 'fixed' && <Badge>קבועה</Badge>}
                          {t.source !== 'manual' && t.source !== 'contribution' && <Badge>{SOURCE_LABEL[t.source] ?? t.source}</Badge>}
                        </p>
                      </td>
                      <td className="text-sm">{t.category ? <bdi>{t.category}{t.subcategory ? ` · ${t.subcategory}` : ''}</bdi> : <span className="text-muted">ללא</span>}</td>
                      <td className="text-sm">{t.account ? <bdi>{t.account}</bdi> : <span className="text-muted">—</span>}</td>
                      {c.kind === 'household' && <td className="text-sm"><bdi>{t.owner_name ?? '—'}</bdi></td>}
                      <td className={cn('num font-medium', sign > 0 ? 'text-good-ink' : 'text-ink')}><Money value={sign * t.amount} /></td>
                      <td>
                        {c.a.canWrite && (t.owner_user_id === c.u.id || ['owner', 'admin'].includes(c.a.role)) && (
                          <TxRowActions ws={c.ws} cats={c.cats} accounts={c.accounts} today={c.today} moveTo={t.owner_user_id === c.u.id ? c.moveTo : []} locked={t.locked}
                            tx={{ id: t.id, direction: t.direction === 'income' ? 'income' : 'expense', occurred_on: t.occurred_on, amount: t.amount, currency: t.currency,
                              merchant: t.merchant, description: t.description, category_id: t.category_id, subcategory_id: t.subcategory_id, account_id: t.account_id,
                              fixed_or_variable: t.fixed_or_variable, frequency: t.frequency, notes: t.notes }} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {more && <p className="text-sm text-muted">מוצגות 300 התנועות האחרונות של החודש. צמצם בסינון כדי לראות את השאר.</p>}
    </div>
  );
}
const SOURCE_LABEL: Record<string, string> = { statement: 'מדוח', receipt: 'מקבלה', gmail: 'מ-Gmail', recurring: 'קבועה' };

// ── Budget ────────────────────────────────────────────────────────────────────
export async function BudgetSection({ c }: { c: LedgerCtx }) {
  const b = await budgetFor(c.ws, c.month);
  if (!b.ready) return <Empty title="טבלאות הפיננסים עוד לא נוצרו במסד" />;
  const lines = b.view ? Object.fromEntries(b.view.rows.map(r => [r.category_id, r.budget])) : {};
  const names = new Map(c.cats.map(x => [x.id, x.name]));
  const prev = !b.budget ? await latestBudgetBefore(c.ws, c.month) : null;
  const edit = c.a.canWrite && (
    <BudgetDialog ws={c.ws} month={c.month} cats={c.cats} lines={lines} notes={b.budget?.notes}
      trigger={b.budget ? 'עריכת תקציב' : <><Plus aria-hidden />צור תקציב חודשי</>} title={`תקציב ${monthLabel(c.month)}`}
      triggerClass={buttonClass(b.budget ? 'secondary' : 'primary', 'sm')} />
  );
  if (!b.view) {
    return (
      <Card>
        <Empty icon={<Tags />} title={`אין תקציב ל${monthLabel(c.month)}`}>
          קבע סכום לכל קטגוריה (דיור, מזון, תחבורה…) ותראה כאן תקציב, בפועל, נשאר וחריגה.
        </Empty>
        <div className="flex flex-wrap justify-center gap-2 pb-8">{edit}{prev && c.a.canWrite && <CopyBudgetButton ws={c.ws} from={prev} to={c.month} label={`העתק מ${monthLabel(prev)}`} />}</div>
      </Card>
    );
  }
  const v = b.view;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="תקציב" value={ils(v.totals.budget)} />
        <KpiCard label="בפועל" value={ils(v.totals.actual)} />
        <KpiCard label="נשאר" value={ils(v.totals.remaining)} />
        <KpiCard label="חריגה" value={ils(Math.max(0, v.totals.variance))} hint={v.totals.variance > 0 ? 'מעל התקציב' : 'בתוך התקציב'} />
      </div>
      <div className="flex justify-end">{edit}</div>
      <Card className="p-0">
        <div className="relative overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>קטגוריה</th><th className="num">תקציב</th><th className="num">בפועל</th><th className="num">נשאר</th><th className="num">חריגה</th><th className="w-40">ניצול</th></tr></thead>
            <tbody>
              {v.rows.map(r => (
                <tr key={r.category_id}>
                  <td><bdi>{r.name}</bdi></td>
                  <td className="num"><Money value={r.budget} /></td>
                  <td className="num"><Money value={r.actual} /></td>
                  <td className={cn('num', r.remaining < 0 && 'text-critical-ink')}><Money value={r.remaining} /></td>
                  <td className={cn('num', r.variance > 0 && 'text-critical-ink')}>{r.variance > 0 ? <Money value={r.variance} /> : '—'}</td>
                  <td><Progress pct={r.pct} over={r.over} /></td>
                </tr>
              ))}
              {v.unbudgeted.map(r => (
                <tr key={r.category_id}>
                  <td><bdi>{names.get(r.category_id) ?? 'קטגוריה'}</bdi> <Badge tone="warning">בלי תקציב</Badge></td>
                  <td className="num">—</td><td className="num"><Money value={r.actual} /></td><td className="num">—</td><td className="num text-critical-ink"><Money value={r.actual} /></td><td />
                </tr>
              ))}
              {b.uncategorized !== null && (
                <tr><td className="text-muted">ללא קטגוריה</td><td className="num">—</td><td className="num"><Money value={b.uncategorized} /></td><td className="num">—</td><td className="num">—</td><td /></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Recurring ─────────────────────────────────────────────────────────────────
export async function FixedSection({ c }: { c: LedgerCtx }) {
  const r = await listRecurring(c.ws);
  if (!r.ready) return <Empty title="טבלאות הפיננסים עוד לא נוצרו במסד" />;
  const common = { ws: c.ws, cats: c.cats, accounts: c.accounts, today: c.today };
  if (!r.items.length) {
    return (
      <Card>
        <Empty icon={<Repeat />} title="אין הוצאות קבועות עדיין">שכירות, ביטוחים, מנויים, ועד בית: הוסף אותן פעם אחת ותראה מה יורד ומתי.</Empty>
        {c.a.canWrite && <div className="flex justify-center pb-8"><RecurringDialog {...common} trigger={<><Plus aria-hidden />הוסף הוצאה קבועה</>} title="הוצאה קבועה חדשה" triggerClass={buttonClass('primary', 'sm')} /></div>}
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">בממוצע בחודש: <Money value={r.monthlyTotal} className="font-semibold" /></p>
        {c.a.canWrite && <RecurringDialog {...common} trigger={<><Plus aria-hidden />הוצאה קבועה</>} title="הוצאה קבועה חדשה" triggerClass={buttonClass('secondary', 'sm')} />}
      </div>
      <Card className="p-0">
        <div className="relative overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>שם</th><th>תדירות</th><th>מועד הבא</th><th>קטגוריה</th><th className="num">סכום</th><th className="num">לחודש</th><th><span className="sr-only">פעולות</span></th></tr></thead>
            <tbody>
              {r.items.map(x => (
                <tr key={x.id} className={x.status !== 'active' ? 'opacity-60' : undefined}>
                  <td><p className="font-medium"><bdi>{x.name}</bdi></p>{x.status !== 'active' && <Badge>{x.status === 'paused' ? 'מושהה' : 'הסתיים'}</Badge>}</td>
                  <td className="text-sm">{x.frequency === 'custom' ? `כל ${x.interval_months} חודשים` : FREQ_LABEL[x.frequency]}</td>
                  <td className={cn('text-sm', x.next_due && x.next_due < c.today && 'text-critical-ink')}>{x.next_due ? shortDate(x.next_due) : '—'}</td>
                  <td className="text-sm">{x.category ? <bdi>{x.category}</bdi> : <span className="text-muted">ללא</span>}</td>
                  <td className="num"><Money value={x.amount} /></td>
                  <td className="num text-muted">{x.monthly ? <Money value={x.monthly} /> : '—'}</td>
                  <td>
                    {c.a.canWrite && (
                      <div className="flex items-center justify-end gap-1">
                        {x.status === 'active' && <RecordPaymentDialog ws={c.ws} id={x.id} amount={x.amount} due={x.next_due} today={c.today} name={x.name} />}
                        <RecurringDialog {...common} initial={x} trigger="עריכה" title="עריכת הוצאה קבועה" triggerClass={buttonClass('ghost', 'sm')} />
                        <Remove kind="recurring" id={x.id} ws={c.ws} label="מחיקת ההוצאה הקבועה" />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Accounts / bills ──────────────────────────────────────────────────────────
export async function AccountsSection({ c }: { c: LedgerCtx }) {
  const { ready, items } = await listAccounts(c.ws, c.month);
  if (!ready) return <Empty title="טבלאות הפיננסים עוד לא נוצרו במסד" />;
  const add = c.a.canWrite && (
    <div className="flex flex-wrap gap-2">
      <AccountDialog ws={c.ws} initial={{ kind: 'bank' }} trigger={<><Landmark aria-hidden />חשבון</>} title="חשבון חדש" triggerClass={buttonClass(items.length ? 'secondary' : 'primary', 'sm')} />
      <AccountDialog ws={c.ws} initial={{ kind: 'credit_card' }} trigger={<><CreditCard aria-hidden />כרטיס אשראי</>} title="כרטיס אשראי חדש" triggerClass={buttonClass('secondary', 'sm')} />
    </div>
  );
  if (!items.length) {
    return (
      <Card>
        <Empty icon={<Landmark />} title={c.kind === 'household' ? 'אין חשבונות משותפים עדיין' : 'אין חשבונות עדיין'}>
          הוסף חשבון בנק או כרטיס אשראי (רק שם ו-4 ספרות אחרונות), ושייך אליו תנועות וייבוא דוחות.
        </Empty>
        <div className="flex justify-center pb-8">{add}</div>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{add}</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(a => (
          <Card key={a.id} className="flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold"><bdi>{a.name}</bdi></p>
                <p className="text-xs text-muted"><bdi>{[ACCOUNT_LABEL[a.kind], a.institution, a.last4 ? `••${a.last4}` : null].filter(Boolean).join(' · ')}</bdi></p>
              </div>
              {c.a.canWrite && (
                <div className="flex shrink-0 items-center">
                  <AccountDialog ws={c.ws} initial={a} trigger="עריכה" title="עריכת חשבון" triggerClass={buttonClass('ghost', 'sm')} />
                  <Remove kind="account" id={a.id} ws={c.ws} label="מחיקת החשבון" />
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-muted">{a.kind === 'credit_card' ? 'יתרת חיוב' : 'יתרה'}{a.balance_as_of ? ` · נכון ל-${shortDate(a.balance_as_of)}` : ''}</p>
              <p className="text-section font-semibold"><Money value={a.balance} /></p>
            </div>
            <div className="flex gap-4 border-t border-line pt-3 text-sm">
              <span className="text-muted">יצא החודש <Money value={a.month_out} empty="—" className="text-ink" /></span>
              <span className="text-muted">נכנס <Money value={a.month_in} empty="—" className="text-ink" /></span>
            </div>
            {a.kind === 'credit_card' && (a.credit_limit || a.billing_day) && (
              <p className="text-xs text-muted">{a.credit_limit ? `מסגרת ${ils(a.credit_limit)}` : ''}{a.credit_limit && a.billing_day ? ' · ' : ''}{a.billing_day ? `חיוב ב-${a.billing_day} לחודש` : ''}</p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Savings ───────────────────────────────────────────────────────────────────
type Goal = Awaited<ReturnType<typeof listSavings>>['items'][number];
function GoalCard({ g, c }: { g: Goal; c: LedgerCtx }) {
  const v = g.view;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold"><bdi>{g.name}</bdi></p>
        {g.status !== 'active' && <Badge tone={g.status === 'reached' ? 'good' : 'neutral'}>{g.status === 'reached' ? 'הושג' : g.status === 'paused' ? 'מושהה' : 'בוטל'}</Badge>}
      </div>
      <p className="text-sm text-ink-2"><Money value={v.current} className="font-semibold" /> מתוך <Money value={v.target} /></p>
      <Progress pct={v.pct} />
      <p className="text-xs text-muted">
        {v.reached ? 'היעד הושג' : [
          `חסר ${ils(v.left)}`,
          g.deadline ? `עד ${shortDate(g.deadline)}` : null,
          v.needPerMonth !== null ? `צריך ${ils(v.needPerMonth)} לחודש` : null,
          v.monthsLeft !== null && !g.deadline ? `עוד כ-${v.monthsLeft} חודשים בקצב הנוכחי` : null,
        ].filter(Boolean).join(' · ')}
      </p>
      {v.onTrack === false && <Badge tone="warning" className="w-fit">ההפקדה החודשית נמוכה ממה שצריך</Badge>}
      {c.a.canWrite && (
        <div className="flex flex-wrap items-center gap-1 border-t border-line pt-3">
          {g.status === 'active' && <DepositDialog ws={c.ws} id={g.id} name={g.name} />}
          <SavingsDialog ws={c.ws} accounts={c.accounts} initial={g} trigger="עריכה" title="עריכת יעד" triggerClass={buttonClass('ghost', 'sm')} />
          <Remove kind="savings" id={g.id} ws={c.ws} label="מחיקת היעד" />
        </div>
      )}
    </Card>
  );
}

export async function SavingsSection({ c }: { c: LedgerCtx }) {
  const { ready, items } = await listSavings(c.ws, c.today);
  if (!ready) return <Empty title="טבלאות הפיננסים עוד לא נוצרו במסד" />;
  const add = c.a.canWrite && <SavingsDialog ws={c.ws} accounts={c.accounts} trigger={<><Plus aria-hidden />יעד חיסכון</>} title="יעד חיסכון חדש" triggerClass={buttonClass(items.length ? 'secondary' : 'primary', 'sm')} />;
  if (!items.length) {
    return (
      <Card>
        <Empty icon={<PiggyBank />} title={c.kind === 'household' ? 'אין יעדי חיסכון משותפים' : 'אין יעדי חיסכון עדיין'}>
          {c.kind === 'household' ? 'יעד משותף נראה לכל חברי משק הבית.' : 'יעד אישי פרטי: רק אתה רואה אותו.'} קבע סכום ותאריך, והמערכת תחשב כמה צריך לחודש.
        </Empty>
        <div className="flex justify-center pb-8">{add}</div>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{add}</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map(g => <GoalCard key={g.id} g={g} c={c} />)}</div>
    </div>
  );
}

// ── Rules + categories ────────────────────────────────────────────────────────
export async function RulesSection({ c }: { c: LedgerCtx }) {
  const rules = await listRules(c.u);
  const targets: WsOpt[] = [...(c.personalId ? [{ id: c.personalId, name: 'אישי', kind: 'personal' as const }] : []), ...c.households];
  const catsByWs: Record<string, CatOpt[]> = {};
  for (const t of targets) catsByWs[t.id] = t.id === c.ws ? c.cats : (await listCategories(t.id)).map(x => ({ id: x.id, kind: x.kind, name: x.name, parent_id: x.parent_id }));
  const top = (kind: 'income' | 'expense') => c.cats.filter(x => x.kind === kind && !x.parent_id);
  return (
    <div className="flex flex-col gap-8">
      <Section title="כללי סיווג" action={<RuleDialog targets={targets} catsByWs={catsByWs} trigger={<><Plus aria-hidden />כלל</>} title="כלל סיווג חדש" triggerClass={buttonClass('secondary', 'sm')} />}>
        <p className="-mt-2 text-sm text-muted">כלל מסווג אוטומטית תנועות בייבוא: לאיזה אזור, קטגוריה, קבועה או משתנה. נוצר גם כשמסמנים &quot;זכור את הבחירה&quot;. הכללים שלך פרטיים.</p>
        <Card className="p-0">
          {rules.length ? (
            <div className="relative overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>כש…</th><th>שייך ל-</th><th>קטגוריה</th><th>סוג</th><th className="num">הופעל</th><th><span className="sr-only">פעולות</span></th></tr></thead>
                <tbody>{rules.map(r => (
                  <tr key={r.id} className={r.active ? undefined : 'opacity-60'}>
                    <td><span className="text-xs text-muted">{r.match_field === 'merchant' ? 'בית העסק' : 'התיאור'} {r.match_type === 'equals' ? 'שווה ל' : r.match_type === 'starts_with' ? 'מתחיל ב' : 'מכיל'} </span><bdi className="font-medium">{r.pattern}</bdi></td>
                    <td><Badge tone="accent"><bdi>{r.target_workspace_id === c.personalId ? 'אישי' : r.workspace}</bdi></Badge></td>
                    <td className="text-sm">{r.category ? <bdi>{r.category}</bdi> : '—'}</td>
                    <td className="text-sm">{[r.fixed_or_variable === 'fixed' ? 'קבועה' : r.fixed_or_variable === 'variable' ? 'משתנה' : null, r.frequency ? FREQ_LABEL[r.frequency] : null].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="num">{r.hits}</td>
                    <td><div className="flex justify-end">
                      <RuleDialog targets={targets} catsByWs={catsByWs} initial={r} trigger="עריכה" title="עריכת כלל" triggerClass={buttonClass('ghost', 'sm')} />
                      <Remove kind="rule" id={r.id} ws={c.ws} label="מחיקת הכלל" />
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty compact icon={<Tags />} title="אין כללים עדיין">בייבוא הראשון של בית עסק תישאל איך לסווג אותו, ואפשר לבחור &quot;זכור את הבחירה&quot;.</Empty>}
        </Card>
      </Section>
      <Section title="קטגוריות" action={c.a.canWrite && <CategoryDialog ws={c.ws} cats={c.cats} trigger={<><Plus aria-hidden />קטגוריה</>} title="קטגוריה חדשה" triggerClass={buttonClass('secondary', 'sm')} />}>
        <div className="grid gap-4 lg:grid-cols-2">
          {(['expense', 'income'] as const).map(kind => (
            <Card key={kind} className="p-0">
              <p className="border-b border-line px-5 py-3 text-sm font-semibold">{kind === 'expense' ? 'הוצאות' : 'הכנסות'}</p>
              {top(kind).length ? (
                <ul className="divide-y divide-[color:var(--border)]">
                  {top(kind).map(cat => {
                    const subs = c.cats.filter(x => x.parent_id === cat.id);
                    return (
                      <li key={cat.id} className="flex items-start justify-between gap-3 px-5 py-2.5">
                        <div className="min-w-0">
                          <p className="font-medium"><bdi>{cat.name}</bdi></p>
                          {subs.length > 0 && <p className="text-xs text-muted"><bdi>{subs.map(s => s.name).join(' · ')}</bdi></p>}
                        </div>
                        {c.a.canWrite && (
                          <div className="flex shrink-0 items-center">
                            <CategoryDialog ws={c.ws} cats={c.cats} initial={cat} trigger="עריכה" title="עריכת קטגוריה" triggerClass={buttonClass('ghost', 'sm')} />
                            <Remove kind="category" id={cat.id} ws={c.ws} label={`מחיקת הקטגוריה ${cat.name}`} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <Empty compact title="אין קטגוריות" />}
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ── Contributions ─────────────────────────────────────────────────────────────
// Personal side: "Contribution to Household" with the amount, next date and an edit button
export async function MyContributions({ c }: { c: LedgerCtx }) {
  const plans = (await myContributions(c.u, c.today)).filter(p => p.status !== 'ended');
  if (!c.households.length && !plans.length) return null;
  const free = c.households.filter(h => !plans.some(p => p.workspace_id === h.id));
  const add = free.length > 0 && (
    <ContributionDialog households={free} accounts={c.accounts} today={c.today} trigger={<><Plus aria-hidden />הגדר העברה למשק הבית</>}
      title="Contribution to Household" triggerClass={buttonClass(plans.length ? 'ghost' : 'secondary', 'sm')} />
  );
  return (
    <Section title="Contribution to Household" action={plans.length ? add : null}>
      {plans.length === 0 ? (
        <Card><Empty compact icon={<Wallet />} title="לא הוגדרה העברה למשק הבית">קבע כמה אתה מעביר כל חודש. משק הבית רואה רק את הסכום, התאריך והסטטוס, לא את ההכנסה שלך.</Empty>
          <div className="flex justify-center pb-6">{add}</div></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map(p => {
            const suggested = p.rule === 'fixed' ? p.fixed_amount : p.rule === 'manual' ? p.fixed_amount : null;
            return (
              <Card key={p.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted">משק בית</p>
                    <p className="font-semibold"><bdi>{p.household}</bdi></p>
                  </div>
                  {p.status === 'paused' && <Badge>מושהה</Badge>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted">סכום חודשי</p>
                    <p className="text-section font-semibold">{p.rule === 'percentage' ? `${p.percentage}% מההכנסה` : <Money value={p.fixed_amount} empty="ידני" />}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">ההעברה הבאה</p>
                    <p className="text-section font-semibold">{p.next ? shortDate(p.next) : '—'}</p>
                  </div>
                </div>
                <p className="text-sm text-muted">החודש הועבר: <Money value={p.this_month_paid} empty="עדיין לא" className="text-ink" /></p>
                <div className="flex flex-wrap items-center gap-1 border-t border-line pt-3">
                  {p.status === 'active' && <ExecuteContributionDialog id={p.id} household={p.household} suggested={suggested} today={c.today} rule={p.rule} />}
                  <ContributionDialog households={[{ id: p.workspace_id, name: p.household, kind: 'household' }]} accounts={c.accounts} today={c.today}
                    initial={{ ...p, household: p.workspace_id, amount: p.fixed_amount }} trigger="Edit contribution" title="עריכת ההעברה" triggerClass={buttonClass('ghost', 'sm')} />
                  <EndContributionButton id={p.id} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// Household side: expected per member, total expected / received / pending, and the payments
export async function HouseholdContributionsCard({ c, compact }: { c: LedgerCtx; compact?: boolean }) {
  const period = `${c.month}-01`;
  const h = await householdContributions(c.ws, period, c.today);
  if (!h.ready) return <Empty title="טבלאות הפיננסים עוד לא נוצרו במסד" />;
  const mine = h.plans.find(p => p.user_id === c.u.id && p.status !== 'ended');
  const add = c.a.canWrite && !mine && (
    <ContributionDialog households={[{ id: c.ws, name: c.a.w.name, kind: 'household' }]} accounts={[]} today={c.today}
      trigger={<><Plus aria-hidden />Contribution</>} title="ההעברה שלי למשק הבית" triggerClass={buttonClass('secondary', 'sm')} />
  );
  const m = h.month;
  const payments = h.payments.filter(p => `${p.period}-01` === period);
  return (
    <Section title={`העברות חברים · ${monthLabel(c.month)}`} action={compact ? <Link href="/household/finance?tab=contributions" className={buttonClass('ghost', 'sm')}>לכל ההעברות</Link> : add}>
      {!h.plans.length ? (
        <Card><Empty compact icon={<Wallet />} title="אף חבר עוד לא הגדיר העברה">כל חבר קובע כמה הוא מעביר מהאזור האישי שלו. כאן רואים רק סכום, תאריך וסטטוס.</Empty>
          {add && <div className="flex justify-center pb-6">{add}</div>}</Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <KpiCard label="צפוי" value={ils(m?.expected)} reason="יש העברה באחוזים שעדיין לא בוצעה" />
            <KpiCard label="התקבל" value={ils(m?.received)} reason="עוד לא התקבלו העברות" />
            <KpiCard label="ממתין" value={ils(m?.pending)} />
          </div>
          <Card className="p-0">
            <div className="relative overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>חבר</th><th className="num">צפוי</th><th className="num">התקבל</th><th>סטטוס</th><th>הבא</th>{!compact && <th><span className="sr-only">פעולות</span></th>}</tr></thead>
                <tbody>
                  {(m?.rows ?? []).map(r => {
                    const plan = h.plans.find(p => p.id === r.contribution_id)!;
                    return (
                      <tr key={r.contribution_id}>
                        <td><bdi className="font-medium">{r.name}</bdi></td>
                        <td className="num"><Money value={r.expected} empty={plan.rule === 'percentage' ? 'לפי הכנסה' : 'ידני'} /></td>
                        <td className="num"><Money value={r.received || null} empty="—" /></td>
                        <td><Badge tone={r.status === 'received' ? 'good' : r.status === 'partial' ? 'warning' : 'neutral'}>{r.status === 'received' ? 'התקבל' : r.status === 'partial' ? 'חלקי' : 'ממתין'}</Badge></td>
                        <td className="text-sm">{plan.next ? shortDate(plan.next) : '—'}</td>
                        {!compact && (
                          <td>{plan.user_id === c.u.id && plan.status === 'active' && (
                            <ExecuteContributionDialog id={plan.id} household={c.a.w.name} suggested={plan.amount} today={c.today} rule={plan.rule} triggerClass={buttonClass('secondary', 'sm')} />
                          )}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          {!compact && (
            <Section title="העברות שבוצעו">
              <Card className="p-0">
                {payments.length ? (
                  <ul className="divide-y divide-[color:var(--border)]">
                    {payments.map(p => (
                      <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div><p className="font-medium"><bdi>{p.name}</bdi></p><p className="text-xs text-muted">{p.paid_on ? shortDate(p.paid_on) : ''}</p></div>
                        <div className="flex items-center gap-2"><Money value={p.amount} className="font-medium text-good-ink" />{p.user_id === c.u.id && <CancelPaymentButton id={p.id} />}</div>
                      </li>
                    ))}
                  </ul>
                ) : <Empty compact title="עוד לא בוצעו העברות החודש" />}
              </Card>
            </Section>
          )}
        </>
      )}
    </Section>
  );
}

export const PERSONAL_FINANCE_TABS = [
  { key: 'overview', label: 'סקירה' }, { key: 'transactions', label: 'תנועות' }, { key: 'budget', label: 'תקציב אישי' },
  { key: 'fixed', label: 'הוצאות קבועות' }, { key: 'accounts', label: 'חשבונות' }, { key: 'documents', label: 'מסמכים' },
  { key: 'savings', label: 'יעדי חיסכון' }, { key: 'rules', label: 'כללי סיווג' },
] as const;
export type PersonalFinanceTab = (typeof PERSONAL_FINANCE_TABS)[number]['key'];

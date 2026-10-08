import Link from 'next/link';
import { ChevronLeft, Lock, Mail } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { gmailImports, gmailStatus } from '@/server/gmail';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { Card, CardContent, Section } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { stamp } from '@/lib/format';
import { GmailControls } from './gmail-controls';

export const dynamic = 'force-dynamic';
// A sync reads up to 50 messages; give the server action room (it stops itself after ~40s)
export const maxDuration = 60;

const CONNECT = '/api/google/connect?with=gmail';

const RETURN: Record<string, { tone: 'good' | 'critical' | 'warning'; text: string }> = {
  connected: { tone: 'good', text: 'החשבון חובר. אפשר לסנכרן.' },
  error: { tone: 'critical', text: 'החיבור ל-Google לא הושלם. נסה שוב.' },
  no_refresh: { tone: 'warning', text: 'Google לא החזיר הרשאה קבועה. נסה לחבר שוב.' },
  no_gmail_scope: { tone: 'warning', text: 'ההרשאה ל-Gmail לא סומנה במסך של Google. חבר שוב וסמן אותה.' },
  not_configured: { tone: 'warning', text: 'החיבור ל-Google עוד לא הוגדר בשרת.' },
};

const IMPORT_STATUS: Record<string, { tone: 'accent' | 'good' | 'critical' | 'neutral'; label: string }> = {
  review: { tone: 'accent', label: 'ממתין לסקירה' },
  imported: { tone: 'good', label: 'הושלם' },
  failed: { tone: 'critical', label: 'נכשל' },
  cancelled: { tone: 'neutral', label: 'בוטל' },
};

export default async function GmailImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const [st, imports] = await Promise.all([gmailStatus(u), gmailImports(u)]);
  const back = sp.gmail ? RETURN[sp.gmail] ?? null : null;
  const ready = st.configured && st.connected && st.hasGmailScope;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="חשבוניות וקבלות מ-Gmail"
        subtitle="מוצא חשבוניות, קבלות, אישורי תשלום ודפי חשבון בתיבת הדואר שלך ומכין אותם לסקירה."
        status={ready ? <Badge tone="good">מחובר</Badge> : undefined}
      />

      {back && <p role="status" className={back.tone === 'good' ? 'text-sm text-good-ink' : back.tone === 'critical' ? 'text-sm text-critical-ink' : 'text-sm text-warning-ink'}>{back.text}</p>}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 sm:pt-6">
          <div className="flex items-center gap-2 text-card font-semibold text-ink"><Lock className="size-4 text-muted" aria-hidden />פרטי ומוגן</div>
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-ink-2">
            <li>רק אתה רואה את תיבת הדואר. ההרשאה שייכת לך בלבד ולא לבני הבית.</li>
            <li>הדשבורד לא שומר את תוכן המיילים או הקבצים: רק שורות לסקירה (תאריך, ספק, סכום, מספר מסמך).</li>
            <li>שום דבר לא נרשם כתנועה עד שאתה מאשר. פריט שתאשר נשמר במרחב האישי, ואפשר להעביר אותו למשק הבית בסקירה.</li>
          </ul>
        </CardContent>
      </Card>

      {!st.configured ? (
        <Card>
          <Empty icon={<Mail aria-hidden />} title="החיבור ל-Google עוד לא הוגדר">
            מנהל המערכת צריך להגדיר את החיבור ל-Google בשרת. אחרי זה יופיע כאן כפתור החיבור.
          </Empty>
        </Card>
      ) : !st.connected ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5 sm:pt-6">
            <p className="text-body text-ink">
              {st.needsReconnect ? 'Google ביטל את ההרשאה. חבר את החשבון מחדש כדי להמשיך.' : 'חבר את חשבון Google שלך כדי לסרוק חשבוניות וקבלות.'}
            </p>
            <Permissions />
            <div>
              <a href={CONNECT} className={buttonClass('primary')}>
                <Mail className="size-4" aria-hidden />{st.needsReconnect ? 'חבר מחדש' : 'חבר חשבון Google'}
              </a>
            </div>
          </CardContent>
        </Card>
      ) : !st.hasGmailScope ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5 sm:pt-6">
            <p className="text-body text-ink">
              חשבון Google {st.email && <bdi dir="ltr">{st.email}</bdi>} מחובר ליומן, אבל בלי הרשאה ל-Gmail.
            </p>
            <Permissions />
            <div>
              <a href={CONNECT} className={buttonClass('primary')}><Mail className="size-4" aria-hidden />הוסף הרשאת Gmail</a>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5 sm:pt-6">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">חשבון</dt>
              <dd className="flex flex-wrap items-center gap-2 text-ink">
                {st.email ? <bdi dir="ltr">{st.email}</bdi> : 'חשבון Google'}<Badge tone="good">מחובר</Badge>
              </dd>
              <dt className="text-muted">סנכרון אחרון</dt>
              <dd className="text-ink">{st.lastSync ? stamp(st.lastSync) : 'עוד לא סונכרן'}</dd>
            </dl>
            <p className="text-sm text-muted">כל סנכרון קורא עד 50 הודעות חדשות מ-90 הימים האחרונים. הודעה שכבר נסרקה לא תיובא פעמיים.</p>
            <GmailControls alsoCalendar={st.hasCalendarScope} />
          </CardContent>
        </Card>
      )}

      <Section title="ייבואים אחרונים מ-Gmail">
        {imports.length === 0 ? (
          <Card><Empty compact title="אין נתונים עדיין">אחרי הסנכרון הראשון יופיעו כאן הייבואים והקישור לסקירה.</Empty></Card>
        ) : (
          <Card>
            <ul className="divide-y divide-[color:var(--border)]">
              {imports.map(i => {
                const s = IMPORT_STATUS[i.status] ?? { tone: 'neutral' as const, label: i.status };
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-6">
                    <span className="min-w-0 flex-1 basis-40 text-sm text-ink">{stamp(i.created_at)}</span>
                    <span className="text-sm text-ink-2">
                      {i.row_count === 0 ? 'אין פריטים חדשים' : `${i.row_count} פריטים`}
                      {i.imported_count > 0 && ` · ${i.imported_count} נשמרו`}
                    </span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {i.row_count > 0 && (
                      <Link href={`/finance-import?import=${i.id}`} className={buttonClass('ghost', 'sm')}>
                        לסקירה<ChevronLeft className="size-4" aria-hidden />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Section>
    </div>
  );
}

function Permissions() {
  return (
    <div className="flex flex-col gap-1.5 text-sm text-ink-2">
      <p className="font-medium text-ink">ההרשאה שמתבקשת ב-Google:</p>
      <ul className="flex list-disc flex-col gap-1 ps-5">
        <li>קריאה בלבד של הדואר (Gmail), כדי למצוא חשבוניות וקבלות.</li>
        <li>לא שליחה, לא מחיקה ולא שינוי של מיילים.</li>
        <li>במסך של Google יופיעו גם הרשאות היומן. אפשר להשאיר רק את Gmail מסומן.</li>
      </ul>
    </div>
  );
}

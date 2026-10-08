import Link from 'next/link';
import { requireUser } from '@/server/auth';
import { canGrant, canManageUsers, listUsers, pendingUsers, ROLE_HINT, ROLE_LABEL } from '@/server/users';
import { placeOptions } from '@/lib/places';
import { UsersSection } from '@/components/settings/users-section';
import { IntegrationsList } from '@/components/settings/integrations-list';
import { integrationsStatus } from '@/server/integrations';
import { CalendarDays, CircleCheck, TriangleAlert, User, Users } from 'lucide-react';
import { calendarStatus } from '@/server/calendar';
import { profile } from '@/server/entries';
import { stamp } from '@/lib/format';
import { CalendarActions, CalendarMappingRow } from '@/components/settings/calendar-controls';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/page-header';

export const metadata = { title: 'הגדרות — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const RESULT: Record<string, { tone: 'good' | 'critical'; text: string }> = {
  connected: { tone: 'good', text: 'יומן Google חובר. האירועים יופיעו בבית, בהיום ובלוח השנה.' },
  error: { tone: 'critical', text: 'החיבור לא הושלם. נסה שוב.' },
  no_refresh: { tone: 'critical', text: 'Google לא החזיר הרשאה קבועה. הסר את הגישה בחשבון Google (אבטחה → אפליקציות של צד שלישי) ונסה שוב.' },
  not_configured: { tone: 'critical', text: 'החיבור עוד לא הוגדר בשרת (חסרים פרטי Google).' },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const manage = canManageUsers(u);
  const [cal, users, team, pending, integrations] = await Promise.all([
    calendarStatus(), profile(), manage ? listUsers(u).catch(() => null) : null, u.isAdmin ? pendingUsers().catch(() => []) : Promise.resolve([]),
    integrationsStatus(u).catch(() => null),
  ]);
  const result = sp.calendar ? RESULT[sp.calendar] : null;
  const me = users.find(x => x.id === u.id);
  // What this user may hand out, and where
  const roles = (['admin', 'manager', 'employee', 'viewer'] as const)
    .filter(r => placeOptions().some(o => canGrant(u, r, o.place)) || (r === 'admin' && canGrant(u, r, { domain: null, branch: null, location: null })))
    .map(r => ({ value: r, label: ROLE_LABEL[r], hint: ROLE_HINT[r] }));
  const places = placeOptions().filter(o => canGrant(u, 'viewer', o.place)).map(o => ({ value: o.value, label: o.label }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="הגדרות" subtitle="יומן Google, חיבורים, משתמשים והרשאות, ופרופיל" />

      <Card id="calendar">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="size-4" aria-hidden />יומן Google</CardTitle>
          {cal.connection ? <Badge tone={cal.connection.status === 'connected' ? 'good' : 'critical'}>{cal.connection.status === 'connected' ? 'מחובר' : 'דורש חיבור מחדש'}</Badge>
            : <Badge>לא מחובר</Badge>}
        </CardHeader>
        <CardContent className="flex flex-col gap-5 text-sm">
          {result && (
            <p role="status" className={result.tone === 'good' ? 'flex items-start gap-2 rounded-lg bg-good-soft px-3.5 py-2.5 text-good-ink' : 'flex items-start gap-2 rounded-lg bg-critical-soft px-3.5 py-2.5 text-critical-ink'}>
              {result.tone === 'good' ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}{result.text}
            </p>
          )}
          {!cal.configured ? (
            <div className="flex flex-col gap-2 text-ink-2">
              <p className="text-body">החיבור ליומן עוד לא הוגדר בשרת. אחרי שיוגדר, יופיע כאן כפתור "חבר את יומן Google". הדשבורד יקרא את היומנים ויוכל ליצור, לערוך ולמחוק אירועים שתבקש ממנו.</p>
              <p className="text-xs text-muted">נדרשים שלושה משתני סביבה ב-Vercel: <bdi dir="ltr">GOOGLE_CLIENT_ID</bdi>, <bdi dir="ltr">GOOGLE_CLIENT_SECRET</bdi> ו-<bdi dir="ltr">CALENDAR_TOKEN_KEY</bdi>.</p>
            </div>
          ) : !cal.connection || cal.connection.status !== 'connected' ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-body text-ink-2">{cal.connection ? 'Google ביטל את ההרשאה או שהחיבור נכשל. חבר מחדש כדי להמשיך לסנכרן.' : 'כל משתמש מחבר את חשבון Google שלו. הדשבורד קורא את היומנים, ויוצר, עורך או מוחק אירוע רק כשאתה מבקש. אירועים פרטיים כברירת מחדל.'}</p>
              <a href="/api/google/connect" className={buttonClass('primary')}>{cal.connection ? 'חבר מחדש' : 'חבר את יומן Google'}</a>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-col gap-0.5"><bdi dir="ltr" className="text-body font-medium text-ink">{cal.connection.email}</bdi>{cal.connection.last_synced_at && <span className="text-xs text-muted">עודכן {stamp(cal.connection.last_synced_at)}</span>}</p>
                <CalendarActions />
              </div>
              {!cal.connection.canWrite && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-3">
                  <p className="text-ink-2">החיבור הוא לקריאה בלבד. חבר מחדש כדי לאפשר כתיבה (יצירה ועריכה של אירועים מהדשבורד).</p>
                  <a href="/api/google/connect" className={buttonClass('primary', 'sm')}>חבר מחדש</a>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-ink">יומנים</h3>
                <p className="text-xs text-muted">איזה יומנים להציג, לאן כל אחד שייך (למשל יומן הספא → Head Spa · מודיעין), ואם הוא משותף עם מי שעובד במקום הזה. יומן לא משותף נשאר פרטי שלך.</p>
                <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                  {cal.calendars.map(c => <CalendarMappingRow key={c.id} cal={c} />)}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <IntegrationsList items={integrations} />

      {team && (
        <Card id="users">
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4" aria-hidden />משתמשים והרשאות</CardTitle></CardHeader>
          <CardContent>
            <UsersSection users={team.users} invites={team.invites} roles={roles} places={places} pending={pending} meId={u.id} />
          </CardContent>
        </Card>
      )}

      <Card id="profile">
        <CardHeader><CardTitle className="flex items-center gap-2"><User className="size-4" aria-hidden />פרופיל</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {me && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5">
              <dt className="text-muted">שם</dt><dd className="font-medium text-ink"><bdi>{me.name}</bdi></dd>
              <dt className="text-muted">אימייל</dt><dd className="text-ink"><bdi dir="ltr">{me.email ?? '—'}</bdi></dd>
              <dt className="text-muted">אזור זמן</dt><dd className="text-ink">ישראל <span className="text-xs text-muted">(<bdi dir="ltr">Asia/Jerusalem</bdi>)</span></dd>
            </dl>
          )}
          <p className="border-t border-line pt-4 text-muted">רשומה "אישית" נשארת רק שלך. רשומה "משותפת" רואים כל מי שיש לו גישה למקום שלה.</p>
          {u.isAdmin && <p className="text-xs text-muted">מע״מ, ספים ואחוזי בעלות מוגדרים בוואלט. <Link href="/health" className="font-medium text-accent-ink hover:underline">שלמות נתונים</Link></p>}
        </CardContent>
      </Card>
    </div>
  );
}

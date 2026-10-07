import { requireUser } from '@/server/auth';
import { openAlerts } from '@/server/data';
import { todayIL } from '@/lib/period';
import { AppShell } from '@/components/shell/app-shell';
import { inboxCount } from '@/server/entries';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const today = todayIL();
  const [open, inbox] = await Promise.all([openAlerts(), inboxCount()]);
  const active = open.filter(a => !(a.snoozed_until && a.snoozed_until > today));
  return <AppShell counts={{ inbox, alerts: active.length }}>{children}</AppShell>;
}

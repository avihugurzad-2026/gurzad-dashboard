import { requireUser } from '@/server/auth';
import { openAlerts } from '@/server/data';
import { todayIL } from '@/lib/period';
import { AppShell } from '@/components/shell/app-shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const today = todayIL();
  const open = await openAlerts();
  const active = open.filter(a => !(a.snoozed_until && a.snoozed_until > today));
  return <AppShell alertCount={active.length}>{children}</AppShell>;
}

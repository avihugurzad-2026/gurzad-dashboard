import 'server-only';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth';
import { canManageWorkspace, currentHousehold, roleIn, workspaceMembers } from '@/server/workspaces';

// The household every /household page is about: the user's current household, its members and
// the user's role in it. The layout already shows the "no household yet" screen, so null here is a 404.
export async function householdContext() {
  const u = await requireUser();
  const w = await currentHousehold(u);
  if (!w) notFound();
  const members = await workspaceMembers(w, u);
  const place = { domain: 'household' as const, branch: w.branch, location: null };
  return { u, w, members, place, role: roleIn(u, w), canManage: canManageWorkspace(u, w) };
}

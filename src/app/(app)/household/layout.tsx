import { requirePlace } from '@/server/auth';

// "הבית שלנו" keeps its data in the personal area's tables until workspaces have their own rows,
// so it follows the personal area's access for now.
export default async function HouseholdLayout({ children }: { children: React.ReactNode }) {
  await requirePlace({ domain: 'personal' });
  return <>{children}</>;
}

import { requirePlace } from '@/server/auth';

// The area menu lives in each page's header (see ./area-nav.tsx)
export default async function PersonalLayout({ children }: { children: React.ReactNode }) {
  await requirePlace({ domain: 'personal' });
  return <>{children}</>;
}

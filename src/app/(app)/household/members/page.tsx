import { UserPlus } from 'lucide-react';
import { HOUSEHOLD, ROLE_LABEL } from '@/lib/workspaces';
import { PageHeader } from '@/components/shell/page-header';
import { PrivacyBoundary } from '@/components/workspace/privacy-boundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HouseholdBadge, HouseholdNav } from '../area-nav';

export const metadata = { title: 'חברי הבית — דשבורד גורזד' };

export default function HouseholdMembersPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="חברים" subtitle="מי שותף בבית ומה כל אחד רואה" status={<HouseholdBadge />} tabs={<HouseholdNav />}
        actions={<Button variant="secondary" disabled title="יגיע עם ניהול ההרשאות"><UserPlus aria-hidden />הזמנת חבר</Button>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.3fr] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>חברי הבית</CardTitle><span className="text-sm text-muted">{HOUSEHOLD.members.length} חברים</span></CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {HOUSEHOLD.members.map(m => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink" aria-hidden>{m.name.slice(0, 1)}</span>
                    <span className="text-body font-medium text-ink">{m.name}</span>
                  </span>
                  <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <PrivacyBoundary />
      </div>
    </div>
  );
}

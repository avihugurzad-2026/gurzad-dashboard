import { HOUSEHOLD_MODULES } from '@/lib/workspaces';
import { WorkspaceBadge, WorkspaceNav } from '@/components/workspace/workspace-ui';

// The household workspace menu. Each page passes it to <PageHeader tabs>.
export function HouseholdNav() {
  return <WorkspaceNav modules={HOUSEHOLD_MODULES} label="הבית" />;
}

export function HouseholdBadge({ members }: { members: number }) {
  return <WorkspaceBadge ws={{ kind: 'household', name: '', memberCount: members }} />;
}

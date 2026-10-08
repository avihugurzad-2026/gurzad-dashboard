import { HOUSEHOLD } from '@/lib/workspaces';
import { WorkspaceBadge, WorkspaceNav } from '@/components/workspace/workspace-ui';

// The "הבית שלנו" workspace menu (modules from src/lib/workspaces.ts)
export function HouseholdNav() {
  return <WorkspaceNav ws={HOUSEHOLD} />;
}

export function HouseholdBadge() {
  return <WorkspaceBadge ws={HOUSEHOLD} />;
}

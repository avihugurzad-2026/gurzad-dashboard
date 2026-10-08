import { PERSONAL } from '@/lib/workspaces';
import { WorkspaceBadge, WorkspaceNav } from '@/components/workspace/workspace-ui';

// The Personal workspace menu (modules from src/lib/workspaces.ts). Each page passes it to <PageHeader tabs>.
export function PersonalNav() {
  return <WorkspaceNav ws={PERSONAL} />;
}

export function PersonalBadge() {
  return <WorkspaceBadge ws={PERSONAL} />;
}

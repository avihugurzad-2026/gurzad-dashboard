import { VENTURES } from '@/lib/workspaces';
import { WorkspaceBadge, WorkspaceNav } from '@/components/workspace/workspace-ui';

// The Ventures workspace menu (modules from src/lib/workspaces.ts). Each page passes it to <PageHeader tabs>.
export function VenturesNav() {
  return <WorkspaceNav ws={VENTURES} />;
}

export function VenturesBadge() {
  return <WorkspaceBadge ws={VENTURES} />;
}

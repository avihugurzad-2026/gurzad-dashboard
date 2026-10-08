import { VENTURES_MODULES } from '@/lib/workspaces';
import { WorkspaceBadge, WorkspaceNav } from '@/components/workspace/workspace-ui';

// The Ventures workspace menu. Each page passes it to <PageHeader tabs>.
export function VenturesNav() {
  return <WorkspaceNav modules={VENTURES_MODULES} label="יזמות" />;
}

export function VenturesBadge() {
  return <WorkspaceBadge ws={{ kind: 'ventures', name: 'יזמות' }} />;
}

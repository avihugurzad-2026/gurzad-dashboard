import { PERSONAL_MODULES } from '@/lib/workspaces';
import { WorkspaceBadge, WorkspaceNav } from '@/components/workspace/workspace-ui';

// The Personal workspace menu. Each page passes it to <PageHeader tabs>.
export function PersonalNav() {
  return <WorkspaceNav modules={PERSONAL_MODULES} label="אישי" />;
}

export function PersonalBadge() {
  return <WorkspaceBadge ws={{ kind: 'personal', name: 'אישי' }} />;
}

import { ROLE_LABEL, type WorkspaceKind, type WorkspaceRole } from '@/lib/workspaces';

// "מנהל" is both admin and manager in a business: tell them apart where both can be picked
export const roleLabel = (role: string, kind: WorkspaceKind) =>
  kind === 'business' && role === 'admin' ? 'מנהל ראשי' : ROLE_LABEL[role as WorkspaceRole] ?? role;

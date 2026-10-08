// The product's information architecture: USER → WORKSPACES → MEMBERS → MODULES → DATA.
//
// Workspaces and their members are user data (DB `workspaces`, `workspace_members`, created and
// managed from the UI: src/server/workspaces.ts). What lives here is only the product's structure:
// the kinds of workspace and the modules each kind has. No person, business, amount or member is
// defined in code.
//
//   personal  · one per user, private: only its owner ever sees it. Nothing in it is shared.
//   household · shared; members see each member's *contribution*, never their income.
//   business  · one per business; its branches are rows of `locations`.
//   ventures  · real estate, investments, legal and funding.

export type WorkspaceKind = 'personal' | 'household' | 'business' | 'ventures';
export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'member' | 'employee' | 'viewer';

// What a page needs to know about a workspace (from the DB row)
export type Workspace = {
  id: string; kind: WorkspaceKind; name: string; href: string;
  domain: string; branch: string | null; memberCount?: number;
};

// `ready`: the module shows real data today. Otherwise it is a placeholder that says what will be there.
export type WorkspaceModule = { key: string; label: string; href: string; ready: boolean; sections?: string[] };

export const KIND_LABEL: Record<WorkspaceKind, string> = {
  personal: 'אישי', household: 'משק בית', business: 'עסק', ventures: 'יזמות',
};
export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'בעלים', admin: 'מנהל', manager: 'מנהל', member: 'חבר', employee: 'עובד', viewer: 'צפייה בלבד',
};
// Roles a household or business can hand out from its members screen
export const HOUSEHOLD_ROLES: WorkspaceRole[] = ['admin', 'member', 'viewer'];
export const BUSINESS_ROLES: WorkspaceRole[] = ['admin', 'manager', 'employee', 'viewer'];

export const hrefOf = (w: { kind: WorkspaceKind; branch: string | null }) =>
  w.kind === 'personal' ? '/personal' : w.kind === 'household' ? '/household' : w.kind === 'ventures' ? '/ventures' : `/business/${w.branch}`;

export const toWorkspace = (w: { id: string; kind: WorkspaceKind; name: string; domain: string; branch: string | null }, memberCount?: number): Workspace =>
  ({ id: w.id, kind: w.kind, name: w.name, domain: w.domain, branch: w.branch, href: hrefOf(w), memberCount });

const mod = (base: string, key: string, label: string, ready: boolean, sections?: string[]): WorkspaceModule =>
  ({ key, label, href: key === 'overview' ? base : `${base}/${key}`, ready, ...(sections ? { sections } : {}) });
const tab = (base: string, key: string, label: string, ready: boolean, sections?: string[]): WorkspaceModule =>
  ({ key, label, href: key === 'overview' ? base : `${base}?tab=${key}`, ready, ...(sections ? { sections } : {}) });

export const PERSONAL_MODULES: WorkspaceModule[] = [
  mod('/personal', 'overview', 'סקירה', true),
  mod('/personal', 'tasks', 'משימות', true),
  mod('/personal', 'money', 'פיננסים', true),
  mod('/personal', 'documents', 'מסמכים', true),
  mod('/personal', 'goals', 'יעדים', true),
  mod('/personal', 'investments', 'השקעות אישיות', false, ['תיק השקעות', 'פנסיה וקרנות השתלמות', 'נכסים אחרים']),
  mod('/personal', 'info', 'מידע אישי', false, ['פרטים אישיים', 'אנשי קשר חשובים', 'מספרי חשבון ופוליסות']),
];

export const HOUSEHOLD_MODULES: WorkspaceModule[] = [
  mod('/household', 'overview', 'סקירה', true),
  mod('/household', 'tasks', 'משימות', true),
  mod('/household', 'finance', 'פיננסים משותפים', true),
  mod('/household', 'budget', 'תקציב', true),
  mod('/household', 'fixed', 'הוצאות קבועות', true),
  mod('/household', 'bills', 'חשבונות', true),
  mod('/household', 'documents', 'מסמכים', true),
  mod('/household', 'savings', 'יעדי חיסכון', true),
  mod('/household', 'members', 'חברים', true),
];

const BUSINESS_SECTIONS: Record<string, string[]> = {
  finance: ['הכנסות והוצאות', 'רווח והפסד', 'מע״מ'],
  reports: ['דוח חודשי', 'השוואה לתקופה קודמת', 'ייצוא לרואה חשבון'],
  clients: ['לקוחות פעילים', 'היסטוריית לקוח', 'פלחים'],
  collections: ['יתרות פתוחות', 'באיחור', 'נגבה'],
};

// `ready` lists the tabs a business page renders with real data
export function businessModules(href: string, ready: string[]): WorkspaceModule[] {
  const keys: [string, string][] = [
    ['overview', 'סקירה'], ['tasks', 'משימות'], ['clients', 'לקוחות'], ['finance', 'פיננסים'], ['collections', 'גבייה'],
    ['documents', 'מסמכים'], ['goals', 'יעדים'], ['reports', 'דוחות'], ['branches', 'סניפים'], ['members', 'חברים'],
  ];
  return keys.map(([k, l]) => tab(href, k, l, ready.includes(k), BUSINESS_SECTIONS[k]));
}

export const VENTURES_MODULES: WorkspaceModule[] = [
  mod('/ventures', 'overview', 'סקירה', true),
  { key: 'real-estate', label: 'נכסים', href: '/ventures/real-estate', ready: true },
  { key: 'investments', label: 'השקעות', href: '/ventures/investments', ready: true },
  { key: 'legal-and-tasks', label: 'משפטי', href: '/ventures/legal-and-tasks', ready: true },
  { key: 'finance', label: 'מימון', href: '/ventures/finance', ready: true },
  mod('/ventures', 'tasks', 'משימות', true),
  mod('/ventures', 'documents', 'מסמכים', true),
  mod('/ventures', 'goals', 'יעדים', true),
];

export const moduleOf = (mods: WorkspaceModule[], key: string) => mods.find(m => m.key === key) ?? null;

// The household's privacy boundary: what the household can see of each member.
export const HOUSEHOLD_SEES = ['ההעברה שכל חבר מעביר לבית: סכום, תאריך וסטטוס', 'הוצאות ותשלומים משותפים', 'יעדי החיסכון של הבית'];
export const HOUSEHOLD_NEVER_SEES = ['ההכנסה הכוללת של כל חבר', 'חשבונות, כרטיסים והוצאות אישיות', 'מסמכים והשקעות מהאזור האישי'];

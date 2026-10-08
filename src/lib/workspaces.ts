import { ENTITIES, LOCATIONS, type Domain } from './places';

// The product's information architecture: USER → WORKSPACES → MEMBERS → MODULES → DATA.
// This stage is UI only: workspaces, members and modules are configuration here, not DB rows,
// and each workspace still reads its data from today's tables through `place` (domain/branch).
// When the workspaces tables arrive, this file becomes the seed for them.
//
//   personal  · "אישי – אביהו"  private, only its owner sees it. Nothing in it is shared.
//   household · "הבית שלנו"      members see each member's *contribution*, never their income.
//   business  · one per business (a-digital, Head Spa Israel and its branches).
//   ventures  · real estate, investments, legal and funding.

export type WorkspaceKind = 'personal' | 'household' | 'business' | 'ventures';
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type WorkspaceMember = { id: string; name: string; role: WorkspaceRole };

// `ready`: the module shows real data today. Otherwise it is a placeholder that says what will be there.
export type WorkspaceModule = { key: string; label: string; href: string; ready: boolean; sections?: string[] };

export type Workspace = {
  id: string; kind: WorkspaceKind; name: string; navLabel: string; href: string;
  visibility: 'private' | 'shared';
  members: WorkspaceMember[];
  modules: WorkspaceModule[];
  place: { domain: Domain; branch: string | null }; // where its data lives in today's tables
  description: string;
};

export const KIND_LABEL: Record<WorkspaceKind, string> = {
  personal: 'אישי', household: 'משק בית', business: 'עסק', ventures: 'יזמות',
};
export const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: 'בעלים', admin: 'מנהל', member: 'חבר', viewer: 'צופה' };

// The people of this account. Names only; logins and roles stay in settings until workspaces are in the DB.
const AVIHU: WorkspaceMember = { id: 'avihu', name: 'אביהו', role: 'owner' };
const EDEN: WorkspaceMember = { id: 'eden', name: 'עדן', role: 'member' };

const mod = (base: string, key: string, label: string, ready: boolean, sections?: string[]): WorkspaceModule =>
  ({ key, label, href: key === 'overview' ? base : `${base}/${key}`, ready, ...(sections ? { sections } : {}) });
const tab = (base: string, key: string, label: string, ready: boolean, sections?: string[]): WorkspaceModule =>
  ({ key, label, href: key === 'overview' ? base : `${base}?tab=${key}`, ready, ...(sections ? { sections } : {}) });

export const PERSONAL: Workspace = {
  id: 'personal', kind: 'personal', name: 'אישי – אביהו', navLabel: 'אישי', href: '/personal',
  visibility: 'private', members: [AVIHU], place: { domain: 'personal', branch: null },
  description: 'הכסף, המשימות והמסמכים שלך. פרטי: אף אחד אחר לא רואה את האזור הזה.',
  modules: [
    mod('/personal', 'overview', 'סקירה', true),
    mod('/personal', 'tasks', 'משימות', true),
    mod('/personal', 'money', 'פיננסים', false, [
      'הכנסות אישיות', 'הוצאות קבועות', 'הוצאות משתנות', 'חשבונות בנק', 'כרטיסי אשראי',
      'הכנסה פסיבית', 'חסכונות', 'מסמכים פיננסיים',
    ]),
    mod('/personal', 'documents', 'מסמכים', false, ['תעודות ומסמכים אישיים', 'חוזים', 'ביטוחים', 'מסמכי מס']),
    mod('/personal', 'goals', 'יעדים', true),
    mod('/personal', 'investments', 'השקעות אישיות', false, ['תיק השקעות', 'פנסיה וקרנות השתלמות', 'קריפטו ונכסים אחרים']),
    mod('/personal', 'info', 'מידע אישי', false, ['פרטים אישיים', 'אנשי קשר חשובים', 'מספרי חשבון ופוליסות']),
  ],
};

export const HOUSEHOLD: Workspace = {
  id: 'household', kind: 'household', name: 'הבית שלנו', navLabel: 'הבית שלנו', href: '/household',
  visibility: 'shared', members: [AVIHU, EDEN], place: { domain: 'personal', branch: null },
  description: 'התקציב המשותף של הבית. כל אחד מחליט כמה הוא מכניס, והבית רואה רק את ההעברה, לא את ההכנסה.',
  modules: [
    mod('/household', 'overview', 'סקירה', true),
    mod('/household', 'tasks', 'משימות', true),
    mod('/household', 'finance', 'פיננסים משותפים', true),
    mod('/household', 'budget', 'תקציב', false),
    mod('/household', 'fixed', 'הוצאות קבועות', false, ['שכירות או משכנתא', 'ארנונה', 'חשמל, מים וגז', 'ביטוחים', 'מנויים', 'גן וחוגים']),
    mod('/household', 'bills', 'חשבונות', false, ['חשבונות לתשלום', 'חשבונות ששולמו', 'הוראות קבע']),
    mod('/household', 'documents', 'מסמכים', false, ['חוזה שכירות', 'פוליסות ביטוח', 'אחריות למוצרים']),
    mod('/household', 'savings', 'יעדי חיסכון', false, ['קרן חירום', 'חופשה', 'רכישות גדולות']),
    mod('/household', 'members', 'חברים', true),
  ],
};

const BUSINESS_SECTIONS: Record<string, string[]> = {
  finance: ['הכנסות והוצאות', 'רווח והפסד', 'מע״מ'],
  documents: ['חוזים', 'חשבוניות וקבלות', 'מסמכי חברה'],
  reports: ['דוח חודשי', 'השוואה לתקופה קודמת', 'ייצוא לרואה חשבון'],
  clients: ['לקוחות פעילים', 'היסטוריית לקוח', 'פלחים'],
  collections: ['יתרות פתוחות', 'באיחור', 'נגבה'],
};

function businessWorkspace(id: string, name: string, href: string, ready: string[]): Workspace {
  const keys: [string, string][] = [
    ['overview', 'סקירה'], ['tasks', 'משימות'], ['clients', 'לקוחות'], ['finance', 'פיננסים'], ['collections', 'גבייה'],
    ['documents', 'מסמכים'], ['goals', 'יעדים'], ['reports', 'דוחות'], ['members', 'חברים'],
  ];
  return {
    id, kind: 'business', name, navLabel: name, href, visibility: 'shared', members: [AVIHU],
    place: { domain: 'business', branch: id },
    description: 'לקוחות, כסף, גבייה ומשימות של העסק.',
    modules: keys.map(([k, l]) => tab(href, k, l, ready.includes(k), BUSINESS_SECTIONS[k])),
  };
}

export const BUSINESSES: Workspace[] = [
  businessWorkspace('adigital', 'a-digital', '/business/adigital', ['overview', 'tasks', 'clients', 'collections', 'goals']),
  businessWorkspace('head-spa-israel', 'Head Spa Israel', '/business/head-spa-israel', ['overview', 'tasks', 'goals']),
];

const ventureEntity = (id: string) => ENTITIES.find(e => e.domain === 'ventures' && e.id === id)!;

export const VENTURES: Workspace = {
  id: 'ventures', kind: 'ventures', name: 'יזמות', navLabel: 'יזמות', href: '/ventures',
  visibility: 'shared', members: [AVIHU], place: { domain: 'ventures', branch: null },
  description: 'נכסים, השקעות, תיקים משפטיים ומימון.',
  modules: [
    mod('/ventures', 'overview', 'סקירה', true),
    { key: 'real-estate', label: ventureEntity('real-estate').label, href: '/ventures/real-estate', ready: true },
    { key: 'investments', label: ventureEntity('investments').label, href: '/ventures/investments', ready: true },
    { key: 'legal-and-tasks', label: ventureEntity('legal-and-tasks').label, href: '/ventures/legal-and-tasks', ready: true },
    { key: 'finance', label: ventureEntity('finance').label, href: '/ventures/finance', ready: true },
    mod('/ventures', 'tasks', 'משימות', true),
    mod('/ventures', 'documents', 'מסמכים', true),
    mod('/ventures', 'goals', 'יעדים', true),
  ],
};

export const WORKSPACES: Workspace[] = [PERSONAL, HOUSEHOLD, VENTURES, ...BUSINESSES];

export const workspace = (id: string) => WORKSPACES.find(w => w.id === id) ?? null;
export const moduleOf = (w: Workspace, key: string) => w.modules.find(m => m.key === key) ?? null;

// Business branches (Head Spa → מודיעין, ירושלים) come from the live location registry
export const branchesOf = (w: Workspace) => (w.kind === 'business' ? LOCATIONS.filter(l => l.entity === w.id) : []);

// The workspace a URL belongs to (for breadcrumbs and the nav). /business alone is the businesses group.
export function workspaceFromPath(path: string): Workspace | null {
  const [, a, b] = path.split('/');
  if (a === 'business') return BUSINESSES.find(w => w.id === b) ?? null;
  return WORKSPACES.find(w => w.href === `/${a}`) ?? null;
}

// Access to a workspace's pages, mapped onto today's place permissions (the household lives in the
// personal domain until it has its own rows, so it follows the personal area's access).
export function workspaceAccessPlace(href: string): { domain: string; branch: string | null; location: string | null } {
  const [, a, b, c] = href.split('/');
  if (a === 'household') return { domain: 'personal', branch: null, location: null };
  return { domain: a, branch: b ?? null, location: c ?? null };
}

// The household's privacy boundary: what the household can see of each member.
export const HOUSEHOLD_SEES = ['ההעברה החודשית שכל חבר הגדיר לבית', 'הוצאות ותשלומים משותפים', 'יעדי החיסכון של הבית'];
export const HOUSEHOLD_NEVER_SEES = ['ההכנסה הכוללת של כל חבר', 'חשבונות, כרטיסים והוצאות אישיות', 'השקעות ומסמכים מהאזור האישי'];

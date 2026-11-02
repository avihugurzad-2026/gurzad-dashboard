// Where things belong: area → entity → branch. Mirrors the DB rows (areas, branches, locations)
// so client components (nav, breadcrumb, quick add) can work without a round trip; the DB's
// foreign keys stay the authority when saving.
//   area   = domain column  (business / personal / ventures)
//   entity = branch column  (adigital, head-spa-israel, real-estate …)
//   branch = location column (modiin, jerusalem)

export type Domain = 'business' | 'personal' | 'ventures' | 'household';
export type Place = { domain: Domain; branch: string | null; location: string | null };

export const AREAS: { id: Domain; label: string; href: string }[] = [
  { id: 'personal', label: 'אישי', href: '/personal' },
  { id: 'household', label: 'הבית שלנו', href: '/household' },
  { id: 'ventures', label: 'יזמות', href: '/ventures' },
  { id: 'business', label: 'עסקים', href: '/business' },
];

// Entities: what a place's `branch` names. Businesses and households are user data (DB `branches` +
// `workspaces`, created from the UI) and fill this registry at runtime (setEntities); the venture
// areas are part of the product's structure (the Ventures workspace's modules).
export type Entity = { domain: Domain; id: string; label: string; short: string; href: string; workspace_id?: string | null };
const VENTURE_AREAS: Entity[] = [
  { domain: 'ventures', id: 'real-estate', label: 'נכסים', short: 'נכסים', href: '/ventures/real-estate' },
  { domain: 'ventures', id: 'investments', label: 'השקעות', short: 'השקעות', href: '/ventures/investments' },
  { domain: 'ventures', id: 'legal-and-tasks', label: 'משפטי', short: 'משפטי', href: '/ventures/legal-and-tasks' },
  { domain: 'ventures', id: 'finance', label: 'מימון', short: 'מימון', href: '/ventures/finance' },
];
export const ENTITIES: Entity[] = [...VENTURE_AREAS];

// A registry row: one business or household, from the DB
export type EntityRow = { domain: 'business' | 'household'; id: string; name: string; workspace_id: string | null; sort: number | null };
let entityKey = '';
export function setEntities(rows: EntityRow[]): void {
  const next = rows
    .filter(r => (r.domain === 'business' || r.domain === 'household') && /^[a-z0-9-]{1,40}$/.test(r.id) && r.name)
    .sort((a, b) => (a.sort ?? 1e9) - (b.sort ?? 1e9) || a.name.localeCompare(b.name))
    .map(r => ({
      domain: r.domain, id: r.id, label: r.name, short: shortName(r.name), workspace_id: r.workspace_id,
      href: r.domain === 'business' ? `/business/${r.id}` : '/household',
    }) as Entity);
  const key = JSON.stringify(next);
  if (key === entityKey) return;
  entityKey = key;
  ENTITIES.splice(0, ENTITIES.length, ...next, ...VENTURE_AREAS);
}
// "Head Spa Israel" → "Head Spa": a short form for "Head Spa · מודיעין"
const shortName = (n: string) => (n.split(' ').length > 2 ? n.split(' ').slice(0, 2).join(' ') : n);

// Branches (locations) are configuration: rows of the DB `locations` table. This module keeps a
// registry seeded with today's rows so it works before the DB is read; the server loads the table
// (src/server/locations.ts, cached ~60s) and calls setLocations, and the client gets the same rows
// through the session context. A new branch = one `locations` row, no code change.
export type LocationRow = {
  domain: string; branch: string; location: string; name_he: string;
  active: boolean; status?: string | null; sort?: number | null;
};
export type LocationEntry = { entity: string; id: string; label: string; status: 'active' | 'setup'; sort: number | null };

export const SEED_LOCATIONS: LocationRow[] = [];

// Live list: setLocations replaces its contents in place, so every importer sees the current rows
export const LOCATIONS: LocationEntry[] = [];
let registryKey = '';

export function setLocations(rows: LocationRow[]): void {
  const next = rows
    .filter(r => /^[a-z0-9-]{1,40}$/.test(r.location) && r.domain === 'business' && r.active && r.name_he)
    .map(r => ({
      entity: r.branch, id: r.location, label: r.name_he, sort: r.sort ?? null,
      // marked as being set up → "בהקמה"; archived (inactive) branches leave the registry
      status: ((r.status ?? 'active') === 'active' ? 'active' : 'setup') as LocationEntry['status'],
    }))
    .sort((a, b) => a.entity.localeCompare(b.entity) || (a.sort ?? 1e9) - (b.sort ?? 1e9) || a.id.localeCompare(b.id));
  const key = JSON.stringify(next);
  if (key === registryKey) return;
  registryKey = key;
  LOCATIONS.splice(0, LOCATIONS.length, ...next);
}
setLocations(SEED_LOCATIONS);

export const locationsOf = (entityId: string) => LOCATIONS.filter(l => l.entity === entityId);

export const CATEGORIES: { id: string; label: string; domain: Domain | null }[] = [
  { id: 'general', label: 'כללי', domain: null },
  { id: 'home', label: 'בית', domain: 'household' },   // the household's own list (DB: categories.domain)
  { id: 'personal', label: 'אישי', domain: 'personal' },
  { id: 'study', label: 'לימודים', domain: 'personal' },
  { id: 'clients', label: 'לקוחות', domain: 'business' },
  { id: 'operations', label: 'תפעול', domain: 'business' },
  { id: 'marketing', label: 'שיווק', domain: 'business' },
  { id: 'finance', label: 'כספים', domain: null },
  { id: 'legal', label: 'משפטי', domain: null },
];

export const PRIORITIES = [
  { value: 1, label: 'P1 · דחוף' }, { value: 2, label: 'P2 · גבוה' },
  { value: 3, label: 'P3 · רגיל' }, { value: 4, label: 'P4 · נמוך' },
] as const;

export const STATUSES = [
  { value: 'todo', label: 'לביצוע' }, { value: 'in_progress', label: 'בעבודה' }, { value: 'waiting', label: 'ממתין למישהו' },
  { value: 'done', label: 'בוצע' }, { value: 'cancelled', label: 'בוטל' },
] as const;
export type Status = (typeof STATUSES)[number]['value'];

export const categoriesFor = (d: Domain) => CATEGORIES.filter(c => c.domain === null || c.domain === d);
export const categoryLabel = (id: string | null) => CATEGORIES.find(c => c.id === id)?.label ?? null;
export const entity = (id: string | null) => ENTITIES.find(e => e.id === id) ?? null;
export const location = (entityId: string | null, id: string | null) => LOCATIONS.find(l => l.entity === entityId && l.id === id) ?? null;
export const area = (id: string) => AREAS.find(a => a.id === id) ?? null;

// Every place a task can be filed under, in menu order, with its encoded value
export function placeOptions(): { value: string; label: string; place: Place }[] {
  const out: { value: string; label: string; place: Place }[] = [];
  const push = (place: Place, label: string) => out.push({ value: encodePlace(place), label, place });
  push({ domain: 'personal', branch: null, location: null }, 'אישי');
  for (const e of ENTITIES.filter(x => x.domain === 'household')) push({ domain: 'household', branch: e.id, location: null }, e.label);
  push({ domain: 'ventures', branch: null, location: null }, 'יזמות');
  for (const e of ENTITIES.filter(x => x.domain === 'ventures')) push({ domain: 'ventures', branch: e.id, location: null }, `יזמות · ${e.label}`);
  for (const e of ENTITIES.filter(x => x.domain === 'business')) {
    push({ domain: 'business', branch: e.id, location: null }, e.label);
    for (const l of LOCATIONS.filter(x => x.entity === e.id)) push({ domain: 'business', branch: e.id, location: l.id }, `${e.short} · ${l.label}`);
  }
  return out;
}

export const encodePlace = (p: Place) => [p.domain, p.branch ?? '', p.location ?? ''].join('|');
export function decodePlace(v: string): Place | null {
  const [domain, branch, location] = v.split('|');
  if (!AREAS.some(a => a.id === domain)) return null;
  return { domain: domain as Domain, branch: branch || null, location: location || null };
}

// "Head Spa · מודיעין", "אישי · בית", "a-digital", "יזמות · נכסים"
export function contextLabel(p: { domain: string; branch: string | null; location: string | null }, category?: string | null): string {
  if (p.domain === 'personal') {
    const c = categoryLabel(category ?? null);
    // "אישי · אישי" reads as one label
    return c && c !== 'כללי' && c !== 'אישי' ? `אישי · ${c}` : 'אישי';
  }
  const e = entity(p.branch);
  if (!e) return area(p.domain)?.label ?? p.domain;
  const l = location(p.branch, p.location);
  if (l) return `${e.short} · ${l.label}`;
  return p.domain === 'ventures' && e.label !== 'יזמות' ? `יזמות · ${e.label}` : e.label;
}

export function hrefFor(p: Place): string {
  if (p.domain === 'personal') return '/personal';
  if (p.domain === 'household') return '/household';
  const e = entity(p.branch);
  if (!e) return area(p.domain)?.href ?? '/';
  return p.location ? `${e.href}/${p.location}` : e.href;
}

// The place a page is about, from its URL. Home and the global pages default to personal.
export function placeFromPath(path: string): Place {
  const [, a, b, c] = path.split('/');
  if (a === 'business' && entity(b)?.domain === 'business') {
    return { domain: 'business', branch: b, location: location(b, c) ? c : null };
  }
  if (a === 'ventures' && entity(b)?.domain === 'ventures') return { domain: 'ventures', branch: b, location: null };
  if (a === 'household') {
    const h = ENTITIES.find(e => e.domain === 'household');
    if (h) return { domain: 'household', branch: h.id, location: null };
  }
  return { domain: 'personal', branch: null, location: null };
}

const PAGE_LABEL: Record<string, string> = {
  today: 'היום', calendar: 'לוח שנה', inbox: 'Inbox', search: 'חיפוש', settings: 'הגדרות', insights: 'סקירה עסקית',
  review: 'סקירה שבועית', scorecard: 'מדדים שבועיים', health: 'שלמות נתונים', reports: 'דוחות', documents: 'מסמכים',
  tasks: 'משימות', finance: 'כספים', goals: 'יעדים',
};
// Module pages inside a workspace (/personal/money, /household/budget …); see src/lib/workspaces.ts
const MODULE_LABEL: Record<string, Record<string, string>> = {
  personal: { tasks: 'משימות', money: 'פיננסים', documents: 'מסמכים', goals: 'יעדים', investments: 'השקעות אישיות', info: 'מידע אישי' },
  household: {
    tasks: 'משימות', finance: 'פיננסים משותפים', budget: 'תקציב', fixed: 'הוצאות קבועות', bills: 'חשבונות',
    documents: 'מסמכים', savings: 'יעדי חיסכון', members: 'חברים',
  },
  ventures: { tasks: 'משימות', documents: 'מסמכים', goals: 'יעדים' },
};
export const TAB_LABEL: Record<string, string> = {
  overview: 'סקירה', tasks: 'משימות', goals: 'יעדים', clients: 'לקוחות', collections: 'גבייה',
  finance: 'פיננסים', documents: 'מסמכים', reports: 'דוחות', members: 'חברים',
  home: 'בית', personal: 'אישי', study: 'לימודים',
  sales: 'מכירות', bookings: 'טיפולים והזמנות', customers: 'לקוחות', staff: 'צוות',
};

// "עסקים / Head Spa Israel / מודיעין / משימות"
export function crumbs(path: string, tab: string | null): { label: string; href: string | null }[] {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const out: { label: string; href: string | null }[] = [];
  const [a, b, c] = parts;
  const hh = a === 'household' ? ENTITIES.find(e => e.domain === 'household') : null;
  const ar0 = AREAS.find(x => x.href === `/${a}`);
  const ar = ar0 && hh ? { ...ar0, label: hh.label } : ar0;
  if (ar) {
    out.push({ label: ar.label, href: ar.href });
    const e = entity(b);
    if (e && e.domain === ar.id) {
      out.push({ label: e.label, href: e.href });
      const l = location(b, c);
      if (l) out.push({ label: l.label, href: `${e.href}/${l.id}` });
    } else if (b && (MODULE_LABEL[ar.id]?.[b] ?? PAGE_LABEL[b])) {
      out.push({ label: MODULE_LABEL[ar.id]?.[b] ?? PAGE_LABEL[b], href: `/${a}/${b}` });
    }
  } else if (PAGE_LABEL[a]) {
    out.push({ label: PAGE_LABEL[a], href: `/${a}` });
  }
  if (tab && TAB_LABEL[tab] && tab !== 'overview' && tab !== 'all') out.push({ label: TAB_LABEL[tab], href: null });
  return out; // the last crumb is rendered as plain text by <Breadcrumb>
}

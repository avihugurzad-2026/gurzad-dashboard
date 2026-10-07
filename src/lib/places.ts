// Where things belong: area → entity → branch. Mirrors the DB rows (areas, branches, locations)
// so client components (nav, breadcrumb, quick add) can work without a round trip; the DB's
// foreign keys stay the authority when saving.
//   area   = domain column  (business / personal / ventures)
//   entity = branch column  (adigital, head-spa-israel, real-estate …)
//   branch = location column (modiin, jerusalem)

export type Domain = 'business' | 'personal' | 'ventures';
export type Place = { domain: Domain; branch: string | null; location: string | null };

export const AREAS: { id: Domain; label: string; href: string }[] = [
  { id: 'personal', label: 'אישי', href: '/personal' },
  { id: 'ventures', label: 'יזמות', href: '/ventures' },
  { id: 'business', label: 'עסקים', href: '/business' },
];

export const ENTITIES: { domain: Domain; id: string; label: string; short: string; href: string }[] = [
  { domain: 'business', id: 'adigital', label: 'a-digital', short: 'a-digital', href: '/business/adigital' },
  { domain: 'business', id: 'head-spa-israel', label: 'Head Spa Israel', short: 'Head Spa', href: '/business/head-spa-israel' },
  { domain: 'ventures', id: 'real-estate', label: 'נכסים', short: 'נכסים', href: '/ventures/real-estate' },
  { domain: 'ventures', id: 'investments', label: 'השקעות', short: 'השקעות', href: '/ventures/investments' },
  { domain: 'ventures', id: 'legal-and-tasks', label: 'משפטי', short: 'משפטי', href: '/ventures/legal-and-tasks' },
  { domain: 'ventures', id: 'finance', label: 'פיננסים', short: 'פיננסים', href: '/ventures/finance' },
];

export const LOCATIONS: { entity: string; id: string; label: string; status: 'active' | 'setup' }[] = [
  { entity: 'head-spa-israel', id: 'modiin', label: 'מודיעין', status: 'active' },
  { entity: 'head-spa-israel', id: 'jerusalem', label: 'ירושלים', status: 'setup' },
];

export const CATEGORIES: { id: string; label: string; domain: Domain | null }[] = [
  { id: 'general', label: 'כללי', domain: null },
  { id: 'home', label: 'בית', domain: 'personal' },
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
    return c && c !== 'כללי' ? `אישי · ${c}` : 'אישי';
  }
  const e = entity(p.branch);
  if (!e) return area(p.domain)?.label ?? p.domain;
  const l = location(p.branch, p.location);
  if (l) return `${e.short} · ${l.label}`;
  return p.domain === 'ventures' ? `יזמות · ${e.label}` : e.label;
}

export function hrefFor(p: Place): string {
  if (p.domain === 'personal') return '/personal';
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
  return { domain: 'personal', branch: null, location: null };
}

const PAGE_LABEL: Record<string, string> = {
  today: 'היום', calendar: 'לוח שנה', inbox: 'Inbox', search: 'חיפוש', settings: 'הגדרות', insights: 'סקירה עסקית',
  review: 'סקירה שבועית', scorecard: 'מדדים שבועיים', health: 'שלמות נתונים', reports: 'דוחות', documents: 'מסמכים',
  tasks: 'משימות', finance: 'כספים משותפים', goals: 'יעדים',
};
export const TAB_LABEL: Record<string, string> = {
  overview: 'סקירה', tasks: 'משימות', goals: 'יעדים', clients: 'לקוחות', collections: 'גבייה',
  home: 'בית', personal: 'אישי', study: 'לימודים',
};

// "עסקים / Head Spa Israel / מודיעין / משימות"
export function crumbs(path: string, tab: string | null): { label: string; href: string | null }[] {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const out: { label: string; href: string | null }[] = [];
  const [a, b, c] = parts;
  const ar = AREAS.find(x => x.href === `/${a}`);
  if (ar) {
    out.push({ label: ar.label, href: ar.href });
    const e = entity(b);
    if (e && e.domain === ar.id) {
      out.push({ label: e.label, href: e.href });
      const l = location(b, c);
      if (l) out.push({ label: l.label, href: `${e.href}/${l.id}` });
    } else if (b && PAGE_LABEL[b]) {
      out.push({ label: ar.id === 'personal' && b === 'goals' ? 'יעדים פיננסיים' : PAGE_LABEL[b], href: `/${a}/${b}` });
    }
  } else if (PAGE_LABEL[a]) {
    out.push({ label: PAGE_LABEL[a], href: `/${a}` });
  }
  if (tab && TAB_LABEL[tab] && tab !== 'overview' && tab !== 'all') out.push({ label: TAB_LABEL[tab], href: null });
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], href: null };
  return out;
}

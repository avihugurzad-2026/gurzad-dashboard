import { canSeePlace, type SessionUser } from '@/server/auth';
import { encodePlace } from '@/lib/places';
import { moduleOf, type Workspace } from '@/lib/workspaces';
import { ModulePlaceholder } from './workspace-ui';
import { WorkspaceDocuments } from './workspace-documents';

// The business modules that have no page of their own yet: documents (real, scoped to the business)
// and placeholders that point to where the data lives today.
export function BusinessModule({ ws, tab, u }: { ws: Workspace; tab: string; u: SessionUser }) {
  const place = { domain: 'business' as const, branch: ws.id, location: null };
  const m = moduleOf(ws, tab);
  if (!m) return null;
  if (tab === 'documents') return <WorkspaceDocuments u={u} place={place} path={ws.href} title={`מסמכי ${ws.name}`} />;
  const money = canSeePlace(u, place, 'money');
  const finance = money ? { href: `/finance?place=${encodeURIComponent(encodePlace(place))}`, label: 'לתנועות של העסק' } : undefined;
  const notes: Record<string, { note?: string; action?: { href: string; label: string } }> = {
    finance: { note: 'הכנסות, הוצאות ורווח של העסק יוצגו כאן. בינתיים התנועות נמצאות במרכז הכספים, מסוננות לעסק הזה.', action: finance },
    reports: { note: 'דוחות חודשיים והשוואות לתקופה קודמת יוצגו כאן, אחרי שמסד הנתונים של האזורים ייבנה.' },
    members: { note: 'כרגע הצוות וההרשאות מנוהלים בהגדרות. בהמשך כל עסק יקבל את רשימת החברים שלו כאן.', action: u.isAdmin ? { href: '/settings#users', label: 'לניהול משתמשים' } : undefined },
    clients: { note: 'רשימת הלקוחות של העסק תוצג כאן.' },
    collections: { note: 'יתרות פתוחות וגבייה של העסק יוצגו כאן.', action: finance },
  };
  return <ModulePlaceholder ws={ws} module={m} note={notes[tab]?.note} action={notes[tab]?.action} />;
}

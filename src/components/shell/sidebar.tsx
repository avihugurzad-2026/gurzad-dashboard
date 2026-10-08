'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, Bell, Briefcase, Building2, CalendarDays, CalendarClock, ChartColumn, ChevronDown, ClipboardCheck, FileText, Gauge, History,
  House, Inbox, ListChecks, MapPin, Rocket, Search, Settings, Sparkles, Target, User, UserRound, Wallet } from 'lucide-react';
import { NAV_BOTTOM, NAV_HUBS, NAV_TOOLS, NAV_TOP, navAreas, type NavItem } from './nav';
import { useSession } from './session-context';
import { badgeClass } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ICONS = {
  home: House, today: CalendarClock, calendar: CalendarDays, inbox: Inbox, personal: UserRound, ventures: Rocket, business: Building2,
  agency: Briefcase, spa: Sparkles, branch: MapPin, chart: ChartColumn, review: ClipboardCheck, scorecard: Gauge, health: Activity,
  search: Search, bell: Bell, settings: Settings, profile: User, money: Wallet, goal: Target, document: FileText, history: History,
  tasks: ListChecks,
} as const;

export type Counts = { inbox: number; alerts: number };

function isActive(item: NavItem, path: string): boolean {
  const href = item.href.split('#')[0];
  if (href === '/') return path === '/';
  if (href === '/tasks') return path === '/tasks' || path.startsWith('/personal/tasks');
  if (item.href.includes('#')) return false;
  // A parent is "active" only on its own page; its children light up for theirs
  return path === href || (!item.children && path.startsWith(`${href}/`));
}

// Collapsed rail: every icon gets a real tooltip (drawn in a portal, so the scrolling rail can't clip it)
function useTooltip() {
  const [tip, setTip] = useState<{ text: string; top: number; right: number } | null>(null);
  const show = (text: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ text, top: r.top + r.height / 2, right: window.innerWidth - r.left + 8 });
  };
  const node = tip && typeof document !== 'undefined' ? createPortal(
    <div role="tooltip" style={{ top: tip.top, right: tip.right }}
      className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-sm font-medium text-surface shadow-lg">
      <bdi>{tip.text}</bdi>
    </div>, document.body) : null;
  return { show, hide: () => setTip(null), node };
}

type Rest = { path: string; collapsed: boolean; counts: Counts; onNavigate?: () => void; tip: ReturnType<typeof useTooltip> };

function NavLink({ item, depth, path, collapsed, counts, onNavigate, tip }: { item: NavItem; depth: number } & Rest) {
  const Icon = ICONS[item.icon as keyof typeof ICONS];
  const active = isActive(item, path);
  const n = item.count ? counts[item.count] : 0;
  const label = item.tag ? `${item.label} · ${item.tag}` : item.label;
  return (
    <Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} aria-label={collapsed ? label : undefined}
      onMouseEnter={collapsed ? tip.show(label) : undefined} onMouseLeave={collapsed ? tip.hide : undefined}
      onFocus={collapsed ? tip.show(label) : undefined} onBlur={collapsed ? tip.hide : undefined}
      className={cn('relative flex items-center gap-2.5 rounded-lg text-nav font-medium transition-colors',
        collapsed ? 'size-10 justify-center' : 'min-h-9 px-3 py-2',
        !collapsed && depth === 2 && 'min-h-8 py-1.5 text-sm',
        active ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
      <span className="relative flex">
        <Icon className={cn('shrink-0', depth === 0 ? 'size-[18px]' : 'size-4', !active && depth > 0 && 'text-muted')} aria-hidden />
        {collapsed && n > 0 && <span className="absolute -end-1.5 -top-1.5 size-2 rounded-full bg-critical" aria-hidden />}
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate"><bdi>{item.label}</bdi></span>}
      {!collapsed && item.tag && <span className={badgeClass('warning', 'h-5 px-2 text-xs')}>{item.tag}</span>}
      {!collapsed && n > 0 && <span className="min-w-6 rounded-full bg-surface-2 px-1.5 text-center text-xs text-ink-2 tabular" aria-label={`${n} פריטים`}>{n}</span>}
    </Link>
  );
}

// Nested levels sit under their parent with a guide line, each level further in
function Tree({ items, depth = 0, ...rest }: { items: NavItem[]; depth?: number } & Rest) {
  return (
    <ul className={cn('flex flex-col gap-0.5', depth > 0 && !rest.collapsed && 'ms-[1.1rem] mt-0.5 border-s border-line ps-1.5')}>
      {items.map(item => (
        <li key={item.href}>
          <NavLink item={item} depth={depth} {...rest} />
          {item.children && item.children.length > 0 && !rest.collapsed && <Tree items={item.children} depth={depth + 1} {...rest} />}
        </li>
      ))}
    </ul>
  );
}

function Heading({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="mx-auto mb-2 h-px w-6 bg-line" aria-hidden />;
  return <p className="mb-1.5 px-3 text-xs font-semibold text-muted">{children}</p>;
}

// Only the links this user may open (the pages check again on the server)
function allowedOnly(items: NavItem[], hrefs: Set<string> | null): NavItem[] {
  if (!hrefs) return items;
  return items.filter(i => hrefs.has(i.href)).map(i => (i.children ? { ...i, children: allowedOnly(i.children, hrefs) } : i));
}

export function SidebarNav({ collapsed = false, counts, onNavigate }: { collapsed?: boolean; counts: Counts; onNavigate?: () => void }) {
  const path = usePathname();
  const session = useSession();
  const tip = useTooltip();
  const hrefs = session ? new Set(session.hrefs) : null;
  const top = allowedOnly(NAV_TOP, hrefs), hubs = allowedOnly(NAV_HUBS, hrefs);
  const areas = allowedOnly(navAreas(), hrefs), tools = allowedOnly(NAV_TOOLS, hrefs);
  const [showTools, setTools] = useState(NAV_TOOLS.some(t => path.startsWith(t.href)));
  const props = { path, collapsed, counts, onNavigate, tip };
  return (
    <nav aria-label="ניווט ראשי" className="flex flex-1 flex-col gap-6">
      <div><Heading collapsed={collapsed}>כללי</Heading><Tree items={top} {...props} /></div>
      {hubs.length > 0 && <div><Heading collapsed={collapsed}>מרכזים</Heading><Tree items={hubs} {...props} /></div>}
      {areas.length > 0 && <div><Heading collapsed={collapsed}>אזורים</Heading><Tree items={areas} {...props} /></div>}
      {tools.length > 0 && (
        <div>
          {collapsed ? <Heading collapsed>כלים</Heading> : (
            <button type="button" onClick={() => setTools(t => !t)} aria-expanded={showTools}
              className="mb-1.5 flex w-full items-center justify-between rounded-md px-3 text-xs font-semibold text-muted hover:text-ink">
              כלים<ChevronDown className={cn('size-4 transition-transform', showTools && 'rotate-180')} aria-hidden />
            </button>
          )}
          {(showTools || collapsed) && <Tree items={tools} {...props} />}
        </div>
      )}
      <div className="mt-auto border-t border-line pt-4">
        <Tree items={allowedOnly(NAV_BOTTOM, hrefs)} {...props} />
      </div>
      {tip.node}
    </nav>
  );
}

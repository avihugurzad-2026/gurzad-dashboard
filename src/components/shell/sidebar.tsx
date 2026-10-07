'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, Bell, Briefcase, Building2, CalendarDays, CalendarClock, ChartColumn, ChevronDown, ClipboardCheck, Gauge, House, Inbox,
  MapPin, Rocket, Search, Settings, Sparkles, User, UserRound,
} from 'lucide-react';
import { NAV_AREAS, NAV_BOTTOM, NAV_TOOLS, NAV_TOP, type NavItem } from './nav';
import { cn } from '@/lib/utils';

const ICONS = {
  home: House, today: CalendarClock, calendar: CalendarDays, inbox: Inbox, personal: UserRound, ventures: Rocket, business: Building2,
  agency: Briefcase, spa: Sparkles, branch: MapPin, chart: ChartColumn, review: ClipboardCheck, scorecard: Gauge, health: Activity,
  search: Search, bell: Bell, settings: Settings, profile: User,
} as const;

export type Counts = { inbox: number; alerts: number };

function isActive(item: NavItem, path: string): boolean {
  const href = item.href.split('#')[0];
  if (href === '/') return path === '/';
  if (item.href.includes('#')) return false;
  // A parent is "active" only on its own page; its children light up for theirs
  return path === href || (!item.children && path.startsWith(`${href}/`));
}

function NavLink({ item, path, depth, collapsed, counts, onNavigate }: {
  item: NavItem; path: string; depth: number; collapsed: boolean; counts: Counts; onNavigate?: () => void;
}) {
  const Icon = ICONS[item.icon as keyof typeof ICONS];
  const active = isActive(item, path);
  const n = item.count ? counts[item.count] : 0;
  return (
    <Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={collapsed ? item.label : undefined}
      className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
        !collapsed && depth === 1 && 'ps-8 py-1.5', !collapsed && depth === 2 && 'ps-12 py-1.5', collapsed && 'justify-center px-0',
        active ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
      <span className="relative">
        <Icon className={cn('shrink-0', depth ? 'size-3.5' : 'size-4')} aria-hidden />
        {collapsed && n > 0 && <span className="absolute -end-1.5 -top-1.5 size-2 rounded-full bg-critical" aria-hidden />}
      </span>
      {!collapsed && <span className="flex-1 truncate"><bdi>{item.label}</bdi></span>}
      {!collapsed && item.tag && <span className="rounded-full bg-warning-soft px-1.5 text-[10px] text-warning-ink">{item.tag}</span>}
      {!collapsed && n > 0 && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-ink-2 tabular" aria-label={`${n} פריטים`}>{n}</span>}
    </Link>
  );
}

function Tree({ items, depth = 0, ...rest }: { items: NavItem[]; depth?: number; path: string; collapsed: boolean; counts: Counts; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map(item => (
        <li key={item.href}>
          <NavLink item={item} depth={depth} {...rest} />
          {item.children && !rest.collapsed && <Tree items={item.children} depth={depth + 1} {...rest} />}
        </li>
      ))}
    </ul>
  );
}

export function SidebarNav({ collapsed = false, counts, onNavigate }: { collapsed?: boolean; counts: Counts; onNavigate?: () => void }) {
  const path = usePathname();
  const [tools, setTools] = useState(NAV_TOOLS.some(t => path.startsWith(t.href)));
  const props = { path, collapsed, counts, onNavigate };
  return (
    <nav aria-label="ניווט ראשי" className="flex flex-1 flex-col gap-5">
      <Tree items={NAV_TOP} {...props} />
      <div>
        {!collapsed && <p className="mb-1 px-3 text-xs font-medium text-muted">אזורים</p>}
        <Tree items={NAV_AREAS} {...props} />
      </div>
      <div>
        {!collapsed && (
          <button type="button" onClick={() => setTools(t => !t)} aria-expanded={tools}
            className="mb-1 flex w-full items-center justify-between px-3 text-xs font-medium text-muted hover:text-ink">
            כלים<ChevronDown className={cn('size-3.5 transition-transform', tools && 'rotate-180')} aria-hidden />
          </button>
        )}
        {(tools || collapsed) && <Tree items={NAV_TOOLS} {...props} />}
      </div>
      <div className="mt-auto border-t border-line pt-3">
        <Tree items={NAV_BOTTOM} {...props} />
      </div>
    </nav>
  );
}

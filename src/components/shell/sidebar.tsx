'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Briefcase, Building2, CalendarDays, ChartColumn, ClipboardCheck, FileText, Landmark, LayoutDashboard, ListChecks, MapPin, Scale, Settings, Sparkles, Target, TrendingUp, Wallet } from 'lucide-react';
import { NAV, type NavItem } from './nav';
import { cn } from '@/lib/utils';

const ICONS = {
  dashboard: LayoutDashboard, tasks: ListChecks, calendar: CalendarDays, finance: Wallet, documents: FileText,
  chart: ChartColumn, spa: Sparkles, review: ClipboardCheck, goals: Target, health: Activity, settings: Settings,
  agency: Briefcase, branch: MapPin, property: Building2, invest: TrendingUp, legal: Scale, bank: Landmark,
} as const;

function NavLink({ item, active, nested, onNavigate }: { item: NavItem; active: boolean; nested?: boolean; onNavigate?: () => void }) {
  const Icon = ICONS[item.icon as keyof typeof ICONS];
  return (
    <Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined}
      className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors', nested && 'ps-9 py-1.5',
        active ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
      <Icon className={cn('shrink-0', nested ? 'size-3.5' : 'size-4')} aria-hidden />
      <span className="flex-1">{item.label}</span>
      {item.soon && <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-muted">בקרוב</span>}
    </Link>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="ניווט ראשי" className="flex flex-col gap-5">
      {NAV.map(section => (
        <div key={section.group}>
          <p className="mb-1 px-3 text-xs font-medium text-muted">{section.group}</p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map(item => {
              const exact = item.href === '/' ? path === '/' : path === item.href || (!item.children && path.startsWith(item.href + '/'));
              return (
                <li key={item.href}>
                  <NavLink item={item} active={exact} onNavigate={onNavigate} />
                  {item.children && (
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                      {item.children.map(c => (
                        <li key={c.href}><NavLink item={c} nested active={path.startsWith(c.href)} onNavigate={onNavigate} /></li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

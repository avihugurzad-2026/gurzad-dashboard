'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, CalendarDays, ChartColumn, ClipboardCheck, FileText, LayoutDashboard, ListChecks, Settings, Sparkles, Target, Wallet } from 'lucide-react';
import { NAV } from './nav';
import { cn } from '@/lib/utils';

const ICONS = {
  dashboard: LayoutDashboard, tasks: ListChecks, calendar: CalendarDays, finance: Wallet, documents: FileText,
  reports: ChartColumn, spa: Sparkles, review: ClipboardCheck, goals: Target, health: Activity, settings: Settings,
} as const;

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="ניווט ראשי" className="flex flex-col gap-5">
      {NAV.map(section => (
        <div key={section.group}>
          <p className="mb-1 px-3 text-xs font-medium text-muted">{section.group}</p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map(item => {
              const Icon = ICONS[item.icon as keyof typeof ICONS];
              const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined}
                    className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      active ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {item.soon && <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-muted">בקרוב</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

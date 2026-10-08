'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { SidebarNav, type Counts } from './sidebar';
import { NewButton } from './new-button';
import { cn } from '@/lib/utils';
import { ThemeToggle, PrivacyToggle, LogoutButton } from './toggles';
import { buttonClass } from '@/components/ui/button';
import { SessionProvider, type ClientSession } from './session-context';
import { CommandPalette, openCommandPalette } from '@/components/search/command-palette';
import { Command, Search } from 'lucide-react';

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className={cn('flex items-center gap-2', compact ? 'justify-center' : 'px-3')}>
      <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm font-bold text-white">ג</span>
      {!compact && <span className="text-card font-bold text-ink">גורזד</span>}
    </Link>
  );
}

export function AppShell({ counts, session, children }: { counts: Counts; session: ClientSession; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => { try { setCollapsed(localStorage.getItem('sidebar') === 'collapsed'); } catch { /* private mode */ } }, []);
  const toggle = () => setCollapsed(c => {
    try { localStorage.setItem('sidebar', c ? 'open' : 'collapsed'); } catch { /* private mode */ }
    return !c;
  });

  return (
    <SessionProvider value={session}>
    <div className={cn('min-h-dvh lg:grid', collapsed ? 'lg:grid-cols-[72px_1fr]' : 'lg:grid-cols-[272px_1fr]')}>
      {/* Desktop sidebar (inline-start = right in RTL), collapsible to icons */}
      <aside className={cn('sticky top-0 hidden h-dvh flex-col gap-5 overflow-y-auto border-e border-line bg-surface py-5 lg:flex', collapsed ? 'px-2' : 'px-3')}>
        <div className={cn('flex items-center', collapsed ? 'flex-col gap-3' : 'justify-between')}>
          <Brand compact={collapsed} />
          <button type="button" onClick={toggle} className={buttonClass('ghost', 'icon')}
            aria-label={collapsed ? 'הרחבת התפריט' : 'כיווץ התפריט'} aria-expanded={!collapsed}>
            {collapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
          </button>
        </div>
        <SidebarNav collapsed={collapsed} counts={counts} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="תפריט">
          <button className="absolute inset-0 bg-black/40" aria-label="סגירת התפריט" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto bg-surface px-3 py-5">
            <div className="flex items-center justify-between">
              <Brand />
              <button className={buttonClass('ghost', 'icon')} aria-label="סגירה" onClick={() => setOpen(false)}><X /></button>
            </div>
            <SidebarNav counts={counts} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-1.5 border-b sm:gap-2 border-line bg-page/90 px-4 backdrop-blur sm:px-6 lg:px-10">
          <button className={buttonClass('ghost', 'icon', 'lg:hidden')} aria-label="פתיחת התפריט" onClick={() => setOpen(true)}>
            <Menu />
          </button>
          <div className="lg:hidden"><Brand compact /></div>
          <div className="flex-1" />
          <button type="button" onClick={() => openCommandPalette()} aria-label="חיפוש (⌘K)" aria-keyshortcuts="Meta+K Control+K"
            className={buttonClass('secondary', 'md', 'max-sm:w-9 max-sm:px-0 text-muted sm:min-w-56 sm:justify-start')}>
            <Search aria-hidden /><span className="hidden flex-1 text-start sm:inline">חיפוש</span>
            <kbd className="hidden items-center gap-0.5 rounded-md border border-line bg-surface-2 px-1.5 text-xs text-muted sm:inline-flex" dir="ltr"><Command className="!size-3" aria-hidden />K</kbd>
          </button>
          <NewButton />
          <PrivacyToggle />
          <ThemeToggle />
          <LogoutButton />
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-8">
          {children}
        </main>
      </div>
      <CommandPalette />
    </div>
    </SessionProvider>
  );
}

'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Menu, X } from 'lucide-react';
import { SidebarNav } from './sidebar';
import { ThemeToggle, PrivacyToggle, LogoutButton } from './toggles';
import { buttonClass } from '@/components/ui/button';

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-3">
      <span className="grid size-7 place-items-center rounded-lg bg-accent text-sm font-bold text-white">ג</span>
      <span className="font-semibold">גורזד</span>
    </Link>
  );
}

export function AppShell({ alertCount, children }: { alertCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      {/* Desktop sidebar (inline-start = right in RTL) */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-e border-line bg-surface px-3 py-5 lg:flex">
        <Brand />
        <SidebarNav />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="תפריט">
          <button className="absolute inset-0 bg-black/40" aria-label="סגירת התפריט" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto bg-surface px-3 py-5">
            <div className="flex items-center justify-between">
              <Brand />
              <button className={buttonClass('ghost', 'icon')} aria-label="סגירה" onClick={() => setOpen(false)}><X className="size-5" /></button>
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-page/85 px-4 backdrop-blur lg:px-8">
          <button className={buttonClass('ghost', 'icon', 'lg:hidden')} aria-label="פתיחת התפריט" onClick={() => setOpen(true)}>
            <Menu className="size-5" />
          </button>
          <div className="lg:hidden"><Brand /></div>
          <div className="flex-1" />
          <Link href="/health#alerts" className={buttonClass('ghost', 'icon', 'relative')} aria-label={`התראות פתוחות: ${alertCount}`}>
            <Bell className="size-[18px]" />
            {alertCount > 0 && (
              <span className="absolute end-1 top-1 grid min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-4 text-white">{alertCount}</span>
            )}
          </Link>
          <PrivacyToggle />
          <ThemeToggle />
          <LogoutButton />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

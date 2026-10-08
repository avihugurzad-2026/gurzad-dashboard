'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, LogOut, Moon, Sun } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private mode */ }
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);
  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    write('theme', next);
    setDark(!dark);
  };
  return (
    <button className={buttonClass('ghost', 'icon')} onClick={toggle} aria-label={dark ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}>
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

export function PrivacyToggle() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(document.documentElement.dataset.private === '1'), []);
  const toggle = () => {
    const next = !hidden;
    if (next) document.documentElement.dataset.private = '1'; else delete document.documentElement.dataset.private;
    write('private', next ? '1' : null);
    window.dispatchEvent(new Event('dashboard:privacy'));
    setHidden(next);
  };
  return (
    <button className={buttonClass('ghost', 'icon')} onClick={toggle} aria-pressed={hidden} aria-label={hidden ? 'הצגת סכומים' : 'הסתרת סכומים'}>
      {hidden ? <EyeOff /> : <Eye />}
    </button>
  );
}

export function LogoutButton() {
  const router = useRouter();
  const logout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    router.replace('/login');
  };
  return (
    <button className={buttonClass('ghost', 'icon')} onClick={logout} aria-label="יציאה">
      <LogOut className="rtl:-scale-x-100" />
    </button>
  );
}

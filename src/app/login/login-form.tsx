'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'הכניסה נכשלה'); return; }
      router.replace('/');
    } catch {
      setError('אין חיבור לשרת');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="em" className="text-sm font-medium">אימייל <span className="font-normal text-muted">(למי שהוזמן; בעלים: השאר ריק)</span></label>
          <input id="em" type="email" dir="ltr" autoComplete="username"
            value={email} onChange={e => setEmail(e.target.value)}
            className="h-10 rounded-lg border border-line-strong bg-surface px-3 text-ink" />
          <label htmlFor="pw" className="text-sm font-medium">סיסמה</label>
          <input id="pw" type="password" autoComplete="current-password" autoFocus required
            value={password} onChange={e => setPassword(e.target.value)}
            className="h-10 rounded-lg border border-line-strong bg-surface px-3 text-ink" />
          {error && <p role="alert" className="text-sm text-critical-ink">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy || !password} className="mt-1 h-10">
            <LogIn className="size-4 rtl:-scale-x-100" aria-hidden />
            {busy ? 'מתחבר…' : 'כניסה'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

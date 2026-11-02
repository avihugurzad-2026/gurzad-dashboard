'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { inputClass, labelClass } from '@/components/work/fields';

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
      <CardContent className="pt-5 sm:pt-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
          <label htmlFor="em" className={labelClass}>אימייל</label>
          <input id="em" type="email" dir="ltr" autoComplete="username"
            value={email} onChange={e => setEmail(e.target.value)}
            aria-describedby="em-hint" className={inputClass} />
          <p id="em-hint" className="text-xs text-muted">למי שהוזמן. בעלים: השאר ריק.</p>
          </div>
          <div className="flex flex-col gap-1.5">
          <label htmlFor="pw" className={labelClass}>סיסמה</label>
          <input id="pw" type="password" autoComplete="current-password" autoFocus required
            value={password} onChange={e => setPassword(e.target.value)}
            className={inputClass} />
          </div>
          {error && <p role="alert" className="text-sm text-critical-ink">{error}</p>}
          <Button type="submit" variant="primary" size="lg" disabled={busy || !password} className="mt-1 w-full">
            <LogIn className="rtl:-scale-x-100" aria-hidden />
            {busy ? 'מתחבר…' : 'כניסה'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

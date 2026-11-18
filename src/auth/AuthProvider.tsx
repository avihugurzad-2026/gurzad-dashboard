import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEMO, DEMO_OTP } from '../lib/config';
import { supabase } from '../lib/supabase';
import { ls } from '../lib/safeStorage';

type User = { id: string; email: string; name: string; avatar?: string };
type Ctx = {
  user: User | null;
  loading: boolean;
  sendCode: (email: string) => Promise<void>;
  verify: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);
const DEMO_KEY = 'gurzad-v3-session';

const nameFrom = (email: string) => email.split('@')[0];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (DEMO) {
      const raw = ls.get(DEMO_KEY);
      if (raw) { try { setUser(JSON.parse(raw)); } catch { /* ignore */ } }
      setLoading(false);
      return;
    }
    supabase!.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      setUser(u ? { id: u.id, email: u.email!, name: (u.user_metadata?.name as string) || nameFrom(u.email!), avatar: (u.user_metadata?.avatar as string) || undefined } : null);
      setLoading(false);
    });
    const { data: sub } = supabase!.auth.onAuthStateChange((_e, s) => {
      const u = s?.user;
      setUser(u ? { id: u.id, email: u.email!, name: (u.user_metadata?.name as string) || nameFrom(u.email!), avatar: (u.user_metadata?.avatar as string) || undefined } : null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: Ctx = {
    user,
    loading,
    async sendCode(email) {
      if (DEMO) { await wait(500); return; }
      await post('/api/auth/send-otp', { email }); // code is emailed through Resend
    },
    async verify(email, code) {
      if (DEMO) {
        await wait(450);
        if (code !== DEMO_OTP) throw new Error('הקוד לא נכון');
        const u = { id: 'demo', email, name: 'אביהו' };
        ls.set(DEMO_KEY, JSON.stringify(u));
        setUser(u);
        return;
      }
      const { token_hash } = await post('/api/auth/verify-otp', { email, code });
      const { error } = await supabase!.auth.verifyOtp({ token_hash, type: 'magiclink' });
      if (error) throw new Error('ההתחברות נכשלה. בקש קוד חדש.');
    },
    async signOut() {
      if (DEMO) { ls.del(DEMO_KEY); setUser(null); return; }
      await supabase!.auth.signOut();
    },
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'משהו השתבש. נסה שוב.');
  return j;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

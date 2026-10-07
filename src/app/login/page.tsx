import { redirect } from 'next/navigation';
import { isAuthed } from '@/server/auth';
import { LoginForm } from './login-form';

export const metadata = { title: 'כניסה — דשבורד גורזד' };

export default async function LoginPage() {
  if (await isAuthed()) redirect('/');
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-accent font-bold text-white">ג</span>
          <span className="text-lg font-semibold">דשבורד גורזד</span>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}

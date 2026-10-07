'use client';
import { useActionState } from 'react';
import { LogIn } from 'lucide-react';
import { acceptInvite } from '@/app/user-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/work/fields';

export function AcceptForm({ token, email, name, role, place, needsCurrent, minPassword }: {
  token: string; email: string; name: string | null; role: string; place: string; needsCurrent: boolean; minPassword: number;
}) {
  const [state, action, busy] = useActionState(acceptInvite, null);
  return (
    <Card>
      <CardContent className="pt-5">
        <form action={action} className="flex flex-col gap-3 text-sm">
          <input type="hidden" name="token" value={token} />
          <p>הוזמנת כ<strong>{role}</strong> ל<strong><bdi dir="rtl">{place}</bdi></strong>.</p>
          <p className="text-muted">הכניסה תהיה עם <bdi dir="ltr">{email}</bdi></p>
          <label className="flex flex-col gap-1 font-medium">שם
            <input name="name" required minLength={2} maxLength={60} defaultValue={name ?? ''} autoComplete="name" className={inputClass} />
          </label>
          {needsCurrent ? (
            <label className="flex flex-col gap-1 font-medium">הסיסמה הנוכחית שלך
              <input name="current_password" type="password" required autoComplete="current-password" className={inputClass} />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1 font-medium">סיסמה (לפחות {minPassword} תווים)
                <input name="password" type="password" required minLength={minPassword} autoComplete="new-password" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 font-medium">שוב את הסיסמה
                <input name="confirm" type="password" required minLength={minPassword} autoComplete="new-password" className={inputClass} />
              </label>
            </>
          )}
          {state && !state.ok && <p role="alert" className="text-critical-ink">{state.error}</p>}
          <Button type="submit" variant="primary" disabled={busy} className="mt-1 h-10">
            <LogIn className="size-4 rtl:-scale-x-100" aria-hidden />{busy ? 'רגע…' : 'כניסה'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

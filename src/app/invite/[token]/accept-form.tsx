'use client';
import { submitWith } from '@/lib/submit';
import { useActionState } from 'react';
import { LogIn } from 'lucide-react';
import { acceptInvite } from '@/app/user-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { inputClass, labelClass } from '@/components/work/fields';
import { cn } from '@/lib/utils';

export function AcceptForm({ token, email, name, role, place, needsCurrent, minPassword }: {
  token: string; email: string; name: string | null; role: string; place: string; needsCurrent: boolean; minPassword: number;
}) {
  const [state, action, busy] = useActionState(acceptInvite, null);
  return (
    <Card>
      <CardContent className="pt-5 sm:pt-6">
        <form onSubmit={submitWith(action)} className="flex flex-col gap-4 text-sm">
          <input type="hidden" name="token" value={token} />
          <div className="flex flex-col gap-1">
          <p className="text-body text-ink">הוזמנת כ<strong className="font-semibold">{role}</strong> ל<strong className="font-semibold"><bdi dir="rtl">{place}</bdi></strong>.</p>
          <p className="text-muted">הכניסה תהיה עם <bdi dir="ltr">{email}</bdi></p>
          </div>
          <label className={cn(labelClass, 'flex flex-col gap-1.5')}>שם
            <input name="name" required minLength={2} maxLength={60} defaultValue={name ?? ''} autoComplete="name" className={inputClass} />
          </label>
          {needsCurrent ? (
            <label className={cn(labelClass, 'flex flex-col gap-1.5')}>הסיסמה הנוכחית שלך
              <input name="current_password" type="password" required autoComplete="current-password" className={inputClass} />
            </label>
          ) : (
            <>
              <label className={cn(labelClass, 'flex flex-col gap-1.5')}>סיסמה (לפחות {minPassword} תווים)
                <input name="password" type="password" required minLength={minPassword} autoComplete="new-password" className={inputClass} />
              </label>
              <label className={cn(labelClass, 'flex flex-col gap-1.5')}>שוב את הסיסמה
                <input name="confirm" type="password" required minLength={minPassword} autoComplete="new-password" className={inputClass} />
              </label>
            </>
          )}
          {state && !state.ok && <p role="alert" className="text-critical-ink">{state.error}</p>}
          <Button type="submit" variant="primary" size="lg" disabled={busy} className="mt-1 w-full">
            <LogIn className="rtl:-scale-x-100" aria-hidden />{busy ? 'רגע…' : 'כניסה'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

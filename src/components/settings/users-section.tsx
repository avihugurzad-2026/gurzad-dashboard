'use client';
import { useActionState, useId, useState, useTransition } from 'react';
import { Copy, Mail, Send, X } from 'lucide-react';
import { cancelInvitation, inviteUser, removeAccess, type InviteResult } from '@/app/user-actions';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { inputClass } from '@/components/work/fields';
import { stamp } from '@/lib/format';
import type { InviteRow, UserRow } from '@/server/users';

type Role = 'admin' | 'manager' | 'employee' | 'viewer';
const ROLE_LABEL: Record<string, string> = { owner: 'בעלים', admin: 'מנהל מערכת', manager: 'מנהל', employee: 'עובד', viewer: 'צפייה בלבד' };

// The people with access, what each may see, pending invitations, and the invite form
export function UsersSection({ users, invites, roles, places, pending, meId }: {
  users: UserRow[]; invites: InviteRow[];
  roles: { value: Role; label: string; hint: string }[];
  places: { value: string; label: string }[];
  pending: { id: string; name: string }[];
  meId: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col divide-y divide-[color:var(--border)]">
        {users.map(u => <UserItem key={u.id} u={u} me={u.id === meId} />)}
      </ul>
      {invites.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted">הזמנות שעוד לא נפתחו</h3>
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {invites.map(i => <InviteItem key={i.id} i={i} />)}
          </ul>
        </div>
      )}
      {roles.length > 0 && <InviteForm roles={roles} places={places} pending={pending} />}
    </div>
  );
}

function UserItem({ u, me }: { u: UserRow; me: boolean }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex flex-col gap-1.5 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{u.name}</span>
        {me && <Badge tone="accent">את/ה</Badge>}
        {u.email && <bdi dir="ltr" className="text-xs text-muted">{u.email}</bdi>}
        {!u.can_sign_in && <Badge>עוד לא נכנס/ה</Badge>}
        {u.last_login_at && <span className="text-xs text-muted">כניסה אחרונה {stamp(u.last_login_at)}</span>}
      </div>
      {u.members.length === 0 ? <p className="text-xs text-muted">אין גישה לשום מקום</p> : (
        <ul className="flex flex-wrap gap-1.5">
          {u.members.map(m => (
            <li key={m.id}>
              <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'} className={busy ? 'opacity-60' : undefined}>
                {ROLE_LABEL[m.role]} · <bdi dir="rtl">{m.label}</bdi>
                {m.revocable && (
                  <button type="button" aria-label={`הסר גישה: ${ROLE_LABEL[m.role]} ${m.label}`} disabled={busy}
                    onClick={() => { if (confirm(`להסיר את הגישה של ${u.name} ל${m.label}?`)) start(async () => { const r = await removeAccess(m.id); setError(r.ok ? null : r.error); }); }}
                    className="-me-1 ms-0.5 rounded-full p-0.5 hover:bg-surface-2"><X className="size-3" aria-hidden /></button>
                )}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-critical-ink">{error}</p>}
    </li>
  );
}

function InviteItem({ i }: { i: InviteRow }) {
  const [busy, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <bdi dir="ltr">{i.email}</bdi>
      <Badge>{ROLE_LABEL[i.role]} · <bdi dir="rtl">{i.label}</bdi></Badge>
      <span className="text-xs text-muted">בתוקף עד {stamp(i.expires_at)}</span>
      <span className="flex-1" />
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => { await cancelInvitation(i.id); })}>בטל</Button>
    </li>
  );
}

function InviteForm({ roles, places, pending }: { roles: { value: Role; label: string; hint: string }[]; places: { value: string; label: string }[]; pending: { id: string; name: string }[] }) {
  const [state, action, busy] = useActionState<InviteResult, FormData>(inviteUser, null);
  const [role, setRole] = useState<Role>(roles.find(r => r.value === 'manager')?.value ?? roles[0].value);
  const [copied, setCopied] = useState(false);
  const id = useId();
  const placeChoices = role === 'admin' ? [{ value: 'all', label: 'הכל' }, ...places] : places;
  if (state?.ok) {
    const mail = `mailto:${state.email}?subject=${encodeURIComponent('הזמנה לדשבורד גורזד')}&body=${encodeURIComponent(`הזמנתי אותך לדשבורד. הקישור בתוקף 7 ימים:\n${state.link}`)}`;
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3 text-sm">
        <p className="font-medium">ההזמנה מוכנה. שלח את הקישור ל-<bdi dir="ltr">{state.email}</bdi>:</p>
        <input readOnly value={state.link} dir="ltr" onFocus={e => e.currentTarget.select()} className={inputClass} aria-label="קישור ההזמנה" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" type="button" onClick={async () => { await navigator.clipboard.writeText(state.link); setCopied(true); }}>
            <Copy className="size-4" aria-hidden />{copied ? 'הועתק' : 'העתק קישור'}
          </Button>
          <a href={mail} className={buttonClass('secondary', 'sm')}><Mail className="size-4" aria-hidden />שלח במייל</a>
        </div>
        <p className="text-xs text-muted">הקישור מוצג רק עכשיו ובתוקף 7 ימים. אם ייאבד, בטל את ההזמנה וצור חדשה.</p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <h3 className="text-sm font-medium">הזמן משתמש</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted" htmlFor={`${id}-e`}>אימייל
          <input id={`${id}-e`} name="email" type="email" required dir="ltr" autoComplete="off" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted" htmlFor={`${id}-n`}>שם
          <input id={`${id}-n`} name="name" maxLength={60} className={inputClass} />
        </label>
        {pending.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-muted">משתמש קיים שעוד לא נכנס
            <select name="user_id" defaultValue={pending[0].id} className={inputClass}>
              {pending.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="">משתמש חדש</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted">תפקיד
          <select name="role" value={role} onChange={e => setRole(e.target.value as Role)} className={inputClass}>
            {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">גישה ל
          <select name="place" key={role} defaultValue={placeChoices[0]?.value} className={inputClass}>
            {placeChoices.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted">{roles.find(r => r.value === role)?.hint}. רשומות "אישיות" של כל אחד נשארות פרטיות; משתפים רשומה עם "משותף".</p>
      {state && !state.ok && <p role="alert" className="text-xs text-critical-ink">{state.error}</p>}
      <div><Button type="submit" variant="primary" size="sm" disabled={busy}><Send className="size-4 rtl:-scale-x-100" aria-hidden />צור קישור הזמנה</Button></div>
    </form>
  );
}

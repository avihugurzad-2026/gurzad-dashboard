import { UserPlus, Users } from 'lucide-react';
import type { SessionUser } from '@/server/auth';
import { canManageWorkspace, pendingInvites, roleIn, workspaceMembers, type WorkspaceRow } from '@/server/workspaces';
import { encodePlace } from '@/lib/places';
import { BUSINESS_ROLES, HOUSEHOLD_ROLES } from '@/lib/workspaces';
import { stamp } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { InviteMemberForm, MemberRoleSelect, RemoveMemberButton, RevokeInviteButton } from './workspace-forms';
import { roleLabel } from './role-label';

// The members of a shared workspace (household or business): who is in it and in what role,
// pending invitations, and the invite form. Managers (owner/admin) change roles and remove;
// anyone but the owner can leave. Names, roles and e-mail only: nothing about anyone's money.
export async function MembersPanel({ w, u, members: given }: { w: WorkspaceRow; u: SessionUser; members?: Awaited<ReturnType<typeof workspaceMembers>> }) {
  const manage = canManageWorkspace(u, w);
  const owner = roleIn(u, w) === 'owner';
  const [members, invites] = await Promise.all([given ?? workspaceMembers(w, u), manage ? pendingInvites(w) : []]);
  const all = w.kind === 'household' ? HOUSEHOLD_ROLES : BUSINESS_ROLES;
  // An admin hands out the roles below admin; only the owner appoints admins
  const grantable: string[] = owner ? all : all.filter(r => r !== 'admin');
  const place = encodePlace({ domain: w.kind === 'household' ? 'household' : 'business', branch: w.branch, location: null });
  const where = w.kind === 'household' ? 'משק הבית' : 'העסק';

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>חברים</CardTitle>
          <span className="text-sm text-muted tabular">{members.length ? `${members.length} חברים` : null}</span>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <Empty compact icon={<Users aria-hidden />} title="אין עדיין חברים">
              {manage ? 'הזמן את מי שצריך להיות כאן בטופס למטה.' : 'מי שמנהל את האזור יכול להזמין חברים.'}
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {members.map(m => {
                const editable = manage && !m.you && m.role !== 'owner' && (owner || m.role !== 'admin');
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink" aria-hidden>{m.name.slice(0, 1)}</span>
                      <span className="flex min-w-0 flex-col">
                        <span className="flex flex-wrap items-center gap-2 text-body font-medium text-ink">
                          <bdi>{m.name}</bdi>{m.you && <Badge tone="accent">את/ה</Badge>}
                        </span>
                        {m.email && <bdi dir="ltr" className="truncate text-xs text-muted">{m.email}</bdi>}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {editable && m.id
                        ? <MemberRoleSelect ws={w.id} member={m.id} role={m.role} roles={grantable} kind={w.kind} name={m.name} />
                        : <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{roleLabel(m.role, w.kind)}</Badge>}
                      {editable && <RemoveMemberButton ws={w.id} member={m.id} name={m.name} self={false} place={w.name} />}
                      {m.you && m.role !== 'owner' && <RemoveMemberButton ws={w.id} member={m.id} name={m.name} self place={w.name} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {manage && invites.length > 0 && (
        <Card>
          <CardHeader><CardTitle>הזמנות שעוד לא נפתחו</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {invites.map(i => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                  {i.name && <bdi className="font-medium text-ink">{i.name}</bdi>}
                  <bdi dir="ltr" className="text-ink-2">{i.email}</bdi>
                  <Badge>{roleLabel(i.role, w.kind)}</Badge>
                  <span className="text-xs text-muted">בתוקף עד {stamp(i.expires_at)}</span>
                  <span className="flex-1" />
                  <RevokeInviteButton id={i.id} email={i.email} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {manage && grantable.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="size-[18px] text-muted" aria-hidden />הזמן חבר</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              נוצר קישור אישי שאתה שולח בעצמך (העתקה או מייל). מי שמקבל אותו מצטרף ל{where} <bdi>{w.name}</bdi> בתפקיד שבחרת.
              {w.kind === 'household' && ' האזור האישי שלו נשאר פרטי.'}
            </p>
            <InviteMemberForm place={place} roles={grantable} kind={w.kind} wsName={w.name} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

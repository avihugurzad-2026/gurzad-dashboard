'use client';
import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Copy, Mail, Pencil, Plus, Send, UserMinus, X } from 'lucide-react';
import {
  addBranch, archiveBranch, archiveWorkspaceAction, createWorkspaceAction, removeMemberAction, renameBranch,
  renameWorkspaceAction, setBranchStatus, setMemberRoleAction, switchHousehold, type WsResult,
} from '@/app/workspace-actions';
import { cancelInvitation, inviteUser, type InviteResult } from '@/app/user-actions';
import { FormDialog } from '@/components/finance/dialog';
import { Button, buttonClass } from '@/components/ui/button';
import { Field, compactInputClass, inputClass, selectClass } from '@/components/work/fields';
import type { WorkspaceKind } from '@/lib/workspaces';
import { roleLabel } from './role-label';

// Client forms for workspaces, branches, members and invitations. Every write goes through
// src/app/workspace-actions.ts (or user-actions.ts for invitations); the server re-checks everything.

type Action = (prev: WsResult, f: FormData) => Promise<WsResult>;


function useWs(action: Action, { onDone, follow = false }: { onDone?: () => void; follow?: boolean } = {}) {
  const router = useRouter();
  const [state, run, busy] = useActionState<WsResult, FormData>(action, null);
  const done = useRef<WsResult>(null);
  useEffect(() => {
    if (!state?.ok || done.current === state) return;
    done.current = state;
    if (follow && state.href) router.push(state.href);
    else router.refresh();
    onDone?.();
  }, [state, follow, onDone, router]);
  return { state, run, busy };
}

function ErrorLine({ state }: { state: WsResult | InviteResult }) {
  return state && !state.ok ? <p role="alert" className="text-sm text-critical-ink">{state.error}</p> : null;
}

const Hidden = ({ fields }: { fields: Record<string, string> }) =>
  <>{Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;

// ── Create a household / business ─────────────────────────────────────────────
const KIND_TEXT = {
  household: { label: 'שם משק הבית', placeholder: 'למשל: הבית שלנו', submit: 'צור משק בית' },
  business: { label: 'שם העסק', placeholder: 'למשל: שם העסק כפי שהלקוחות מכירים אותו', submit: 'צור עסק' },
} as const;

export function CreateWorkspaceForm({ kind, onDone, follow = false }: { kind: 'household' | 'business'; onDone?: () => void; follow?: boolean }) {
  const { state, run, busy } = useWs(createWorkspaceAction, { onDone, follow });
  const id = useId();
  const t = KIND_TEXT[kind];
  return (
    <form action={run} className="flex flex-col gap-4">
      <input type="hidden" name="kind" value={kind} />
      <Field label={t.label} htmlFor={id}>
        <input id={id} name="name" required minLength={2} maxLength={60} placeholder={t.placeholder} className={inputClass} autoComplete="off" />
      </Field>
      <ErrorLine state={state} />
      <div><Button type="submit" variant="primary" disabled={busy}><Plus aria-hidden />{t.submit}</Button></div>
    </form>
  );
}

export function CreateWorkspaceDialog({ kind, primary = false }: { kind: 'household' | 'business'; primary?: boolean }) {
  const title = kind === 'household' ? 'משק בית חדש' : 'עסק חדש';
  return (
    <FormDialog wide={false} title={title} triggerClass={buttonClass(primary ? 'primary' : 'secondary', 'md')}
      trigger={<><Plus aria-hidden />{title}</>}>
      {close => (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {kind === 'household'
              ? 'משק בית משותף לכמה אנשים. אחרי היצירה אפשר להזמין אליו חברים. האזור האישי של כל אחד נשאר פרטי.'
              : 'לכל עסק יש משימות, מסמכים, יעדים, סניפים וחברי צוות משלו. אפשר להוסיף סניפים אחרי היצירה.'}
          </p>
          <CreateWorkspaceForm kind={kind} onDone={close} />
        </div>
      )}
    </FormDialog>
  );
}

// ── Rename (workspace or branch) ──────────────────────────────────────────────
export function RenameDialog({ ws, name, location, label = 'שינוי שם' }: { ws: string; name: string; location?: string; label?: string }) {
  return (
    <FormDialog wide={false} title={label} triggerClass={buttonClass('ghost', 'sm')} trigger={<><Pencil aria-hidden />שינוי שם</>}>
      {close => <RenameForm ws={ws} name={name} location={location} onDone={close} />}
    </FormDialog>
  );
}

function RenameForm({ ws, name, location, onDone }: { ws: string; name: string; location?: string; onDone: () => void }) {
  const { state, run, busy } = useWs(location ? renameBranch : renameWorkspaceAction, { onDone });
  const id = useId();
  return (
    <form action={run} className="flex flex-col gap-4">
      <Hidden fields={location ? { ws, location } : { ws }} />
      <Field label="שם חדש" htmlFor={id}>
        <input id={id} name="name" required minLength={2} maxLength={60} defaultValue={name} className={inputClass} autoComplete="off" />
      </Field>
      <ErrorLine state={state} />
      <div><Button type="submit" variant="primary" disabled={busy}>שמור</Button></div>
    </form>
  );
}

// ── Confirmed actions: archive a workspace / branch, remove or leave ─────────
function ConfirmDialog({ title, trigger, triggerClass, body, confirm, action, fields, follow = false }: {
  title: string; trigger: React.ReactNode; triggerClass: string; body: React.ReactNode; confirm: string;
  action: Action; fields: Record<string, string>; follow?: boolean;
}) {
  return (
    <FormDialog wide={false} title={title} triggerClass={triggerClass} trigger={trigger}>
      {close => <ConfirmForm body={body} confirm={confirm} action={action} fields={fields} follow={follow} onDone={close} close={close} />}
    </FormDialog>
  );
}

function ConfirmForm({ body, confirm, action, fields, follow, onDone, close }: {
  body: React.ReactNode; confirm: string; action: Action; fields: Record<string, string>; follow: boolean; onDone: () => void; close: () => void;
}) {
  const { state, run, busy } = useWs(action, { onDone, follow });
  return (
    <form action={run} className="flex flex-col gap-4">
      <Hidden fields={fields} />
      <div className="text-body text-ink-2">{body}</div>
      <ErrorLine state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={busy}>{confirm}</Button>
        <Button variant="ghost" onClick={close}>ביטול</Button>
      </div>
    </form>
  );
}

export function ArchiveWorkspaceButton({ ws, name, kind }: { ws: string; name: string; kind: 'household' | 'business' }) {
  const what = kind === 'household' ? 'משק הבית' : 'העסק';
  return (
    <ConfirmDialog title={`העברה לארכיון: ${name}`} trigger={<><Archive aria-hidden />ארכיון</>} triggerClass={buttonClass('ghost', 'sm')}
      confirm="העבר לארכיון" action={archiveWorkspaceAction} fields={{ ws }} follow
      body={<>
        <p>{what} <bdi className="font-semibold">{name}</bdi> ייעלם מהתפריטים ומהמסכים של כל החברים.</p>
        <p className="mt-2 text-sm text-muted">שום נתון לא נמחק: המשימות, המסמכים והתנועות נשמרים, ואפשר לשחזר את {what} בעתיד.</p>
      </>} />
  );
}

export function ArchiveBranchButton({ ws, location, name }: { ws: string; location: string; name: string }) {
  return (
    <ConfirmDialog title={`העברה לארכיון: ${name}`} trigger={<Archive aria-hidden />} triggerClass={buttonClass('ghost', 'icon')}
      confirm="העבר לארכיון" action={archiveBranch} fields={{ ws, location }}
      body={<>
        <p>הסניף <bdi className="font-semibold">{name}</bdi> ייעלם מהרשימות.</p>
        <p className="mt-2 text-sm text-muted">הנתונים שלו נשמרים ואפשר לשחזר אותו בעתיד.</p>
      </>} />
  );
}

export function RemoveMemberButton({ ws, member, name, self, place }: { ws: string; member: string; name: string; self: boolean; place: string }) {
  return self ? (
    <ConfirmDialog title={`לעזוב את ${place}?`} trigger={<><UserMinus aria-hidden />עזוב</>} triggerClass={buttonClass('danger', 'sm')}
      confirm="עזוב" action={removeMemberAction} fields={{ ws, member }} follow
      body={<p>לא תראה יותר את <bdi>{place}</bdi>. מה שהוספת נשאר שם. כדי לחזור צריך הזמנה חדשה.</p>} />
  ) : (
    <ConfirmDialog title={`להסיר את ${name}?`} trigger={<UserMinus aria-hidden />} triggerClass={buttonClass('ghost', 'icon')}
      confirm="הסר" action={removeMemberAction} fields={{ ws, member }}
      body={<p><bdi>{name}</bdi> לא יראה יותר את <bdi>{place}</bdi>. מה שהוסיף נשאר. אפשר להזמין שוב בכל זמן.</p>} />
  );
}

// ── Selects that save on change ───────────────────────────────────────────────
function AutoSelect({ action, fields, name, value, options, label }: {
  action: Action; fields: Record<string, string>; name: string; value: string; options: { value: string; label: string }[]; label: string;
}) {
  const { state, run, busy } = useWs(action);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={run} className="flex flex-col items-end gap-1">
      <Hidden fields={fields} />
      <select name={name} defaultValue={value} aria-label={label} disabled={busy} className={`${compactInputClass} w-auto pe-7`}
        onChange={() => form.current?.requestSubmit()}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ErrorLine state={state} />
    </form>
  );
}

export function MemberRoleSelect({ ws, member, role, roles, kind, name }: {
  ws: string; member: string; role: string; roles: string[]; kind: WorkspaceKind; name: string;
}) {
  const opts = (roles.includes(role) ? roles : [role, ...roles]).map(r => ({ value: r, label: roleLabel(r, kind) }));
  return <AutoSelect action={setMemberRoleAction} fields={{ ws, member }} name="role" value={role} options={opts} label={`התפקיד של ${name}`} />;
}

export function BranchStatusSelect({ ws, location, status, name }: { ws: string; location: string; status: string; name: string }) {
  return <AutoSelect action={setBranchStatus} fields={{ ws, location }} name="status" value={status === 'setup' ? 'setup' : 'active'}
    options={[{ value: 'active', label: 'פעיל' }, { value: 'setup', label: 'בהקמה' }]} label={`הסטטוס של ${name}`} />;
}

// ── Add a branch ──────────────────────────────────────────────────────────────
export function AddBranchDialog({ ws, primary = false }: { ws: string; primary?: boolean }) {
  return (
    <FormDialog wide={false} title="סניף חדש" triggerClass={buttonClass(primary ? 'primary' : 'secondary', primary ? 'md' : 'sm')}
      trigger={<><Plus aria-hidden />הוסף סניף</>}>
      {close => <AddBranchForm ws={ws} onDone={close} />}
    </FormDialog>
  );
}

function AddBranchForm({ ws, onDone }: { ws: string; onDone: () => void }) {
  const { state, run, busy } = useWs(addBranch, { onDone });
  const id = useId();
  return (
    <form action={run} className="flex flex-col gap-4">
      <input type="hidden" name="ws" value={ws} />
      <Field label="שם הסניף" htmlFor={`${id}-n`}>
        <input id={`${id}-n`} name="name" required minLength={2} maxLength={60} placeholder="למשל: שם העיר או השכונה" className={inputClass} autoComplete="off" />
      </Field>
      <Field label="סטטוס" htmlFor={`${id}-s`}>
        <select id={`${id}-s`} name="status" defaultValue="active" className={selectClass}>
          <option value="active">פעיל</option>
          <option value="setup">בהקמה</option>
        </select>
      </Field>
      <ErrorLine state={state} />
      <div><Button type="submit" variant="primary" disabled={busy}><Plus aria-hidden />הוסף סניף</Button></div>
    </form>
  );
}

// ── Invitations ───────────────────────────────────────────────────────────────
export function InviteMemberForm({ place, roles, kind, wsName }: { place: string; roles: string[]; kind: WorkspaceKind; wsName: string }) {
  const [round, setRound] = useState(0);
  return <InviteInner key={round} place={place} roles={roles} kind={kind} wsName={wsName} again={() => setRound(r => r + 1)} />;
}

function InviteInner({ place, roles, kind, wsName, again }: { place: string; roles: string[]; kind: WorkspaceKind; wsName: string; again: () => void }) {
  const router = useRouter();
  const [state, run, busy] = useActionState<InviteResult, FormData>(inviteUser, null);
  const [copied, setCopied] = useState(false);
  const id = useId();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  if (state?.ok) {
    const mail = `mailto:${state.email}?subject=${encodeURIComponent(`הזמנה ל${wsName}`)}&body=${encodeURIComponent(`הזמנתי אותך ל${wsName} בדשבורד. הקישור בתוקף 7 ימים:\n${state.link}`)}`;
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
        <p className="font-medium text-ink">ההזמנה מוכנה. שלח את הקישור ל-<bdi dir="ltr">{state.email}</bdi>:</p>
        <input readOnly value={state.link} dir="ltr" onFocus={e => e.currentTarget.select()} className={inputClass} aria-label="קישור ההזמנה" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={async () => {
            try { await navigator.clipboard.writeText(state.link); setCopied(true); } catch { setCopied(false); }
          }}><Copy aria-hidden />{copied ? 'הועתק' : 'העתק קישור'}</Button>
          <a href={mail} className={buttonClass('secondary', 'sm')}><Mail aria-hidden />שלח במייל</a>
          <Button size="sm" variant="ghost" onClick={again}>הזמן עוד מישהו</Button>
        </div>
        <p className="text-xs text-muted">הקישור מוצג רק עכשיו ובתוקף 7 ימים. אם ייאבד, בטל את ההזמנה וצור חדשה.</p>
      </div>
    );
  }
  return (
    <form action={run} className="flex flex-col gap-4">
      <input type="hidden" name="place" value={place} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="אימייל" htmlFor={`${id}-e`}>
          <input id={`${id}-e`} name="email" type="email" required dir="ltr" autoComplete="off" maxLength={200} className={inputClass} />
        </Field>
        <Field label="שם (לא חובה)" htmlFor={`${id}-n`}>
          <input id={`${id}-n`} name="name" maxLength={60} className={inputClass} autoComplete="off" />
        </Field>
        <Field label="תפקיד" htmlFor={`${id}-r`}>
          <select id={`${id}-r`} name="role" defaultValue={roles.includes('member') ? 'member' : roles.includes('employee') ? 'employee' : roles[0]} className={selectClass}>
            {roles.map(r => <option key={r} value={r}>{roleLabel(r, kind)}</option>)}
          </select>
        </Field>
      </div>
      <ErrorLine state={state} />
      <div><Button type="submit" variant="primary" disabled={busy}><Send className="rtl:-scale-x-100" aria-hidden />צור קישור הזמנה</Button></div>
    </form>
  );
}

export function RevokeInviteButton({ id, email }: { id: string; email: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span role="alert" className="text-xs text-critical-ink">{error}</span>}
      <Button size="sm" variant="ghost" disabled={busy} aria-label={`בטל את ההזמנה של ${email}`}
        onClick={() => start(async () => { const r = await cancelInvitation(id); if (r.ok) router.refresh(); else setError(r.error); })}>
        <X aria-hidden />בטל
      </Button>
    </span>
  );
}

// ── Household switcher (more than one household) ──────────────────────────────
export function HouseholdSwitcher({ households, current, next }: { households: { id: string; name: string }[]; current: string; next?: string }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={switchHousehold} className="flex items-center gap-2">
      {next && <input type="hidden" name="next" value={next} />}
      <label htmlFor="hh-switch" className="text-sm text-muted">משק בית</label>
      <select id="hh-switch" name="ws" defaultValue={current} className={`${compactInputClass} w-auto pe-7`}
        onChange={() => form.current?.requestSubmit()}>
        {households.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      <noscript><button type="submit" className={buttonClass('secondary', 'sm')}>החלף</button></noscript>
    </form>
  );
}

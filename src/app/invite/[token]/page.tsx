import { inviteByToken, MIN_PASSWORD, ROLE_LABEL } from '@/server/users';
import { AcceptForm } from './accept-form';

export const metadata = { title: 'הזמנה — דשבורד גורזד', robots: { index: false } };
export const dynamic = 'force-dynamic';

// Public page behind the invitation link. Shows what the link gives, then name + password.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await inviteByToken(token).catch(() => null);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-accent font-bold text-white">ג</span>
          <span className="text-section font-semibold text-ink">דשבורד גורזד</span>
        </div>
        {!inv ? (
          <div className="rounded-xl border border-line bg-surface p-5 text-sm sm:p-6">
            <p className="text-card font-semibold text-ink">הקישור לא בתוקף</p>
            <p className="mt-1.5 text-muted">ייתכן שכבר השתמשו בו או שעברו 7 ימים. בקש קישור חדש ממי שהזמין אותך.</p>
          </div>
        ) : (
          <AcceptForm token={token} email={inv.email} name={inv.name} role={ROLE_LABEL[inv.role]} place={inv.label}
            needsCurrent={inv.needs_current_password} minPassword={MIN_PASSWORD} />
        )}
      </div>
    </main>
  );
}

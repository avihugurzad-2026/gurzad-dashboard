import { cn } from '@/lib/utils';

// Form primitives for the whole product: every input, select and textarea uses these classes, so
// height, border, radius, padding, font size and focus look the same everywhere.
const control = 'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted transition-colors '
  + 'hover:border-[color:var(--axis)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 '
  + 'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted';
export const inputClass = `h-10 ${control}`;
export const selectClass = `h-10 ${control} pe-8`;
export const textareaClass = `min-h-24 py-2.5 ${control}`;
// A compact control for toolbars and table rows (same look, 32px)
export const compactInputClass = `h-8 ${control} px-2.5`;

export const labelClass = 'text-sm font-medium text-ink-2';

export function Field({ label, htmlFor, hint, className, children }: {
  label: string; htmlFor: string; hint?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className={labelClass}>{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

// Hidden inputs that say where an item belongs
export function PlaceInputs({ domain, branch, location, list, path }: {
  domain: string; branch?: string | null; location?: string | null; list?: string | null; path: string;
}) {
  return (
    <>
      <input type="hidden" name="domain" value={domain} />
      {branch && <input type="hidden" name="branch" value={branch} />}
      {location && <input type="hidden" name="location" value={location} />}
      {list && <input type="hidden" name="list" value={list} />}
      <input type="hidden" name="path" value={path} />
    </>
  );
}

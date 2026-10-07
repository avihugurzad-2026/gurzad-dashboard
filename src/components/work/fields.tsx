import { cn } from '@/lib/utils';

// Small form primitives shared by the entry forms
export const inputClass = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted';

export function Field({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-xs text-muted">{label}</label>
      {children}
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

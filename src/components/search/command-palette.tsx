'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Loader2, Search } from 'lucide-react';
import type { SearchGroup, SearchResult } from '@/server/search';
import { cn } from '@/lib/utils';
import { TypeIcon } from './type-icon';

// ⌘K / Ctrl+K (and "/" when not typing in a field) opens one search over everything (3.5).
// Mount once in the app shell: <CommandPalette />. Anything else can open it with
// openCommandPalette() (e.g. a search button in the header). Accessible combobox + listbox:
// focus stays in the input, ↑↓ move the active option (aria-activedescendant), Enter opens it,
// Esc closes and returns focus to where it was.

const OPEN_EVENT = 'gd:open-search';
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Response = { q: string; groups: SearchGroup[]; total: number };
type Option = { key: string; href: string; item: SearchResult | null };

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));
};

export function CommandPalette({ placeholder = 'חיפוש משימות, לקוחות, מסמכים, נכסים…' }: { placeholder?: string } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const cache = useRef(new Map<string, Response>());
  const id = useId();

  const show = useCallback(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setQ(''); setData(null); setError(null); setActive(0);
    const back = returnTo.current;
    if (back && document.contains(back)) requestAnimationFrame(() => back.focus());
  }, []);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
        e.preventDefault();
        if (open) close(); else show();
        return;
      }
      if (!open && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === '/' || (e.code === 'Slash' && !e.shiftKey)) && !typing(e.target)) {
        e.preventDefault();
        show();
      }
    };
    const onOpen = () => show();
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, [open, show, close]);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  // Lock page scroll behind the dialog
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Debounced fetch (150 ms); stale responses are aborted
  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    if (text.length < 2) { setData(null); setLoading(false); setError(null); return; }
    const hit = cache.current.get(text);
    if (hit) { setData(hit); setActive(0); setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(text)}&limit=6`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (res.status === 401) { setError('צריך להתחבר מחדש'); setData(null); return; }
        if (!res.ok) { setError('החיפוש נכשל, נסה שוב'); return; }
        const body = (await res.json()) as Response;
        cache.current.set(text, body);
        if (cache.current.size > 50) cache.current.delete(cache.current.keys().next().value!);
        setData(body); setError(null); setActive(0);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('החיפוש נכשל, נסה שוב');
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  // Flat list of options in display order, plus "all results" at the end
  const options: Option[] = useMemo(() => {
    const out: Option[] = [];
    for (const g of data?.groups ?? []) for (const it of g.items) out.push({ key: `${g.type}:${it.id}`, href: it.href, item: it });
    if (q.trim().length >= 2) out.push({ key: 'all', href: `/search?q=${encodeURIComponent(q.trim())}`, item: null });
    return out;
  }, [data, q]);
  const optId = (i: number) => `${id}-opt-${i}`;

  useEffect(() => {
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (o: Option | undefined) => {
    if (!o) return;
    close();
    router.push(o.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (options.length ? (a + 1) % options.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (options.length ? (a - 1 + options.length) % options.length : 0)); }
    else if (e.key === 'Home' && options.length) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && options.length) { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') e.preventDefault();   // focus stays in the dialog
  };

  if (!open) return null;
  const text = q.trim();
  let n = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[min(12vh,6rem)]" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="חיפוש בכל המערכת" dir="rtl"
        className="flex max-h-[min(70dvh,560px)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-xl">
        <div className="flex items-center gap-2 border-b border-line px-3">
          {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-muted" aria-hidden /> : <Search className="size-4 shrink-0 text-muted" aria-hidden />}
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown}
            role="combobox" aria-expanded={options.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
            aria-activedescendant={options.length ? optId(active) : undefined} aria-label="חיפוש"
            placeholder={placeholder} maxLength={100} autoComplete="off" spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted" />
          <kbd className="hidden shrink-0 rounded border border-line-strong px-1.5 text-[11px] text-muted sm:inline">Esc</kbd>
        </div>
        <div ref={list} id={`${id}-list`} role="listbox" aria-label="תוצאות" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {data?.groups.map(g => (
            <div key={g.type} role="group" aria-labelledby={`${id}-g-${g.type}`} className="pb-1">
              <div id={`${id}-g-${g.type}`} className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-xs font-medium text-muted">
                <TypeIcon type={g.type} className="size-3.5" />{g.label}
              </div>
              {g.items.map(it => {
                n++;
                const i = n;
                return (
                  <div key={`${g.type}:${it.id}`} id={optId(i)} role="option" aria-selected={i === active}
                    onMouseMove={() => { if (active !== i) setActive(i); }} onClick={() => go(options[i])}
                    className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2', i === active ? 'bg-accent-soft' : 'hover:bg-surface-2')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-medium"><bdi>{it.title}</bdi></span>
                        {it.subtitle && <span className="truncate text-xs text-muted"><bdi>{it.subtitle}</bdi></span>}
                      </div>
                      <div className="truncate text-xs text-muted"><bdi dir="rtl">{it.crumbs}</bdi></div>
                    </div>
                    {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden />}
                  </div>
                );
              })}
            </div>
          ))}
          {text.length >= 2 && (() => {
            const i = options.length - 1;
            return (
              <div id={optId(i)} role="option" aria-selected={i === active} onMouseMove={() => { if (active !== i) setActive(i); }}
                onClick={() => go(options[i])}
                className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-accent', i === active ? 'bg-accent-soft' : 'hover:bg-surface-2')}>
                <Search className="size-3.5" aria-hidden />כל התוצאות עבור "<bdi>{text}</bdi>"
              </div>
            );
          })()}
        </div>
        <div className="border-t border-line px-3 py-2 text-xs text-muted" aria-live="polite">
          {error ? <span className="text-critical-ink">{error}</span>
            : text.length < 2 ? 'הקלד לפחות שני תווים · ↑↓ לבחירה · Enter לפתיחה'
            : loading && !data ? 'מחפש…'
            : data && data.total === 0 ? <>לא נמצא שום דבר עבור "<bdi>{text}</bdi>"</>
            : data ? `${data.total} תוצאות` : ''}
        </div>
      </div>
    </div>
  );
}

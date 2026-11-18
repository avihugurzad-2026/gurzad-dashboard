/* Phone gestures that make the web app feel native.
   All of them are touch-only and do nothing on desktop (no touch events there). */
import { useEffect } from 'react';
import { haptic } from './pwa';

const phone = () => matchMedia('(max-width: 1023px) and (pointer: coarse)').matches;
const root = () => document.documentElement;

/** Elements that own their own horizontal or vertical gestures. */
function ownsGesture(el: EventTarget | null, axis: 'x' | 'y') {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    if (n.matches?.('input, textarea, select, [contenteditable], .sheet, .sheet-backdrop, [data-noswipe]')) return true;
    if (axis === 'x') {
      const s = getComputedStyle(n);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 2) return true;
    }
  }
  return false;
}

/** Horizontal swipe on the page:
 *  - if the page marks [data-swipe="next"|"prev"] buttons (planner days/weeks), it presses them;
 *  - otherwise it moves to the neighbouring sub-tab (בית: סקירה → משימות → קניות ...).
 *  RTL: the "next" item sits to the left, so a finger moving right brings it in. */
export function useSwipeNav() {
  useEffect(() => {
    let x0 = 0, y0 = 0, t0 = 0, armed = false;
    const start = (e: TouchEvent) => {
      if (!phone() || e.touches.length !== 1 || ownsGesture(e.target, 'x')) { armed = false; return; }
      const t = e.touches[0];
      // leave the screen edges to the system back/forward gesture
      if (t.clientX < 24 || t.clientX > window.innerWidth - 24) { armed = false; return; }
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); armed = true;
    };
    const end = (e: TouchEvent) => {
      if (!armed) return;
      armed = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0, dt = Date.now() - t0;
      if (dt > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.5) return;
      if (window.getSelection()?.toString()) return;
      const dir: 'next' | 'prev' = dx > 0 ? 'next' : 'prev';
      const direct = document.querySelector<HTMLButtonElement>(`.main [data-swipe="${dir}"]:not(:disabled)`);
      if (direct) { haptic(6); direct.click(); return; }
      const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.main .subnav [role="tab"]'));
      const i = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
      if (i < 0) return;
      const target = tabs[dir === 'next' ? i + 1 : i - 1];
      if (target) { haptic(6); target.click(); }
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    return () => { document.removeEventListener('touchstart', start); document.removeEventListener('touchend', end); };
  }, []);
}

/** Pull down at the top of the page to reload data. The browser's own pull-to-refresh
 *  is off (overscroll-behavior: none) and does not exist in the installed app. */
export function usePullToRefresh(refresh: () => Promise<unknown>) {
  useEffect(() => {
    const ind = document.createElement('div');
    ind.className = 'ptr';
    ind.setAttribute('aria-hidden', 'true');
    ind.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';
    document.body.appendChild(ind);
    const MAX = 110, TRIGGER = 72;
    let y0 = 0, pull = 0, active = false, busy = false;
    const paint = (p: number, anim = false) => {
      ind.style.transition = anim ? 'transform .28s cubic-bezier(.32,.72,0,1), opacity .2s ease' : 'none';
      ind.style.transform = `translate(-50%, ${p - 56}px) rotate(${p * 3}deg)`;
      ind.style.opacity = String(Math.min(1, p / TRIGGER));
      ind.classList.toggle('ready', p >= TRIGGER);
    };
    const start = (e: TouchEvent) => {
      active = !busy && phone() && window.scrollY <= 0 && e.touches.length === 1 && !ownsGesture(e.target, 'y') && !document.querySelector('.sheet');
      if (active) { y0 = e.touches[0].clientY; pull = 0; }
    };
    const move = (e: TouchEvent) => {
      if (!active) return;
      const d = e.touches[0].clientY - y0;
      if (d <= 0 || window.scrollY > 0) { if (pull) paint(0); pull = 0; return; }
      const next = Math.min(MAX, d * 0.5);
      if (pull < TRIGGER && next >= TRIGGER) haptic(8);
      pull = next; paint(pull);
    };
    const end = async () => {
      if (!active) return;
      active = false;
      if (pull < TRIGGER) { paint(0, true); return; }
      busy = true; ind.classList.add('spin'); paint(TRIGGER * 0.8, true);
      try { await Promise.all([refresh(), new Promise((r) => setTimeout(r, 450))]); } finally {
        ind.classList.remove('spin'); paint(0, true); busy = false;
      }
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', end);
      ind.remove();
    };
  }, [refresh]);
}

/** Classes on <html> for chrome that reacts to scrolling and the keyboard:
 *  - `scrolled`   : page is not at the top (top bar gets its glass edge)
 *  - `scroll-down`: user is scrolling down (FAB tucks away so it does not cover rows)
 *  - `kb-open`    : on-screen keyboard is up (tab bar and FAB hide, like native apps) */
export function useChromeState() {
  useEffect(() => {
    let last = window.scrollY, acc = 0, raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY, d = y - last;
        last = y;
        root().classList.toggle('scrolled', y > 4);
        acc = Math.sign(d) === Math.sign(acc) ? acc + d : d;
        const atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 8;
        if (y < 40 || acc < -24 || atBottom) root().classList.remove('scroll-down');
        else if (acc > 24) root().classList.add('scroll-down');
      });
    };
    const vv = window.visualViewport;
    const onVV = () => {
      if (!vv) return;
      const typing = document.activeElement?.matches?.('input, textarea, [contenteditable]');
      root().classList.toggle('kb-open', Boolean(typing) && vv.height < window.innerHeight * 0.78);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    vv?.addEventListener('resize', onVV);
    document.addEventListener('focusout', () => setTimeout(onVV, 50));
    return () => { window.removeEventListener('scroll', onScroll); vv?.removeEventListener('resize', onVV); cancelAnimationFrame(raf); };
  }, []);
}

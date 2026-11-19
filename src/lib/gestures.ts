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

export type Dir = 'next' | 'prev';
/** What a swipe in one direction would do on this screen, or null at the first/last screen. */
export type Neighbor = (dir: Dir) => (() => void) | null;

/** The sub-tabs of the current screen (בית: סקירה → משימות → קניות …), as a step before/after the main areas. */
export function subTabStep(dir: Dir): (() => void) | null {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.main .subnav [role="tab"]'));
  const i = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
  if (i < 0) return null;
  const t = tabs[dir === 'next' ? i + 1 : i - 1];
  return t ? () => t.click() : null;
}

/** Swipe pager for the phone: one continuous strip of screens.
 *  Sub-tabs of the current area come first; past the last sub-tab the next main area slides in
 *  (סקירה → בית → עסקים → השקעות → יומן).
 *  - The page follows the finger while dragging (transform only, no layout work).
 *  - It changes screen past 30% of the width, or on a quick flick (≥0.45px/ms over ≥24px).
 *  - RTL: the next screen sits to the left, so a finger moving right brings it in.
 *  - At the first and last screen the page stretches a little and springs back (rubber band).
 *  - Vertical scrolling wins when the finger starts mostly vertical; inputs, sheets, sliders and
 *    anything that scrolls sideways keep their own gesture. Inside [data-swipe-zone] (planner board)
 *    a swipe presses that zone's [data-swipe] buttons instead (previous / next week).
 *  - prefers-reduced-motion: no dragging movement; the screen simply changes with a short fade. */
export function useSwipePager(neighbor: Neighbor, dots: () => { count: number; index: number } | null) {
  useEffect(() => {
    const page = () => document.querySelector<HTMLElement>('.main .page');
    const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    let dotsEl: HTMLDivElement | null = null;
    let dotsTimer = 0;
    const showDots = (on: boolean) => {
      const d = dots();
      if (!d) return;
      if (!dotsEl) { dotsEl = document.createElement('div'); dotsEl.className = 'pager-dots'; dotsEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(dotsEl); }
      dotsEl.innerHTML = Array.from({ length: d.count }, (_, i) => `<i class="${i === d.index ? 'on' : ''}"></i>`).join('');
      clearTimeout(dotsTimer);
      if (on) dotsEl.classList.add('show'); else dotsTimer = window.setTimeout(() => dotsEl?.classList.remove('show'), 700);
    };

    let x0 = 0, y0 = 0, t0 = 0, lastX = 0, lastT = 0, vx = 0;
    let mode: 'off' | 'wait' | 'drag' | 'zone' = 'off';
    let target: { next: (() => void) | null; prev: (() => void) | null } = { next: null, prev: null };
    let crossed = false;
    const W = () => window.innerWidth;

    const paint = (dx: number) => {
      const el = page(); if (!el) return;
      const dir: Dir = dx > 0 ? 'next' : 'prev';
      const free = !!target[dir];
      // rubber band at the ends: the further you pull, the less it moves (max ~56px)
      const off = free ? dx : Math.sign(dx) * 56 * (1 - Math.exp(-Math.abs(dx) / 160));
      el.style.transform = `translate3d(${off}px,0,0)`;
      el.style.opacity = free ? String(1 - Math.min(0.35, Math.abs(dx) / W() * 0.5)) : '';
      const over = free && Math.abs(dx) > W() * 0.3;
      if (over !== crossed) { crossed = over; if (over) haptic(6); }
    };
    const reset = (animate: boolean) => {
      const el = page(); if (!el) return;
      el.classList.remove('dragging');
      if (animate) { el.classList.add('settle'); setTimeout(() => el.classList.remove('settle'), 280); }
      el.style.transform = ''; el.style.opacity = '';
    };
    const enter = (dir: Dir) => {
      requestAnimationFrame(() => {
        const el = page(); if (!el) return;
        el.classList.remove('enter-from-left', 'enter-from-right');
        void el.offsetWidth;
        el.classList.add(dir === 'next' ? 'enter-from-left' : 'enter-from-right');
        setTimeout(() => el.classList.remove('enter-from-left', 'enter-from-right'), 300);
        showDots(false);
      });
    };
    const commit = (dir: Dir) => {
      const go = target[dir]; if (!go) return;
      haptic(6);
      const el = page();
      if (el && !reduce()) {
        el.classList.remove('dragging'); el.classList.add('settle');
        el.style.transform = `translate3d(${dir === 'next' ? W() : -W()}px,0,0)`; el.style.opacity = '0';
        setTimeout(() => { el.classList.remove('settle'); el.style.transform = ''; el.style.opacity = ''; go(); enter(dir); }, 170);
      } else { reset(false); go(); enter(dir); }
    };

    const start = (e: TouchEvent) => {
      mode = 'off';
      if (!phone() || e.touches.length !== 1 || document.querySelector('.sheet')) return;
      if (ownsGesture(e.target, 'x') || (e.target as HTMLElement).closest?.('.tabbar, .fab, .topbar')) return;
      const t = e.touches[0];
      if (t.clientX < 20 || t.clientX > W() - 20) return; // screen edges belong to the system back gesture
      x0 = lastX = t.clientX; y0 = t.clientY; t0 = lastT = e.timeStamp; vx = 0; crossed = false;
      mode = (e.target as HTMLElement).closest?.('[data-swipe-zone]') ? 'zone' : 'wait';
    };
    const move = (e: TouchEvent) => {
      if (mode === 'off' || mode === 'zone') return;
      const t = e.touches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if (mode === 'wait') {
        if (Math.abs(dx) + Math.abs(dy) < 10) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.2 || window.getSelection()?.toString()) { mode = 'off'; return; }
        mode = 'drag';
        target = { next: neighbor('next'), prev: neighbor('prev') };
        if (!target.next && !target.prev) { mode = 'off'; return; }
        if (!reduce()) page()?.classList.add('dragging');
        showDots(true);
      }
      if (e.cancelable) e.preventDefault(); // we own this touch now: no vertical scroll while dragging sideways
      const dt = e.timeStamp - lastT;
      if (dt > 0) vx = 0.7 * ((t.clientX - lastX) / dt) + 0.3 * vx;
      lastX = t.clientX; lastT = e.timeStamp;
      if (!reduce()) paint(dx);
    };
    const end = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const dx = t ? t.clientX - x0 : 0, dy = t ? t.clientY - y0 : 0;
      if (mode === 'zone') {
        mode = 'off';
        if (e.timeStamp - t0 > 600 || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.5) return;
        const b = document.querySelector<HTMLButtonElement>(`.main [data-swipe="${dx > 0 ? 'next' : 'prev'}"]:not(:disabled)`);
        if (b) { haptic(6); b.click(); }
        return;
      }
      if (mode !== 'drag') { mode = 'off'; return; }
      mode = 'off';
      if (e.timeStamp - lastT > 80) vx = 0; // finger stopped before lifting: no flick
      const dir: Dir = dx > 0 ? 'next' : 'prev';
      const flick = Math.abs(vx) > 0.45 && Math.abs(dx) > 24 && Math.sign(vx) === Math.sign(dx);
      if (target[dir] && (Math.abs(dx) > W() * 0.3 || flick)) commit(dir);
      else { reset(true); showDots(false); }
    };
    const cancel = () => { if (mode === 'drag') { reset(true); showDots(false); } mode = 'off'; };

    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', cancel);
      dotsEl?.remove();
    };
  }, [neighbor, dots]);
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

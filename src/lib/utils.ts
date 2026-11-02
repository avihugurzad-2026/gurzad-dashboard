import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Our type scale (globals.css) adds text-body, text-nav, text-card, text-section, text-title and
// text-kpi. tailwind-merge must know they are font sizes, or it drops them next to a text color.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['body', 'nav', 'card', 'section', 'title', 'kpi'] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import type { Metadata, Viewport } from 'next';
import { Google_Sans } from 'next/font/google';
import './globals.css';

// The one font of the product, Hebrew and Latin alike: Google Sans from Google Fonts (self-hosted by
// next/font at build time). Variable 400-700. No fallback face: `block` waits for the font instead
// of flashing another one, and no metric-adjusted Arial is generated.
const googleSans = Google_Sans({
  subsets: ['hebrew', 'latin', 'latin-ext'], weight: 'variable', variable: '--font-google-sans',
  display: 'block', adjustFontFallback: false, fallback: [],
});

export const metadata: Metadata = {
  title: 'דשבורד גורזד',
  description: 'מרכז ניהול אישי ועסקי',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f6f6f3' };

// Applies the stored theme and privacy choices before first paint, so neither flashes.
const BOOT = `(function(){try{var d=document.documentElement,t=localStorage.getItem('theme');if(t)d.dataset.theme=t;if(localStorage.getItem('private')==='1')d.dataset.private='1';}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={googleSans.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: BOOT }} /></head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

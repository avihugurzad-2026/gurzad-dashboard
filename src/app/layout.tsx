import type { Metadata, Viewport } from 'next';
import { Heebo, Inter } from 'next/font/google';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

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
    <html lang="he" dir="rtl" className={`${heebo.variable} ${inter.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: BOOT }} /></head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

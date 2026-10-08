import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pg is server-only; keep it out of the bundler
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  // Inbox files go through a server action; the stored cap is 4 MB (Vercel's request limit is 4.5 MB)
  experimental: { serverActions: { bodySizeLimit: '4.4mb' } },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https:" },
      ],
    }];
  },
};

export default nextConfig;

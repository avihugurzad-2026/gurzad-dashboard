import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pg is server-only; keep it out of the bundler
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'same-origin' },
      ],
    }];
  },
};

export default nextConfig;

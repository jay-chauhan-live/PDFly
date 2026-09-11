import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  experimental: {
    // The dashboard talks to the api service; nothing is proxied through Next.
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;

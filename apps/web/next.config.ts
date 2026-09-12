import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Emit a self-contained server at .next/standalone with only the traced
  // dependencies — the production image copies that rather than the whole
  // pnpm workspace node_modules, which does not port cleanly across images.
  output: 'standalone',
  experimental: {
    // The dashboard talks to the api service; nothing is proxied through Next.
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;

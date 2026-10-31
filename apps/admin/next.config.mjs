import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/administrator',
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // Trace from the repo root so the standalone build includes the workspace packages.
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  // Development only: send /api to a local API (in Docker and on the VPS, Caddy does this).
  async rewrites() {
    return process.env.API_ORIGIN
      ? [{ source: '/api/:path*', destination: process.env.API_ORIGIN + '/api/:path*', basePath: false }]
      : [];
  },
};

export default nextConfig;

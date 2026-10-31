import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/staff',
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // Trace from the repo root so the standalone build includes the workspace packages.
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'),
};

export default nextConfig;

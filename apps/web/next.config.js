/** @type {import('next').NextConfig} */
console.log('NEXT_CONFIG_VERSION=', process.env.VERSION);
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@prodtrack/ui', '@prodtrack/contracts', '@prodtrack/db'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    VERSION: process.env.VERSION || 'dev',
  },
};

module.exports = nextConfig;
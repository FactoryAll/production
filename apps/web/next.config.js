/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@prodtrack/ui', '@prodtrack/contracts', '@prodtrack/db'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
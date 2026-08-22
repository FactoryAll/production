/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@prodtrack/ui', '@prodtrack/contracts', '@prodtrack/db']
};

module.exports = nextConfig;

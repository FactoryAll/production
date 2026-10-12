/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@prodtrack/ui', '@prodtrack/contracts', '@prodtrack/db'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Загрузка номенклатуры из файла: server action принимает .xlsx, а предел по умолчанию — 1 МБ.
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  env: {
    VERSION: process.env.VERSION || 'dev',
  },
};

module.exports = nextConfig;
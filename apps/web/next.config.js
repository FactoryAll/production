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
    // 3 МБ, а не 10: книга разбирается в памяти целиком, и на сервере 1 ГБ (web 560 МБ, куча 384 МБ)
    // большая книга убивала контейнер. Значение обязано совпадать с IMPORT_MAX_FILE_BYTES
    // в lib/nsi-import/limits.ts — там же объяснение, откуда взялось число.
    serverActions: {
      bodySizeLimit: '3mb',
    },
  },
  env: {
    VERSION: process.env.VERSION || 'dev',
  },
};

module.exports = nextConfig;
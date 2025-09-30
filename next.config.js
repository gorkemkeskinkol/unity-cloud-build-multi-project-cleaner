/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    esmExternals: false,
  },
  webpack: (config) => {
    // SQLite3 için webpack konfigürasyonu
    config.externals.push({
      'sqlite3': 'commonjs sqlite3'
    });
    return config;
  },
  // Mantine için CSS-in-JS desteği
  transpilePackages: ['@mantine/core', '@mantine/hooks', '@mantine/notifications'],
};

module.exports = nextConfig;

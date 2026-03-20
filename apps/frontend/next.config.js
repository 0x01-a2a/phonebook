const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  env: {
    API_URL: process.env.API_URL || 'http://localhost:3001',
  },
  async rewrites() {
    const backend = process.env.API_URL || 'http://localhost:3001';
    return [
      {
        source: '/api/broadcasts/:path*',
        destination: `${backend}/api/broadcasts/:path*`,
      },
      {
        source: '/api/voice/:path*',
        destination: `${backend}/api/voice/:path*`,
      },
      {
        source: '/api/audio/:path*',
        destination: `${backend}/api/audio/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

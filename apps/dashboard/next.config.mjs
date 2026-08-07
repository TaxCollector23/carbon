/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@carbon/ui'],
  output: 'standalone',
};
export default nextConfig;

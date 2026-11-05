/** @type {import('next').NextConfig} */
const nextConfig = {
  // Outbound list uploads (CSV) can be up to 4 MB.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};
export default nextConfig;

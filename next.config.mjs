/** @type {import('next').NextConfig} */
const nextConfig = {
  // Outbound list CSVs and Follow-ups pictures (up to 6 x 10 MB, usually much smaller).
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};
export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Outbound list CSVs and Follow-ups pictures (up to 6 x 10 MB, usually much smaller).
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  // The Xtime button loads its code from here while on Xtime's site.
  async headers() {
    return [{ source: "/brand/:file(xtime-.*\\.js)", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cache-Control", value: "no-cache" }] }];
  },
};
export default nextConfig;

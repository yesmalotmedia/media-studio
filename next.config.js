/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // needed on Next 14.x for instrumentation.js (register()) to run — this is
  // how the auto-ingest folder watcher (lib/ingest.js) gets started once when
  // the server boots. Stable-by-default from Next 15 on.
  experimental: { instrumentationHook: true },
};
export default nextConfig;

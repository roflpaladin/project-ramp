/** @type {import('next').NextConfig} */
const nextConfig = {
  // The refund policy lives at /refunds; /refund is a common guess (and was
  // typed into Paddle's KYB form), so it must never 404.
  async redirects() {
    return [{ source: "/refund", destination: "/refunds", permanent: true }];
  },
};

export default nextConfig;

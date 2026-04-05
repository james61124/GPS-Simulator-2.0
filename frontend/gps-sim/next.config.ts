/** @type {import("next").NextConfig} */
const internalDjango =
  process.env.INTERNAL_DJANGO_URL ||
  process.env.BACKEND_URL ||
  "http://127.0.0.1:8000"

const nextConfig = {
  async rewrites() {
    const base = String(internalDjango).replace(/\/$/, "")
    return [
      {
        source: "/api/:path*",
        destination: `${base}/api/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
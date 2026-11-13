import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
let apiOrigin = "";
try {
  apiOrigin = new URL(apiUrl).origin;
} catch {
  apiOrigin = "";
}

// Map tiles, style and fonts (MapLibre + OpenFreeMap by default; NEXT_PUBLIC_MAP_STYLE_URL can point elsewhere)
let mapOrigin = "https://tiles.openfreemap.org";
try {
  mapOrigin = new URL(process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty").origin;
} catch {
  /* keep the default */
}

const connectSrc = [
  "'self'",
  apiOrigin,
  mapOrigin,
  "https://*.onrender.com",
  "https://*.sentry.io",
  "https://*.ingest.sentry.io",
  "https://*.ingest.us.sentry.io",
]
  .filter(Boolean)
  .join(" ");

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  // MapLibre renders in a web worker created from a blob
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  `connect-src ${connectSrc}`,
  "frame-src 'self' https://accounts.google.com https://js.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// Default to Report-Only first so real traffic can be observed before enforcing;
// set NEXT_PUBLIC_CSP_ENFORCE="true" to switch to enforced Content-Security-Policy.
const cspHeaderKey =
  process.env.NEXT_PUBLIC_CSP_ENFORCE === "true"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";

const nextConfig: NextConfig = {
  // Docker image (frontend/Dockerfile) builds a self-contained server; Vercel ignores this when unset
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // Allow images from common real estate image sources
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "cdn.example.com" },
      { protocol: "https", hostname: "*.cloudflare.com" },
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
    ],
  },

  // Security & PWA headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options",    value: "nosniff" },
          { key: "X-Frame-Options",            value: "DENY" },
          { key: "X-XSS-Protection",           value: "1; mode=block" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",         value: "camera=(), microphone=(), geolocation=(self)" },
          { key: "Strict-Transport-Security",  value: "max-age=31536000; includeSubDomains" },
          { key: cspHeaderKey,                 value: cspDirectives },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type",  value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  },

  // No root redirect — / now serves the public marketing landing page

  // Enable React strict mode for better dev warnings
  reactStrictMode: true,
};

export default nextConfig;

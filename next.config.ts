import type { NextConfig } from "next";

/**
 * Configure allowed remote image patterns for Supabase Storage.
 * Note for Phase 10 CSP: The Content Security Policy header (img-src) must
 * permit this Supabase origin (process.env.NEXT_PUBLIC_SUPABASE_URL).
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [];

if (supabaseUrl && typeof supabaseUrl === "string") {
  try {
    const trimmed = supabaseUrl.trim();
    if (trimmed) {
      const parsed = new URL(trimmed);
      remotePatterns.push({
        protocol: (parsed.protocol.replace(":", "") as "http" | "https") || "https",
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        pathname: "/storage/v1/object/public/menu-images/**",
      });
    }
  } catch {
    // Malformed URL or non-standard format; gracefully do not crash Next.js build
  }
}

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
  images: {
    remotePatterns,
  },
};

export default nextConfig;

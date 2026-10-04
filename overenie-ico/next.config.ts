import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["xlsx", "playwright-core", "@sparticuz/chromium"],
  // binárky Chromia pre serverless funkcie, ktoré spúšťajú prehliadač (agent AI, diagnostika)
  outputFileTracingIncludes: {
    "/api/ai/fallback": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/diag": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;

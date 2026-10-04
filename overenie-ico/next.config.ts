import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["xlsx", "playwright-core", "@sparticuz/chromium"],
  // Chromium (~80 MB) sa pribaľuje len k funkciám, ktoré spúšťajú prehliadač (agent AI, skriptované dopyty, diagnostika);
  // hlavná funkcia preverenia ostáva malá a štartuje rýchlo.
  outputFileTracingExcludes: {
    "*": ["./node_modules/@sparticuz/chromium/**", "./node_modules/playwright-core/**"],
  },
  outputFileTracingIncludes: {
    "/api/ai/fallback": ["./node_modules/@sparticuz/chromium/**", "./node_modules/playwright-core/**"],
    "/api/browser/flow": ["./node_modules/@sparticuz/chromium/**", "./node_modules/playwright-core/**"],
    "/api/diag": ["./node_modules/@sparticuz/chromium/**", "./node_modules/playwright-core/**"],
  },
};

export default nextConfig;

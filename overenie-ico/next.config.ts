import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["xlsx", "playwright-core", "@sparticuz/chromium"],
  // Chromium (~80 MB) sa pribaľuje len k funkciám, ktoré spúšťajú prehliadač (agent AI, skriptované dopyty, diagnostika) – ostatné
  // funkcie kód prehliadača neimportujú (lib/sources/public.ts volá /api/browser/flow cez HTTP), preto ostávajú malé a štartujú rýchlo.
  // Závislosti (tar-fs …) sa stopujú automaticky; globálne vylúčenie by ich odstránilo.
  outputFileTracingIncludes: {
    "/api/ai/fallback": ["./node_modules/@sparticuz/chromium/**", "./node_modules/playwright-core/**"],
    "/api/browser/flow": ["./node_modules/@sparticuz/chromium/**", "./node_modules/playwright-core/**"],
    "/api/diag": ["./node_modules/@sparticuz/chromium/**", "./node_modules/playwright-core/**"],
  },
};

export default nextConfig;

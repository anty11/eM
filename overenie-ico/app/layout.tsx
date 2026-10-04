import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Obozretne – overenie dodávateľa a odberateľa podľa IČO", template: "%s · Obozretne" },
  description:
    "Overte si dodávateľa a odberateľa vo verejných registroch SR tak, ako to vyžaduje judikatúra Súdneho dvora EÚ: obchodný register, dane a DPH, poisťovne, konkurzy, závierky, médiá. Protokol s časovou pečiatkou.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body>{children}</body>
    </html>
  );
}

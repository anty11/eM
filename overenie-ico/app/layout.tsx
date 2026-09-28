import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Preverenie partnera podľa IČO",
  description: "Kontrola subjektu vo verejných registroch SR – obchodný register, dane, poisťovne, konkurzy, závierky, médiá.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body>{children}</body>
    </html>
  );
}

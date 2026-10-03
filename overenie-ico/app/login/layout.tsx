import type { Metadata } from "next";

/** Prihlásenie / klientska sekcia – bez indexovania vyhľadávačmi. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

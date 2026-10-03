import type { Metadata } from "next";

/** Klientska sekcia – nie je určená na indexovanie vyhľadávačmi. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

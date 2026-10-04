import { LegalPage, legalMetadata } from "../components/site/LegalPage";

export const metadata = legalMetadata("/obchodne-podmienky");
export default function Page() {
  return <LegalPage href="/obchodne-podmienky" />;
}

import { LegalPage, legalMetadata } from "../components/site/LegalPage";

export const metadata = legalMetadata("/pravne-upozornenie");
export default function Page() {
  return <LegalPage href="/pravne-upozornenie" />;
}

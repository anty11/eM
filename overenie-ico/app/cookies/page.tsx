import { LegalPage, legalMetadata } from "../components/site/LegalPage";

export const metadata = legalMetadata("/cookies");
export default function Page() {
  return <LegalPage href="/cookies" />;
}

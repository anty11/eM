import { LegalPage, legalMetadata } from "../components/site/LegalPage";

export const metadata = legalMetadata("/ochrana-osobnych-udajov");
export default function Page() {
  return <LegalPage href="/ochrana-osobnych-udajov" />;
}

import { LegalPage, legalMetadata } from "../components/site/LegalPage";

export const metadata = legalMetadata("/spracovanie-udajov");
export default function Page() {
  return <LegalPage href="/spracovanie-udajov" />;
}

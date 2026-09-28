/**
 * Ukážkový režim na lokálne vyskúšanie bez prístupu k registrom:
 * v .env.local nastavte DEMO_DATA=1 – všetky registre vrátia testovacie údaje.
 * V produkcii (npm run build / Vercel) sa ukážkový režim nikdy nezapne.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DEMO_DATA === "1" && process.env.NODE_ENV !== "production") {
    const { installMock } = await import("./test/mock");
    installMock();
    console.log("⚠ DEMO_DATA=1 – registre vracajú TESTOVACIE údaje (IČO 47244895 = v poriadku, 31318177 = rizikový).");
  }
}

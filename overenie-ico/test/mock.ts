/** Náhrada fetch s odpoveďami v štruktúre reálnych API – pre offline testy a náhľad UI. */
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
export const GOOD = "47244895";
export const BAD = "31318177";

const rpoEntity = (ico: string, bad: boolean) => ({
  id: bad ? 1 : 784628,
  identifiers: [{ value: ico, validFrom: "2013-01-09" }],
  fullNames: bad
    ? [{ value: "C.C.C. s.r.o.", validFrom: "2025-11-01" }]
    : [
        { value: "URBAN s.r.o., advokátska kancelária", validFrom: "2013-01-09", validTo: "2017-12-31" },
        { value: "URBAN & PARTNERS s.r.o., advokátska kancelária", validFrom: "2024-01-16" },
      ],
  addresses: [
    { validFrom: "2024-01-16", street: "Červeňova", regNumber: 0, buildingNumber: "15", postalCodes: ["811 03"], municipality: { value: "Bratislava - mestská časť Staré Mesto" }, country: { value: "Slovenská republika", code: "703" } },
  ],
  legalForms: [{ value: { value: "Spoločnosť s ručením obmedzeným", code: "112" }, validFrom: "2013-01-09" }],
  establishment: bad ? "2025-11-01" : "2013-01-09",
  statutoryBodies: [
    { stakeholderType: { value: "Konateľ" }, statutoryBodyMember: { value: "Konateľ" }, validFrom: "2013-01-09", validTo: "2022-10-03", personName: { formatedName: "JUDr. Peter Starý" } },
    { stakeholderType: { value: "Konateľ" }, statutoryBodyMember: { value: "Konateľ" }, validFrom: bad ? "2025-11-01" : "2022-10-04", personName: { formatedName: "JUDr. Ján Vzor" } },
  ],
  stakeholders: [
    { stakeholderType: { value: "Spoločník" }, validFrom: "2013-01-09", validTo: "2024-01-15", personName: { formatedName: "JUDr. Peter Starý" } },
    { stakeholderType: { value: "Spoločník" }, validFrom: bad ? "2026-08-01" : "2024-01-16", personName: { formatedName: "JUDr. Ján Vzor" } },
  ],
  activities: [
    { economicActivityDescription: "poskytovanie právnych služieb,", validFrom: "2013-01-09" },
    { economicActivityDescription: "sprostredkovateľská činnosť v oblasti obchodu", validFrom: "2013-01-09" },
    { economicActivityDescription: "zrušená činnosť", validFrom: "2013-01-09", validTo: "2015-01-01" },
  ],
  equities: [{ validFrom: "2013-01-09", value: 5000, currency: { code: "EUR" } }],
  statisticalCodes: { mainActivity: { value: "Právne činnosti", code: "69100" } },
  sourceRegister: { value: { value: "Obchodný register", code: "1" }, registrationOffices: [{ value: "Mestský súd Bratislava III" }], registrationNumbers: [{ value: "Sro/125611/B" }] },
});

// Šablóna s 3 tabuľkami ako Úč POD (zjednodušená – rovnaké texty kľúčových riadkov)
const sablona = {
  id: 699,
  tabulky: [
    { nazov: { sk: "Strana aktív" }, pocetDatovychStlpcov: 4, riadky: [{ text: { sk: "SPOLU MAJETOK r. 02 + r. 33 + r. 74" } }, { text: { sk: "Neobežný majetok" } }] },
    { nazov: { sk: "Strana pasív" }, pocetDatovychStlpcov: 2, riadky: [
      { text: { sk: "SPOLU VLASTNÉ IMANIE A ZÁVÄZKY" } }, { text: { sk: "Vlastné imanie r. 81 + ..." } }, { text: { sk: "Výsledok hospodárenia za účtovné obdobie po zdanení /+-/" } }, { text: { sk: "Záväzky r. 102 + ..." } },
    ] },
    { nazov: { sk: "Výkaz ziskov a strát" }, pocetDatovychStlpcov: 2, riadky: [
      { text: { sk: "Čistý obrat (časť účt. tr. 6 podľa zákona)" } }, { text: { sk: "Výnosy z hospodárskej činnosti spolu" } }, { text: { sk: "Výsledok hospodárenia za účtovné obdobie po zdanení (+/-)" } },
    ] },
  ],
};
const vykaz = (bad: boolean) => ({
  id: 10330401,
  idSablony: 699,
  obsah: {
    tabulky: [
      { nazov: { sk: "Strana aktív" }, data: ["1953410", "158730", "1794680", "1444581", "", "", "", ""] },
      { nazov: { sk: "Strana pasív" }, data: bad ? ["50000", "60000", "-42000", "-1000", "-41000", "-3000", "92000", "61000"] : ["1794680", "1444581", "923155", "891686", "31469", "30000", "871525", "552895"] },
      { nazov: { sk: "Výkaz ziskov a strát" }, data: bad ? ["12000", "40000", "12000", "40000", "-41000", "-3000"] : ["979872", "902131", "980463", "1001870", "31469", "30000"] },
    ],
  },
});

function socpoistXlsx(): Buffer {
  const rows: any[][] = [["Názov", "Adresa", "Mesto", "IČO", "Suma"]];
  for (let i = 0; i < 1500; i++) rows.push([`Firma ${i}`, "Ulica 1", "Mesto", String(40000000 + i), "10,00 €"]);
  rows.push(["''C.C.C.'' s.r.o.", "Námestie Biely kríž 1110/1", "Bratislava", BAD, "5 933,27 €"]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Dlžníci");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
const socBuf = socpoistXlsx();

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
export const calls: string[] = [];

export function installMock() {
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  calls.push(url);
  const u = new URL(url);
  const icoParam = u.searchParams.get("ico") || u.searchParams.get("identifier") || u.searchParams.get("search") || u.searchParams.get("query") || "";
  const bad = url.includes(BAD) || url.includes("id=1&") || /entity\/1\?/.test(url) || url.includes("id=999");

  if (u.host === "api.statistics.sk") {
    if (url.includes("/search")) return json({ results: [rpoEntity(icoParam, icoParam === BAD)] });
    return json(rpoEntity(bad ? BAD : GOOD, bad));
  }
  if (u.host === "www.registeruz.sk") {
    if (url.includes("uctovne-jednotky")) return json({ id: [icoParam === BAD ? 999 : 1472260], existujeDalsieId: false });
    if (url.includes("uctovna-jednotka")) return json({ id: 1, ico: bad ? BAD : GOOD, dic: bad ? "2020000001" : "2023674466", idUctovnychZavierok: bad ? [5] : [7026251, 6519074] });
    if (url.includes("uctovna-zavierka")) {
      const id = u.searchParams.get("id");
      const yr = id === "6519074" ? "2024" : "2025";
      return json({ id, datumZostaveniaK: `${yr}-12-31`, datumPodania: `${Number(yr) + 1}-06-30`, idUctovnychVykazov: [id === "5" ? 555 : 10330401], typ: "Riadna" });
    }
    if (url.includes("uctovny-vykaz")) return json(vykaz(u.searchParams.get("id") === "555"));
    if (url.includes("sablona")) return json(sablona);
  }
  if (u.host === "iz.opendata.financnasprava.sk") {
    if (!init?.headers?.key) return json({ error: "missing key" }, 401);
    if (url.endsWith("/api/lists"))
      return json([{ slug: "ds_dsdd", name: "Zoznam daňových dlžníkov" }, { slug: "ds_dphs", name: "Zoznam registrovaných platiteľov DPH" }, { slug: "ds_dphz", name: "Zoznam platiteľov DPH, u ktorých nastali dôvody na zrušenie registrácie" }, { slug: "ds_ids", name: "Index daňovej spoľahlivosti" }, { slug: "ds_dppo", name: "Daňové subjekty PO s výškou dane z príjmov" }]);
    const slug = u.pathname.split("/")[3];
    const col = u.searchParams.get("column");
    const term = u.searchParams.get("search") || "";
    if (col !== "ico") return json({ data: [] });
    const isBad = term === BAD;
    if (slug === "ds_dsdd") return json({ data: isBad ? [{ ico: BAD, nazov: "C.C.C.", suma: "12 345,67" }] : [] });
    if (slug === "ds_dphs") return json({ data: [{ ico: term, ic_dph: isBad ? "SK2020000001" : "SK2023674466" }] });
    if (slug === "ds_dphz") return json({ data: isBad ? [{ ico: BAD }] : [] });
    if (slug === "ds_dppo") return json({ data: isBad ? [] : [{ ico: term, rok: "2024", dan: "5 100,00" }, { ico: term, rok: "2025", dan: "7 830,00" }] });
    if (slug === "ds_ids") return json({ data: [{ ico: term, index: isBad ? "menej spoľahlivý" : "vysoko spoľahlivý" }] });
    return json({ data: [] });
  }
  if (u.host === "www.socpoist.sk") {
    if (url.includes("/api/idsp/download/")) return new Response(new Uint8Array(socBuf), { status: 200 });
    return new Response('<a href="/api/idsp/download/ed57da4c-93aa-4198-ae4b-b2d65d3ca099">Stiahnuť</a>', { status: 200 });
  }
  if (u.host === "replik.justice.sk")
    return new Response(icoParam === BAD ? `<td>${BAD}</td><td>Konkurz</td>` : "<div>Nenašli sa žiadne záznamy</div>", { status: 200 });
  if (u.host === "rpvs.gov.sk") return json({ value: [] });
  if (u.host === "api.anthropic.com") {
    const body = JSON.parse(init?.body || "{}");
    const userText: string = body.messages?.[0]?.content || "";
    if (!userText.includes("IČO") && !userText.includes("OK")) return json({ error: { message: "bad" } }, 400);
    if (userText.startsWith("Odpovedz")) return json({ content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: {} });
    const firstUrl = (userText.match(/- (https:\/\/\S+)/) || [])[1];
    const isBad = userText.includes(BAD);
    const fabricate = userText.includes("12345679");
    const isRpo = userText.includes("Identifikuj subjekt");
    const out = isRpo
      ? { result: "found", summary: "Subjekt nájdený v OR SR.", findings: [], evidence: [{ url: firstUrl, quote: "Obchodné meno" }],
          data: { name: "AI FIRMA s.r.o.", legalForm: "Spoločnosť s ručením obmedzeným", established: "2015-03-01", statutory: [{ name: "Ing. AI Konateľ", role: "konateľ", since: "2015-03-01" }], lastStatutoryChange: "2015-03-01", inLiquidation: false } }
      : { result: isBad ? "found" : "clean", summary: isBad ? "Subjekt je v zozname." : "Subjekt v zozname nie je.", findings: [],
          evidence: [{ url: fabricate ? "https://www.socpoist.sk/vymyslena-stranka" : firstUrl, quote: "zoznam" }], data: isBad ? { amount: 999 } : {} };
    // prvé volanie: pause_turn (overenie pokračovania), druhé: výsledok
    const paused = body.messages.length === 1;
    const fetchBlock = { type: "web_fetch_tool_result", tool_use_id: "t1", content: { type: "web_fetch_result", url: firstUrl, content: {} } };
    if (paused) return json({ content: [{ type: "server_tool_use", id: "t1", name: "web_fetch", input: { url: firstUrl } }, fetchBlock], stop_reason: "pause_turn", usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } } });
    return json({ content: [{ type: "text", text: `Hotovo.\n<json>${JSON.stringify(out)}</json>` }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 30 } });
  }
  if (u.host === "news.google.com")
    return new Response(
      `<rss><channel><item><title>${u.searchParams.get("q")} – polícia obvinila konateľa z podvodu</title><link>https://x.sk/1</link><pubDate>${new Date().toUTCString()}</pubDate></item><item><title>Nová pobočka</title><link>https://x.sk/2</link></item></channel></rss>`,
      { status: 200 },
    );
  return new Response("not mocked", { status: 404 });
}) as typeof fetch;
}


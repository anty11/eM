# Stav aplikácie – kontrolné body

Každý riadok je stav nasadený na Vercel, ku ktorému sa dá vrátiť. Návrat: `git checkout <tag>` na pozretie,
`git revert` alebo `git reset --hard <tag>` + push na skutočné vrátenie (po resete `git push --force-with-lease`).

## v1.1.0 – 3. 10. 2026 (tag `v1.1.0`, commit `8dfe900` + dokumentácia)

**Nasadené a funkčné na Vercel (projekt e-m):**

- Prihlásenie, správa používateľov a pozvánok, dvaja administrátori, audit preverení.
- Preverenie IČO so streamovaním výsledkov (každý zdroj sa zobrazí hneď, limit 25 s), tlačidlo „Skúsiť znova“ pri zdroji.
- Zdroje: RPO, RÚZ, Finančná správa (dlžníci, DPH, index spoľahlivosti, daň z príjmov – s kľúčom `FS_API_KEY`),
  Sociálna poisťovňa (index v Redis, cron 04:20), REPLIK (insolvencia/likvidácia – len riadky výsledkov),
  RPVS, médiá (Google News/Bing/DuckDuckGo + priame slovenské weby; štatutári, bývalé názvy, skratky).
- 9 kľúčových faktov advokáta, karta kontaktu, režimy Firma / Advokát, PDF protokol.
- AI záložné overenie len na tlačidlo (predvolene vypnuté), kľúč z env alebo od admina.
- Diagnostika `/api/diag` len pre admina; karta pokrytia sa klientovi nezobrazuje.

**Známe otvorené body k tomuto stavu:**

- Priame vyhľadávanie v slovenských médiách (`lib/sources/slovakMedia.ts`) zatiaľ neoverené proti skutočným webom.
- Prvé preverenie po nasadení vracia pri Sociálnej poisťovni „zoznam sa pripravuje“ – zoznam sa buduje na pozadí, treba kliknúť „Skúsiť znova“.
- Na Vercel majú byť zmazané `AI_AUTO_FALLBACK`, `AI_NO_API_SOURCES` a po prvom prihlásení `ADMIN_SETUP_CODE`.
- Médiá pre testovacie IČO 47244895 majú ukázať články z r. 2022 (NAKA/korupcia) – naživo ešte nepotvrdené.

**Testy:** `npm run typecheck`, `npm test` (offline) prechádzajú.

## v1.1.1 – 3. 10. 2026 – kompaktný PDF protokol

- PDF protokol prepracovaný na 2 strany A4 (predtým 5–6) pri zachovaní všetkých údajov: hlavička s názvom a IČO,
  verdikt s dôvodmi v dvoch stĺpcoch, kľúčové otázky, kontakt a poznámky ako text (nie formulár), identifikácia
  v troch stĺpcoch, kontroly ako riadky s číslovaným odkazom `[n]` a zoznamom „Odkazy na zdroje“ na konci.
- Stavy a skóre sú čitateľné aj bez tlače pozadia (rámčeky a farba textu namiesto farebných plôch).
- Kontrola: dev server s `DEMO_DATA=1`, prihlásenie, preverenie IČO 31318177 (rizikový) a 47244895, „Uložiť PDF protokol“ – očakávané 2 strany.

## v1.2.0 – 3. 10. 2026 – databáza preverených spoločností

- Stránka **Preverené spoločnosti** (`/account`, odkaz v hlavičke): všetky spoločnosti preverené kanceláriou, zoradené od posledného
  preverenia, s výsledkom, kým boli preverené a vekom preverenia („overené dnes / včera / pred X dňami“).
- Preverenie staršie ako **180 dní** je červené s poznámkou „odporúčame opakované preverenie“; filter „Len na opakované preverenie“, „Len moje preverenia“, hľadanie.
- Tlačidlo **↻ Preveriť znova** pri každej spoločnosti spustí nové preverenie; administrátor môže záznam odstrániť.
- Záznam vzniká pri každom preverení (`recordScan` v `/api/check`); staršie preverenia sa pri prvom načítaní doplnia z auditu.
- Kód: `lib/companies.ts`, `lib/ago.ts`, `app/api/companies/route.ts`, `app/components/CompanyList.tsx`, `app/account/page.tsx`; test `test/companies.test.ts`.

## v1.3.0 – 4. 10. 2026 – verejný web, objednávka, overuje spoločnosť sama

- **Verejný web na `/`**: prezentácia produktu (prečo overovať – judikatúra SD EÚ a § 69 ods. 14 zákona o DPH, čo overujeme, ako to funguje,
  pre koho, kancelárie URBAN & PARTNERS a LEXNERA Legal, dve verzie Štandard / Rozšírené, časté otázky), stránka `/pravny-zaklad`
  a objednávka `/objednavka` (ukladá sa do databázy, administrátor ju vidí v Administrácii → Objednávky z webu a mení stav; voliteľný `ORDER_WEBHOOK_URL`).
- **Klientska sekcia presunutá na `/app`** (`/app?ico=…`); `/account`, `/admin` a všetky API ostávajú za prihlásením; po prihlásení sa ide na `/app`.
  Verejné stránky sú indexovateľné, klientska sekcia má `noindex`.
- **Texty**: overenie vykonáva spoločnosť sama prostredníctvom poverených zamestnancov – nie advokát. Verzie sa volajú **Štandard** (`firma`)
  a **Rozšírené** (`advokat` – identifikátor ostal kvôli uloženým údajom). Protokol: „Vypracoval (poverený zamestnanec)“, „štandardné / rozšírené overenie“.
- Farby a kontakty kancelárií sú na jednom mieste: `app/site.css` (premenné `--s-*`) a `app/components/site/SiteShell.tsx` (`FIRMS`).
- **v1.3.1** – paleta podľa webov kancelárií (odmerané zo screenshotov): tmavý web, fialová `#7e31fb` a gradient `#170c28 → #2b1551` (URBAN & PARTNERS),
  zlatá `#c09040` / `#a67b30` a hnedočierna `#1e1512` (LEXNERA); písma Montserrat + Playfair Display (Google Fonts); karty kancelárií každá vo svojej farbe
  s textovými logotypmi. Skutočné logá (SVG) ešte treba doplniť.
- Kód: `app/page.tsx`, `app/pravny-zaklad/page.tsx`, `app/objednavka/page.tsx`, `app/site.css`, `app/components/site/SiteShell.tsx`,
  `lib/orders.ts`, `app/api/order`, `app/api/admin/orders`, `app/components/OrdersPanel.tsx`, `proxy.ts`; test `test/orders.test.ts`.

## v1.3.2 – 4. 10. 2026 – svetlá vlastná identita webu, prevádzkovateľ vs. odborná záštita

- Web má vlastnú svetlú identitu (pozadie `#faf9fc`, indigovo-fialová `#5b35c9` ako hlavná farba – zjemnená Urban `#7e31fb`, zlatá `#b8893a` – stlmená LEXNERA),
  mäkké prechody medzi časťami (tónované pozadia, žiadne ostré pásy); jediný tmavší pás „Pre koho“ sa rozplýva do pozadia, päta prechádza plynulo.
- Pokojnejšie nadpisy (bez hrozieb v titulkoch); právny obsah ostal v texte a na stránke Právny základ.
- **Prevádzkovateľ je samostatná s.r.o.** (`OPERATOR` v `SiteShell.tsx` – pracovný názov a e-mail treba nahradiť skutočnými), advokátske kancelárie sú
  „odborná záštita“ len s popisom a odkazom na ich web – bez adries, e-mailov a telefónov. Súhlas v objednávke a päta odkazujú na prevádzkovateľa.

## v1.3.3 – 4. 10. 2026 – názov Preverto (preverto.sk)

- Produkt sa volá **Preverto** („prever to“), doména preverto.sk; prevádzkovateľ pracovne Preverto s.r.o., e-mail info@preverto.sk.
  Všetko na jednom mieste: `PRODUCT`, `DOMAIN`, `OPERATOR` v `app/components/site/SiteShell.tsx`, hlavička aplikácie `app/components/Header.tsx`, titulky v `app/layout.tsx`.
- PDF protokol má v hlavičke značku preverto.sk. Úvodný titulok webu: „Prever to. Obchodného partnera preveríte rýchlo, spoľahlivo a s protokolom.“

## v1.3.4 – 4. 10. 2026 – klientska sekcia v palete webu

- Klientska sekcia (prihlásenie, preverenie, preverené spoločnosti, administrácia) používa rovnakú paletu a písma ako verejný web
  (indigovo-fialová `#5b35c9`, zlaté nadpisy kariet, Montserrat + Playfair Display). Premenné v `app/globals.css` `:root` + tmavý režim.
- **PDF protokol je nezmenený**: blok `@media print` v `globals.css` má vlastné farby aj písma (Inter/Georgia) a nezávisí od palety obrazovky.
- Web: bez FAQ a karty prevádzkovateľa; verzie ako porovnávacia tabuľka (Rozšírené prvé); poradie sekcií Prečo → Pre koho → Objednávka → Čo → Ako → O projekte.

## v1.3.5 – 4. 10. 2026 – logo

- Hlavné logo je **wordmark** „prever·to“ (`Wordmark` v `app/components/Logo.tsx`): „prever“ v indigovo-čiernej, „to“ v zlatej, indigová bodka; variant `onDark` pre pätu.
- **Symbol** (len kde treba znak): pečať – dvojitý kruh so zlatou fajkou (`Seal` tamtiež), favicon `app/icon.svg`. Paragraf § sa už nepoužíva – produkt nie je právna služba.
- Použitie: hlavička webu (s podtitulom „overenie obchodného partnera“), päta, hlavička klientskej sekcie („klientska sekcia“). PDF protokol nezmenený.

## v1.3.6 – 4. 10. 2026 – chýbajúce závierky za 2+ období

- Samostatný **kritický** nález (−40, verdikt NEODPORÚČAME), ak účtovná závierka chýba za dve a viac po sebe idúcich účtovných období
  (od poslednej uloženej alebo od vzniku spoločnosti) – nesplnenie povinnosti za 2+ období je dôvodom na zrušenie spoločnosti súdom (§ 68b ods. 1 písm. c) ObZ).
  Jedno chýbajúce obdobie ostáva upozornením (−12). Kľúčová otázka „Podala účtovnú závierku?“ to uvádza výslovne.
- Kód: `lib/sources/ruz.ts` (`missingFilingPeriods`, data `missingPeriods`, `dissolutionRisk`), `lib/keyfacts.ts`; test v `test/offline.test.ts`.
- **v1.3.7** – chýbajúce závierky sa posudzujú len za obdobia s uplynutou lehotou (`filingStatus` v `ruz.ts`): mladá spoločnosť, ktorá ešte nemusela podať,
  nemá za závierky žiadnu zrážku (len za vek); vznik v októbri–decembri posúva prvé obdobie o rok (§ 3 ods. 4 ZoÚ); jedno chýbajúce = −12, dve a viac = kritické −40.

## v1.4.0 – 4. 10. 2026 – indikátory rizika SKDP 03/2024

- Nová karta **Údaje o obchode a indikátory rizika**: smer obchodu, predmet (porovnanie s predmetom podnikania + pripomienka povolení pri regulovaných činnostiach),
  IBAN partnera (overenie v zozname bankových účtov platiteľov DPH FS – neoznámený účet = kritické, ručenie § 69 ods. 14 písm. c)), hodnota;
  9 indikátorov na posúdenie zamestnancom (vrátane platieb v hotovosti), tri stavy, zápis do protokolu, vplyv na verdikt (`lib/deal.ts`, `DealCard.tsx`, `/api/check/iban`).
- Automaticky: neaktívna spoločnosť (tržby < 1 000 €), spoločník v rizikovej jurisdikcii, časté zmeny spoločníkov, zmena vlastníka/štatutára za posledných 180 dní.
- Karta kontaktu: „Oprávnenie konať za spoločnosť je doložené (plná moc / poverenie)“ – indikátor (v).
- Virtuálne sídlo sa zámerne nerieši. Dokumentácia: `docs/ZDROJE.md` – sekcia Indikátory. Test `test/deal.test.ts`. PDF ostáva na 2 stranách.

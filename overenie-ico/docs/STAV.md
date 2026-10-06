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
- **v1.4.1** – IČO, ktoré sa v Registri právnických osôb nenájde, preverenie zastaví: zobrazí sa len karta „IČO sa v registri nenašlo“ s postupom
  (kontrola IČO, zahraničný subjekt, výpis z OR), ostatné registre ani indikátory sa nevyhodnocujú, záznam sa nezapíše do databázy preverených spoločností
  (audit ho eviduje s verdiktom `not_found`). Výpadok RPO (chyba API) sa od „nenájdené“ odlišuje – vtedy preverenie pokračuje.

## v1.5.0 – 4. 10. 2026 – názov Obozretne (obozretne.sk)

- Produkt premenovaný z Preverto na **Obozretne** (doména obozretne.sk, prevádzkovateľ pracovne Obozretne s.r.o., e-mail info@obozretne.sk) – Preverto kolidovalo s konkurenciou.
- Wordmark: „obozretne“ so zlatým prvým písmenom a zlatou bodkou (číta sa ako výrok „Obozretne.“); pečať s fajkou ostáva symbolom a faviconou.
- Úvodný titulok: „Obchodujte obozretne. Partnera preveríte rýchlo, spoľahlivo a s protokolom.“ PDF protokol má v hlavičke obozretne.sk.
- **v1.5.1** – ochrana údajov vo výstupoch: v protokole, PDF, JSON exporte, karte kontaktu a zozname preverených spoločností sa uvádza len **meno**
  povereného zamestnanca, nikdy e-mail („poverený zamestnanec“, ak meno nie je nastavené). E-maily ostávajú len v audite a v administrácii.
  Odporúčanie: administrátor nastaví používateľom mená (Administrácia → Používatelia).

## v1.6.0 – 4. 10. 2026 – pečať protokolu a overovacia stránka

- Pri „Uložiť PDF protokol“ sa konečný obsah (výsledky, manuálne overenia, údaje o obchode, karta kontaktu, poznámka, vypracovateľ) pošle na server,
  ten vypočíta **SHA-256 z kanonického JSON**, zapíše pečať (čas, odtlačok, verdikt, skóre, meno) do databázy (`seals:<scanId>`) a auditu a vráti ju;
  až potom sa otvorí tlač. Rovnaký obsah = rovnaká pečať a pôvodný čas; zmena obsahu = nová pečať #2, #3…
- Protokol tlačí riadok „Pečať protokolu #n: odtlačok … zapísaný dd. mm. rrrr hh:mm:ss · overenie: obozretne.sk/overit/<číslo>“ + úplný odtlačok.
- **Verejná stránka `/overit/<číslo protokolu>`** (bez prihlásenia, noindex): časy preverenia a pečatí, verdikt, skóre, odtlačky – bez osobných údajov.
  Pripravené pole `tsa` pre kvalifikovanú časovú pečiatku (RFC 3161 / eIDAS) od tretej strany.
- Kód: `lib/seal.ts`, `app/api/protocol/seal`, `app/overit/[scanId]/page.tsx`, `app/app/page.tsx` (`sealAndPrint`), `proxy.ts`; test `test/seal.test.ts`. Bez poplatkov.
- **v1.6.1** – overovacia stránka vyžaduje **náhodný overovací kód** (10 znakov, vytlačený v riadku „Pečať protokolu“ a v adrese
  `/overit/<číslo>/<kód>`). Číslo protokolu je z IČO a času uhádnuteľné, kód nie – bez neho stránka neukáže nič, ani existenciu protokolu
  (informácie o obchodných vzťahoch klientov nie sú odhaliteľné hádaním). 20 pokusov za hodinu z jednej adresy. `/overit/<číslo>` bez kódu zobrazí len formulár na jeho zadanie.

## v1.7.0 – 4. 10. 2026 – existujúca spolupráca a spätné preverenie (len Rozšírené)

- Nad vyhľadávaním (len verzia Rozšírené) prepínač **Nová spolupráca / Existujúca spolupráca od <dátum>**. Pri existujúcej sa preverenie vykoná
  normálne k dnešku a navyše každý zdroj doplní, čo bolo k rozhodnému dátumu zistiteľné: obchodný register (názov, sídlo, štatutári, spoločníci,
  zápisy o zrušení, vek, zmeny po dátume), register závierok (uložené k dátumu podľa dátumu podania, chýbajúce splatné obdobia vtedy), register úpadcov
  (konania pred / v roku / po rozhodnom dátume podľa spisovej značky), médiá (články pred dátumom). Zoznamy FS a SP: výslovne „k dátumu neoveriteľné“.
- Protokol: zvýraznený rámček „Spätné preverenie vyhotovené <dnes> k rozhodnému dátumu začiatku spolupráce <dátum>“ a blok „Stav k rozhodnému dátumu“.
  Verdikt a skóre vždy vyjadrujú dnešný stav; dátum vyhotovenia sa nikdy nemení (antedatovanie nie je možné). Pečať aj overovacia stránka nesú oba dátumy.
- API `/api/check?asOf=YYYY-MM-DD` – len pre používateľov Rozšírené, dátum v minulosti (≥ 1993). Databáza preverení ukladá dnešný dátum.
- Kód: `lib/retro.ts`, `lib/sources/{rpo,ruz,insolvency,news}.ts` (pole `data.asOf`), `app/app/page.tsx`, `lib/seal.ts` (`asOf` v odtlačku). Test `test/retro.test.ts`.
- Tlač zhustená (prázdne údaje o obchode = jeden riadok), všetky varianty protokolu na 2 stranách.
- **v1.7.1** – AI dohľadanie sa na verejnom webe už neuvádza (ostáva internou záložnou funkciou v klientskej sekcii na tlačidlo, predvolene vypnuté);
  demo meno vo všetkých ukážkach a testoch je Janko Mrkvička.

## v1.8.0 – 4. 10. 2026 – web: podstránky a náhľad skrátenej úvodnej strany

- Spätná väzba: príliš veľa textu na úvodnej strane, pôsobí chaoticky. Riešenie odsúhlasené: rozhodnutia súdov presunuté do `/pravny-zaklad`
  (nová časť „4. Kľúčové rozhodnutia a ustanovenia v skratke“), nové podstránky **`/co-overujeme`**, **`/ako-to-funguje`**, **`/pre-koho`**
  (verejné, v navigácii; na užších obrazovkách rozbaľovacie menu „Viac“).
- Úplná porovnávacia tabuľka verzií je na `/objednavka#porovnanie` (pod formulárom); na úvodnej strane bude len 7 kľúčových riadkov s odkazom.
- **Náhľad novej úvodnej strany na `/nahlad`** (noindex): úvod → Prečo overovať (jeden odsek, citát, odkaz) → tri karty-odkazy na podstránky →
  skrátená tabuľka → O projekte (karty kancelárií bez úvodného odseku) → záverečná výzva. Pôvodná úvodná strana `/` zatiaľ bez zmeny obsahu
  (len refaktor – zdieľané texty). Po odsúhlasení sa obsah `/nahlad` presunie do `app/page.tsx` a `/nahlad` sa zruší.
- Kód: `app/components/site/content.tsx` (REGISTERS, FEATURES s príznakom `key`, CASES, STEPS, AUDIENCES, `CompareTable`), `app/components/site/Hero.tsx`
  (`Hero`, `Firms`), `SiteShell.tsx` (`NavKey`, menu „Viac“), `app/site.css` (`.s-more`, `.s-why`, `.s-teaser`, kotvy pod hlavičkou), `proxy.ts` (PUBLIC).
- **v1.8.1** – skrátená úvodná strana nasadená na `/` (náhľad `/nahlad` zrušený); riadok tabuľky „Údaje o obchode a indikátory rizika podľa
  Bulletinu SKDP 03/2024“ premenovaný na „Indikátory rizika“ (odkaz na SKDP ostáva v poznámke úplnej tabuľky). Podtitul loga v jednom riadku.
- **v1.8.2** – verejná stránka **`/overit`** (vstup na overenie protokolu bez adresy z PDF: číslo protokolu + overovací kód, vysvetlenie, čo
  overenie ukáže); odkaz „Overiť protokol“ v navigácii (pod 1460 px v menu „Viac“) a v päte. Na stránke objednávky má úplná tabuľka verzií
  rovnakú šírku ako formulár (780 px); tlačidlá v hlavičke tabuliek na jednom riadku.
- **v1.8.3** – nadpisy „Náležitá starostlivosť…“ a „Samostatný projekt…“ na úvodnej strane na jednom riadku (`.s-head.wide`); päta má stĺpec
  **Právne dokumenty** (obchodné podmienky, ochrana osobných údajov, zmluva o spracúvaní údajov, cookies, právne upozornenie – zatiaľ stránky
  „dokument sa pripravuje“, šablóna `app/components/site/LegalPage.tsx`, zoznam `LEGAL_DOCS` v `SiteShell.tsx`); „Overiť protokol“ vypustené
  z hornej navigácie aj päty – odkaz je pod prihlasovacím formulárom (`/login`) a adresa je v PDF; objednávka: nadpis, formulár a tabuľka
  v jednom vycentrovanom stĺpci 780 px.

## v2.0.0 – 4. 10. 2026 – viacfiremný režim: každá firma vidí len svoje dáta

- **Model:** správcovia platformy (prevádzkovateľ; 2 – 3 účty, vznikajú výlučne cez `ADMIN_EMAILS` + `ADMIN_SETUP_CODE`, nedajú sa kúpiť ani
  vytvoriť v aplikácii) → **firmy** (klienti; názov, IČO, balík Štandard / Rozšírené, počet používateľských miest, stav aktívna / pozastavená)
  → **používatelia** firmy (patria práve do jednej firmy; počet obmedzený miestami). Správcu firmy zatiaľ nemáme – používateľov spravuje len prevádzkovateľ.
- **Oddelenie dát:** preverenia, databáza preverených spoločností, karty kontaktov, protokol činností a adresár kolegov sú uložené pod kľúčmi
  `org:<id>:…` (`lib/orgs.ts` → `orgKey`). Každé API určí firmu cez `orgScope()`: používateľ vždy len vlastnú (parameter `org` sa ignoruje),
  správca platformy musí firmu zvoliť (`?org=`, výber v hornej lište ukladaný v prehliadači), inak chyba – nikdy sa nespadne do cudzej firmy.
  Pečať protokolu nesie `orgId`/`orgName`; číslo protokolu patrí firme, ktorá ho zapečatila prvá. Verzia Štandard / Rozšírené je vlastnosťou firmy.
- **Prihlásenie:** pozastavená firma = jej používatelia sa neprihlásia a existujúce relácie prestanú platiť; používateľ bez firmy sa neprihlási.
- **Administrácia:** panel Firmy (založenie, balík, miesta, pozastavenie, poznámka; „Založiť firmu“ priamo z objednávky), používatelia zvolenej firmy
  (pridanie len do voľných miest, nový kód, blokovanie, meno, zmazanie), zoznam správcov platformy (len nový kód a meno), protokol činností
  s výberom firmy / platformy. Protokol PDF a overovacia stránka uvádzajú názov preverujúcej firmy.
- **Prechod:** pri prvom prihlásení po nasadení sa – ak existujú doterajšie dáta – založí firma `test` („Obozretne – test“, Rozšírené, 10 miest),
  doterajší používatelia sa do nej priradia a pôvodná databáza preverení, karty kontaktov a protokol činností sú pre ňu dostupné (`LEGACY_ORG`).
  Pri čistej inštalácii sa nič nevytvára. Správcovia platformy ostávajú bez firmy.
- Kód: `lib/orgs.ts`, `lib/auth/{users,guard}.ts`, `lib/{companies,contacts,audit,seal}.ts`, `app/api/admin/orgs`, `app/api/admin/users`,
  `app/components/{OrgsPanel,org,Header}.tsx`, `app/admin/page.tsx`. Testy: `test/orgs.test.ts` (oddelenie a prechod), aktualizované auth/companies/seal.
- **v2.0.1** – hodnotenie: strop upozornení 40 a bonusu +10 (upozornenia bez kritického nálezu = najviac „S výhradou“); právne skutočnosti z RPO
  sa zaraďujú (`classifyLegalFact`) – zlúčenia / splynutia, kde je spoločnosť nástupcom, už nie sú „konanie o zrušení“ (príčina skóre 0 pri veľkých a. s.,
  napr. Slovnaft), kritický postih za zrušenie sa počíta raz, záložné práva sú informácia; zmeny členov veľkých orgánov sa nehodnotia jednotlivo.
  RPO: jeden opakovaný pokus pri pomalej odpovedi. Chybné zdroje majú odkaz „Otvoriť“ na register aj v zozname manuálnych overení. FS OpenData: širšie
  rozpoznanie prehľadávateľných stĺpcov a diagnostika v chybovej správe. AI: poznámka o obmedzení (OpenAI bez otvárania stránok), kratší limit. Test `test/scoring.test.ts`.
- **v2.0.2** – RÚZ: zlyhanie načítania závierky už nevyzerá ako „závierka chýba“ (opakovaný pokus, inak výsledok „neúplný“ bez zrážky);
  pri viacerých účtovných jednotkách na IČO sa vyberie platná s najviac závierkami; zavedená spoločnosť bez jedinej závierky v RÚZ (6+ splatných
  období) = upozornenie na manuálne overenie (−12), nie kritický nález „34 období“ (Slovnaft). Manuálne overenie: poznámka „čo ste zistili“
  (ide do zhrnutia, nálezu a protokolu), manuálny výsledok má prednosť pred výsledkom AI, tlačidlo „Zahodiť výsledok AI“. `CheckResult.manual`.

## v2.1.0 – 4. 10. 2026 – registre bez API: priame dopyty servera a import Obchodného vestníka

- `lib/sources/public.ts`: diskvalifikácie, ÚVO, VšZP, Union – server položí dopyt priamo registru; prísne vyhodnotenie (nález / výslovne prázdny
  výsledok / inak manuálne). Výsledok nahradí manuálnu položku, inak ostáva manuálna s poznámkou „automatický dopyt sa nepodaril“.
- `lib/sources/ov.ts`: index Obchodného vestníka z XML vydaní (cron `/api/cron/ov` 04:40, ručný import `POST /api/admin/ov` s XML v tele,
  stav `GET /api/admin/ov`); kontrola „ov“ číta index, zaraďuje oznámenia a hodnotí 3 roky. Bez indexu ostáva manuálna.
- `/api/diag?source=<diskv|uvo|vszp|union>&ico=…&name=…` vráti všetky pokusy s výňatkami odpovedí; `/api/diag` ukazuje aj telo detailu zoznamu FS
  a stav indexu OV. Dôvera: výslovne ručne. CRE: poznámka o webovej službe (1,60 €), klient po registrácii.
- Klient: automaticky vyriešené „neverejné“ registre sa počítajú ako bežné kontroly; „Skúsiť znova“ funguje aj pre ne. Testy `test/public.test.ts`.
- **v2.1.1** – RPO: zmeny vlastníkov a štatutárov sa počítajú len ako skutočné zmeny osôb (zmena množiny mien), nie aktualizácie zápisu či
  opätovné zvolenie – pri Slovnafte odpadli „8 zmien štatutárov“ a „zmena štatutárneho orgánu pred 173 dňami“ (išlo o aktualizáciu zápisu
  jediného akcionára); pri orgáne nad 3 členov sa indikátor „zmena tesne pred obchodom“ hlási správne ako zmena vlastníka. Diagnostika
  `/api/diag?source=` vracia aj formuláre (action, metóda, polia), skripty a surový začiatok HTML – na doladenie dopytov do registrov bez API.
- **v2.1.2** – Administrácia → Diagnostika zdrojov: všetky zdroje (API aj bez API), surová odpoveď kľúčových adries pre dané IČO + výsledok
  kontroly, pri registroch bez API formuláre/skripty/HTML; „Spustiť všetky zdroje“ zloží jeden výstup (kopírovať / stiahnuť JSON).
  `/api/diag?source=<id>&ico=&name=` pre každý zdroj.
- **v2.1.3** – podľa prvej diagnostiky z produkcie: FS API vracia `searchable` ako reťazec oddelený čiarkou (opravené; daňoví dlžníci sa hľadajú
  len podľa názvu, DPH/IBAN podľa IČ DPH), skutočné slugy `ds_iz_ran` (index), `ds_dppos` (DPPO), `ds_dph_iban` (účty). Registre bez API:
  hlavičky prehliadača (justice.gov.sk vracal 403), prípravný krok s cookies (VšZP – vypnutie ochrany formulára, POST typ/nazov/docid/proceed),
  v diagnostike prehľadanie skriptov SPA (Union) na adresy API, odkazy na stránke a hľadanie datasetov na data.gov.sk (diskvalifikácie, ÚVO).
- **v2.1.4** – „bez záznamu“ pri registroch bez API vyžaduje, aby sa hlásenie o prázdnom výsledku týkalo hľadania (v okolí slovo záznam / dlžník /
  výsledok / subjekt) – druhá diagnostika ukázala, že VšZP by inak prešlo ako „bez záznamu“ bez istoty; dôkaz (úryvok) sa ukladá do výsledku.
  Diagnostika: okolie hľadaných reťazcov, vložené skripty, úryvky kódu z JS balíka (Union), varianty adries (justice.gov.sk bez www / http),
  stránka ÚVO s rozhodnutiami o zákaze účasti, hľadanie datasetov na data.slovensko.sk.
- **v2.1.5** – VšZP potvrdené (odpoveď „Nenašli sa žiadne záznamy.“ za hlavičkou tabuľky Obchodné meno · Obec · Ulica · PSČ · Pohľadávka);
  vyhodnotenie podľa registra (`judgeFor`): tabuľka bez IČO → počítajú sa dátové riadky. Register diskvalifikácií: justice.gov.sk blokuje
  adresy dátových centier → pokus cez **Edge runtime** vlastného nasadenia (`/api/edgefetch`, interný token zo SESSION_SECRET, povolené domény).
  Union: v diagnostike sa načítajú lenivé časti aplikácie (Debtors-*.js) a vytiahnu volania API. ÚVO: varianty `searchType` globálneho
  vyhľadávania, hodnoty výberu (`selects`) a text hlavného obsahu (`mainText`) v diagnostike.
- **v2.1.6** – Union: skutočné API portálu `POST /ehip-server/rest/debtors` (JSON; polia rplNazov, rplIco, suma) – skúšajú sa varianty názvu
  poľa pre hľadaný text, „bez záznamu“ len pri totalRows = 0. ÚVO: globálne vyhľadávanie `searchType=OSZ` (Osoba so zákazom), vyhodnotenie
  „N záznamov“ + blok s IČO a slovom zákaz. Register diskvalifikácií: justice.gov.sk vracia 403 aj cez Edge runtime → z Vercelu nedostupný
  (ostáva manuálne / AI; možnosť: proxy so slovenskou adresou).
- **v2.1.7** – AI: dvaja poskytovatelia naraz – kľúče na poskytovateľa (prostredie `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` alebo administrácia,
  šifrovane), správca prepína aktívneho poskytovateľa v Administrácii kedykoľvek (aj keď sú kľúče v prostredí), model na poskytovateľa;
  predvolený Claude. AI vypnutá s vysvetlením pre VšZP, Union (formulár / API – overuje server), Obchodný vestník (formulár) a Register
  diskvalifikácií (blokovanie); ÚVO cez globálne vyhľadávanie OSZ. Audit AI overení ide do protokolu firmy.
- **v2.1.8 – v2.1.9** – AI znova povolená pre VšZP, Union, Obchodný vestník a Register diskvalifikácií (na želanie: vyskúšať Claude web search na
  všetkých registroch; vypnutá ostáva len pre CRE a Dôveru). Zadania pre AI pri týchto registroch výslovne žiadajú „unknown“, ak sa stránka
  s výsledkom nedá otvoriť (nástroj web_fetch len načíta adresu – formulár nevyplní). Voliteľné hlavičky z prostredia: `ANTHROPIC_BETA`, `ANTHROPIC_WORKSPACE_ID` (kľúč organizácie bez
  pracovného priestoru hlási „API key is not scoped to a workspace“ – alebo vytvoriť kľúč priamo v pracovnom priestore).
- **v2.1.10** – Claude web_search bez `user_location` (API hlásilo „Country code SK is not supported“); prvé živé AI overenie s Claude.
- **v2.1.11** – Výsledok AI „unknown“ je v rozhraní zreteľný: štítok „AI nevedela overiť“, vysvetlenie, že AI otvorila len uvedené stránky
  a k výsledku vyhľadávania sa nedostala (nič nepotvrdila), v okne manuálneho overenia sa ukazuje zhrnutie AI namiesto pôvodného textu.

## v2.2.0 – 4. 10. 2026 – AI agent s prehliadačom na serveri

- **Agent s prehliadačom** (`lib/browser/session.ts`, `lib/ai/agent.ts`): pre registre za formulárom alebo aplikáciou (VšZP, Union, Obchodný
  vestník, Register diskvalifikácií, ÚVO) dostane model – Claude alebo OpenAI, podľa aktívneho poskytovateľa – nástroje `open_page`, `fill`,
  `click`, `press_enter`, `select_option`, `wait`, `read_page`. Headless Chromium beží na serveri (Vercel: `@sparticuz/chromium`; lokálne
  `CHROMIUM_PATH`; vzdialený prehliadač `BROWSER_WS_ENDPOINT` cez CDP – aj so slovenskou IP adresou pre justice.gov.sk). Model vidí kompaktnú
  snímku stránky (očíslované polia, tlačidlá, výbery, odkazy, tabuľky, text) a smie otvárať len oficiálne domény zdroja; obrázky/fonty sa nenačítavajú.
- **Nezávislá kontrola tvrdení** (`verifyAgentClaims`): „bez záznamu“ platí len po skutočnom odoslaní formulára a bez IČO pri údajoch o zázname
  na stránke s výsledkom; „nájdený“ len ak IČO alebo názov server naozaj videl. Dôkaz zo stránky s výsledkom dopĺňa server (`serverQuote`).
  Zamietnuté tvrdenie → „AI nevedela overiť“ s dôvodom. V rozhraní: režim (agent / webové vyhľadávanie), počet krokov, rozbaľovací záznam akcií.
- Ak prehliadač nie je k dispozícii, použije sa webové vyhľadávanie s poznámkou. `BROWSER_DISABLED=1` agenta vypne. Limit funkcie AI 300 s.
- Diagnostika: zdroj „Prehliadač na serveri“ – spustenie Chromia a snímky vstupných stránok Union / VšZP / OV / diskvalifikácií.
- ÚVO potvrdené naživo („Zadaný výraz nebol nájdený.“ pre Slovnaft, searchType=OSZ); pridaný dopyt podľa obchodného mena pred IČO.
  Union: API `/ehip-server/rest/debtors` vracia 401 pre priame volania (token aplikácie) → rieši agent s prehliadačom.
- Testy: `test/agent.test.ts` – skutočné Chromium proti lokálnemu registru, simulované API Claude aj OpenAI, kontrola tvrdení, zapojenie do aiCheck.
- **v2.2.1** – Vercel: do funkcií sa pribaľuje celý `playwright-core` (chýbal `browsers.json`) a celý `@sparticuz/chromium`.
- **v2.2.2** – Chromium na Verceli potvrdené (153.0.8010.0; portál Union sa načítal: pole „Zadajte priezvisko, IČO, obchodný názov, obec“,
  tlačidlo Hľadať, tabuľka s IČO a pohľadávkou, „1–10 z 81934“). Každé sedenie má vlastný prehliadač – zdieľaná inštancia po zavretí
  kontextu padala (`Target page … has been closed`, ERR_INSUFFICIENT_RESOURCES). **Union automaticky bez AI:** skriptovaný dopyt cez prehliadač
  (`lib/browser/flows.ts` – vyplní IČO, Hľadať, prečíta tabuľku; „bez záznamu“ len po skutočnom hľadaní, nie z úvodného zoznamu) ako záloha
  po API (401). Diagnostika: strop 25 s na stránku, klient čaká najviac 150 s a hlási prekročenie limitu.

## v2.3.0 – 4. 10. 2026 – výkon a škálovanie: vyrovnávacia pamäť výsledkov, oddelená funkcia prehliadača

- **Vyrovnávacia pamäť výsledkov** (`cache:check:<verzia>:<zdroj>:<IČO>` v Redise, TTL 6 h; médiá 2 h, Sociálna poisťovňa 12 h): registre sa
  menia nanajvýš denne, takže opakované preverenie toho istého IČO – iným používateľom, návratom k firme, obnovením stránky – je okamžité
  a nezaťažuje registre ani limity ich API (pripravené na tisíce preverení denne). Ukladajú sa len úspešné výsledky (nie chyby/manuálne);
  spolu s nimi údaje profilu, ktoré zdroj doplnil (RPO identifikácia, DIČ z RÚZ…). Výsledok z pamäte je označený „· uložené“.
  „Preveriť znova“ (`fresh=1`) pamäť obíde a obnoví; „Skúsiť znova“ pri zdroji zmaže len ten zdroj; spätné preverenie k dátumu pamäť nepoužíva.
- **Oddelená funkcia prehliadača** `/api/browser/flow` (interný token): Chromium (~80 MB) sa pribaľuje len k nej, k AI agentovi a k diagnostike
  (`outputFileTracingExcludes` pre ostatné). Hlavná funkcia preverenia ostáva malá → rýchly studený štart (pomalé „0 z 10“ po nasadení).
- Registre bez API majú vlastný limit 55 s (prehliadač + hľadanie), ÚVO/diskvalifikácie čakajú na RPO, ostatné sa spúšťajú hneď; funkcia
  preverenia 120 s. Pri neúspechu automatického dopytu sa pri manuálnej kontrole zobrazí dôvod („Automatický pokus: …“).
- Finančná správa: zrozumiteľná chyba, keď sa zoznam prehľadáva len podľa názvu (ds_dsdd) a názov nie je známy (identifikácia v RPO zlyhala).
- **v2.3.1** – Vyrovnávacia pamäť výsledkov je **predvolene vypnutá** (zmyslom preverenia je aktuálny stav registrov); zapína sa len vedome
  `CHECK_CACHE_MIN` (minúty) ako ochrana pred opakovaným načítaním tej istej firmy pri veľkej prevádzke. Oprava balenia Chromia: globálne
  vylúčenie zo stopovania odstránilo aj závislosti (`tar-fs` → „Cannot find package 'tar-fs'“); namiesto toho funkcia preverenia kód
  prehliadača vôbec neimportuje (volá `/api/browser/flow` cez HTTP, lokálne `SELF_ORIGIN`) a Chromium so závislosťami sa stopuje len
  do troch funkcií prehliadača (overené v stope zostavenia).

## v2.4.0 – 4. 10. 2026 – agent potvrdený naživo (Obchodný vestník), rýchlejší agent, OV skriptom bez AI

- **Prvé živé overenie agentom**: OpenAI gpt-5.5 cez prehliadač prešiel Obchodným vestníkom (11 krokov, ~60 s) – vyhľadal IČO Slovnaftu
  s dátumom od 3 rokov, prečítal tabuľku (len podania OR) → „bez záznamu“ s citátmi z výsledkovej tabuľky; serverová kontrola prešla.
- **Úvod bez AI (`searchPrelude`)**: server pred prvým volaním modelu sám prijme cookies, nájde pole IČO, vyplní ho, nastaví dátum „od“
  a odošle; model dostane rovno snímku výsledku a spravidla rozhodne bez jediného kroku (test: 0 krokov) – namiesto ~60 s okolo 10 – 15 s.
  Model môže zreťaziť viac akcií v jednej odpovedi. Záznam krokov obsahuje aj kroky servera.
- **Obchodný vestník bez AI**: skriptovaný dopyt cez prehliadač (`ovFlow`) pri každom preverení, keď import vydaní nie je zapnutý –
  oznámenia sa triedia ako pri importe XML (`classifyNotice`); negatívne = záznam, len podania OR / závierky = bez záznamu; viac strán = AI/manuálne.
  Diagnostika: zdroj „Obchodný vestník cez prehliadač“.

## v2.5.0 – 5. 10. 2026 – živý priebeh AI overenia

- Počas „Overiť cez AI“ sa pod tlačidlom (na karte aj v okne manuálneho overenia) priebežne vypisuje, čo agent práve robí – s časom od
  začiatku: „Otváram obchodnyvestnik.justice.gov.sk/…“, „Vypĺňam pole „IČO“: 31322832“, „Klikám na „Vyhľadať““, „Na stránke: tabuľka
  s 11 riadkami“, „AI vyhodnocuje stránku…“, krátke vety modelu o tom, čo robí a prečo, a nakoniec výsledok serverovej kontroly
  („Overené: bez záznamu …“ / „Tvrdenie AI zamietnuté: …“). Posledný krok je zvýraznený, hlavička ukazuje sekundy a počet akcií.
- Technicky: `/api/ai/fallback?stream=1` vracia NDJSON (`step` → `result` / `error`, srdcový tep každých 10 s); udalosti vznikajú
  v `BrowserSession` (akcie s popisom poľa/tlačidla podľa snímky, stručný popis stránky – titulok, tabuľka, počet, hlásenie o prázdnom
  výsledku), v agentovi (úvod servera, volania modelu, text modelu popri akciách) a v `aiCheck` (kontrola prehliadača, web, overenie).
  Model dostal pokyn písať pred akciami jednu krátku vetu (ide len do živého priebehu, nie do JSON výsledku).
- **v2.5.1** – Preverenie už nečaká na Register právnických osôb: pri pomalom API ŠÚ SR (vyhľadanie 2× 11 s + výpis) bolo „0 z 10“
  až 25 s, lebo všetky zdroje štartovali až po RPO. Teraz štartujú všetky hneď; podľa IČO idú RÚZ, Sociálna poisťovňa, REPLIK, RPVS
  a registre bez API, na meno čakajú len FS, médiá, ÚVO a diskvalifikácie – najviac 14 s, potom sa použije názov a sídlo z RÚZ.
  RÚZ čaká na údaje RPO najviac 6 s, výpis z RPO má limit 12 s. V karte „Preverujem…“ beží čas a po 12 s vysvetlenie pomalých registrov.
  Test: pri RPO oneskorenom o 3 s prídu Sociálna poisťovňa a REPLIK skôr.
- **v2.5.2** – Register právnických osôb: vyhľadanie so „zabezpečeným“ opakovaním (druhá súbežná požiadavka po 5 s, limit 18 s; predtým
  2× 11 s za sebou → „Časový limit vypršal (11s)“). **Záloha z Obchodného registra SR (orsr.sk)** – `lib/sources/orsr.ts`: vyhľadanie podľa
  IČO a aktuálny výpis (windows-1250) → obchodné meno, sídlo, právna forma, deň zápisu, oddiel/vložka, štatutárny orgán, spoločníci/akcionár,
  výmaz/likvidácia. Spustí sa, keď RPO neodpovie do 7 s alebo zlyhá; ak odpovie a RPO stále mešká, po 3 s sa použije (karta uvedie
  „podľa Obchodného registra SR (RPO neodpovedalo včas)“; história zmien štatutárov/vlastníkov sa vtedy nehodnotí). Pri chybe RPO
  odkaz „Otvoriť“ vedie na vyhľadanie IČO v orsr.sk. Diagnostika: zdroj „Obchodný register SR (orsr.sk)“ (surové HTML + rozpoznané údaje).
  Testy `test/orsr.test.ts` (výpis vo windows-1250, chyba RPO, pomalé RPO → záloha po ~10 s, obe nedostupné).
- **v2.5.3** – Web: v hornej lište je zlaté tlačidlo „Klientska sekcia“, „Objednať“ je biele (na mobile ostáva len Klientska sekcia, užšia).
- **v2.5.4** – Web: stránka Právny základ na celú šírku obsahu (1100 px, zarovnané s hlavičkou; predtým 800 px, úvod 720 px).

## v2.6.0 – 5. 10. 2026 – rýchly model AI ako predvolený

- Administrácia → Nastavenia AI: voľba **Rýchlosť overenia** – „Rýchly model (odporúčané)“ = Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
  / OpenAI GPT-6 Luna (`gpt-6-luna`), alebo „Štandardný model“ = `claude-sonnet-5` / `gpt-5.5`. Predvolene rýchly (aj bez uloženého
  nastavenia; `AI_SPEED=standard` v prostredí mení východiskovú hodnotu). „Vlastný model“ na poskytovateľa ostáva a voľbu prepíše.
  `AI_MODEL` z prostredia platí len, kým správca rýchlosť nezvolí.
- **Automatické zopakovanie**: ak kľúč rýchly model nepozná alebo model nepodporuje nástroj (napr. webové vyhľadávanie), overenie sa raz
  zopakuje so štandardným modelom – v živom priebehu „Rýchly model … nie je dostupný – skúšam štandardný …“, v protokole poznámka.
  „Otestovať spojenie“ v takom prípade otestuje aj štandardný model a zobrazí upozornenie. Chyby API obsahujú typ chyby (not_found_error…).
- Text v nastaveniach AI opisuje agenta s prehliadačom (predtým zastarané „AI vypnutá pre formuláre“, „30 – 90 s“).
- **v2.6.1** – Úvod bez AI našiel pole IČO aj na formulári Obchodného vestníka (ASP.NET: bez `<label>`, popis v susednej bunke, názov
  `ctl00$…$txtIco`) – `fieldKey()` odvodí kľúč z technického názvu, snímka berie popis aj z predchádzajúcej bunky / textu pred poľom.
  Vypĺňanie: neaktívne pole → okamžitá chyba „najprv zvoľ prepínač“ (predtým 8 s čakania), pole len na čítanie (výber dátumu) alebo zakryté
  → hodnota skriptom s udalosťami; klik pri zakrytom prvku skriptom; limity 3 – 4 s. Snímka označuje NEAKTÍVNE / len na čítanie.
  Predvolený model späť na **štandardný** (Haiku sa na OV zamotal: 63 s, 2× timeout dátumov) – rýchly ostáva na voľbu.

## v2.7.0 – 5. 10. 2026 – Jev (TypeSafe) na rýchle vyhodnotenie výsledku

- `lib/ai/jev.ts`: klient API `POST https://api.typesafe.ai/v1/systemone` (model `jev-latest`, otázka typu `choice`
  clean / found / unknown s pravdepodobnosťami a istotou). Kľúč `TYPESAFE_API_KEY` (alebo administrácia pri AI_ALLOW_ADMIN_KEY=1),
  v Administrácii → Nastavenia AI sekcia „Rýchle vyhodnotenie výsledku – Jev“: zapnutie, prah istoty (predvolene 85 %), test kľúča.
- **AI overenie**: po úvode servera (vyplnené IČO, odoslaný formulár) Jev vyhodnotí stránku; „bez záznamu“ s istotou nad prahom →
  hotovo bez LLM (server tvrdenie nezávisle overí podľa textu stránky, v protokole „Jev (TypeSafe) · server vyplnil formulár,
  Jev vyhodnotil výsledok“). Nález alebo nižšia istota → pokračuje Claude/OpenAI s odhadom Jev v zadaní (nález potrebuje detaily).
- **Automatické preverenie** (Union, Obchodný vestník cez prehliadač): keď pevné pravidlá výsledok neurčia, skúsi ho Jev – prijme sa
  len „bez záznamu“ nad prahom a bez IČO pri údajoch o dlhu na stránke.
- Popisy registrov pre Jev v `AI_SPECS[*].jev` (po anglicky – hlavný jazyk modelu; stránka je po slovensky, preto vysoký prah).
- Testy: Jev rozhodne „bez záznamu“ bez volania LLM (LLM 0 volaní); pri náleze len radí a rozhoduje LLM.

## v2.8.0 – 5. 10. 2026 – Prístupy k registrom v administrácii

- Nová karta **Administrácia → Prístupy k registrom** (`lib/access.ts`, `/api/admin/access`): prehľad, prečo zvyšné registre nie sú
  automatické a čo pomôže; **proxy pre registre blokujúce dátové centrá** (adresa `http://meno:heslo@host:port`, domény – predvolene
  justice.gov.sk, zapnutie, test: výstupná IP a krajina + dopyt do Registra diskvalifikácií) a **prístup k exportu Obchodného vestníka**
  (adresa s {date}, meno, heslo – použije ho nočný import). Heslá šifrovane (AES-256-GCM zo SESSION_SECRET); prostredie má prednosť
  (`REGISTRY_PROXY_URL`, `REGISTRY_PROXY_DOMAINS`, `OV_EXPORT_URL`…).
- Proxy používajú dopyty servera (`fetchWithTimeout` → undici `ProxyAgent` pre nastavené domény) aj prehliadač (kontext Playwright
  s proxy, keď register patrí medzi nastavené domény; v živom priebehu „Register ide cez proxy …“). Register diskvalifikácií skúša
  najprv priamy dopyt podľa IČO a priezvisk štatutárov (s proxy prejde), až potom Edge.
- `fold` presunuté do `lib/text.ts` (klientske komponenty už neťahajú serverový `lib/http`).
- Testy `test/access.test.ts`: lokálna proxy (CONNECT aj absolútne URL) – dopyt servera aj prehliadač idú cez ňu s prihlásením,
  iné domény priamo, vypnutie, šifrovanie, prístup k OV.

## v2.9.0 – 5. 10. 2026 – Záznam AI overení so súhrnom na zdieľanie

- **Administrácia → Záznam AI overení** (`lib/ailog.ts`, `/api/admin/ailog`, `AiLogPanel`): každé „Overiť cez AI“ a každý skriptovaný
  dopyt cez prehliadač (`/api/browser/flow` – Union, Obchodný vestník) sa uloží (posledných 200): register, IČO, model / Jev, výsledok,
  dôvod zamietnutia, čas, akcie so **stabilným popisom prvku** (name, popis, druh, vyplnená hodnota), stručné snímky navštívených stránok
  (polia formulára, tabuľky, text), živý priebeh. Tabuľka behov s filtrom podľa registra a detailom.
- **„Súhrn na zdieľanie“** (JSON, kopírovať / stiahnuť): za každý register počty výsledkov, priemerný čas, modely, koľkokrát rozhodol Jev,
  posledný úspešný postup ako „recept“ (len úspešné akcie: otvoriť URL → vyplniť pole name=… → kliknúť „…“) so záverečnou stránkou
  a posledný neúspech so všetkými stránkami a dôvodom. Podklad na prevod AI overenia na automatický dopyt bez AI (ako pri OV a Union).
- `BrowserSession`: `log[].target/value`, `pages` (max. 15 snímok, vstupná ostáva); `aiCheck` vracia `debug` (klientovi sa neposiela).
- Testy `test/ailog.test.ts` + kontrola cieľov akcií a snímok v teste agenta.
- **v2.9.1** – Podľa prvého súhrnu záznamu AI overení: **Obchodný vestník** vyhodnocoval len prvú stranu (10 z ~130 oznámení – riadok
  stránkovania „Aktuálna stránka: 1 2 … 13“ sa počítal ako oznámenie a stránkovanie sa nerozpoznalo) a filter „od“ sa nenastavil
  (polia od/do sú neaktívne, kým sa nezvolí prepínač rozsahu). Teraz: úvod servera zvolí najbližší nezaškrtnutý prepínač pred poľom
  „od“, vyplní od (3 roky) aj do; skript prepne na 100 záznamov na stránku a číta ďalšie stránky (klik na číslo strany podľa textu),
  kým sú oznámenia novšie ako 3 roky; riadky sa filtrujú podľa dátumu; neúplné čítanie bez nálezu = „neviem“. Union: dôkaz
  „Žiadne data · 0–0 z 0“. Test `test/ovflow.test.ts` (kópia štruktúry OV: prepínač, stránkovanie, nález na 2. strane, staré oznámenie).
- **v2.9.2** – Oprava právnych odkazov: ručenie odberateľa za DPH je v aktuálnom znení zákona č. 222/2004 Z. z. v **§ 69 ods. 13**
  (predpoklady písm. a) neprimeraná cena, b) personálne prepojenie, c) platba na účet nezverejnený v zozname FS), postup § 69b,
  osobitný spôsob úhrady § 69c – podľa Informácie FR SR 1/DPH/2026/I a odbornej tlače 2025/2026 (predtým § 69 ods. 14 – staré číslovanie).
  Zoznam platiteľov s dôvodmi na zrušenie registrácie už nie je opisovaný ako zákonný predpoklad ručenia, ale ako varovný signál;
  odstránené neisté odkazy na § 69 ods. 15 a § 81 ods. 4 písm. b). Upravené: úvod webu, Právny základ, karta právnych zdrojov,
  zistenie FS DPH, indikátory obchodu (cena, účet), karta obchodu, zadanie AI, ZDROJE.md.
- **v2.9.3** – `docs/ARCHITEKTURA.md`: živý dokument s diagramami (Mermaid) – celkový pohľad, priebeh preverenia, rozhodovací strom
  registrov bez API, AI agent a Jev, kto čo rozhoduje, zdroje a očakávané polia, dátové štruktúry (CheckResult, JSON modelu, Jev,
  záznam behu), testovanie a diagnostika, postup „AI → recept → skript“, konfigurácia. `test/docs.test.ts` stráži aktuálnosť
  (zdroje, zadania AI, premenné prostredia, testy, verzia); pravidlo v `CLAUDE.md`.
- **v2.9.4** – Chýbajúca účtovná závierka za minulý rok: **−15** (predtým −12) a odporúčanie vyžiadať si od partnera dôvod
  (`Finding.ask`); v karte RÚZ pole „Dôvod uvedený partnerom“ – zapíše sa do protokolu ako „Dôvod uvedený partnerom: …“ (skóre nemení,
  posúdenie je na zamestnancovi). Otázka aj pri 2+ chýbajúcich obdobiach (−40).
- **v2.9.5** – Chýbajúca účtovná závierka už nemôže skončiť „ODPORÚČAME“: LEXNERA Legal (závierka 2024, chýba 2025) mala
  100 − 15 + pozitíva = 92 → Odporúčame. Nové `Finding.cap = "caution"` – verdikt najviac „S výhradou“ a skóre najviac 84;
  použité pri chýbajúcej závierke za minulý rok a pri firme bez jedinej závierky v RÚZ.

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

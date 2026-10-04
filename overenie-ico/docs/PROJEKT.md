# Obozretne (Overenie IČO) – referencia projektu

Názov produktu a doména: **Obozretne · obozretne.sk** („obozretný podnikateľ“ – pojem z judikatúry o náležitej starostlivosti; predchádzajúce pracovné názvy Preverto a Preverenie partnera boli opustené pre konkurenciu). Prevádzkovateľ: samostatná spoločnosť (pracovne Obozretne s.r.o.), odborná záštita URBAN & PARTNERS a LEXNERA Legal. Názov je na jednom mieste: `PRODUCT`, `DOMAIN`, `OPERATOR` v `app/components/site/SiteShell.tsx` + hlavička aplikácie `app/components/Header.tsx`.

Jediný zdroj pravdy o tom, kde aplikácia beží, ako je poskladaná a ako sa na nej pracuje.
Čítať pred akoukoľvek zmenou. Podrobnosti k zdrojom sú v [ZDROJE.md](ZDROJE.md), nasadenie v [DEPLOYMENT.md](DEPLOYMENT.md).

## Čo to je

Produkt pre firmy (zastrešený advokátskymi kanceláriami URBAN & PARTNERS a LEXNERA Legal): verejný web `/` s prezentáciou, právnym základom a objednávkou; klientska sekcia `/app`, kde poverení zamestnanci spoločnosti zadajú IČO partnera, preverí sa vo verejných registroch SR,
vyhodnotí sa skóre a vydá sa verdikt **ODPORÚČAME / S VÝHRADOU / NEODPORÚČAME** s výsledkom na obrazovke
a PDF protokolom s časovou pečiatkou. Dve verzie: **Štandard** (`firma`, predvolená) a **Rozšírené** (`advokat` – identifikátor ostal kvôli uloženým údajom)
(vyskakovacie okno so zoznamom manuálnych kontrol neverejných registrov). Prístup len po prihlásení,
používateľov spravujú administrátori.

## Kde beží

| Čo | Hodnota |
|---|---|
| GitHub | `anty11/eM`, aplikácia v podpriečinku **`overenie-ico/`**; push do `main` nasadí |
| Adresy | `/` verejný web · `/pravny-zaklad` · `/objednavka` · `/overit/<číslo protokolu>/<overovací kód>` (verejné overenie pečate; bez kódu len formulár) · `/login` · klientska sekcia `/app` (`/app?ico=…`) · `/account` preverené spoločnosti · `/admin` |
| Vercel | projekt **`e-m`**, Root Directory `overenie-ico`, Framework Next.js, región `fra1` |
| Cron | `vercel.json` → `/api/cron/socpoist` denne 04:20 (stiahne a zaindexuje zoznam dlžníkov SP) |
| Databáza | Upstash Redis cez Vercel Marketplace (premenné s predponou `KV_`); `lib/auth/kv.ts` prijme aj `*_REST_API_URL/TOKEN` alebo `REDIS_URL`; bez databázy beží lokálne v pamäti |
| Administrátori | `antonincajka@gmail.com`, `lichnermonika@gmail.com` (zriadia sa cez `ADMIN_EMAILS` + `ADMIN_SETUP_CODE` na `/login` → prvé nastavenie) |
| Testovacie IČO | **47244895** – URBAN & PARTNERS s.r.o. (predtým URBAN GAŠPEREC BOŠANSKÝ, URBAN STEINECKER GAŠPEREC BOŠANSKÝ); médiá musia nájsť články z r. 2022 (NAKA, korupcia) → očakávaný verdikt S VÝHRADOU |

## Technológie

Next.js 16 (App Router, route handlers, `proxy.ts` ako middleware, `after()`, `instrumentation.ts`), React 19,
TypeScript, `@upstash/redis`, `xlsx` + `fflate`, `tsx` na testy.
**Táto verzia Next.js sa líši od staršej dokumentácie** – pred zmenami v Next-špecifickom kóde pozrieť `node_modules/next/dist/docs/`.

Príkazy: `npm run dev` · `npm run build` · `npm run typecheck` · `npm test` (offline testy s falošným `fetch` v `test/mock.ts`).
Lokálne bez internetu: `DEMO_DATA=1 npm run dev`.

## Mapa kódu

| Súbor | Úloha |
|---|---|
| `lib/scan.ts` | spustí všetky zdroje naraz, limit 25 s (`DEADLINE_MS`), každý výsledok hneď odošle cez `onProgress`; `runOne()` zopakuje jeden zdroj (tlačidlo „Skúsiť znova“); `APP_VERSION` |
| `lib/sources/meta.ts` | názvy, kategórie a adresy automatických zdrojov, `pendingCheck()` |
| `lib/sources/rpo.ts` | RPO (api.statistics.sk): identita, štatutári, vlastníci, činnosti, dátumy zmien, zrušenie/likvidácia (kritické) |
| `lib/sources/ruz.ts` | RÚZ (registeruz.sk): DIČ, účtovné závierky, ukazovatele, podanie závierky, test krízy §67a |
| `lib/sources/fs.ts` | OpenData Finančnej správy (`iz.opendata.financnasprava.sk/api`, hlavička `key`): dlžníci `ds_dsdd`, DPH `ds_dphs/dphz/dphv`, index spoľahlivosti `ds_ids` (pole `ids`), daň z príjmov `ds_dppo`; prehľadávateľné stĺpce z `/lists/{slug}`; 404 „Search not found“ = nie je v zozname; VIES ako náhrada pre DPH bez kľúča |
| `lib/sources/socpoist.ts` | zoznam dlžníkov Sociálnej poisťovne (ZIP/XLSX) – index v Redis (`sp:idx:*`, `sp:meta`, zámok `sp:lock`), buduje sa na pozadí alebo cronom, **nikdy sa neparsuje v požiadavke** |
| `lib/sources/insolvency.ts` | REPLIK (replik.justice.sk) – spracúvajú sa **iba riadky výsledkov** `(IČO: X) - druh č. číslo`; stránka vždy obsahuje slová filtra, preto sa nikdy nehľadá v surovom texte |
| `lib/sources/rpvs.ts` | RPVS OData v2, dvojkrokové vyhľadanie, koneční užívatelia výhod |
| `lib/sources/news.ts`, `slovakMedia.ts` | médiá: Google News/Bing RSS, DuckDuckGo, priame vyhľadávanie v slovenských médiách; varianty mena, bývalé názvy, skratky (USGB), štatutári a priezviská partnerov; skóre relevancie a zoznam odmietnutých |
| `lib/keyfacts.ts` | 9 kľúčových otázok (zadanie z praxe daňových kontrol) · `lib/scoring.ts` skóre a verdikt (režim Firma ignoruje neverejné registre) |
| `lib/companies.ts`, `lib/ago.ts` | databáza preverených spoločností (Redis hash `companies`, jeden záznam na IČO, prvé doplnenie z auditu); vek preverenia, hranica `STALE_DAYS = 180` · API `app/api/companies` · zoznam v `app/components/CompanyList.tsx` na stránke `/account` |
| `lib/seal.ts`, `app/api/protocol/seal`, `app/overit/[scanId]` | pečať protokolu: SHA-256 z kanonického JSON pri uložení PDF, zápis s časom, verejná overovacia stránka; pole `tsa` pre kvalifikovanú časovú pečiatku |
| `lib/auth/*` | používatelia, scrypt heslá, HMAC cookie (12 h), pozvánky, limit pokusov, CSRF · `lib/audit.ts` záznam preverení a nastavení |
| `lib/ai/*` | záložné vyhľadávanie LLM (Anthropic web_search / OpenAI web_search). **Predvolene VYPNUTÉ** – spúšťa sa len tlačidlom „AI overiť“, nikdy pri každom preverení |
| `app/page.tsx`, `app/pravny-zaklad`, `app/objednavka`, `app/components/site/SiteShell.tsx`, `app/site.css` | verejný web: prezentácia, judikatúra, objednávka (`lib/orders.ts`, `/api/order`, admin panel `OrdersPanel`); kontakty kancelárií a farby na jednom mieste |
| `app/app/page.tsx` | klient so streamovaním (`/api/check?ico=&stream=1`), kľúčové fakty, karta kontaktu, Štandard/Rozšírené, opakovanie zdroja |
| `app/admin` | používatelia, AI kľúč, audit · `app/api/diag?ico=` diagnostika len pre admina; karta „Pokrytie overenia“ sa zobrazí len adminovi s `?diag` – **nikdy klientovi** |

## Premenné prostredia (Vercel → Production)

`SESSION_SECRET` (≥ 32 znakov) · `ADMIN_EMAILS` · `ADMIN_SETUP_CODE` (po prvom prihlásení zmazať) ·
`KV_REST_API_URL`, `KV_REST_API_TOKEN` (z integrácie Upstash) · `FS_API_KEY` (kľúč OpenData FS) · `APP_MODE=firma` ·
voliteľné `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, `AI_PROVIDER`, `AI_MODEL`, `AI_ALLOW_ADMIN_KEY`, `CRON_SECRET`, `ORDER_WEBHOOK_URL` (upozornenie na objednávku z webu).

`AI_AUTO_FALLBACK` a `AI_NO_API_SOURCES` **nenastavovať** (AI musí ostať len na tlačidlo). Každá zmena premenných vyžaduje redeploy.

## Práca na repozitári

- Pred pushom musí prejsť `npm run typecheck` a `npm test`.
- Overenie naživo: výstup aplikácie alebo JSON z `/api/diag` (admin). Vývojové prostredie bez prístupu na slovenské štátne a spravodajské weby sa spolieha práve na ne.
- Commity po slovensky, popisujú zmenu z pohľadu používateľa (pozri `git log`).
- Push cez fine-grained token GitHubu (Settings → Developer settings → Personal access tokens → Fine-grained):
  Resource owner `anty11`, Only select repositories → `eM`, Repository permissions: Contents *Read and write*, Metadata *Read*, platnosť ≤ 30 dní.
  Token sa použije len v príkaze, **nikdy sa neukladá do súborov ani do git configu**; po skončení práce ho zrušiť.

  ```bash
  T='<token>'
  AUTH="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$T" | base64 -w0)"
  git -c http.https://github.com/.extraheader="$AUTH" clone https://github.com/anty11/eM.git
  git -c user.name=anty11 -c user.email=74680657+anty11@users.noreply.github.com commit -am "…"
  git -c http.https://github.com/.extraheader="$AUTH" push origin main
  ```

- Pred pushom skontrolovať, že v kóde nie sú tajomstvá: `git grep -nE 'github_pat_|sk-[A-Za-z0-9]|KV_REST_API_TOKEN='`.

## Pravidlá overené v prevádzke

0. Ak IČO nie je v Registri právnických osôb, preverenie sa skončí – ostatné registre a indikátory sa nevyhodnocujú a nič sa nezapisuje do databázy preverení.

1. Výsledky sa zobrazujú priebežne (stream); žiadny pomalý zdroj nesmie blokovať ostatné. Ťažké veci idú na pozadie alebo do cronu.
2. Interné diagnostické karty sa klientovi nikdy nezobrazujú.
3. Negatívny nález musí vychádzať zo spracovaného riadku údajov, nie z textu, ktorý je na stránke vždy.
4. Médiá pokrývajú slovenské weby a hľadajú aj štatutárov, bývalé názvy a skratky – nie len presný aktuálny názov.
5. AI vyhľadávanie je len na kliknutie; nesmie míňať kredity automaticky.

# Preverenie partnera podľa IČO

Webová aplikácia pre advokátsku kanceláriu, prístupná len prihláseným používateľom: zadáte IČO a aplikácia overí subjekt vo verejných registroch SR. Z výsledkov vypočíta skóre rizika (0–100) a dá odporúčanie: **ODPORÚČAME / S VÝHRADOU / NEODPORÚČAME**. Výsledok uložíte ako PDF protokol s časom preverenia.

> 📄 Podrobná dokumentácia zdrojov, požadovaných údajov a pravidiel: [docs/ZDROJE.md](docs/ZDROJE.md) · Nasadenie a testovanie na Verceli: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Dve verzie

- **Firma** (predvolená, hlavná) je pre zamestnancov spoločnosti, ktorí si partnerov preverujú sami. Verdikt vychádza z verejných registrov. Neverejné registre (exekúcie, zdravotné poisťovne a i.) sú len v rozbaľovacej časti *Ďalšie odporúčané overenia* s odkazmi.
- **Advokát** navyše po každom preverení zobrazí okno *Overte manuálne* so zoznamom registrov, ktoré nie sú verejne dostupné. Advokát ich otvorí, označí *Bez záznamu / Záznam nájdený* a verdikt sa hneď prepočíta. Kým nie sú všetky potvrdené, je verdikt označený ako predbežný.

Verziu nastavuje administrátor každému používateľovi zvlášť (pri pridaní alebo neskôr v zozname používateľov). Predvolenú verziu pre nových používateľov môžete zmeniť premennou `APP_MODE=advokat`.

## Prehľad – kľúčové otázky

Na začiatku výsledku (aj v PDF) je prehľad s odpoveďami:

- Podala spoločnosť účtovnú závierku / daňové priznanie (rok a dátum uloženia, daň z príjmov)?
- Je vedené konanie o zrušení, výmaze alebo likvidácii (alebo insolvenčné konanie)?
- Aký je typ spoločnosti a aký je jej vek?
- Aký je predmet činnosti? (Celý zoznam predmetov podnikania je v identifikácii subjektu.)
- Kedy bola posledná zmena vlastníctva (spoločníkov) a kto je vlastníkom?
- Kedy bola posledná zmena štatutárneho orgánu a kto je štatutárom?
- Je spoločnosť spoľahlivý platiteľ DPH (registrácia, dôvody na zrušenie, index daňovej spoľahlivosti)?
- Má nedoplatky na daniach alebo v Sociálnej poisťovni?

## Komunikácia s partnerom

Pri každom partnerovi je karta:

- zaškrtnutie *S touto spoločnosťou komunikujeme / spolupracujeme*,
- kontaktná osoba u partnera, jej funkcia, telefón a e-mail,
- zaškrtnutie *Kontaktná osoba je štatutár*. Aplikácia porovná meno s obchodným registrom a upozorní, ak nesedí.
- zaškrtnutie *Totožnosť sme overili*,
- *Kto od nás s partnerom komunikuje*: výber kolegov z používateľov aplikácie,
- poznámka.

Karta sa ukladá k IČO, vidí ju celá firma a zobrazí sa pri každom ďalšom preverení toho istého partnera. Každá úprava sa zapíše do protokolu činností.

## Čo sa kontroluje

| Oblasť | Zdroj | Spôsob |
|---|---|---|
| Identifikácia, stav, štatutári, zmeny sídla/mena, likvidácia, zánik | Register právnických osôb (ŠÚ SR, údaje z ORSR) – `api.statistics.sk/rpo` | automaticky |
| Účtovné závierky, tržby, VH, vlastné imanie, záväzky, kríza § 67a ObZ, chýbajúce závierky | Register účtovných závierok – `registeruz.sk` API | automaticky |
| Daňoví dlžníci | Finančná správa – OpenData API | automaticky (s kľúčom) |
| DPH: registrácia, **dôvody na zrušenie registrácie** (ručenie § 69 ods. 14 ZDPH), vymazaní | Finančná správa – OpenData API | automaticky (s kľúčom) |
| Index daňovej spoľahlivosti | Finančná správa – OpenData API | automaticky (s kľúčom) |
| Daňové priznanie k dani z príjmov (rok, výška dane) | Finančná správa – OpenData API | automaticky (s kľúčom) |
| Dlžníci Sociálnej poisťovne | Celý zoznam SP (stiahnutý súbor, cache 6 h) | automaticky |
| Konkurz, reštrukturalizácia, likvidácia, zrušenie | Register úpadcov a likvidácií REPLIK (MS SR) + zápisy v obchodnom registri | automaticky, len pozitívny nález; inak manuálne potvrdenie |
| Koneční užívatelia výhod | Register partnerov verejného sektora (OData) | automaticky |
| Médiá, PR, negatívne správy | Google News RSS + odkazy na FinStat, Index podnikateľa, FOAF, CRZ | automaticky + odkazy |
| Exekúcie | Centrálny register exekúcií (spoplatnený, s prihlásením) | manuálne |
| VšZP, Dôvera, Union | Zoznamy dlžníkov (bez API, Dôvera automatizáciu zakazuje) | manuálne |
| Obchodný vestník, Register diskvalifikácií, ÚVO – zákaz účasti | MS SR, ÚVO | manuálne |

Pri kontrolách, ktoré treba overiť manuálne, aplikácia zobrazí odkaz na príslušný register a tlačidlá **Bez záznamu / Záznam nájdený**. Keď advokát výsledok označí, verdikt sa hneď prepočíta a výsledok sa zapíše do protokolu. Kým niektorá kontrola nie je potvrdená, verdikt je označený ako **predbežný**. Výnimka: ak sa nájde kritický záznam, verdikt NEODPORÚČAME platí hneď.

## Záložné AI vyhľadávanie

Keď register nie je dostupný cez API (výpadok, zmena formátu, chýbajúci kľúč) alebo API vôbec nemá (VšZP, Union, Obchodný vestník, Register diskvalifikácií, ÚVO), AI (Claude alebo OpenAI) vyhľadá údaje priamo na oficiálnej stránke registra.

- Výsledok sa uzná, len ak AI doloží odkaz na oficiálnu stránku, ktorú reálne otvorila. Inak kontrola ostáva na manuálne overenie.
- Výsledky majú štítok **Overené AI** s odkazmi a citátmi a sú zapísané v protokole činností.
- Centrálny register exekúcií (spoplatnený, s prihlásením) a Dôvera (zakazuje automatizáciu) sa cez AI neoverujú.
- Kľúč: lokálne v *Administrácia → Nastavenia AI*, v produkcii v premenných prostredia `ANTHROPIC_API_KEY` alebo `OPENAI_API_KEY`.

Podrobnosti sú v [docs/ZDROJE.md](docs/ZDROJE.md#4-záložné-ai-vyhľadávanie).

## Hodnotenie

Skóre začína na 100. Každé zistenie odpočíta body a pozitívne zistenia body pridajú (logika je v `lib/scoring.ts` a v jednotlivých `lib/sources/*.ts`, penalizácie sa dajú upraviť).

- **Kritický nález** (daňový dlžník, dlh v SP, konkurz, dôvody na zrušenie DPH, záporné vlastné imanie, zánik alebo likvidácia, manuálne zistená exekúcia) → vždy **NEODPORÚČAME**
- skóre ≥ 85 → **ODPORÚČAME**, 60–84 → **S VÝHRADOU**, < 60 → **NEODPORÚČAME**

## Prihlásenie a používatelia

Celá aplikácia je za prihlásením (e-mail + heslo). Prístup majú len e-maily, ktoré pridá administrátor.

- **Administrátor** v časti *Administrácia* vloží zoznam e-mailov (oddelených čiarkou, bodkočiarkou alebo novým riadkom) a zvolí rolu *používateľ* alebo *administrátor*.
- Každý nový používateľ dostane **jednorazový kód** (napr. `K7QM-4XTD-9RWP`, platí 7 dní). Kód sa zobrazí iba raz. Tlačidlo *Kopírovať pozvánky* pripraví text s kódom a odkazom na prihlásenie.
- Používateľ otvorí prihlásenie, zvolí **Prvé prihlásenie / nový kód**, zadá e-mail, kód a zvolí si heslo (aspoň 10 znakov).
- Pri zabudnutom hesle administrátor klikne na **Nový kód**. Staré heslo prestane platiť a používateľ sa odhlási zo všetkých zariadení.
- Administrátor môže používateľa **zablokovať** (okamžite stratí prístup), zmeniť mu rolu alebo ho zmazať. Aplikácia nedovolí odstrániť posledného administrátora ani odobrať práva sebe.
- Každý si v časti *Môj účet* (klik na svoj e-mail vpravo hore) môže zmeniť heslo.

Bezpečnosť: heslá sa ukladajú ako hash (scrypt), jednorazové kódy tiež len ako hash. Prihlásenie platí 12 hodín a je v podpísanom, httpOnly cookie. Po 8 neúspešných pokusoch sa účet na 15 minút zablokuje. Každý API endpoint overuje účet v databáze, takže zablokovanie platí okamžite.

### Protokol činností

V časti *Administrácia → Protokol činností* je zoznam všetkých preverení (kto, kedy, IČO, firma, verdikt, skóre, číslo protokolu), prihlásení, neúspešných pokusov a zmien používateľov. Dá sa filtrovať, vyhľadávať a exportovať do CSV (otvorí sa v Exceli). Uchováva sa posledných 20 000 udalostí. Na PDF protokole je uvedené aj meno toho, kto preverenie spustil.

## Nasadenie na Vercel (súkromný účet)

1. Nahrajte priečinok do súkromného GitHub repozitára.
2. Na vercel.com: **Add New → Project** → vyberte repozitár. Framework Next.js sa rozpozná sám.
3. **Databáza:** v projekte otvorte **Storage → Create Database → Upstash for Redis** (bezplatný plán, región Frankfurt) a kliknite na **Connect** k projektu. Vercel doplní premenné `KV_REST_API_URL` a `KV_REST_API_TOKEN`.
4. **Settings → Environment Variables:**

   | Premenná | Hodnota |
   |---|---|
   | `SESSION_SECRET` | náhodný reťazec, aspoň 32 znakov (napr. výstup `openssl rand -hex 32` alebo z generátora hesiel) |
   | `ADMIN_EMAILS` | váš e-mail, napr. `antonin.cajka@publicis.no` (viac adries oddeľte čiarkou) |
   | `ADMIN_SETUP_CODE` | ľubovoľný kód na prvé prihlásenie, aspoň 8 znakov |
   | `FS_API_KEY` | bezplatný kľúč z https://opendata.financnasprava.sk/page/openapi |
   | `ANTHROPIC_API_KEY` alebo `OPENAI_API_KEY` | voliteľné – záložné AI vyhľadávanie |

5. **Deploy** (po pridaní premenných ešte raz *Redeploy*).
6. Otvorte aplikáciu → **Prvé prihlásenie / nový kód** → zadajte e-mail z `ADMIN_EMAILS`, kód z `ADMIN_SETUP_CODE` a zvoľte si heslo. Ste administrátor.
7. Potom môžete `ADMIN_SETUP_CODE` z Vercelu zmazať a pridávať ďalších ľudí v Administrácii.
8. Ako administrátor otvorte `https://<vaša-doména>/api/diag` a skontrolujte, či sú zo servera dostupné databáza aj všetky registre. Pri každom registri by mal byť stav 200.

Tip: v **Settings → Functions** nastavte región **Frankfurt (fra1)**. Slovenské štátne servery odpovedajú z EÚ rýchlejšie.

## Spustenie lokálne

Potrebujete **Node.js 20.9 alebo novší** (https://nodejs.org, verzia LTS).

```bash
cd overenie-ico
npm install
```

V priečinku vytvorte súbor `.env.local`:

```
ADMIN_EMAILS=vas@email.sk
ADMIN_SETUP_CODE=TESTKOD123
DEMO_DATA=1
```

Spustite `npm run dev` a otvorte http://localhost:3000. Zvoľte **Prvé prihlásenie / nový kód**, zadajte e-mail, kód `TESTKOD123` a zvoľte si heslo.

- `DEMO_DATA=1` zapne **ukážkové údaje**, takže nepotrebujete prístup k registrom. IČO **47244895** je bezproblémová firma, IČO **31318177** rizikový subjekt. Údaje sú vymyslené.
- Keď riadok `DEMO_DATA=1` zmažete, aplikácia sa pýta skutočných registrov. Doplňte aj `FS_API_KEY`, inak budú daňové kontroly na manuálne overenie.
- Lokálne beží dočasná databáza v pamäti. Po reštarte (`Ctrl+C` a znova `npm run dev`) sa používatelia vymažú a treba sa prihlásiť znova cez kód. Ak chcete trvalé dáta, doplňte do `.env.local` premenné `KV_REST_API_URL` a `KV_REST_API_TOKEN` z Upstash.
- `npm test` spustí offline testy (preverenie + prihlasovanie).

## Dôležité obmedzenia

- Údaje sú k času preverenia a registre môžu mať oneskorenie (napr. SP aktualizuje 4× mesačne, zdravotné poisťovne k 20. dňu v mesiaci).
- Finančné ukazovatele sa čítajú z výkazu podľa textu riadkov šablóny. Pri závierkach podaných len ako PDF (napr. IFRS) aplikácia čísla nezobrazí, len na PDF upozorní.
- Formát API Finančnej správy (názvy stĺpcov a zoznamov) aplikácia zisťuje za behu. Ak FS formát zmení, kontrola skončí stavom „Zdroj nedostupný“ a nevráti falošné „bez záznamu“.
- Mediálna kontrola hľadá podľa obchodného mena, takže môže nájsť aj iný subjekt s podobným menom. Články vždy prečítajte.
- Hodnotenie je pomôcka a nenahrádza právne posúdenie.

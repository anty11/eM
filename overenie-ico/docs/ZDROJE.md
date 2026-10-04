# Zdroje údajov, požadované údaje a pravidlá hodnotenia

Technická a metodická dokumentácia aplikácie **Preverto** (preverenie obchodného partnera podľa IČO, preverto.sk). Pre každý zdroj opisuje:

- odkiaľ a ako sa údaje získavajú (API, otvorené dáta, súbor, webová stránka),
- čo presne sa od zdroja žiada (vstup),
- ktoré údaje sa preberajú,
- ako sa vyhodnocujú (pravidlá a bodové postihy),
- čo robí záložné AI vyhľadávanie, keď API zlyhá alebo neexistuje.

Stav k 28. 9. 2026, verzia aplikácie 1.0.0.

---

## 1. Prehľad zdrojov

| # | Zdroj | Prevádzkovateľ | Prístup | Autentifikácia | Režim v aplikácii | Záložné AI | Kód |
|---|---|---|---|---|---|---|---|
| 1 | Register právnických osôb (údaje z Obchodného registra) | Štatistický úrad SR | REST API (JSON) | žiadna | automaticky | áno (orsr.sk) | `lib/sources/rpo.ts` |
| 2 | Register účtovných závierok (RÚZ) | Ministerstvo financií SR | REST API (JSON) | žiadna | automaticky | áno | `lib/sources/ruz.ts` |
| 3 | Zoznam daňových dlžníkov | Finančná správa SR | OpenData API | bezplatný kľúč | automaticky | áno | `lib/sources/fs.ts` |
| 4 | Platitelia DPH, dôvody na zrušenie registrácie, vymazaní platitelia | Finančná správa SR | OpenData API | bezplatný kľúč | automaticky | áno | `lib/sources/fs.ts` |
| 5 | Index daňovej spoľahlivosti | Finančná správa SR | OpenData API | bezplatný kľúč | automaticky | áno | `lib/sources/fs.ts` |
| 6 | Daň z príjmov PO (podané priznania) | Finančná správa SR | OpenData API | bezplatný kľúč | automaticky | áno | `lib/sources/fs.ts` |
| 7 | Zoznam dlžníkov Sociálnej poisťovne | Sociálna poisťovňa | súbor na stiahnutie (celý zoznam) + web | žiadna | automaticky | áno | `lib/sources/socpoist.ts` |
| 8 | Register úpadcov a likvidácií (REPLIK) | Ministerstvo spravodlivosti SR | webová stránka (bez API) | žiadna | automaticky, len pozitívny nález | áno | `lib/sources/insolvency.ts` |
| 9 | Register partnerov verejného sektora (RPVS) | Ministerstvo spravodlivosti SR | OData API | žiadna | automaticky | áno | `lib/sources/rpvs.ts` |
| 10 | Médiá (správy, PR) | Google News | RSS | žiadna | automaticky | – | `lib/sources/news.ts` |
| 11 | Dlžníci VšZP | Všeobecná zdravotná poisťovňa | webový formulár, **bez API** | žiadna | manuálne / AI | áno | `lib/sources/manual.ts` |
| 12 | Dlžníci Union ZP | Union zdravotná poisťovňa | webový portál, **bez API** | žiadna | manuálne / AI | áno | `lib/sources/manual.ts` |
| 13 | Dlžníci Dôvera ZP | Dôvera zdravotná poisťovňa | webový formulár, **bez API**; automatizované overovanie výslovne zakázané | – | **len manuálne** | **nie** | `lib/sources/manual.ts` |
| 14 | Obchodný vestník | Ministerstvo spravodlivosti SR | web, **bez API** | žiadna | manuálne / AI | áno | `lib/sources/manual.ts` |
| 15 | Register diskvalifikácií | Ministerstvo spravodlivosti SR | web, **bez API** | žiadna | manuálne / AI | áno | `lib/sources/manual.ts` |
| 16 | Register osôb so zákazom účasti vo VO | Úrad pre verejné obstarávanie | web, **bez API** | žiadna | manuálne / AI | áno | `lib/sources/manual.ts` |
| 17 | Centrálny register exekúcií (CRE) | Slovenská komora exekútorov | spoplatnený výpis po prihlásení | účet + platba | **len manuálne** | **nie** | `lib/sources/manual.ts` |

**Režimy:**

- **automaticky:** údaje sa získajú strojovo z API alebo súboru.
- **manuálne:** aplikácia pripraví odkaz. Vo verzii *Rozšírené* poverený zamestnanec označí výsledok *Bez záznamu / Záznam nájdený*. Vo verzii *Štandard* je zdroj v časti *Ďalšie odporúčané overenia*.
- **AI:** záložné vyhľadávanie cez LLM (kapitola 4).

---

## 2. Priebeh preverenia

1. **Vstup:** IČO (6–8 číslic). Kratšie IČO sa doplní nulami zľava na 8 číslic. Kontrolný súčet (modulo 11) sa overí, ale pri nesúlade sa len upozorní, lebo niektoré historické IČO ho nespĺňajú.
2. **Fáza 1, identifikácia:** RPO (obchodné meno, štatutári, vlastníci…), potom RÚZ (doplní **DIČ**, ktoré potrebujú daňové kontroly).
3. **Fáza 2, paralelne:** Finančná správa (4 zoznamy), Sociálna poisťovňa, REPLIK, RPVS, médiá.
4. **Neverejné registre:** pridajú sa ako manuálne položky s pripraveným odkazom.
5. **Záložné AI** (ak je nastavené) sa spustí v prehliadači po zobrazení výsledku:
   - pre zdroje v stave *Zdroj nedostupný* alebo *Overiť manuálne*,
   - pri zapnutej voľbe aj pre registre bez API.

   Výsledky sa priebežne dopĺňajú a verdikt sa prepočíta.
6. **Výstup:** verdikt, skóre, prehľad kľúčových otázok, detail každej kontroly s časom a odkazom na zdroj, PDF protokol.
7. **Záznam:** každé preverenie a každé AI overenie sa zapíše do protokolu činností (používateľ, čas, IČO, firma, verdikt).

Časové limity: jeden zdroj 12–45 s, jedna AI úloha 90 s. Zlyhanie jedného zdroja nezastaví ostatné.

---

## 3. Zdroje podrobne

### 3.1 Register právnických osôb (RPO) – údaje z Obchodného registra

| | |
|---|---|
| Prevádzkovateľ | Štatistický úrad SR. RPO preberá údaje z Obchodného registra, Živnostenského registra a ďalších zdrojových registrov. |
| Prístup | REST API, JSON, bez autentifikácie, licencia CC BY 4.0 |
| Vyhľadanie | `GET https://api.statistics.sk/rpo/v1/search?identifier={IČO}` → `results[0].id` |
| Detail | `GET https://api.statistics.sk/rpo/v1/entity/{id}?showHistoricalData=true&showOrganizationUnits=false` |
| Overenie v zdroji | `https://www.orsr.sk/hladaj_ico.asp?ICO={IČO}&SID=0` |

**Preberané údaje:**

| Údaj | Pole API | Poznámka |
|---|---|---|
| Obchodné meno (aktuálne a predchádzajúce) | `fullNames[]` | aktuálne = bez `validTo` |
| Sídlo | `addresses[]` | ulica, číslo, PSČ, obec, štát |
| Právna forma | `legalForms[].value.value` | |
| Deň vzniku, deň zániku | `establishment`, `termination` | |
| Registrový súd, číslo vložky | `sourceRegister.registrationOffices[]`, `registrationNumbers[]` | |
| Hlavná činnosť (SK NACE) | `statisticalCodes.mainActivity` | |
| Predmety podnikania | `activities[].economicActivityDescription` | len aktuálne |
| Štatutárny orgán | `statutoryBodies[]` | meno, funkcia, od kedy |
| Vlastníci (spoločníci, jediný akcionár, členovia) | `stakeholders[]` | typ obsahuje spoločník/akcionár/člen, **bez dozornej rady** |
| Základné imanie | `equities[].value` | |
| Právne skutočnosti | `otherLegalFacts[]` | zrušenie, likvidácia, výmaz, záložné právo… |
| **Dátum poslednej zmeny vlastníctva** | najneskorší `validFrom`/`validTo` spomedzi vlastníkov | okrem dňa vzniku |
| **Dátum poslednej zmeny štatutárneho orgánu** | najneskorší `validFrom`/`validTo` v `statutoryBodies[]` | okrem dňa vzniku |

**Pravidlá hodnotenia:**

| Situácia | Závažnosť | Body |
|---|---|---|
| IČO sa v RPO nenašlo | kritická | −60 |
| Subjekt zanikol (`termination`) | kritická | −100 |
| Obchodné meno obsahuje „v likvidácii“ | kritická | −70 |
| Obchodné meno obsahuje „v konkurze“ | kritická | −90 |
| Obchodné meno obsahuje „v reštrukturalizácii“ | kritická | −50 |
| Právna skutočnosť o zrušení, výmaze alebo likvidácii | kritická | −60 |
| Iná závažná právna skutočnosť (konkurz, exekúcia, záložné právo, reštrukturalizácia) | upozornenie | −10 (max. 3×) |
| Vek pod 1 rok | upozornenie | −15 |
| Vek 1–2 roky | upozornenie | −6 |
| Vek 5 a viac rokov | pozitívne | +3 |
| 3 a viac zmien sídla za 3 roky | upozornenie | −10 |
| 2 a viac zmien obchodného mena za 3 roky | upozornenie | −6 |
| 3 a viac zmien štatutárov za 2 roky | upozornenie | −8 |
| Obchodná spoločnosť bez aktuálneho štatutára | upozornenie | −8 |

**Obmedzenia:** akcionári akciovej spoločnosti sa v OR nezverejňujú, výnimkou je jediný akcionár. RPO môže mať voči ORSR oneskorenie niekoľko dní.

---

### 3.2 Register účtovných závierok (RÚZ)

| | |
|---|---|
| Prevádzkovateľ | Ministerstvo financií SR |
| Prístup | REST API, JSON, bez autentifikácie |
| Účtovná jednotka | `GET https://www.registeruz.sk/cruz-public/api/uctovne-jednotky?zmenene-od=2000-01-01&ico={IČO}` → `id[]`, potom `GET …/api/uctovna-jednotka?id={id}` |
| Závierky | `GET …/api/uctovna-zavierka?id={id}` pre každé `idUctovnychZavierok[]` |
| Výkazy | `GET …/api/uctovny-vykaz?id={id}` + šablóna `GET …/api/sablona?id={idSablony}` (cache 24 h) |
| Overenie v zdroji | `https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch?ico={IČO}` |

**Preberané údaje:** DIČ, SK NACE, veľkosť organizácie. Zo závierok sa berie zoznam rokov, typ (riadna/mimoriadna, priebežné sa vynechávajú), obdobie a **dátum uloženia** (`datumPodania`). Z posledného výkazu so štruktúrovanými dátami sa berú tieto ukazovatele, za bežné aj predchádzajúce obdobie:

| Ukazovateľ | Riadok šablóny (hľadá sa podľa textu, nie čísla riadku) |
|---|---|
| Aktíva spolu | Strana aktív: „SPOLU MAJETOK“, stĺpec Netto bežné obdobie |
| Vlastné imanie | Strana pasív: „Vlastné imanie“ |
| Záväzky | Strana pasív: „Záväzky“ |
| Tržby / čistý obrat | Výkaz ziskov a strát: „Čistý obrat“, prípadne prvé „Tržby…“ |
| Výsledok hospodárenia | „Výsledok hospodárenia za účtovné obdobie (po zdanení)“ |

Dáta výkazu sú plochý zoznam hodnôt. Počet stĺpcov na riadok udáva `pocetDatovychStlpcov` šablóny: aktíva majú 4 stĺpce (Brutto, Korekcia, Netto bežné, Netto predchádzajúce), ostatné tabuľky 2 (bežné, predchádzajúce).

**Očakávaná závierka:** za rok N sa ukladá do 30. 6. roku N+1, pri predĺžení do 30. 9. Od októbra sa preto očakáva závierka za minulý rok, inak za predminulý.
**Splatné obdobia:** posudzujú sa len obdobia, ktorých lehota už uplynula – od prvého účtovného obdobia (rok vzniku; pri vzniku v októbri až decembri sa v prospech spoločnosti ráta až nasledujúci rok podľa § 3 ods. 4 zákona o účtovníctve) po očakávaný rok. Spoločnosť, ktorá ešte nemusela podať žiadnu závierku, nedostane za závierky žiadnu zrážku – odpočíta sa len vek (kontrola obchodného registra).

**Pravidlá hodnotenia:**

| Situácia | Závažnosť | Body |
|---|---|---|
| Obchodná spoločnosť staršia ako 2 roky nie je v RÚZ | upozornenie | −12 |
| **Závierka chýba za 2 a viac po sebe idúcich období** (od poslednej uloženej, resp. od vzniku) – dôvod na zrušenie spoločnosti súdom podľa § 68b ods. 1 písm. c) ObZ | **kritické** | **−40** |
| Chýba práve jedna splatná závierka (posledná, alebo prvá u mladšej firmy) | upozornenie | −12 |
| Žiadne splatné obdobie (mladá spoločnosť) | – | 0 |
| **Záporné vlastné imanie** | kritická | −30 |
| Spoločnosť v kríze podľa § 67a ObZ (vlastné imanie / záväzky < 0,08) | upozornenie | −18 |
| Strata v poslednom roku | upozornenie | −5 |
| Strata dva roky po sebe | upozornenie | −10 |
| Pokles tržieb o viac ako 50 % | upozornenie | −6 |
| Zisk a kladné vlastné imanie | pozitívne | +4 |

**Obmedzenia:** závierky podľa IFRS a niektoré ďalšie sú uložené len ako PDF. Čísla sa vtedy nezobrazia a aplikácia na to upozorní.

---

### 3.3 Finančná správa SR – OpenData API (zdroje 3–6)

| | |
|---|---|
| Prevádzkovateľ | Finančná správa SR |
| Prístup | REST API, JSON |
| Autentifikácia | HTTP hlavička `key: {FS_API_KEY}`. Kľúč je bezplatný, registrácia na https://opendata.financnasprava.sk/page/openapi. Limit 1 000 požiadaviek za hodinu. |
| Zoznamy | `GET https://iz.opendata.financnasprava.sk/api/lists` (cache 6 h) |
| Vyhľadanie | `GET https://iz.opendata.financnasprava.sk/api/data/{slug}/search?page=1&column={stĺpec}&search={hodnota}` |
| Overenie v zdroji | https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy |

Aplikácia skúša stĺpce v poradí `ico`, `ICO`, potom `dic` (DIČ z RÚZ) a `ic_dph` (`SK` + DIČ). Riadok sa uzná, len ak skutočne obsahuje dané IČO alebo DIČ. Zoznamy sa hľadajú najprv podľa slugu a potom podľa názvu, takže premenovanie zoznamu aplikáciu nerozbije. Ak API vráti neznámy formát, kontrola skončí ako *Zdroj nedostupný*, nikdy ako „bez záznamu“.

| Kontrola | Slug (predvolený) | Hľadaný názov | Preberá sa | Hodnotenie |
|---|---|---|---|---|
| Daňoví dlžníci | `ds_dsdd` | „daňoví dlžníci“ | výška nedoplatku | nález: **kritická, −45** |
| Registrovaní platitelia DPH | `ds_dphs` | „registrovaní … DPH“ | IČ DPH | registrovaný bez rizika: +2 |
| Platitelia DPH s dôvodmi na zrušenie registrácie | `ds_dphz` | „dôvody na zrušenie“ | – | nález: **kritická, −35** (riziko ručenia za DPH podľa § 69 ods. 14 ZDPH) |
| Vymazaní platitelia DPH | `ds_dphv` | „vymazaní … DPH“ | – | vymazaný a nie je registrovaný: upozornenie, −8 |
| Index daňovej spoľahlivosti | `ds_ids` | „spoľahlivý“ | hodnotenie | „menej spoľahlivý“: upozornenie, −20; „vysoko spoľahlivý“: +5 |
| Daň z príjmov PO | `ds_dppo` | „výška dane … právnických osôb“ | rok, výška dane | informácia. Chýbajúci záznam neznamená nepodanie priznania. |

**Bez kľúča** sa všetky štyri kontroly označia *Overiť manuálne*. Ak je nastavené AI, overí ich AI.

---

### 3.4 Sociálna poisťovňa – zoznam dlžníkov

| | |
|---|---|
| Prístup | celý zoznam ako súbor na stiahnutie. Odkaz sa zistí zo stránky `https://www.socpoist.sk/nastroje-sluzby/zoznam-dlznikov`; záložný je `https://www.socpoist.sk/api/idsp/download/ed57da4c-93aa-4198-ae4b-b2d65d3ca099`. |
| Aktualizácia | 4× mesačne (asi 136 000 záznamov) |
| Spracovanie | súbor (XLSX/CSV) sa načíta, zaindexuje podľa **IČO** a drží v pamäti 6 hodín |
| Kontrola formátu | ak má súbor menej ako 1 000 záznamov s IČO, považuje sa za neplatný |
| Záloha | vyhľadanie na webe `?search={IČO}`. Uzná sa len pozitívny nález, inak manuálne overenie. |

**Preberané údaje:** názov, mesto, výška dlhu. **Hodnotenie:** nález je kritický, −35.

---

### 3.5 Register úpadcov a likvidácií (REPLIK)

| | |
|---|---|
| Prevádzkovateľ | Ministerstvo spravodlivosti SR – Register predinsolvenčných, likvidačných a insolvenčných konaní |
| Prístup | webová stránka (JSF), **bez API** |
| Požiadavka | `GET https://replik.justice.sk/ru-verejnost-web/pages/searchKonanie.xhtml?query={IČO}` |
| Bez konania | stránka obsahuje „Nenašli sa žiadne konania pre hľadaný reťazec – {IČO}“ → bez záznamu |
| S konaním | „Počet výsledkov: N“ a riadky v tvare `Obchodné meno (IČO: 12345678) - Konkurz č. 2K/8/2026 · Začaté konkurzné konanie · 14.8.2026, Okresný súd …` |
| Iný výsledok | manuálne overenie (príp. AI) |

**Dôležité:** stránka vždy obsahuje filter s druhmi konaní (Konkurz, Reštrukturalizácia, Likvidácia…) a hľadané IČO v hlavičke. Nález sa preto uzná **len podľa riadku výsledku** `(IČO: …) - druh č. spisová značka` s presne tým istým IČO. (Do verzie z 29. 9. 2026 aplikácia chybne hlásila konanie pri každom subjekte.)

**Hodnotenie:**

| Situácia | Závažnosť | Body |
|---|---|---|
| Prebiehajúci konkurz / malý konkurz / reštrukturalizácia / oddlženie | kritická | −80 (za najzávažnejšie, ďalšie sa nesčítavajú) |
| Prebiehajúca likvidácia | kritická | −60; v prehľade „konanie o zrušení / likvidácii: ÁNO“ |
| Skončené konanie v minulosti (skončené, zastavené, zamietnuté, zrušené) | upozornenie | −8 |

---

### 3.6 Register partnerov verejného sektora (RPVS)

| | |
|---|---|
| Prístup | OData API, JSON, bez autentifikácie |
| Požiadavka | `GET https://rpvs.gov.sk/opendatav2/PartneriVerejnehoSektora?$filter=Ico eq '{IČO}'&$expand=KonecniUzivateliaVyhod,Partner`, záložne `…/OpenData/Partneri?$filter=…` |
| Preberá sa | zápis, platnosť, **koneční užívatelia výhod** (KUV) |
| Hodnotenie | informácia bez bodov. Zápis je povinný len pri plneniach od štátu nad zákonný limit. |

---

### 3.7 Médiá a internet

| | |
|---|---|
| Zdroje | Google News RSS (sk/SK) a Bing News RSS (sk/SK, zoradené podľa dátumu) |
| Dopyty | `"meno bez právnej formy" when:1y` (najnovšie), `"meno"` (všetky), `"úplné obchodné meno"`, `"meno" "priezvisko štatutára"`, Bing `"meno"` |
| Spracovanie | zlúčenie, odstránenie duplicít (rovnaký titulok), vyradenie článkov starších ako **3 roky**, zoradenie **od najnovšieho** |

**Relevancia** (či je článok naozaj o tomto subjekte) – body sa sčítavajú, článok sa zobrazí pri **≥ 3**:

| Kritérium | Body |
|---|---|
| úplné obchodné meno (s právnou formou) v titulku/popise | +3 |
| meno bez právnej formy v titulku (+3), len v popise (+2), všetky výrazné slová mena (+1) | |
| IČO v texte | +3 |
| priezvisko štatutára v texte | +2 |
| mesto sídla v texte | +1 |
| slovenský alebo český zdroj (.sk / .cz) | +1 |
| krátke/všeobecné meno (1 slovo, < 8 znakov) bez ďalšieho kontextu | najviac 1 → vyradené |

Slová ako *partners, group, slovakia, holding, invest…* sa pri porovnávaní ignorujú. Tak sa vyradia napr. zahraničné firmy s podobným menom.

**Negatívne výrazy** (začiatky slov bez diakritiky): podvod, obvinenie, trestné stíhanie, NAKA/polícia, zadržanie, konkurz, exekúcia, insolvencia/úpadok, dlhy (*dlhy, dlhov, dlžník, nezaplatené* – nie „dlhodobý“), pokuta/sankcia, kartel/korupcia, daňový únik/karusel, žaloba/spor, likvidácia/krach, sprenevera/pranie, kauza/škandál, prepúšťanie.

**Hodnotenie:** 3 a viac relevantných negatívnych článkov za 2 roky → upozornenie −10; 1–2 → upozornenie −3.

**Odkazy navyše:** Google správy za posledný rok, Google s negatívnymi výrazmi, FinStat, Index podnikateľa, FOAF, Centrálny register zmlúv.

**Obmedzenia:** RSS vracia len titulok a krátky popis, nie celý článok. Rozhodujúce je, čo je v titulku a popise; články treba prečítať.

---

### 3.8 Registre bez verejného API

| Register | Odkaz na overenie | Čo overiť | Postih pri náleze | AI |
|---|---|---|---|---|
| Centrálny register exekúcií | https://cre.sk | vedená exekúcia voči subjektu | kritická, −40 | **nie**: spoplatnený výpis po prihlásení |
| VšZP – dlžníci | https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html | časť *Zamestnávatelia a SZČO*, hľadať podľa IČO | kritická, −25 | áno |
| Dôvera – dlžníci | https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov | hľadať podľa IČO | kritická, −25 | **nie**: poisťovňa zakazuje automatizované overovanie |
| Union – dlžníci | https://portal.unionzp.sk/pub/dlznici | hľadať podľa IČO alebo mena | kritická, −25 | áno |
| Obchodný vestník | https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormulareZverejnene.aspx | likvidácia, konkurz, zrušenie, výzvy veriteľom, zníženie imania, dražby | upozornenie, −30 | áno |
| Register diskvalifikácií | https://www.justice.gov.sk/registre/registerDiskvalifikacii/ | zákaz výkonu funkcie štatutára (§ 13a ObZ) | kritická, −25 | áno |
| ÚVO – register osôb so zákazom | https://www.uvo.gov.sk/zaujemca-uchadzac/registre-o-hospodarskych-subjektoch/register-osob-so-zakazom | zákaz účasti vo verejnom obstarávaní | upozornenie, −15 | áno |

---

## 4. Záložné AI vyhľadávanie

### 4.1 Kedy sa použije

- Zdroj s API zlyhal (výpadok, časový limit, zmenený formát) a kontrola skončila ako *Zdroj nedostupný* alebo *Overiť manuálne*.
- Chýba kľúč Finančnej správy.
- Register nemá API (VšZP, Union, Obchodný vestník, Register diskvalifikácií, ÚVO), ak je v nastaveniach zapnutá voľba *Automaticky overovať aj registre bez API*.
- **Predvolene len ručne**, tlačidlom **Overiť cez AI** pri kontrole alebo **Overiť všetko dostupné cez AI** v okne manuálnych overení.

Ak zlyhá identifikácia (RPO), AI ju spustí ako prvú a doplnené údaje (meno, štatutári…) použije pre ostatné AI úlohy.

### 4.2 Poskytovatelia a technika

| Poskytovateľ | API | Nástroje | Predvolený model |
|---|---|---|---|
| Claude (Anthropic) | `POST https://api.anthropic.com/v1/messages` | `web_search_20260318` (lokalizácia SK), `web_fetch_20260318` | `claude-sonnet-5` |
| OpenAI | `POST https://api.openai.com/v1/responses` | `web_search` (lokalizácia SK, `filters.allowed_domains`) | `gpt-5.5` |

- Nástroje sú **obmedzené na oficiálne domény** daného registra (`allowed_domains`).
- Claude `web_fetch` smie otvoriť len URL uvedené v zadaní, preto zadanie obsahuje presné odkazy na register.
- Pri dlhšom vyhľadávaní (`stop_reason: pause_turn`) aplikácia pokračuje, najviac 4×.
- Najviac 6 vyhľadávaní a 6 otvorení stránky na úlohu, časový limit 90 s, najviac 3 úlohy súčasne.

### 4.3 Zadania pre jednotlivé zdroje

Model dostane: úlohu, presné odkazy, zoznam povolených domén, dnešný dátum a požadovaný formát. Zadania sú v `lib/ai/specs.ts`.

| Zdroj | Typ | Povolené domény | Úloha | Požadované údaje (`data`) |
|---|---|---|---|---|
| RPO / OR | údaje | orsr.sk, statistics.sk | identifikovať subjekt vo výpise z OR, zistiť likvidáciu, konkurz, zrušenie, výmaz | `name, legalForm, established, terminated, address, statutory[], owners[], activities[], lastStatutoryChange, lastOwnershipChange, inLiquidation, dissolutionProceedings, registrationNumber` |
| RÚZ | údaje | registeruz.sk | posledná riadna závierka, rok, dátum uloženia, ukazovatele | `lastFiledYear, lastFiledOn, years[], revenue, profit, equity, liabilities` |
| Daňoví dlžníci | negatívny | financnasprava.sk | je v zozname daňových dlžníkov? | `amount, listDate` |
| DPH | údaje | financnasprava.sk, ec.europa.eu (VIES) | registrácia, dôvody na zrušenie, vymazanie | `registered, icDph, deregistrationReasons, deleted` |
| Index daňovej spoľahlivosti | údaje | financnasprava.sk | hodnotenie | `rating, period` |
| Daň z príjmov PO | údaje | financnasprava.sk | podané priznanie, rok, daň | `filed, year, tax` |
| Sociálna poisťovňa | negatívny | socpoist.sk | je v zozname dlžníkov (zhoda podľa IČO)? | `amount` |
| REPLIK | negatívny | replik.justice.sk, obchodnyvestnik.justice.gov.sk | konkurz, reštrukturalizácia, likvidácia, zrušenie | `kind, state, since` |
| RPVS | údaje | rpvs.gov.sk | zápis a KUV | `registered, kuv[]` |
| VšZP | negatívny | vszp.sk | zoznam dlžníkov | `amount` |
| Union | negatívny | unionzp.sk, union.sk | zoznam dlžníkov | `amount` |
| Obchodný vestník | negatívny | obchodnyvestnik.justice.gov.sk | negatívne oznámenia za 3 roky | `notices[]` |
| Register diskvalifikácií | negatívny | justice.gov.sk | zákaz výkonu funkcie štatutárov (mená z OR) | `persons[]` |
| ÚVO | negatívny | uvo.gov.sk | zákaz účasti vo VO | `until` |
| CRE, Dôvera | – | – | **AI sa nepoužíva** (prihlásenie a platba, resp. zákaz automatizácie) | – |

### 4.4 Formát odpovede modelu

```json
{
  "result": "clean | found | unknown",
  "summary": "1–2 vety",
  "findings": [{ "severity": "critical | warning | info | positive", "text": "…" }],
  "evidence": [{ "url": "https://…", "quote": "citát zo stránky" }],
  "data": { "…údaje podľa tabuľky 4.3…" }
}
```

### 4.5 Ochrana pred chybami AI

1. **Povinný dôkaz.** Výsledok `clean` alebo `found` sa uzná, len ak má aspoň jeden dôkaz s URL, ktorá:
   - pochádza z povolenej oficiálnej domény,
   - a model ju **reálne otvoril alebo citoval**. To sa overuje podľa technickej odpovede API, nie podľa textu modelu.

   Inak sa výsledok zamietne a kontrola ostáva *Overiť manuálne* s poznámkou „AI neuviedla overiteľný dôkaz“.
2. **„Neviem“ je dovolené.** Model má pokyn nevymýšľať a pri neistote vrátiť `unknown`, čo znamená manuálne overenie.
3. **Nedôveryhodný obsah.** Obsah stránok je pre model len dáta a pokyny v ňom ignoruje.
4. **Rovnaké body ako pri API.** Pri negatívnom registri sa za nález strhne rovnaký postih ako pri API (napr. Sociálna poisťovňa −35). Ďalšie zistenia AI:
   - kritické −30, upozornenie −8, pozitívne +2;
   - jedna AI kontrola najviac −60 (okrem zániku subjektu, −100).
5. **Označenie.** Výsledok má štítok **Overené AI** s poskytovateľom, modelom, časom a odkazmi na dôkazy s citátom. Prenáša sa aj do PDF a do exportu JSON.
6. **Záznam.** Každé AI overenie sa zapíše do protokolu činností: používateľ, IČO, zdroj, výsledok, zamietnutie, model.
7. **Nenahrádza API.** AI sa spúšťa len ako záloha. Keď API funguje, jeho výsledok má prednosť.

### 4.6 Nastavenie kľúča

| Prostredie | Kde | Premenné |
|---|---|---|
| Lokálne / testovanie | Administrácia → Nastavenia AI (kľúč sa uloží šifrovane AES-256-GCM, znova sa nezobrazí) | – |
| Produkcia (Vercel) | Environment Variables | `ANTHROPIC_API_KEY` alebo `OPENAI_API_KEY`, voliteľne `AI_PROVIDER` (`anthropic` / `openai`), `AI_MODEL`, `AI_AUTO_FALLBACK=1` (zapne automatické spúšťanie pri zlyhaní zdroja), `AI_NO_API_SOURCES=1` (zapne automatické overovanie registrov bez API). Predvolene je oboje **vypnuté** – AI sa spúšťa len tlačidlom |

Premenné prostredia majú vždy prednosť a zamknú nastavenie v administrácii. V produkcii sa kľúč z administrácie nepoužije, pokiaľ nie je nastavené `AI_ALLOW_ADMIN_KEY=1`.

**Náklady (orientačne):** jedno AI overenie = 1–6 vyhľadávaní (Claude 10 USD za 1 000 vyhľadávaní) + tokeny. Preverenie s AI pre všetky registre bez API vychádza zhruba na desiatky centov.

---

## 5. Prehľad – kľúčové otázky

Zobrazuje sa na začiatku výsledku a v PDF (`lib/keyfacts.ts`).

| Otázka | Zdroj | Odpoveď |
|---|---|---|
| Podala účtovnú závierku / daňové priznanie? | RÚZ (rok, dátum uloženia), FS – daň z príjmov | Áno / Oneskorene (chýba posledná) / NIE – chýba za 2+ období, dôvod na zrušenie súdom (§ 68b ObZ); u firiem mladších ako 2 roky „zatiaľ nie“ |
| Je vedené konanie o zrušení, výmaze alebo likvidácii? | RPO (meno, právne skutočnosti, zánik), REPLIK | ÁNO / Nie / insolvenčné konanie / treba potvrdiť |
| Typ spoločnosti | RPO | právna forma |
| Vek spoločnosti | RPO | „X rokov Y mesiacov (vznik …)“; pod 1 rok = pozor |
| Predmet obchodnej činnosti | RPO, ŠÚ SR | hlavná činnosť + počet predmetov (celý zoznam v identifikácii) |
| Dátum poslednej zmeny vlastníctva | RPO | dátum + súčasní vlastníci; zmena pred menej ako 6 mesiacmi = pozor |
| Dátum poslednej zmeny štatutárneho orgánu | RPO | dátum + súčasný štatutár; zmena pred menej ako 6 mesiacmi = pozor |
| Je spoľahlivý platiteľ DPH? | FS – DPH, dôvody na zrušenie, index | Áno / NIE (dôvody na zrušenie) / nie je platiteľ / menej spoľahlivý |
| Má nedoplatky na daniach alebo v Sociálnej poisťovni? | FS, Sociálna poisťovňa | ÁNO / Nie / treba overiť |

---

## 6. Verdikt a skóre

- Skóre začína na **100**. Každé zistenie strhne alebo pridá body podľa tabuliek vyššie a výsledok sa zaokrúhli do rozsahu 0–100.
- **ODPORÚČAME:** skóre ≥ 85 a žiadny kritický nález.
- **S VÝHRADOU:** skóre 60–84 a žiadny kritický nález.
- **NEODPORÚČAME:** skóre < 60 **alebo akýkoľvek kritický nález**.
- **Predbežné:** niektorá kontrola čaká na manuálne overenie alebo zdroj nebol dostupný. Pri kritickom náleze je verdikt konečný. Vo verzii *Firma* neverejné registre verdikt neblokujú.
- Manuálne potvrdenie vo verzii *Rozšírené*:
  - *Bez záznamu* = kontrola v poriadku;
  - *Záznam nájdený* = postih podľa tabuľky 3.8.

---

## 7. Údržba – čo robiť, keď sa zdroj zmení

1. **Zistenie.** Kontrola ukazuje *Zdroj nedostupný*, prípadne AI začne dopĺňať výsledky. Admin otvorí `/api/diag`: stav každého zdroja (HTTP kód, čas), databázy a kľúča FS.
2. **Dočasne** zabezpečí výsledky záložné AI, alebo sa zdroj overí ručne cez odkaz.
3. **Oprava.** Každý zdroj má vlastný súbor v `lib/sources/`. Zmena formátu sa zvyčajne opraví úpravou mapovania polí v jednom súbore.
4. **Overenie.** `npm test` spustí offline testy s odpoveďami v štruktúre reálnych API. Po oprave treba doplniť test so zmeneným formátom (`test/mock.ts`).

---

## 8. Právne a prevádzkové poznámky

- Všetky automatické zdroje sú verejné registre alebo otvorené dáta (CC BY 4.0 alebo verejné zoznamy podľa osobitných predpisov).
- **Dôvera** výslovne zakazuje automatizované overovanie, preto ju aplikácia neoveruje ani cez AI. **CRE** vyžaduje prihlásenie a platbu a aplikácia k nemu nepristupuje.
- Aplikácia neukladá údaje z registrov natrvalo. Ukladá len protokol činností (kto, kedy, IČO, verdikt) a kontaktné karty partnerov.
- Hodnotenie je pomôcka a nenahrádza právne posúdenie. Údaje v registroch môžu byť oneskorené.


## Indikátory rizikovosti obchodu (Bulletin SKDP 03/2024, s. 4 a nasl.)

Štrnásť indikátorov daňového podvodu, ktoré správca dane skúma. Aplikácia ich pokrýva takto (kód: `lib/deal.ts`, `lib/sources/rpo.ts`, `lib/sources/ruz.ts`, `lib/sources/fs.ts`, `app/components/DealCard.tsx`, `ContactCard.tsx`):

| Indikátor | Ako sa zisťuje | Nález |
|---|---|---|
| (i) nová / neetablovaná spoločnosť | vek z RPO; predmet obchodu zadaný zamestnancom vs. predmet podnikania a hlavná činnosť v registri | vek −15 / −6; nezhoda predmetu obchodu: upozornenie −8 |
| (ii) neaktívna spoločnosť | tržby v poslednej závierke < 1 000 € pri aspoň 2 splatných obdobiach | upozornenie −12 |
| (iii) daňový raj | štát sídla spoločníka (RPO) oproti zoznamu EÚ nespolupracujúcich jurisdikcií + offshore centrá (`RISK_JURISDICTIONS`); virtuálne sídlo sa nerieši | upozornenie −15 |
| (iv) časté zmeny / zmena pred obchodom | zmeny spoločníkov (≥ 2 za 2 roky), štatutárov (≥ 3 za 2 roky); zmena vlastníka alebo štatutára za posledných 180 dní (okrem vzniku) | −8 · −8 · −10 |
| (v) komunikácia s neoprávnenou osobou | karta kontaktu: meno vs. štatutári v registri; zaškrtnutie „oprávnenie konať doložené (plná moc)“ | varovný text, zápis do protokolu |
| (vi) dokumentácia | posúdi poverený zamestnanec | −8 |
| (vii) cenová politika | posúdi poverený zamestnanec | −10 |
| (viii) porušovanie predpisov / nabádanie | posúdi poverený zamestnanec | **kritické −40** |
| (ix) povolenie / zápis v registri | predmet obchodu vs. zoznam regulovaných činností (`REGULATED`): PHM, lieh, tabak, odpady, finančné služby, doprava, lieky, zbrane, SBS, agentúrne zamestnávanie, stavby, VTZ, potraviny, hazard | pripomienka s odkazom na register |
| (x) nezvyčajné platby | IBAN partnera vs. zoznam bankových účtov platiteľov DPH (FS OpenData, `bankAccounts`); platby v hotovosti a iné metódy posúdi zamestnanec | neoznámený účet **kritické −35** (§ 69 ods. 14 písm. c) ZDPH); hotovosť −12; iné −10; neplatný IBAN −5 |
| (xi) preprava | posúdi poverený zamestnanec | −6 |
| (xii) umelé zapojenie osôb | posúdi poverený zamestnanec | **kritické −40** |
| (xiii) referencie len od sprostredkovateľa | posúdi poverený zamestnanec | −8 |
| (xiv) tlak na čas | posúdi poverený zamestnanec | −6 |

Posúdenie zamestnanca má tri stavy (neposúdené / bez indikácie / indikácia potvrdená) a všetky sa zapíšu do protokolu s menom a časom. Neposúdené a neoverené položky (napr. účet bez kľúča FS) nie sú nikdy v neprospech partnera.

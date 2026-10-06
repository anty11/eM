@AGENTS.md

# Dokumentácia architektúry – povinné pri každej zmene

`docs/ARCHITEKTURA.md` je živý popis toho, odkiaľ berieme dáta, ako ich overujeme, aké polia očakávame, kde pomáha Jev a čo robí
Claude/OpenAI. V tom istom commite ho uprav, keď meníš zdroj (`lib/sources`), AI (`lib/ai`), prehliadač (`lib/browser`), prístupy,
premenné prostredia alebo testy – presné pravidlá sú v kapitole 11 dokumentu. `test/docs.test.ts` (súčasť `npm test`) zlyhá,
ak v dokumente chýba zdroj, zadanie AI, premenná prostredia, test alebo ak verzia v hlavičke nesedí s `APP_VERSION`.
Zmeny verzií zapisuj aj do `docs/STAV.md`.

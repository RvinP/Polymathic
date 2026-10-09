---
name: praca
description: Nauka wpleciona w zwykłą pracę z AI (kod, analiza, pisanie) — po zakończeniu większego etapu proponuje opcjonalne 10–15-minutowe ćwiczenie oparte na tym, co właśnie powstało. Używaj, gdy użytkownik pracuje nad czymś i chce przy okazji się uczyć, albo wywoła /praca.
argument-hint: "[nad czym pracujemy]"
allowed-tools: Bash(node scripts/srs.mjs:*), Bash(node scripts/new-topic.mjs:*), Read, Write, Edit, Glob, Grep, WebSearch, WebFetch
---

# /praca — nauka wpleciona w pracę

Kontekst: **$ARGUMENTS**

Od teraz pracujemy normalnie (kod, analiza, pisanie) — praca ma pierwszeństwo. Nauka jest **opcjonalnym dodatkiem**, nie warunkiem.

## Kiedy proponować ćwiczenie

- Tylko po zakończeniu czegoś **znaczącego** (funkcja działa, analiza ma wnioski, rozdział napisany) — nie w trakcie.
- **Jedna propozycja na większy etap.** Nie przerywaj natarczywie.
- Krótko, jednym zdaniem + wybór, np.: „Zanim pójdziemy dalej — 10 minut ćwiczenia na tym, co zrobiliśmy? (przewidywanie / luka do uzupełnienia / dlaczego tak)”.
- **Odmowa jest w porządku.** Nie dopytuj, nie zachęcaj ponownie przy tym samym etapie.

## Trzy rodzaje ćwiczeń

1. **Przewidywanie** — „Co się stanie, jeśli…?” *zanim* pokażesz wynik: zmiana wejścia, usunięcie linii, inna kolejność, skrajny przypadek. Najpierw jego przewidywanie z uzasadnieniem, potem uruchomienie/sprawdzenie, potem rozmowa o różnicy.
2. **Generowanie** — kluczowy fragment pisze/wyjaśnia sam. Ty zostawiasz lukę:
   - w kodzie: znacznik `TODO(człowiek): <co ma się tu znaleźć i po co>` w miejscu najbardziej pouczającym (nie w nudnym boilerplate); reszta działa;
   - w tekście/analizie: puste miejsce na kluczowy argument lub wniosek.
   Po uzupełnieniu — sprawdź i omów po sokratejsku (`/sokrates`).
3. **Przypominanie** — „Dlaczego wybraliśmy X zamiast Y?” — po pewnym czasie od decyzji (np. na koniec dnia pracy), bez zaglądania do historii.

## Zapisywanie pojęć

Pojęcia warte zapamiętania (nie trywialne, przydatne poza tym projektem) zapisz do powtórek:

1. `node scripts/new-topic.mjs praca "Praca"` — tylko raz, jeśli temat `praca` jeszcze nie istnieje (ustaw mu `status: utrwalanie` i krótki cel: „pojęcia z codziennej pracy”).
2. `node scripts/new-topic.mjs concept <slug> praca "<Nazwa>" --type wywod` (albo `prawda`).
3. Poproś uczącego się o zasadę **własnymi słowami** → wklej dosłownie do pliku.
4. `node scripts/srs.mjs new <slug> <ocena z ćwiczenia>`.
5. Dopisz slug do `pojecia:` w `dane/tematy/praca/temat.md`.

Pojęcia te wrócą w `/powtorka`, przeplecione z innymi tematami.

## Log

Krótki wpis `dane/sesje/RRRR-MM-DD-praca.md` (`tryb: praca`): nad czym pracowaliśmy, jakie ćwiczenie, wynik, zapisane pojęcia. Jeśli ćwiczenia nie było — nie twórz logu.

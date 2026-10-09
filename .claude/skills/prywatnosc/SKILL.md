---
name: prywatnosc
description: Przegląd znaczeniowy prywatności przed publikacją — czyta zmiany przeznaczone do repozytorium i szuka treści osobistych, których nie złapie strażnik oparty na wzorcach (imiona, relacje, uczucia, zdrowie, praca, ambicje, historia nauki, preferencje podane jako reguła). Używaj przed git push, przed pierwszym commitem, gdy użytkownik pyta „czy mogę to opublikować” albo wywoła /prywatnosc.
argument-hint: "[zakres: staged | push | wszystko]"
allowed-tools: Bash(git diff:*), Bash(git ls-files:*), Bash(git log:*), Bash(git status:*), Bash(node scripts/check-repo.mjs:*), Read, Grep
---

# /prywatnosc — przegląd znaczeniowy przed publikacją

Strażnik `scripts/check-repo.mjs` łapie to, co da się opisać wzorcem (e-mail, ścieżka, token, słowa z `.private-patterns`). Ten skill łapie to, co jest prywatne ze względu na **znaczenie**: „mam kota Filemona” nie pasuje do żadnego wzorca, a jest prywatne. Przegląd AI jest probabilistyczny — uzupełnia strażnika i przegląd człowieka, nie zastępuje ich.

## Zakres

Argument: **$ARGUMENTS** (domyślnie `push`).

- `staged` → `git diff --cached`
- `push` → zmiany jeszcze niewypchnięte: `git diff @{upstream}...HEAD` oraz `git diff --cached`; bez upstreamu (pierwsza publikacja) → jak `wszystko`
- `wszystko` → treść każdego pliku z `git ls-files --cached --others --exclude-standard`

Najpierw uruchom `node scripts/check-repo.mjs`; jego znaleziska podaj osobno na początku.

## Czego szukasz

Treści, które mówią coś o **konkretnej osobie**, a nie o metodzie:

1. Tożsamość: imiona, pseudonimy, miejsca, firmy, konta, numery.
2. Relacje i uczucia: bliscy, partnerzy, konflikty, emocje opisane jako fakt o kimś.
3. Zdrowie, finanse, sytuacja życiowa.
4. Praca: pracodawca, projekt, stanowisko, staż, technologie z czyjejś pracy podane jako oczywistość.
5. Ambicje i porównania: „ma zostać ekspertem w swojej branży”, „czuje się gorszy od…”.
6. Historia i preferencje jednej osoby podane jako reguła ogólna („uczący się woli…”, „preferencja uczącego się”).
7. Przykłady z jednej dziedziny, które zdradzają autora (np. wszystkie z jednej branży).

Nie zgłaszaj ogólnych zasad uczenia się opartych na badaniach ani neutralnych przykładów.

## Wynik

Lista od najpoważniejszego: `plik:linia` · krótki cytat · dlaczego to prywatne · propozycja (uogólnić / przenieść do `dane/` / dopisać wzorzec do `.private-patterns` / usunąć). Na końcu werdykt: **można publikować** albo **najpierw poprawki**.

Nie edytuj plików bez zgody — decyzję podejmuje człowiek. Nie cytuj w odpowiedzi treści `dane/` ani `.private-patterns` szerzej, niż trzeba do wskazania problemu.

---
name: quiz
description: Quiz z natychmiastową oceną w przeglądarce (okno w aplikacji Polymathic, ✓/✗, poprawna odpowiedź, wyjaśnienie, zawsze opcja „Nie wiem”). Moduł dla /nauka, /powtorka, /pytania — używaj zawsze, gdy pytanie ma jednoznacznie poprawną odpowiedź. Wywołaj bezpośrednio (/quiz <temat>), żeby zrobić krótki quiz z danego tematu.
argument-hint: "[temat lub pojęcie]"
allowed-tools: Bash(node scripts/quiz.mjs:*), Bash(node scripts/srs.mjs:*), Read, Glob, Grep, WebSearch, WebFetch, Agent
---

# /quiz — pytania z oceną

Jeśli wywołano bezpośrednio (**$ARGUMENTS**): 4–6 pytań z tematu/pojęcia, rosnąca trudność, na końcu krótkie podsumowanie i wnioski (co powtórzyć). W pozostałych przypadkach to moduł.

## Kiedy quiz, a kiedy nie

| Sytuacja | Narzędzie |
|---|---|
| pytanie ma jednoznacznie poprawną odpowiedź (także pytanie sokratejskie, w którym uczący się „odkrywa”) | **quiz** |
| szybkie mapowanie granicy wiedzy w diagnozie | **quiz** (seria małych pytań zamiast męczących otwartych) |
| brak dobrej odpowiedzi: preferencja, kierunek, wybór celu | **AskUserQuestion** (popup w terminalu) |
| wyjaśnij własnymi słowami, swobodne przypomnienie, zapis zasady | **pytanie otwarte w czacie** — quiz nigdy go nie zastępuje |

W powtórce **swobodne przypomnienie zawsze pierwsze** — quiz dopiero potem (podpowiedzi w opcjach psują przypominanie).

## Jak zadać

Pojedyncze pytanie: Bash z `timeout: 600000` (skrypt czeka, aż uczący się odpowie w przeglądarce):

```bash
node scripts/quiz.mjs <<'JSON'
{
  "question": "<pytanie z tematu, którego się uczysz>",
  "details": "<opcjonalny kontekst: założenia, wersja, dane>",
  "options": ["<poprawna teza>", "<teza przy błędnym przekonaniu A>", "<teza przy błędnym przekonaniu B>"],
  "correct": "<poprawna teza>",
  "explanation": "<dlaczego poprawna jest poprawna i skąd biorą się pozostałe>",
  "concept": "slug-pojecia"
}
JSON
```

- `question`, `details`, `explanation` to markdown; wzory w LaTeX: `$…$`, `$$…$$`; kod w backtickach.
- Kilka poprawnych: `"correct": ["…", "…"]` (uczący się musi zaznaczyć dokładnie ten zbiór).
- Opcje są tasowane automatycznie (`"shuffle": false` tylko gdy kolejność ma znaczenie, np. liczby rosnąco).
- „Nie wiem” jest dodawane zawsze — nie dodawaj go sam.
- Serwer podglądu uruchamia się sam, jeśli nie działa.

**Seria pytań:** gdy masz więcej niż jedno pytanie, które nie zależą od siebie, wygeneruj **wszystkie z góry** i wyślij je jednym wywołaniem jako tablicę. Uczący się od razu widzi „pytanie 2 z 6” i pasek postępu, może „Pomiń pytanie” albo „Zakończ (pomiń N)”, gdy nie ma czasu. Zapisz tablicę do pliku JSON w scratchpadzie i uruchom w tle (`run_in_background`), wynik przyjdzie po całej serii:

```bash
node scripts/quiz.mjs <scratchpad>/seria.json      # [ {"question"…}, {"question"…}, … ]
```

Przed serią diagnostyczną powiedz w czacie wprost: „przy braku pewności zaznacz »Nie wiem« (jest pod opcjami)” — inaczej zgadnięte trafienia udają wiedzę, a zgadnięte błędy udają błędne przekonania. Domyślny limit to 5 min na pytanie (`--timeout <s>` dla całości). Wyjście: blok na każde pytanie (`1. ✓ Dobrze.` … + `RESULT_JSON`) i linia `PODSUMOWANIE: x/n dobrze · … · k pominięte`. Pominięte ≠ „Nie wiem” — to brak czasu, nie luka; nie oceniaj z nich FSRS. Pojedyncze pytanie (np. sokratejskie, gdy następne zależy od odpowiedzi) zadawaj jak wyżej.

Wynik: `✓ Dobrze` / `✗ Źle` / `? Nie wiem` + linia `RESULT_JSON: {...}` (`selected` — wybrane, `correctAnswers` — poprawne, `note` — notatka uczącego się, `dontKnow`, `isCorrect`). **„Nie wiem” to uczciwa luka, nie błąd** — traktuj inaczej niż zgadywanie: nie ma błędnego przekonania do wyrugowania, jest coś do zbudowania. Notatka uczącego się (pole w oknie) często zawiera jego tok myślenia — przeczytaj ją.

Uczący się widzi wyjaśnienie od razu w oknie. W czacie nie powtarzaj go — skomentuj krótko tylko to, co z wyniku wynika dla dalszej nauki (zgrzyt? błędne przekonanie? podnieść trudność?).

## Hamulec trudności

W seriach diagnostycznych w obszarze, którego podstawy uczący się zna, dodaj w każdym pytaniu ostatnią opcję „Czarna magia — zejdźmy niżej” (`"shuffle": false`, poprawną umieść w różnych miejscach). Wybór = sygnał, że poziom jest za wysoki: zejdź do podstawy, potem wróć wyżej. W `details` poproś o opis rozumienia i pewność 1–4 w notatce.

## Budowa opcji — procedura (nie audyt po fakcie)

Opcje mają być równe z konstrukcji, inaczej poprawna zdradza się sama:

1. **Każda opcja to goła teza — zero uzasadnień.** Najczęstsza wpadka: poprawna opcja niesie swoje „bo…”, a dystraktory są gołe → dłuższa i konkretniejsza. Całe „dlaczego” idzie do `explanation`.
2. **Najpierw napisz poprawną tezę, potem przerób ją na dystraktory.** Weź konkretne błędne przekonanie albo łatwo mylonego sąsiada i zapisz, co twierdziłby ktoś, kto je wyznaje — w tym samym szkielecie, długości i rejestrze. Każda opcja to „teza przy jakimś przekonaniu”; poprawna to teza przy przekonaniu prawdziwym.
3. Każdy dystraktor to błąd, który uczący się **naprawdę mógłby popełnić** (wtedy wybór jest diagnostyczny) — kuszący, ale jednoznacznie błędny. Bez podchwytliwości.
4. **Bez asymetrycznego pogrubiania** i bez opcji typu „wszystkie powyższe”, jeśli nie są naprawdę potrzebne.

Test: czytając gotowy zestaw „na zimno”, bez wiedzy z tematu — czy da się zgadnąć poprawną? Jeśli tak, wróć do kroku 1 lub 2 i wygeneruj od nowa, nie łataj.

Fakty w pytaniu i wyjaśnieniu muszą być sprawdzone (przy wątpliwości: agent `researcher` albo WebSearch) — zły klucz odpowiedzi uczy błędu.

## Po quizie

- Wynik wpływa na ocenę FSRS tak jak każda odpowiedź (`/powtorka`, `/nauka` krok 6) — ale quiz sam w sobie to słabszy dowód niż swobodne przypomnienie.
- Dobre pomyłki zapisz w pliku pojęcia („Moje typowe błędy”).
- Nie fiksuj się: dwa nietrafione quizy w tym samym punkcie → zaparkuj, wróć do mapy (`/sokrates`).

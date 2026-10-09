---
name: pytania
description: Trening przejmowania inicjatywy — uczący się zadaje pytania, AI ocenia ich jakość (fakt / przyczyna / granica / połączenie / zastosowanie) i prowadzi bank pytań. Używaj, gdy użytkownik chce ćwiczyć zadawanie pytań, wypisać pytania do tematu albo zmienić poziom inicjatywy; także jako moduł w /nauka i /powtorka.
argument-hint: "[temat, pojęcie albo materiał do przeczytania]"
allowed-tools: Bash(node scripts/srs.mjs:*), Bash(node scripts/quiz.mjs:*), Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, Agent
---

# /pytania — przejmowanie inicjatywy

Argument: **$ARGUMENTS** (temat, pojęcie albo materiał). Bez argumentu — zaproponuj temat w toku albo pojęcie z ostatnich sesji.

Docelowo umiejętność zadawania sobie dobrych pytań ma zostać **nawet bez AI**. AI zaczyna jako ten, który pyta, a kończy jako ten, który ocenia pytania człowieka.

## Poziomy inicjatywy

Zapisane globalnie w `dane/profil.md` (`poziom_inicjatywy`) i per pojęcie (`poziom_inicjatywy` w pliku pojęcia). Per pojęcie wygrywa, jeśli jest ustawione.

| poziom | przebieg |
|---|---|
| **1** | AI pyta, uczący się odpowiada. |
| **2** | Po każdej odpowiedzi uczący się dopisuje **jedno własne pytanie**, które mu się nasunęło. |
| **3** | **Zanim AI cokolwiek zapyta**, uczący się wypisuje 3–5 pytań do tematu; AI ocenia ich jakość, potem dialog zaczyna się od najlepszego z nich. |
| **4** | Uczący się dostaje materiał **bez pomocy** (tekst, rozdział, problem — najlepiej z jego `dane/materialy/`), pracuje sam; AI na końcu sprawdza, czy jego pytania wyłapały sedno — co pominęły? |

Na początku sesji powiedz, na jakim poziomie jesteśmy, i czy jest **jawne założenie** na tę sesję, np. „tym razem poza odpowiedziami znajdź pytania, które dodatkowo masz” albo „szukamy pytań o granice”.

## Ocena jakości pytania

Każde pytanie uczącego się:

1. **Nazwij kategorię:**
   - `fakt` — co / ile / kiedy (odpowiedź do sprawdzenia),
   - `przyczyna` — dlaczego, skąd to się bierze, jaki mechanizm,
   - `granica` — kiedy przestaje działać, co jeśli zmienić założenie,
   - `polaczenie` — związek z innym pojęciem/tematem,
   - `zastosowanie` — jak tego użyć, co to zmienia w praktyce.
2. **Zaproponuj, jak to samo pytanie zadać głębiej** — konkretnie, jednym zdaniem (zwykle: fakt → przyczyna → granica).
3. Krótko i rzeczowo. Bez ocen typu „świetne pytanie”: nazwij, co w nim dobre, a co można pogłębić.

Na pytanie samo w sobie **nie odpowiadaj od razu** — jeśli może sam do odpowiedzi dojść, zapytaj, jak by zaczął (zasady `/sokrates`). Pytanie o fakt, którego nie da się wywnioskować — odpowiedz (sprawdzając w sieci, jeśli niepewne).

## Bank pytań

Dobre pytania (zwłaszcza przyczyna / granica / połączenie) dopisz do `dane/pytania.md` w formacie:

```
## RRRR-MM-DD · <slug-pojęcia> · <kategoria>
**Pytanie:** <dosłownie jego słowami>
**Ocena AI:** <kategoria i co w nim wartościowe>
**Głębiej:** <jak zadać głębiej>
```

- Kategoria bez polskich znaków: `fakt`, `przyczyna`, `granica`, `polaczenie`, `zastosowanie`.
- Dopisuj nowe wpisy na końcu pliku (poza blokiem przykładowym `<!-- przyklad:start/end -->`).
- Pytania z banku mogą wracać w `/powtorka` (np. jako oś `granica` albo `polaczenie`).

## Awans poziomu

Policz ostatnie ~10 pytań uczącego się (bank + logi sesji). Gdy **regularnie** trafiają w przyczyny i granice (np. ≥ 5 z 10) — **zaproponuj** awans o jeden poziom (globalnie albo dla pojęcia). Nie awansuj bez zgody. Gdy na wyższym poziomie wyraźnie się męczy — zaproponuj powrót; to nie porażka.

Zmianę zapisz w `dane/profil.md` lub w pliku pojęcia i zanotuj w logu sesji.

## Log

Jeśli `/pytania` jest osobną sesją: `dane/sesje/RRRR-MM-DD-pytania.md`, `tryb: pytania`, w treści: poziom, założenie sesji, pytania z kategoriami, wnioski.

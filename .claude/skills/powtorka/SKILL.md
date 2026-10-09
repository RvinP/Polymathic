---
name: powtorka
description: Powtórki sokratejskie z transformacją — pojęcia na dziś z FSRS, przeplatane między tematami, każde w innym przebraniu (osie transformacji). Używaj, gdy użytkownik chce zrobić powtórkę, utrwalić materiał albo /status pokazuje pojęcia do powtórki.
argument-hint: "[opcjonalnie: slug tematu albo liczba pojęć]"
allowed-tools: Bash(node scripts/session.mjs:*), Bash(node scripts/srs.mjs:*), Bash(node scripts/quiz.mjs:*), Bash(node scripts/render.mjs:*), Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, Agent
---

# /powtorka — powtórki z transformacją

Argument (opcjonalny): **$ARGUMENTS** — ogranicz do tematu albo do liczby pojęć.

Najważniejsza zasada: **powtórka nigdy nie jest kopią.** Ta sama zasada wraca w innym przebraniu i z innej strony. Pamiętamy to, co musieliśmy odtworzyć w nowej sytuacji — nie to, co rozpoznaliśmy.

Przeczytaj `.claude/skills/sesja/SKILL.md` i używaj wspólnego planu oraz zapisu dowodów. Przy wznowieniu odczytaj status zamiast powtarzać diagnozę.

## Przygotowanie

1. `node scripts/srs.mjs today` (jeśli argument to kategoria, np. „Języki” albo „Gotowanie” — dodaj `--category "<kategoria>"`) — lista pojęć na dziś. Skrypt już je **przeplata** między tematami i podaje `suggestedAxis`. Nie zmieniaj kolejności na „temat po temacie”.
2. Pusta lista → powiedz, że dziś nic, i że przerwa też jest częścią metody. Możesz zaproponować `/pytania` albo `/nauka` dla tematu w toku. Nie rób powtórek „na zapas” — FSRS wie lepiej.
3. Dużo pojęć (> 8) → zaproponuj dziś 6–8 najbardziej zaległych, resztę jutro. Dostosuj liczbę do podanego czasu i sygnałów zmęczenia.
4. Dla każdego pojęcia przeczytaj `dane/pojecia/<slug>.md`: zasadę słowami uczącego się, jego błędy, `osie_uzyte`, `poziom_inicjatywy`. Przejrzyj ostatnie logi sesji z tym pojęciem, żeby **nie zadać tego samego pytania co poprzednio**.

## Mieszaj i utrudniaj

Pojedyncze pojęcia w izolacji to za mało — w prawdziwym problemie nikt nie mówi, której zasady użyć.

- **Zadania łączone.** `srs.mjs today` wypisuje grupy pojęć powiązanych w grafie. Wybierz 2–3 powiązane pojęcia z grupy; daj **jedno** zadanie wymagające tych pojęć naraz. Duże grupy dziel na krótkie zadania (np. rodzic + dziecko: zastosuj oba w jednym rozumowaniu). Pojęcie „do wplecenia bez oceny” (spoza listy na dziś) też wchodzi do zadania, ale go nie oceniasz.
- **Zadanie bez etykiety.** Przynajmniej raz na powtórkę podaj problem, nie mówiąc, którego pojęcia dotyczy — uczący się sam rozpoznaje, która zasada pasuje. Rozpoznawanie to osobna umiejętność od stosowania.
- **Trudne zadania.** Gdy pojęcie ma stabilność ≥ 7 dni albo poszło łatwo (4) — następnym razem daj zadanie wieloetapowe, z pułapką lub z przypadkiem brzegowym, a nie samo przypomnienie.
- **Nie fiksuj się:** jeśli zadanie łączone utknęło na jednym pojęciu, oceń to pojęcie odpowiednio, zaparkuj szczegół i dokończ resztę (zasady w `/sokrates`).

Od początku przeplataj zadania łączone z pojedynczymi, zależnie od związku pojęć i poziomu. Zadanie łączone bez wskazania zasad jest zarazem swobodnym przypomnieniem i zadaniem bez etykiety: ZASTĘPUJE trzy osobne etapy. Nie testuj potem wszystkich tych pojęć ponownie. Planuj zwykle 3–5 zadań w 10–15 minut; przerwij po wyczerpaniu ustalonego czasu.

## Pętla dla zadania (pojedynczego albo łączonego)

### 1. Jedna samodzielna próba

Daj problem wymagający odtworzenia zasad bez etykiet, podpowiedzi ani widocznej notatki. Może łączyć 2–3 pojęcia z planu. Nie poprzedzaj go odpytywaniem z definicji: samodzielne zastosowanie jest już przypomnieniem. Gdy celem jest znajomość samej zasady, krótkie wyjaśnienie własnymi słowami może być całym zadaniem.

### 2. Dialog na wybranej osi

Wybierz oś: domyślnie `suggestedAxis` ze skryptu (nieużyta ostatnio, odblokowana dla obecnej stabilności). Możesz wybrać inną adekwatną, jeśli lepiej pasuje do pojęcia — ale **nie powtarzaj osi z ostatniej powtórki** (sprawdź koniec `osie_uzyte`). Szczegóły: `node scripts/srs.mjs axis <slug>`.

Osie — sugestie trudności na podstawie stabilności, nie zakaz trudnych zadań. Połączenia są dostępne od początku, jeśli uczeń zna składowe. Dobieraj trudność do odpowiedzi; wartości dni nie są pomiarem rozumienia:

| oś | od stab. | co robisz | przykład |
|---|---|---|---|
| `przebranie` | 0 d | ta sama zasada w zupełnie innym kontekście/dziedzinie | 2 jabłka + 2 jabłka → „mam 4 koty” |
| `odwrocenie` | 0 d | znam wynik, szukam przyczyny lub brakującego elementu | „…ile brakuje, żeby mieć 9?” |
| `reprezentacja` | 2 d | wyjaśnij rysunkiem (opisem rysunku/ASCII), analogią albo dziecku | |
| `blad` | 4 d | podajesz **przekonujące, ale błędne** rozumowanie; on wskazuje, gdzie się sypie | błąd ma być subtelny, wiarygodny, najlepiej taki, jaki on sam kiedyś popełnił (sekcja „Typowe błędy”) |
| `granica` | 7 d | kiedy zasada przestaje działać? co, jeśli zmienić jedno założenie? | |
| `polaczenie` | 0 d | związek z innym pojęciem z jego grafu — najlepiej z **innego tematu** | szukaj w `dane/pojecia/` |
| `tworzenie` | 20 d | on układa zadanie sprawdzające tę zasadę; Ty oceniasz, czy naprawdę ją sprawdza | |

Quiz (`/quiz`) pasuje do osi `blad` (która z tych wersji rozumowania jest poprawna?), `odwrocenie` i do szybkiego sprawdzenia zadania łączonego — może zastąpić otwartą próbę, ale nie jest dodatkowym obowiązkowym etapem.

Prowadzenie dialogu — według `/sokrates` (stany, próg frustracji, różne typy pytań). Przy osi `blad` sprawdź poprawność swojego „błędnego” rozumowania i właściwej odpowiedzi — błąd ma być zamierzony, nie przypadkowy.

**Nigdy nie zadawaj tego samego pytania co poprzednio** — ani dosłownie, ani tego samego zadania z innymi liczbami w tej samej osi.

Własne pytanie człowieka wykorzystaj jako dowód, jeśli ujawnia rozumienie; nie wymagaj dodatkowego zadania po poprawnej próbie.

### 3. Ocena i zapis

Ocena 1–4 według **jakości**, nie tylko poprawności — najwięcej waży swobodne przypomnienie:

| ocena | kiedy |
|---|---|
| 1 — nie pamiętam | swobodne przypomnienie puste lub błędne; dialog dopiero odbudował zasadę |
| 2 — z trudem | przypomnienie fragmentaryczne albo oś przeszedł dopiero z podpowiedzią |
| 3 — dobrze | przypomnienie poprawne własnymi słowami, oś przeszedł samodzielnie |
| 4 — łatwo | natychmiast, precyzyjnie, z własnym przykładem; oś bez wysiłku |

Przy wątpliwości zapytaj o samoocenę („Jak trudne to było, 1–4?”) i weź pod uwagę obie.

Następnie:
1. `node scripts/srs.mjs rate <slug> <ocena> <os>` — z osią, której użyłeś. Tylko raz na pojęcie w sesji. W zadaniu łączonym oceń każde pojęcie z osobna na podstawie rozumowania. Sukces jednego nie dowodzi opanowania drugiego; nie oceniaj pojęcia, którego odpowiedź faktycznie nie sprawdziła.
2. Zapisz próbę przez `session.mjs attempt`, z wynikiem osobno dla każdej sprawdzonej składowej. Nie wyprowadzaj procentu opanowania z jednej próby.
3. Jeśli ujawnił się nowy błąd — dopisz do „Moje typowe błędy” (jego słowami lub cytatem).
4. Jeśli jego zasada w pliku okazała się nieprecyzyjna — poproś, żeby ją poprawił sam.
5. Krótki wpis do logu sesji (patrz niżej).

Poinformuj krótko o następnym terminie (z wyjścia skryptu) i przejdź do następnego pojęcia **bez komentarza o następnym temacie** — przeplatanie ma zaskakiwać.

## Log sesji

`dane/sesje/RRRR-MM-DD-powtorka.md` (jeśli istnieje z dziś — dopisz). Frontmatter:

```yaml
tryb: powtorka
temat: powtorka
tytul: "Powtórka: <n> pojęć"
pojecia: [..]
oceny: { slug: 3, ... }
energia: …
czas_min: …
```

W treści dla każdego pojęcia: oś, zadane pytanie (żeby następnym razem go nie powtórzyć), ocena i dlaczego, zauważone błędne przekonania, pytania uczącego się. Osobno: zadania łączone (które pojęcia, treść, wynik) i sekcja „Zaparkowane”.

## Koniec

Krótko: ile pojęć, które poszły najlepiej / najgorzej, ile jutro (`srs.mjs stats`). Przypomnij, że sen utrwala to, co dziś odtworzył.

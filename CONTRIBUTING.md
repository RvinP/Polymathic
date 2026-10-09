# Jak pomóc w rozwoju Polymathic

Dzięki, że chcesz pomóc! Polymathic to aplikacja do nauki, a jej „mózg” to instrukcje dla AI. Zmiana jednego zdania w skillu zmienia sposób uczenia, więc traktujemy ją z taką samą uwagą jak zmianę kodu.

## Gdzie co leży

| Co | Gdzie |
|---|---|
| Zasady pracy AI (skille: `/nauka`, `/powtorka`, `/quiz`…) | `.claude/skills/<nazwa>/SKILL.md` |
| Agenci pomocniczy (`researcher`, `rysownik`) | `.claude/agents/` |
| Instrukcje ogólne | `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex i inne) |
| Wspólne uprawnienia i hooki Claude Code | `.claude/settings.json` (osobiste: `.claude/settings.local.json`, ignorowany) |
| Aplikacja (serwer i interfejs) | `app/` |
| Skrypty (FSRS, sesje, quizy, rysunki) | `scripts/` |
| Testy | `tests/` |
| Neutralny stan początkowy danych | `data-template/` |
| Badania, na których opiera się metoda | `docs/research/` |

Skille muszą leżeć w `.claude/skills/`, bo tylko tam Claude Code je znajduje. Zobacz [dokumentację skilli](https://code.claude.com/docs/en/skills).

## Zmiana skilla

1. **Uzasadnij zmianę.** Zasady nauki opierają się na badaniach (np. przypominanie zamiast czytania, rozłożenie w czasie, przeplatanie). Zmiana działania AI potrzebuje źródła albo opisu konkretnego problemu z sesji, a nie tylko „wydaje mi się”.
2. **Pisz ogólnie.** Skill ma działać dla każdego tematu i każdej osoby. Przykłady bierz z różnych dziedzin (gotowanie, języki, fizyka, sport), a nie z jednej branży. Nie wpisuj własnych celów, preferencji ani historii. Na to jest prywatny `dane/profil.md` i ekran Ustawienia.
3. **Sprawdź na krótkiej sesji.** Uruchom `claude` w katalogu projektu, przeprowadź krótką sesję, w której zmiana ma znaczenie, i opisz w PR, co AI zrobiło inaczej niż przed zmianą.

## Zmiana kodu

```sh
npm ci
npm test
node scripts/check-repo.mjs   # strażnik prywatności (to samo uruchamia hook przed commitem)
```

Zmiany w `app/*.mjs` i `scripts/lib.mjs` wymagają restartu serwera. Interfejs sprawdź w obu motywach i na wąskim ekranie (telefon).

## Prywatność: strażnik przed commitem

`dane/` (profil, sesje, lekcje, materiały) nigdy nie trafia do repozytorium. Prywatne treści mogą się jednak przemycić także w skillach, dokumentach, testach i przykładach. Dlatego:

```sh
git config core.hooksPath .githooks   # raz po sklonowaniu: strażnik przed każdym commitem
```

Strażnik (`scripts/check-repo.mjs`) blokuje commit, gdy w plikach repozytorium znajdzie adres e-mail, ścieżkę z nazwą użytkownika, ciąg wyglądający na klucz albo słowo z Twojej prywatnej listy `.private-patterns` (jedno wyrażenie regularne na linię; plik jest ignorowany przez git). `git commit --no-verify` go omija. To furtka na wyjątki, nie zwyczaj.

Strażnik rozumie tylko wzorce: zdania „mam kota Filemona” nie złapie. Dlatego przed `git push` uruchom w Claude Code `/prywatnosc`, czyli przegląd znaczeniowy zmian. To też jest sito, nie gwarancja, więc ostatnie słowo ma Twój przegląd diffu.

## Na co uważać

| Problem | Dlaczego jest ważny | Rozwiązanie w projekcie |
|---|---|---|
| Prywatne instrukcje w skillach | Mogą ujawnić profil, preferencje i osobiste cele | Ogólne przykłady; przegląd `.claude/`, `CLAUDE.md`, `AGENTS.md` przed PR |
| Dane poza `dane/` | Wrażliwe treści mogą być też w `docs/`, testach i przykładach | Strażnik sprawdza wszystkie pliki przeznaczone do commita |
| Ścieżki lokalne | Kod może działać tylko na komputerze autora | Ścieżki względem katalogu projektu; strażnik łapie `/Users/<nazwa>` |
| Szablon danych | Aplikacja może nie wystartować bez poprawnego stanu początkowego | `data-template/` + `npm install` tworzy `dane/`; test w `tests/data-template.test.mjs` |
| Zależność od Claude Code | `npm start` nie oznacza jeszcze gotowości do nauki | Brak `claude` w PATH → komunikat w konsoli aplikacji, nie awaria |
| Licencje | Publiczne repo samo nie daje prawa do używania kodu | `LICENSE` (MIT); licencje zależności sprawdzane przed wydaniem |
| Regresje | Zmiana może zepsuć instalację albo skille | `npm test` + test świeżego klonu przed wydaniem |

## Lista przed wydaniem (publikacją nowej wersji)

To lista do rzeczywistego sprawdzenia, nie potwierdzenie wykonania testów.

- [ ] Nie ma prywatnych danych, osobistych instrukcji ani sekretów w publikowanych plikach (`node scripts/check-repo.mjs`, `/prywatnosc` w Claude Code, przegląd diffów skilli)
- [ ] Historia przeznaczona do publikacji została sprawdzona (`git log -p`)
- [ ] Świeży klon instaluje zależności przez `npm ci`
- [ ] Aplikacja uruchamia się z neutralnymi danymi (świeży klon, bez `dane/`)
- [ ] Brak CLI lub logowania daje zrozumiałą instrukcję, a nie awarię
- [ ] Testy projektu przechodzą (`npm test`)
- [ ] README opisuje wymagania, ograniczenia i pierwszy start
- [ ] Licencja i licencje zależności zostały sprawdzone

## Pull request

Jedna zmiana na PR. W opisie: co zmienia się w zachowaniu (AI albo aplikacji), dlaczego (źródło lub problem z sesji), jak to sprawdziłeś. Pomysły i błędy zgłaszaj jako issues.

# Polymathic

Lokalna przestrzeń nauki z AI. Uczysz się dowolnego tematu w rozmowie z Claude Code. Polymathic nie podaje gotowych odpowiedzi, tylko prowadzi: diagnoza, mapa zależności pojęć, krótkie wyjaśnienie, Twoja próba, informacja zwrotna, powtórki rozłożone w czasie (FSRS). Wszystko działa na Twoim komputerze i zapisuje się w zwykłych plikach Markdown.

## Wymagania

- Node.js 18+
- [Claude Code](https://claude.com/claude-code) zainstalowany i zalogowany (`claude` w PATH). Nie trzeba klucza API.
- Przeglądarka. Rysunki do lekcji wymagają przeglądarki z rodziny Chromium (Chrome, Brave, Edge).
- Testowane na macOS. Linux powinien działać. Windows nie był sprawdzany.

## Ograniczenia

- Jakość nauki zależy od modelu AI. Ocena rozumowania i dobór zadań to nie gwarancja skuteczności.
- Bez `claude` w PATH aplikacja się uruchomi, ale konsola Nauki pokaże tylko instrukcję instalacji. Jeśli Claude Code nie jest zalogowany, konsola wyświetli jego ekran logowania.
- Jeden użytkownik, jeden komputer. Synchronizacja między urządzeniami nie jest obsługiwana.

## Start

```sh
git clone <adres-repozytorium> polymathic
cd polymathic
npm install      # przy okazji tworzy dane/ z neutralnego szablonu
npm start        # otwiera http://localhost:4321
```

Na macOS możesz też dwukrotnie kliknąć `Uruchom Polymathic.command`.

W zakładce **Nauka** wpisz `/nauka <temat>`, np. `/nauka procent składany`. Potem:

- **Ustawienia**: dopasuj styl pracy AI, np. ile pytań bez postępu znosisz albo jak mocno AI trzyma się celu (hamulec zakresu).
- **Powtórki**: terminy wyznacza algorytm.
- **Biblioteka**: tematy, mapy pojęć, Twoje materiały i zapisane lekcje.

## Komendy w rozmowie

| Komenda | Do czego |
|---|---|
| `/nauka <temat>` | sesja nauki: cel → przykład/próba → informacja zwrotna → zastosowanie |
| `/powtorka` | powtórki na dziś, każde pojęcie w innym przebraniu |
| `/pytania` | trening zadawania własnych pytań |
| `/status` | co na dziś i jedna rekomendacja |
| `/quiz` | pytanie z oceną w oknie przeglądarki |
| `/wizualizuj` | sprawdzony rysunek do lekcji |
| `/prywatnosc` | przegląd prywatności przed publikacją (dla rozwijających) |

Możesz też uruchomić `claude` we własnym terminalu w tym folderze, działa tak samo. Zasady pracy AI są w `CLAUDE.md`, `AGENTS.md` i `.claude/skills/`. Własne skille dodawaj obok (zob. `.claude/skills/moje/README.md`).

## Twoje dane

- `dane/` to Twoje prywatne dane: profil, tematy, pojęcia, sesje, lekcje, materiały. Folder jest w `.gitignore` i nigdy nie trafia do repozytorium. Przy pierwszym starcie powstaje z `data-template/`, a istniejące pliki nie są nadpisywane.
- Stan rozmowy: `~/Library/Application Support/Polymathic/` (macOS). Katalog zmienisz przez `POLYMATHIC_STATE_DIR`.
- `PORT=4322 npm start` zmienia port. `POLYMATHIC_NO_OPEN=1` wyłącza automatyczne otwieranie przeglądarki.

Serwer nasłuchuje tylko na `127.0.0.1` i sprawdza Host oraz Origin zapisów. HTML notatek przechodzi przez DOMPurify. **Nie wystawiaj aplikacji przez publiczny tunel**: interfejs daje dostęp do Twoich danych i do uruchamiania AI.

## Rozwój

Jak pomóc i na co uważać: [CONTRIBUTING.md](CONTRIBUTING.md).

```sh
npm test                              # testy
```

Przed commitem działa strażnik prywatności (hook git); jak go włączyć i co sprawdza, opisuje [CONTRIBUTING.md](CONTRIBUTING.md#prywatność-strażnik-przed-commitem).

Zmiany w backendzie (`app/*.mjs`, `scripts/lib.mjs`) wymagają restartu serwera. Samo odświeżenie strony nie wystarczy.

## Inspiracja i licencja

Inspiracja: [amosblomqvist/learn](https://github.com/amosblomqvist/learn): zależności między pojęciami, motywowane wyjaśnienia, quizy i czytelny zapis lekcji.

Licencja: [MIT](LICENSE).

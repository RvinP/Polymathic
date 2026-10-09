---
name: sesja
description: Prowadzenie i wznowienie ograniczonej czasowo sesji nauki w Polymathic, z zadaniami łączonymi i trwałym zapisem dowodów. Używaj wraz z nauka lub powtorka; nie uruchamiaj dla krótkiego pytania ani prac nad kodem aplikacji.
allowed-tools: Bash(node scripts/session.mjs:*), Read
---

# Sesja z pamięcią

To obsługa nauczyciela, nie dodatkowy formularz dla ucznia. Cel → jedno zadanie → próba → konkretna informacja zwrotna → następny sensowny krok. Nie pokazuj JSON ani technicznych komend w lekcji.

1. `node scripts/session.mjs status` przed rozpoczęciem lub wznowieniem nauki. Aktywna sesja zachowuje cel, zadania, dosłowne odpowiedzi i luki; nie powtarzaj diagnozy. Jeśli poprzednia jest zakończona, wykorzystaj `nextStep` i odłożone luki do nowego planu.
2. Uruchom `start` dopiero kiedy cel wynika z rozmowy. Domyślnie 15 minut, bez pytania o każdą preferencję. Podany czas ma pierwszeństwo. `topic` to istniejący slug; przy nowym temacie najpierw stwórz temat/pojęcia zgodnie z `/nauka`. Gdy brak pojęć, zadanie `orient` służy krótkiej orientacji, nie dowodzi opanowania dziedziny.
3. Korzystaj z `next`: `example` → krótki rozwiązany przykład przed próbą; `transfer` → nowe zastosowanie; `connect` → jeden problem wymagający 2–3 pojęć. Nie pokazuj nazw zasad przed próbą. Przeczytaj karty i ich błędy; ułóż i sam sprawdź zadanie przed podaniem go człowiekowi. Plan nie jest generatorem treści ani pomiarem wiedzy.
4. Po rzeczywistej odpowiedzi zapisz `attempt`: pytanie, dosłowną odpowiedź, wynik i uzasadnienie OSOBNO dla każdego faktycznie sprawdzonego pojęcia. `helpUsed: true` obejmuje podpowiedź, widoczne rozwiązanie i zastosowanie skopiowane z przykładu. Nie oceniaj niesprawdzonych składowych. Id próby zachowaj przy ponowieniu zapisu.
5. `new-example` → inny kontekst bez pomocy, zamiast przepytywania o to samo. Po dwóch próbach bez samodzielnego dowodu skrypt odkłada zadanie i blokuje zależne wątki. `explain-and-switch` → wyjaśnij lukę krótko i przejdź do wskazanego niezależnego zadania. `wrap` → zakończ bieżące wyjaśnienie i podsumuj; jeśli nie ma niezależnego zadania, nie udawaj, że fundament jest opanowany. Możesz pokazać rozwiązany przykład, a powrót odłożyć do kolejnej sesji. Prośba „wyjaśnij” natychmiast kończy zgadywanie, niezależnie od licznika.
6. `finish` zapisuje konkretny następny krok. Podsumuj tylko dowody: co samodzielnie, co z pomocą, co odłożone. Brak próby = brak dowodu. FSRS obsługuje nadal wyłącznie `srs.mjs`; sesja go nie modyfikuje. Nie oceniaj FSRS ponownie po każdej korekcie.

## Wywołania

Dane przekazuj przez stdin z cytowanym heredoc, nigdy przez interpolację odpowiedzi człowieka do komendy.

```sh
node scripts/session.mjs start <<'JSON'
{"goal":"Wybrać i uzasadnić metodę rozwiązania problemu","topic":"istniejacy-slug","mode":"learn","minutes":15}
JSON
```

`mode`: `learn` przy nauce, `review` przy powtórce.

```sh
node scripts/session.mjs attempt <<'JSON'
{"sessionId":"id-z-statusu","id":"proba-1","taskId":"t1","question":"Dokładna treść zadania","answer":"Dosłowna odpowiedź człowieka","evidence":[{"concept":"slug-z-zadania","outcome":"independent","helpUsed":false,"reason":"Konkretny fragment rozumowania uzasadniający wynik"}]}
JSON
```

`outcome`: `independent`, `assisted`, `not_yet`. Dla zadania bez pojęć (`orient`) użyj `concept: "orientation"`; to tylko orientacja. Dla zadania łączonego dodaj osobny dowód dla każdej sprawdzonej składowej. Nie zmieniaj nazw/id, aby ominąć limit prób.

```sh
node scripts/session.mjs finish <<'JSON'
{"sessionId":"id-z-statusu","nextStep":"Sprawdzić samodzielnie X w nowym kontekście Y; wcześniej potrzebna krótka demonstracja Z"}
JSON
```

Zapis pozostaje w katalogu danych aplikacji, poprzednie sesje są archiwizowane. Krótki log w `dane/sesje/` zostaje notatką dla człowieka; nie kopiuj do niego całego JSON. Jeśli zapis się nie udał, zgłoś to i zachowaj dowody w logu; nie twierdź, że aplikacja je zapamiętała.

---
name: status
description: Krótki raport „co na dziś” w Polymathic — pojęcia do powtórki, tematy w toku, ostatnie sesje, słabe punkty, poziom inicjatywy i jedna rekomendacja. Używaj na początku dnia/rozmowy albo gdy użytkownik pyta, co teraz robić.
allowed-tools: Bash(node scripts/srs.mjs:*), Read, Glob, Grep
---

# /status — co na dziś

1. Uruchom `node scripts/srs.mjs stats --json`.
2. Jeśli trzeba, zajrzyj do `dane/profil.md` (energia, poziom inicjatywy) i ostatniego logu w `dane/sesje/`.
3. Odpowiedz w 2–4 zdaniach: co robiliśmy, co warto zrobić teraz i dlaczego. Jedna rekomendacja z komendą. Liczbę powtórek podaj, jeśli są na dziś; resztę statystyk dopiero na prośbę. Nie wyliczaj poziomów, serii, braków i awansów przy zwykłym rozpoczęciu dnia.

Zasady rekomendacji (jedna rzecz, nie lista):
- są pojęcia do powtórki → `/powtorka` (powtórki najpierw — zaległości rosną);
- nic do powtórki, jest słaby punkt → wróć do niego (`/nauka <temat>` dla tego węzła albo `/pytania` o to pojęcie);
- temat w toku → `/nauka <slug>`;
- nic nie ma → zaproponuj nowy temat.
- Jeśli pojęcia nie mają karty (`withoutCard`) — wspomnij, że trzeba je założyć (`srs.mjs new`).
- Jeśli pytania uczącego się regularnie trafiają w przyczyny i granice — wspomnij o możliwym awansie poziomu inicjatywy (`/pytania`).

Nie powtarzaj na każdej sesji porad o śnie i całej metodyki.

Nie zaczynaj sesji samodzielnie — czekaj, aż użytkownik wybierze.

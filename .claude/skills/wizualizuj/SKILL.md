---
name: wizualizuj
description: Dodaje do lekcji poprawny, minimalny rysunek (diagram mermaid albo rysunek SVG), sprawdzony przez wyrenderowanie i obejrzenie przed pokazaniem. Używaj, gdy idea jest wyraźnie czytelniejsza jako obraz — zależności, przepływ, sekwencja wymiany, stany, porównanie, geometria. Moduł dla /nauka i /powtorka; można wywołać bezpośrednio.
argument-hint: "[co narysować]"
allowed-tools: Agent, Read, Bash(node scripts/render.mjs:*)
---

# /wizualizuj — rysunek do lekcji

Obraz zasługuje na miejsce tylko wtedy, gdy pokazuje coś, czego słowa nie pokażą: strukturę, kierunek, relację, kształt. Ten skill robi **jeden** taki rysunek i gwarantuje, że jest **poprawny** — rysownik renderuje go i ogląda przed oddaniem.

Ty jesteś dyrektorem artystycznym: decydujesz o idei i przycinasz ją do najmniejszej liczby elementów. Rysownik (agent `rysownik`) pisze, renderuje, ogląda, poprawia i zwraca wynik.

## Kiedy rysować (a kiedy nie)

Rysuj, gdy idea to:
- **struktura lub relacja** — zależności, system z częściami i strzałkami, przepływ, sekwencja wymiany (np. kupujący ↔ sprzedawca, enzym ↔ substrat), automat stanów, drzewo, porównanie dwóch wariantów;
- **przestrzeń lub geometria** — oś liczbowa, wektory, kształt funkcji, układ fizyczny.

Nie rysuj, gdy proza albo jedno równanie już to niesie. Ozdobny diagram, który powtarza zdanie obok, to szum i dodatkowa szansa na błąd. **W razie wątpliwości — nie rysuj.** Brak rysunku jest tańszy niż fałszywy.

## Brief: jedna idea, najmniej elementów

Najczęstsza porażka to upychanie. Przed briefem przytnij: przy każdym elemencie zapytaj „czy po usunięciu idea nadal jest jasna?” — jeśli tak, usuń.

- ŹLE: „narysuj fotosyntezę”.
- DOBRZE: „flowchart: światło + woda → faza jasna → ATP/NADPH → faza ciemna (+CO₂) → glukoza. Bez tytułu. Pokaż, że faza ciemna zależy od produktów fazy jasnej.”

Brief ≤ 5–7 elementów; jeśli dłuższy — najpierw tnij.

## Wywołanie

```
Agent(subagent_type="rysownik", prompt="<zwięzły, konkretny brief>")
```

Rysownik zwraca `WYNIK:` z polem `osadzenie`. Jeśli `WYNIK: BRAK` — uprość brief albo zrezygnuj z rysunku. Nigdy nie rysuj „na oko” sam bez renderu.

## Osadzenie w lekcji

Wstaw `osadzenie` dosłownie do swojej wiadomości (blok ```mermaid``` albo obrazek `![…](/lekcje/rysunki/<slug>.svg)`). Wprowadź rysunek jednym zdaniem, potem niech on niesie ideę — nie opowiadaj każdego elementu prozą. Lekcja na żywo w aplikacji (`npm start` → Lekcje) pokaże rysunek wyrenderowany; w terminalu będzie widać źródło.

Mapy zależności tematu (w `temat.md`) robisz sam według konwencji z `/nauka` — rysownik jest do rysunków w trakcie wyjaśniania.

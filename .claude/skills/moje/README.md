# Własne skille

Tu (albo obok, w `.claude/skills/`) dodajesz własne skille. Claude Code wykrywa je automatycznie — nie trzeba niczego zmieniać w reszcie frameworka.

## Jak dodać skill

1. Utwórz folder **bezpośrednio** w `.claude/skills/`, np. `.claude/skills/fiszki-jezyk/`.
   (Ten folder `moje/` to tylko instrukcja — skille wewnątrz `moje/` nie zostaną wykryte.)
2. W środku plik `SKILL.md`:

```markdown
---
name: fiszki-jezyk
description: Nauka słówek z kontekstem zdania. Używaj, gdy chcę ćwiczyć słownictwo obcego języka.
argument-hint: "[język]"
---

# /fiszki-jezyk

Instrukcje dla Claude: jak ma prowadzić sesję, krok po kroku.
Argument użytkownika jest dostępny jako $ARGUMENTS.

- Każde nowe słówko zapisz jako pojęcie (temat np. `hiszpanski`) przez
  `node scripts/new-topic.mjs concept <slug> hiszpanski "<słowo>"`,
  a kartę załóż przez `node scripts/srs.mjs new <slug>`.
```

3. Skill jest dostępny jako `/fiszki-jezyk`. Jeśli nie widać go od razu w trwającej rozmowie — uruchom Claude Code ponownie.

## Zasady

- `name` = nazwa folderu = komenda (`/name`). Małe litery, myślniki.
- `description` pisz tak, żeby było jasne, **kiedy** skill ma być użyty — Claude czyta ten opis, decydując, czy go uruchomić.
- **Twoje skille mają pierwszeństwo** przed wbudowanymi. Jeśli Twój skill opisuje inny styl prowadzenia sesji (np. więcej wykładu, quiz), Claude **łączy** go z zasadami Polymathic (wysiłek, weryfikacja faktów, FSRS przez skrypt, treść pojęć Twoimi słowami), a nie zastępuje nimi Twojego stylu.
- Chcesz, żeby skill korzystał z powtórek? Używaj `scripts/srs.mjs` — nie licz terminów samodzielnie.
- Możesz nadpisać wbudowany skill, edytując jego `SKILL.md` — ale lepiej zrobić własny obok (np. `nauka-szybka`), żeby aktualizacje frameworka nie kolidowały.

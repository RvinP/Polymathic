#!/usr/bin/env node
// Polymathic file skeletons.
//
//   node scripts/new-topic.mjs <slug> "<title>" [--category "Języki/Hiszpański"]
//       → dane/tematy/<slug>/temat.md (status: diagnoza)
//
//   node scripts/new-topic.mjs concept <slug> <topic> "<name>" [--type prawda|wywod] [--depends a,b]
//       → dane/pojecia/<slug>.md (no FSRS card — create it afterwards: node scripts/srs.mjs new <slug>)

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DIRS, localDay, normalizeCategory, loadSavedCategories, saveCategories } from './lib.mjs';

const args = process.argv.slice(2);
const option = (n) => {
  const i = args.indexOf(n);
  if (i === -1) return null;
  const [, v] = args.splice(i, 2);
  return v;
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
function checkSlug(s) {
  if (!s || !SLUG.test(s)) fail(`Nieprawidłowy slug „${s ?? ''}”. Używaj małych liter bez polskich znaków, cyfr i myślników, np. procent-skladany`);
}
function writeNew(file, content) {
  if (fs.existsSync(file)) fail(`Plik już istnieje: ${path.relative(ROOT, file)} — nie nadpisuję.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`✓ Utworzono ${path.relative(ROOT, file)}`);
}
const q = (s) => JSON.stringify(s);

if (args[0] === 'concept') {
  const type = option('--type') ?? 'wywod';
  const depends = (option('--depends') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const [, slug, topic, name] = args;
  checkSlug(slug);
  checkSlug(topic);
  if (!name) fail('Podaj nazwę pojęcia w cudzysłowie.');
  if (!['prawda', 'wywod'].includes(type)) fail('--type musi być „prawda” albo „wywod”.');
  depends.forEach(checkSlug);
  writeNew(path.join(DIRS.concepts, `${slug}.md`), `---
nazwa: ${q(name)}
temat: ${topic}
zalezy_od: [${depends.join(', ')}]
typ: ${type}
fsrs: {}
osie_uzyte: []
poziom_inicjatywy: 1
opanowanie: 0
---

## Zasada moimi słowami

<!-- Tu pisze uczący się — nie AI. AI może najwyżej dopytać, czy sformułowanie jest precyzyjne. -->

## Przykłady

## Moje typowe błędy
`);
  console.log(`  Następny krok: node scripts/srs.mjs new ${slug}`);
} else {
  const categoryArg = option('--category');
  const category = categoryArg ? normalizeCategory(categoryArg) : null;
  if (categoryArg && !category) fail('Nieprawidłowa kategoria (podkategorię oddziel „/”, maks. 3 poziomy).');
  const [slug, title] = args;
  checkSlug(slug);
  if (!title) fail('Użycie: node scripts/new-topic.mjs <slug> "<tytuł>"');
  writeNew(path.join(DIRS.topics, slug, 'temat.md'), `---
tytul: ${q(title)}
cel: ""
status: diagnoza
kategoria: ${q(category ?? '')}
utworzono: ${localDay(new Date())}
pojecia: []
---

## Cel

<!-- Konkretny cel wypracowany w rozmowie: co będę umiał zrobić / wyjaśnić, czego dziś nie umiem. -->

## Diagnoza

<!-- Dla każdego wątku: co umiem (pewnie) | gdzie kończy się moja wiedza | błędne przekonania do wyrugowania. -->

## Mapa zależności

<!-- Graf DAG: bezwarunkowe prawdy u góry, cel na dole. Id węzła = slug pojęcia z „-” zamienionym na „_”. -->

\`\`\`mermaid
flowchart TD
  cel[Cel]
\`\`\`

## Plan
`);
  if (category) saveCategories([...loadSavedCategories(), category]);
}

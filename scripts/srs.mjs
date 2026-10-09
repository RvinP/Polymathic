#!/usr/bin/env node
// Reviews in Polymathic: FSRS (ts-fsrs). Skills ALWAYS call this script — they never compute intervals themselves.
//
//   node scripts/srs.mjs today [--json] [--category Języki]  concepts due today (interleaved, with a suggested axis)
//   node scripts/srs.mjs rate <slug> <1-4> [axis]        saves a rating, moves the due date, appends the axis to osie_uzyte
//   node scripts/srs.mjs new <slug> [1-4]                creates a card for a new concept (optionally with a rating right away)
//   node scripts/srs.mjs stats [--json]                  summary (for /status and the UI)
//   node scripts/srs.mjs axis <slug>                     suggested next transformation axis
//
// Testing option: --now "YYYY-MM-DD HH:MM" pretends it is another moment.

import fs from 'node:fs';
import path from 'node:path';
import { createEmptyCard, State } from 'ts-fsrs';
import {
  ROOT, RATINGS, AXES, AXIS_IDS, scheduler, readMarkdown, conceptPath, setFrontmatterKey, cardToYaml, listToYaml,
  cardFromData, dueToday, connectedGroups, loadTopics, loadConcepts, normalizeCategory, inCategory, stats, suggestedAxis, formatLocal, parseDate, daysBetween, pluralize, startOfDay,
} from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  if (i === -1) return null;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v ?? true;
};
const jsonOnly = !!flag('--json');
const overwrite = !!flag('--overwrite');
const nowArg = flag('--now');
const categoryArg = flag('--category');
const now = nowArg ? parseDate(nowArg) : new Date();
if (!now) fail(`Nieprawidłowa data w --now: ${nowArg}`);

const [command, ...rest] = args;

function fail(msg, code = 1) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

function requireConcept(slug) {
  if (!slug) fail('Podaj slug pojęcia, np. procent-prosty');
  const file = conceptPath(slug);
  if (!fs.existsSync(file)) {
    fail(`Brak pliku ${path.relative(ROOT, file)}.\n  Utwórz go najpierw: node scripts/new-topic.mjs concept ${slug} <temat> "<nazwa>"`);
  }
  return file;
}

function describeDue(due) {
  const days = daysBetween(due, now);
  if (days <= 0) return 'dziś';
  if (days === 1) return 'jutro';
  return `za ${days} ${pluralize(days, 'dzień', 'dni', 'dni')}`;
}

function saveCard(file, raw, card, axes) {
  let updated = setFrontmatterKey(raw, 'fsrs', cardToYaml(card));
  if (axes) updated = setFrontmatterKey(updated, 'osie_uzyte', listToYaml(axes));
  fs.writeFileSync(file, updated);
}

// ---------- commands ----------
function today() {
  // --category Języki: only concepts from topics in this category (and its subcategories).
  let concepts = loadConcepts();
  if (categoryArg) {
    const category = normalizeCategory(categoryArg);
    if (!category) fail(`Nieprawidłowa kategoria: ${categoryArg}`);
    const topics = new Set(loadTopics().filter((t) => inCategory(normalizeCategory(t.kategoria), category)).map((t) => t.slug));
    concepts = concepts.filter((p) => topics.has(p.temat));
  }
  const list = dueToday(now, concepts);
  if (jsonOnly) return console.log(JSON.stringify(list, null, 2));
  if (!list.length) {
    console.log('Na dziś nic do powtórki. Pamięć potrzebuje przerw — to też część metody.');
  } else {
    console.log(`Do powtórki dziś: ${list.length} ${pluralize(list.length, 'pojęcie', 'pojęcia', 'pojęć')} (kolejność przeplatana między tematami)\n`);
    list.forEach((p, i) => {
      const overdue = p.overdueDays > 0 ? `, zaległe ${p.overdueDays} d` : '';
      const recall = p.retrievability != null ? `, przypominalność ~${Math.round(p.retrievability * 100)}%` : '';
      console.log(`${i + 1}. ${p.nazwa}  [${p.slug}] · temat: ${p.temat}${overdue}${recall}`);
      console.log(`   oś: ${p.suggestedAxis}  (użyte dotąd: ${p.osie_uzyte.length ? p.osie_uzyte.join(', ') : '—'})`);
    });
    const groups = connectedGroups(list);
    if (groups.length) {
      console.log('\nZadania łączone (pojęcia powiązane w grafie — jedno zadanie wymagające ich naraz):');
      for (const g of groups) {
        const extra = g.extra.length ? `  + wpleć bez oceny: ${g.extra.join(', ')}` : '';
        console.log(`  • ${g.concepts.join(' + ')}${extra}`);
      }
    }
  }
  console.log('\nJSON:');
  console.log(JSON.stringify(list));
}

function rate() {
  const [slug, ratingStr, axis] = rest;
  const file = requireConcept(slug);
  const rating = RATINGS[ratingStr];
  if (!rating) fail('Ocena musi być liczbą 1–4 (1 = nie pamiętam, 2 = z trudem, 3 = dobrze, 4 = łatwo)');
  if (axis && !AXIS_IDS.includes(axis)) fail(`Nieznana oś „${axis}”. Dostępne: ${AXIS_IDS.join(', ')}`);

  const { data, raw } = readMarkdown(file);
  let card = cardFromData(data.fsrs, now);
  const hadCard = !!card;
  if (!card) card = createEmptyCard(now);
  const before = card.due;

  const { card: next } = scheduler.next(card, now, rating.rating);
  const axes = Array.isArray(data.osie_uzyte) ? [...data.osie_uzyte] : [];
  if (axis) axes.push(axis);
  saveCard(file, raw, next, axis ? axes : null);

  const result = {
    slug, rating: Number(ratingStr), ratingLabel: rating.label, axis: axis ?? null,
    previousDue: hadCard ? formatLocal(before) : null,
    nextDue: formatLocal(next.due), intervalDays: next.scheduled_days,
    stability: Math.round(next.stability * 100) / 100, difficulty: Math.round(next.difficulty * 100) / 100,
    lapses: next.lapses, reps: next.reps, state: State[next.state],
    suggestedNextAxis: suggestedAxis({ fsrs: { stability: next.stability }, osie_uzyte: axes }).id,
  };
  if (jsonOnly) return console.log(JSON.stringify(result, null, 2));
  if (!hadCard) console.log('(pojęcie nie miało karty — założono nową)');
  console.log(`✓ ${slug}: ocena ${ratingStr} (${rating.label})${axis ? `, oś: ${axis}` : ''}`);
  console.log(`  następna powtórka: ${result.nextDue} (${describeDue(next.due)}, interwał ${next.scheduled_days} d)`);
  console.log(`  stabilność: ${result.stability} d · trudność: ${result.difficulty} · zapomnienia: ${next.lapses}`);
  console.log(`  następnym razem sugerowana oś: ${result.suggestedNextAxis}`);
}

function newCard() {
  const [slug, ratingStr] = rest;
  const file = requireConcept(slug);
  const { data, raw } = readMarkdown(file);
  if (data.fsrs?.due && !overwrite) {
    fail(`Pojęcie ${slug} ma już kartę (termin ${data.fsrs.due}). Użyj „rate”, albo dodaj --overwrite, by zacząć od zera.`);
  }
  let card;
  if (ratingStr) {
    const rating = RATINGS[ratingStr];
    if (!rating) fail('Ocena musi być liczbą 1–4');
    // The check at the end of a learning session counts as the first review.
    card = scheduler.next(createEmptyCard(now), now, rating.rating).card;
  } else {
    // Without a rating: first review tomorrow (sleep consolidates memory — no review on the same day).
    const tomorrow = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    tomorrow.setHours(now.getHours(), now.getMinutes());
    card = createEmptyCard(tomorrow);
  }
  saveCard(file, raw, card, Array.isArray(data.osie_uzyte) ? null : []);
  const result = { slug, nextDue: formatLocal(card.due), state: State[card.state], intervalDays: card.scheduled_days };
  if (jsonOnly) return console.log(JSON.stringify(result, null, 2));
  console.log(`✓ Karta założona: ${slug}`);
  console.log(`  pierwsza powtórka: ${result.nextDue} (${describeDue(card.due)})`);
}

function showStats() {
  const s = stats(now);
  if (jsonOnly) return console.log(JSON.stringify(s, null, 2));
  console.log(`Polymathic · ${s.now}\n`);
  console.log(`Do powtórki dziś: ${s.dueTodayCount}   jutro: ${s.tomorrow}   seria: ${s.streakDays} ${pluralize(s.streakDays, 'dzień', 'dni', 'dni')}`);
  console.log(`Pojęcia: ${s.conceptCount} (średnie opanowanie: ${s.averageMastery ?? '—'}%)   tematy: ${s.topicCount}`);
  if (s.withoutCard.length) console.log(`Bez karty FSRS (uruchom „new”): ${s.withoutCard.join(', ')}`);
  console.log(`\nTematy w toku:`);
  if (!s.topicsInProgress.length) console.log('  —');
  s.topicsInProgress.forEach((t) => console.log(`  • ${t.tytul} [${t.slug}] — ${t.status}`));
  console.log(`\nOstatnie sesje:`);
  if (!s.recentSessions.length) console.log('  —');
  s.recentSessions.forEach((x) => console.log(`  • ${x.date} · ${x.tryb ?? '?'} · ${x.temat}`));
  console.log(`\nSłabe punkty:`);
  if (!s.weakPoints.length) console.log('  — brak (żadne pojęcie nie było zapominane ≥ 2 razy)');
  s.weakPoints.forEach((p) => console.log(`  • ${p.nazwa} [${p.slug}] — zapomnienia: ${p.lapses}, opanowanie: ${p.opanowanie}%`));
  console.log(`\nPoziom inicjatywy: globalnie ${s.initiativeLevel.global}/4, średnio w pojęciach ${s.initiativeLevel.conceptAverage ?? '—'}/4`);
  const c = s.questions.categories;
  console.log(`Moje pytania: ${s.questions.total} (fakt ${c.fakt}, przyczyna ${c.przyczyna}, granica ${c.granica}, połączenie ${c.polaczenie}, zastosowanie ${c.zastosowanie})`);
  console.log(`\nPrognoza 14 dni: ${s.forecast14Days.map((d) => d.count).join(' ')}`);
  console.log(`\n→ ${s.recommendation.text}  ${s.recommendation.command}`);
}

function axis() {
  const [slug] = rest;
  const file = requireConcept(slug);
  const { data } = readMarkdown(file);
  const s = suggestedAxis(data);
  if (jsonOnly) return console.log(JSON.stringify(s, null, 2));
  console.log(`Sugerowana oś dla ${slug}: ${s.id} — ${s.description}`);
  console.log(`Odblokowane (stabilność ${data.fsrs?.stability ?? 0} d): ${s.unlocked.join(', ')}`);
  if (s.nextToUnlock) console.log(`Następna do odblokowania: ${s.nextToUnlock.id} (od stabilności ${s.nextToUnlock.minStability} d)`);
}

const COMMANDS = { today, rate, new: newCard, stats: showStats, axis };
if (!Object.hasOwn(COMMANDS, command ?? '')) {
  console.log(`Użycie:
  node scripts/srs.mjs today [--json] [--category <kategoria>]
  node scripts/srs.mjs rate <slug> <1-4> [oś]
  node scripts/srs.mjs new <slug> [1-4]
  node scripts/srs.mjs stats [--json]
  node scripts/srs.mjs axis <slug>

Oceny: 1 = nie pamiętam, 2 = z trudem, 3 = dobrze, 4 = łatwo
Osie:  ${AXES.map((o) => o.id).join(', ')}`);
  process.exit(command ? 1 : 0);
}
COMMANDS[command]();

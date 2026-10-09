#!/usr/bin/env node
// Quiz in the browser: Claude asks a question, Polymathic shows a window with options, grades the answer
// and hands the result back here. The script waits for the answer (Bash: set timeout 600000).
//
//   node scripts/quiz.mjs <<'JSON'
//   {
//     "question": "…",                   (markdown, formulas $…$)
//     "details": "…",                    (optional: context under the question)
//     "options": ["…", "…", "…"],        (or [{"text": "…", "value": "a"}])
//     "correct": "…",                    (option text or value; a list when several are correct)
//     "explanation": "…",                (shown AFTER the answer)
//     "concept": "slug",                 (optional)
//     "shuffle": true                    (default true)
//   }
//   JSON
//
//   node scripts/quiz.mjs file.json [--timeout 540]
//
// Series: pass an array of questions ([{…}, {…}] or {"questions": [...]}). All of them go to the window
// at once — the learner sees "question 2 of 6" and can skip a question or end the series.
// The script waits for the whole series (5 min per question by default; run it in the background).
//
// Every result is printed as one line `RESULT_JSON: {…}`.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './lib.mjs';

const PORT = Number(process.env.PORT) || 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2);
const iTimeout = args.indexOf('--timeout');
const timeoutArg = iTimeout >= 0 ? Number(args.splice(iTimeout, 2)[1]) : null;
const HEADERS = { 'Content-Type': 'application/json', 'X-Polymathic': '1' };

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readInput() {
  if (args[0]) return fs.readFileSync(path.resolve(args[0]), 'utf8');
  if (process.stdin.isTTY) fail('Podaj quiz jako JSON na wejściu (heredoc) albo ścieżkę do pliku .json.');
  return fs.readFileSync(0, 'utf8');
}

async function isRunning() {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function ensureServer() {
  if (await isRunning()) return;
  // The server is not running — start it in the background (it opens the browser) and wait a moment.
  const proc = spawn(process.execPath, [path.join(ROOT, 'app/server.mjs')], { detached: true, stdio: 'ignore', cwd: ROOT });
  proc.unref();
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    if (await isRunning()) {
      console.log('(uruchomiłem podgląd Polymathic w tle: http://localhost:' + PORT + ')');
      await sleep(1500); // time to open the tab and connect SSE
      return;
    }
  }
  fail('Nie udało się uruchomić serwera Polymathic. Uruchom „npm start” i spróbuj ponownie.');
}

let quiz;
try {
  quiz = JSON.parse(readInput());
} catch (e) {
  fail(`Nieprawidłowy JSON quizu: ${e.message}`);
}

await ensureServer();

const r = await fetch(`${BASE}/api/quiz`, { method: 'POST', headers: HEADERS, body: JSON.stringify(quiz) });
const created = await r.json();
if (!r.ok) fail(created.error || `Serwer zwrócił ${r.status}`);
const ids = created.ids ?? [created.id];
const series = ids.length > 1;
const timeoutS = timeoutArg ?? (series ? 300 * ids.length : 540);

if (!created.clients) {
  // Nobody has Polymathic open — open a tab.
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const a = process.platform === 'win32' ? ['/c', 'start', '', `http://localhost:${PORT}`] : [`http://localhost:${PORT}`];
  spawn(cmd, a, { detached: true, stdio: 'ignore' }).unref();
}
console.log(series
  ? `Seria ${ids.length} pytań czeka w przeglądarce: http://localhost:${PORT}`
  : `Quiz czeka na odpowiedź w przeglądarce: http://localhost:${PORT}`);

const deadline = Date.now() + timeoutS * 1000;
const results = new Map();
while (Date.now() < deadline && results.size < ids.length) {
  await sleep(800);
  for (const id of ids) {
    if (results.has(id)) continue;
    try {
      const w = await (await fetch(`${BASE}/api/quiz/${id}`)).json();
      if (w.status && w.status !== 'pending') results.set(id, w);
    } catch {
      // server briefly unavailable — keep trying
    }
  }
}

const missing = ids.filter((id) => !results.has(id));
for (const id of missing) {
  await fetch(`${BASE}/api/quiz/${id}/cancel`, { method: 'POST', headers: HEADERS }).catch(() => {});
  results.set(id, { id, status: 'no-answer' });
}

function print(result, nr) {
  const prefix = series ? `${nr}. ` : '';
  if (result.status === 'no-answer') return console.log(`${prefix}— brak odpowiedzi (czas minął).`);
  if (result.status === 'cancelled') console.log(`${prefix}— pominięte.`);
  else if (result.dontKnow) console.log(`${prefix}? „Nie wiem” — uczciwa luka, nie zgadywanie.`);
  else {
    console.log(`${prefix}${result.isCorrect ? '✓ Dobrze.' : '✗ Źle.'}`);
    console.log(`Odpowiedź: ${result.selected.join(' | ')}`);
  }
  if (result.status !== 'cancelled') {
    console.log(`Poprawna: ${result.correctAnswers.join(' | ')}`);
    if (result.note) console.log(`Notatka uczącego się: ${result.note}`);
  }
  console.log('RESULT_JSON: ' + JSON.stringify(result));
}

if (missing.length && !series) {
  console.log(`Brak odpowiedzi w ciągu ${Math.round(timeoutS / 60)} min — quiz zamknięty. Zapytaj w czacie, czy kontynuować.`);
  console.log('RESULT_JSON: ' + JSON.stringify(results.get(ids[0])));
  process.exit(0);
}
if (!series && results.get(ids[0]).status === 'cancelled') {
  console.log('Uczący się pominął quiz.');
  console.log('RESULT_JSON: ' + JSON.stringify(results.get(ids[0])));
  process.exit(0);
}

ids.forEach((id, i) => {
  if (series) console.log('');
  print(results.get(id), i + 1);
});

if (series) {
  const all = [...results.values()];
  const count = (f) => all.filter(f).length;
  const answered = (x) => x.status === 'answered';
  console.log('');
  console.log(`PODSUMOWANIE: ${count((x) => answered(x) && x.isCorrect)}/${ids.length} dobrze · ${count((x) => answered(x) && !x.isCorrect && !x.dontKnow)} źle · ${count((x) => answered(x) && x.dontKnow)} nie wiem · ${count((x) => x.status === 'cancelled')} pominięte${missing.length ? ` · ${missing.length} bez odpowiedzi (czas minął)` : ''}`);
}

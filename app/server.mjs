// Polymathic — local progress view (read-only). Editing the data is Claude Code's job.
// Serves app/public, libraries from node_modules (offline, no CDN), the JSON API and SSE events
// sent when something in dane/ changes.

import http from 'node:http';
import { createAI } from './ai.mjs';
import { createSessionStore } from '../scripts/session-store.mjs';
import { createTerminal } from './terminal.mjs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import matter from 'gray-matter';
import {
  ROOT, DATA_DIR, DIRS, AXES, QUESTION_CATEGORIES, loadProfile, loadTopics, loadConcepts, loadSessions, loadQuestions,
  loadMaterials, loadLessons, stats, suggestedAxis, slugify, formatLocal, localDay,
  hideLesson, lessonSessionId, normalizeCategory, inCategory, renameCategory, afterCategoryRemoval, loadSavedCategories, saveCategories, loadCategories, setTopicCategory, FEATURES, loadFeatures, setFeature, PROFILE_FIELDS, setProfile, prepareData, listMarkdownFiles, markdownPath, linkIndex, incomingLinks,
} from '../scripts/lib.mjs';

const PORT = Number(process.env.PORT) || 4321;
const HOST = '127.0.0.1';
const ai = createAI();
const learningSession = createSessionStore();
// Terminal state next to the chat state: ~/Library/Application Support/Polymathic/<project hash>/terminal.json
const stateDir = path.join(process.env.POLYMATHIC_STATE_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'Polymathic'),
  createHash('sha256').update(ROOT).digest('hex').slice(0, 12));
const terminal = createTerminal({
  root: ROOT,
  stateFile: path.join(stateDir, 'terminal.json'),
  // Before the English rename the state file was called konsola.json; read it once so the conversation resumes.
  legacyStateFile: path.join(stateDir, 'konsola.json'),
});
const PUBLIC = path.join(ROOT, 'app', 'public');

const VENDOR = {
  '/vendor/purify.js': path.join(ROOT, 'node_modules/dompurify/dist/purify.min.js'),
  '/vendor/marked.js': path.join(ROOT, 'node_modules/marked/lib/marked.esm.js'),
  '/vendor/mermaid.js': path.join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js'),
  '/vendor/katex.js': path.join(ROOT, 'node_modules/katex/dist/katex.min.js'),
  '/vendor/katex.css': path.join(ROOT, 'node_modules/katex/dist/katex.min.css'),
  '/vendor/xterm.js': path.join(ROOT, 'node_modules/@xterm/xterm/lib/xterm.js'),
  '/vendor/xterm.css': path.join(ROOT, 'node_modules/@xterm/xterm/css/xterm.css'),
  '/vendor/xterm-fit.js': path.join(ROOT, 'node_modules/@xterm/addon-fit/lib/addon-fit.js'),
};
const KATEX_FONTS = path.join(ROOT, 'node_modules/katex/dist/fonts');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const MAX_SIZE = 500 * 1024 * 1024; // 500 MB per file

function allData() {
  const now = new Date();
  let learning = null, learningError = '';
  try { learning = learningSession.status(); } catch (error) { learningError = error.message; }
  const concepts = loadConcepts().map((p) => (p.error ? p : { ...p, suggestedAxis: suggestedAxis(p).id }));
  return {
    learning, learningError,
    profile: loadProfile(),
    topics: loadTopics(),
    concepts,
    sessions: loadSessions(),
    questions: loadQuestions(),
    materials: loadMaterials(),
    lessons: loadLessons(),
    categories: loadCategories(),
    features: { enabled: loadFeatures(), definitions: FEATURES },
    profileFields: PROFILE_FIELDS,
    stats: stats(now),
    axes: AXES,
    questionCategories: QUESTION_CATEGORIES,
  };
}

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nie znaleziono');
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------- materials (the only write from the app) ----------
// Writes only from this app: the X-Polymathic header is required (it forces a CORS preflight we do not handle)
// and the Origin must match — a foreign page in the browser cannot drop anything into dane/.
function writeAllowed(req) {
  if (req.headers['x-polymathic'] !== '1') return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}

function safeFileName(name) {
  const clean = path.basename(String(name ?? '')).replace(/[\u0000-\u001f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 180);
  return clean && clean !== 'opis.md' ? clean : null;
}

function freeName(folder, name) {
  const { name: base, ext } = path.parse(name);
  let candidate = name;
  for (let i = 2; fs.existsSync(path.join(folder, candidate)); i++) candidate = `${base} (${i})${ext}`;
  return candidate;
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': MIME_TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      s += c;
      if (s.length > 1e6) req.destroy(new Error('Za duże żądanie'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function saveMaterialFile(req, res, url) {
  const lessonName = url.searchParams.get('folder');
  const slug = slugify(lessonName);
  const fileName = safeFileName(url.searchParams.get('name'));
  if (!slug) return json(res, 400, { error: 'Podaj nazwę lekcji (litery lub cyfry).' });
  if (!fileName) return json(res, 400, { error: 'Nieprawidłowa nazwa pliku.' });
  if (Number(req.headers['content-length']) > MAX_SIZE) return json(res, 413, { error: 'Plik jest większy niż 500 MB.' });

  const folder = path.join(DIRS.materials, slug);
  fs.mkdirSync(folder, { recursive: true });
  const target = freeName(folder, fileName);
  const targetPath = path.join(folder, target);
  const partial = path.join(folder, `.${target}.czesc`);
  const out = fs.createWriteStream(partial);
  let size = 0;
  let aborted = false;
  const cleanUp = () => fs.rm(partial, { force: true }, () => {});
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_SIZE && !aborted) {
      aborted = true;
      req.unpipe(out);
      out.destroy();
      cleanUp();
      json(res, 413, { error: 'Plik jest większy niż 500 MB.' });
    }
  });
  req.on('aborted', () => { aborted = true; out.destroy(); cleanUp(); });
  req.pipe(out);
  out.on('finish', () => {
    if (aborted) return cleanUp();
    fs.rename(partial, targetPath, (err) => {
      if (err) { cleanUp(); return json(res, 500, { error: err.message }); }
      json(res, 200, { slug, file: target, size });
    });
  });
  out.on('error', (err) => { cleanUp(); if (!res.headersSent) json(res, 500, { error: err.message }); });
}

async function saveMaterialDescription(req, res) {
  let body;
  try { body = await readJson(req); } catch { return json(res, 400, { error: 'Nieprawidłowe dane.' }); }
  const name = String(body.folder ?? '').trim();
  const slug = slugify(name);
  if (!slug) return json(res, 400, { error: 'Podaj nazwę lekcji (litery lub cyfry).' });
  const description = String(body.description ?? '').trim();
  const files = (Array.isArray(body.files) ? body.files : []).map(String);
  const folder = path.join(DIRS.materials, slug);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'opis.md');
  const now = new Date();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `---\nnazwa: ${JSON.stringify(name)}\nutworzono: ${localDay(now)}\n---\n\n# ${name}\n`);
  }
  const entry = `\n## ${formatLocal(now)}${files.length ? ` · ${files.join(', ')}` : ''}\n\n${description || '_(bez opisu)_'}\n`;
  fs.appendFileSync(file, entry);
  json(res, 200, { slug });
}

function sendDrawing(res, p) {
  const dir = path.join(DIRS.lessons, 'rysunki');
  const file = path.normalize(path.join(dir, p.slice('/lekcje/rysunki/'.length)));
  if (!file.startsWith(dir + path.sep) || !/\.(png|svg)$/i.test(file)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end();
    }
    // SVG only as an image (<img>) and with scripts blocked, in case someone opens it directly.
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()], 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

function sendMaterial(res, p) {
  // /materialy/<slug>/<file>
  const [, , slug, ...rest] = p.split('/');
  const file = path.normalize(path.join(DIRS.materials, slug ?? '', rest.join('/')));
  if (!slug || !file.startsWith(DIRS.materials + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nie znaleziono');
    }
    const type = MIME_TYPES[path.extname(file).toLowerCase()];
    res.writeHead(200, {
      'Content-Type': type ?? 'application/octet-stream',
      'Content-Length': st.size,
      'X-Content-Type-Options': 'nosniff',
      // HTML/SVG files and unknown types are downloaded instead of displayed, so they never run inside the app.
      'Content-Disposition': `${type && !/html|svg/.test(type) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- quizzes ----------
// Claude asks a quiz through scripts/quiz.mjs → POST /api/quiz. The browser shows a dialog,
// the answer is graded here (the correct answer never reaches the browser before the answer),
// and the script receives the result through GET /api/quiz/<id>.
const quizzes = new Map();
let activeQuizId = null;

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function publicView(q) {
  return {
    id: q.id, question: q.question, details: q.details, multiple: q.multiple,
    options: q.options.map((o, i) => ({ number: i + 1, text: o.text })), status: q.status,
    ...(q.series ? { series: { index: q.series.index, total: q.series.total } } : {}),
  };
}

function prepareQuiz(input) {
  const rawOptions = Array.isArray(input.options) ? input.options : [];
  const options = rawOptions.map((o) => (typeof o === 'string' ? { text: o } : o))
    .map((o) => ({ text: String(o.text ?? '').trim(), value: String(o.value ?? o.text ?? '').trim() }))
    .filter((o) => o.text);
  if (!String(input.question ?? '').trim()) throw new Error('Brak pola „question”.');
  if (options.length < 2) throw new Error('Quiz potrzebuje co najmniej 2 opcji.');
  if (new Set(options.map((o) => o.value)).size !== options.length) throw new Error('Wartości opcji muszą być unikalne.');
  if (!String(input.explanation ?? '').trim()) throw new Error('Brak pola „explanation” (pokazywane po odpowiedzi).');
  const correctInput = (Array.isArray(input.correct) ? input.correct : [input.correct]).map((v) => String(v ?? '').trim());
  for (const v of correctInput) if (!options.some((o) => o.value === v)) throw new Error(`„correct”: „${v}” nie pasuje do żadnej opcji (podaj jej text albo value).`);
  const multiple = !!input.multiple || correctInput.length > 1;
  const ordered = input.shuffle === false ? options : shuffle(options);
  const id = `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    id, question: String(input.question).trim(), details: input.details ? String(input.details) : '',
    options: ordered, multiple, explanation: String(input.explanation).trim(), concept: input.concept ?? null,
    correct: ordered.map((o, i) => (correctInput.includes(o.value) ? i + 1 : null)).filter(Boolean),
    status: 'pending', created: formatLocal(new Date()),
  };
}

// One quiz or a whole series at once (an array) — the learner sees from the start how many questions there are.
// Only one is shown at a time: the next one in the series becomes active when the previous one closes.
function createQuizzes(input) {
  const list = Array.isArray(input) ? input : Array.isArray(input?.questions) ? input.questions : [input];
  if (!list.length) throw new Error('Pusta seria pytań.');
  const created = list.map((d, i) => {
    try {
      return prepareQuiz(d ?? {});
    } catch (e) {
      throw new Error(list.length > 1 ? `Pytanie ${i + 1}: ${e.message}` : e.message);
    }
  });
  if (created.length > 1) {
    const seriesId = `s${Date.now().toString(36)}`;
    created.forEach((q, i) => (q.series = { id: seriesId, index: i + 1, total: created.length, ids: created.map((x) => x.id) }));
  }
  // A new quiz replaces everything that was still pending.
  for (const q of quizzes.values()) if (q.status === 'pending') q.status = 'cancelled';
  for (const q of created) quizzes.set(q.id, q);
  activeQuizId = created[0].id;
  // Old, closed quizzes do not need to live forever.
  for (const [id, q] of quizzes) {
    if (quizzes.size <= 100) break;
    if (q.status !== 'pending') quizzes.delete(id);
  }
  return created;
}

function nextInSeries(q) {
  const id = q.series?.ids.find((i) => quizzes.get(i)?.status === 'pending');
  if (!id) return null;
  activeQuizId = id;
  return quizzes.get(id);
}

function gradeQuiz(q, { selected = [], dontKnow = false, note = '' }) {
  const chosen = [...new Set((Array.isArray(selected) ? selected : []).map(Number).filter((n) => n >= 1 && n <= q.options.length))].sort((a, b) => a - b);
  if (!dontKnow && !chosen.length) throw new Error('Wybierz odpowiedź albo „Nie wiem”.');
  const isCorrect = !dontKnow && chosen.length === q.correct.length && chosen.every((v, i) => v === q.correct[i]);
  q.status = 'answered';
  q.answer = { selected: dontKnow ? [] : chosen, dontKnow: !!dontKnow, note: String(note ?? '').trim(), isCorrect, time: formatLocal(new Date()) };
  return q;
}

// Shape printed by scripts/quiz.mjs as RESULT_JSON (see the glossary / quiz skill).
function quizResult(q) {
  const text = (number) => q.options[number - 1]?.text;
  return {
    id: q.id, status: q.status, question: q.question, concept: q.concept,
    options: q.options.map((o, i) => `${i + 1}. ${o.text}`),
    correctAnswers: q.correct.map(text),
    ...(q.answer ? {
      dontKnow: q.answer.dontKnow, isCorrect: q.answer.isCorrect,
      selected: q.answer.selected.map(text), note: q.answer.note || null,
    } : {}),
    explanation: q.explanation,
  };
}

async function handleQuiz(req, res, p) {
  if (p === '/api/quiz/active') {
    const q = activeQuizId && quizzes.get(activeQuizId);
    return json(res, 200, q && q.status === 'pending' ? publicView(q) : null);
  }
  if (p === '/api/quiz' && req.method === 'POST') {
    if (!writeAllowed(req)) return json(res, 403, { error: 'Quiz może utworzyć tylko Polymathic.' });
    try {
      const created = createQuizzes(await readJson(req));
      broadcast('quiz', publicView(created[0]));
      return json(res, 200, { id: created[0].id, ids: created.map((q) => q.id), clients: clients.size });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }
  const m = p.match(/^\/api\/quiz\/([a-z0-9]+)(?:\/(answer|cancel))?$/);
  const q = m && quizzes.get(m[1]);
  if (!q) return json(res, 404, { error: 'Nie ma takiego quizu (może serwer był restartowany).' });
  if (!m[2]) return json(res, 200, quizResult(q));
  if (req.method !== 'POST') return json(res, 405, { error: 'Tylko POST.' });
  if (!writeAllowed(req)) return json(res, 403, { error: 'Odpowiedź tylko z aplikacji Polymathic.' });
  if (q.status !== 'pending') return json(res, 409, { error: 'Ten quiz jest już zamknięty.' });
  let body;
  try {
    body = await readJson(req);
  } catch {
    body = {};
  }
  if (m[2] === 'cancel') {
    // {"series": true} — "Finish": skips this and all remaining questions of the series.
    const toClose = body?.series && q.series ? q.series.ids.map((i) => quizzes.get(i)).filter((x) => x?.status === 'pending') : [q];
    for (const x of toClose) {
      x.status = 'cancelled';
      broadcast('quiz-closed', { id: x.id });
    }
    const next = nextInSeries(q);
    if (next) broadcast('quiz', publicView(next));
    return json(res, 200, { ok: true });
  }
  try {
    gradeQuiz(q, body);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
  broadcast('quiz-closed', { id: q.id });
  const next = nextInSeries(q);
  if (next) broadcast('quiz', publicView(next));
  return json(res, 200, { isCorrect: q.answer.isCorrect, dontKnow: q.answer.dontKnow, correct: q.correct, explanation: q.explanation });
}

// ---------- SSE ----------
const clients = new Set();
function broadcast(event, body) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(body)}\n\n`;
  for (const res of clients) res.write(msg);
}

let debounce = null;
const changed = new Set();
function watchData() {
  try {
    fs.watch(DATA_DIR, { recursive: true }, (_type, file) => {
      if (file) changed.add(String(file));
      // Editors and Claude save files in several steps — collect changes for a moment.
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        broadcast('change', { files: [...changed] });
        changed.clear();
      }, 150);
    });
  } catch (e) {
    console.warn(`⚠ Nie mogę obserwować dane/ (${e.message}). Odświeżanie na żywo wyłączone.`);
  }
}

// ---------- server ----------
export const server = http.createServer((req, res) => {
  if (![ `127.0.0.1:${PORT}`, `localhost:${PORT}` ].includes(req.headers.host)) return json(res, 403, { error: 'Nieprawidłowy host.' });
  let url, p;
  try { url = new URL(req.url, `http://${req.headers.host}`); p = decodeURIComponent(url.pathname); }
  catch { return json(res, 400, { error: 'Nieprawidłowy adres.' }); }

  if (p === '/api/learning' && req.method === 'GET') {
    try { return json(res, 200, learningSession.status()); }
    catch (error) { return json(res, 500, { error: error.message }); }
  }

  if (p === '/api/ai' && req.method === 'GET') return json(res, 200, ai.snapshot());
  if (p.startsWith('/api/ai')) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Tylko POST.' });
    if (!writeAllowed(req)) return json(res, 403, { error: 'Uruchom AI z aplikacji Polymathic.' });
    return readJson(req).then(body => {
      if (p === '/api/ai/send') return json(res, 202, ai.start(body));
      if (p === '/api/ai/hint') return json(res, 200, ai.hint());
      if (p === '/api/ai/context') return json(res, 200, ai.update(body));
      if (p === '/api/ai/stop') { ai.stop(); return json(res, 200, ai.snapshot()); }
      return json(res, 404, { error: 'Nieznana operacja.' });
    }).catch(error => json(res, 400, { error: error.message }));
  }

  if (p === '/api/data') {
    try {
      const body = JSON.stringify(allData());
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.json'], 'Cache-Control': 'no-store' });
      return res.end(body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': MIME_TYPES['.json'] });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  if (p === '/api/health') return json(res, 200, { ok: true, clients: clients.size });
  if (p.startsWith('/api/quiz')) return handleQuiz(req, res, p);

  if (p.startsWith('/vendor/fonts/')) {
    const f = path.normalize(path.join(KATEX_FONTS, p.slice('/vendor/fonts/'.length)));
    if (!f.startsWith(KATEX_FONTS + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    return sendFile(res, f);
  }
  // On-disk lesson format: drawings are linked as /lekcje/rysunki/<file> inside dane/lekcje/*.md.
  if (p.startsWith('/lekcje/rysunki/')) return sendDrawing(res, p);

  // Topic categories: add / rename / remove, and assigning a topic to a category.
  if (p === '/api/categories' || p === '/api/topics/category') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Tylko POST.' });
    if (!writeAllowed(req)) return json(res, 403, { error: 'Zmiany tylko z aplikacji Polymathic.' });
    return readJson(req).then((b) => {
      if (p === '/api/topics/category') {
        const category = setTopicCategory(b.slug, b.category);
        if (category) saveCategories([...loadSavedCategories(), category]);
        return json(res, 200, { category });
      }
      const topics = loadTopics().filter((t) => !t.error);
      const saved = loadSavedCategories();
      if (b.action === 'add') {
        const n = normalizeCategory(b.name);
        if (!n) return json(res, 400, { error: 'Podaj nazwę kategorii (podkategorię oddziel „/”, maks. 3 poziomy).' });
        return json(res, 200, { categories: saveCategories([...saved, n]) });
      }
      const from = normalizeCategory(b.name);
      if (!from || !loadCategories(topics).includes(from)) return json(res, 404, { error: 'Nie ma takiej kategorii.' });
      let change;
      if (b.action === 'rename') {
        const to = normalizeCategory(b.to);
        if (!to) return json(res, 400, { error: 'Nieprawidłowa nowa nazwa.' });
        if (inCategory(to, from) && to !== from) return json(res, 400, { error: 'Nie można przenieść kategorii do jej własnej podkategorii.' });
        change = (c) => renameCategory(c, from, to);
      } else if (b.action === 'remove') {
        change = (c) => afterCategoryRemoval(c, from);
      } else return json(res, 400, { error: 'Nieznana akcja.' });
      let topicsChanged = 0;
      for (const t of topics) {
        const c = normalizeCategory(t.kategoria);
        if (c && inCategory(c, from)) {
          setTopicCategory(t.slug, change(c));
          topicsChanged++;
        }
      }
      // Parents of the old name are saved too, so that moving "Języki/Hiszpański" → "Hiszpański" does not drop an empty "Języki".
      const all = loadCategories(topics);
      return json(res, 200, { categories: saveCategories(all.map(change).filter(Boolean)), topicsChanged });
    }).catch((error) => json(res, 400, { error: error.message }));
  }

  if (p === '/api/features') {
    if (req.method !== 'POST') return json(res, 200, { enabled: loadFeatures(), definitions: FEATURES });
    if (!writeAllowed(req)) return json(res, 403, { error: 'Zmiana ustawień tylko z aplikacji Polymathic.' });
    return readJson(req).then((b) => json(res, 200, { enabled: setFeature(String(b.id), b.enabled) }))
      .catch((error) => json(res, 400, { error: error.message }));
  }

  if (p === '/api/profile') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Tylko POST.' });
    if (!writeAllowed(req)) return json(res, 403, { error: 'Zmiana ustawień tylko z aplikacji Polymathic.' });
    return readJson(req).then((b) => json(res, 200, { profile: setProfile(b) }))
      .catch((error) => json(res, 400, { error: error.message }));
  }

  // The "pliki" feature (feature flag): without enabling it the API does not exist.
  if (p === '/api/files' || p === '/api/file') {
    if (!loadFeatures().pliki) return json(res, 404, { error: 'Funkcja „Pliki” jest wyłączona. Włączysz ją w Ustawieniach → Funkcje eksperymentalne.' });
    const list = listMarkdownFiles();
    if (p === '/api/files') return json(res, 200, { files: list, links: linkIndex(list) });
    const rel = url.searchParams.get('path');
    const file = markdownPath(rel);
    if (!file) return json(res, 404, { error: 'Nie ma takiego pliku Markdown w dane/.' });
    const raw = fs.readFileSync(file, 'utf8');
    let data = {}, content = raw;
    try { ({ data, content } = matter(raw, {})); } catch { /* broken frontmatter — show everything */ }
    const st = fs.statSync(file);
    return json(res, 200, { path: path.relative(DATA_DIR, file), data, content, modified: formatLocal(st.mtime), incoming: incomingLinks(path.relative(DATA_DIR, file), list) });
  }

  if (p === '/api/topics/abandon') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Tylko POST.' });
    if (!writeAllowed(req)) return json(res, 403, { error: 'Porzucanie tylko z aplikacji Polymathic.' });
    return readJson(req).then((body) => {
      const slug = path.basename(String(body.slug ?? ''));
      const topicDir = path.join(DIRS.topics, slug);
      if (!slug || slug.startsWith('.') || !fs.existsSync(path.join(topicDir, 'temat.md'))) return json(res, 404, { error: 'Nie ma takiego tematu.' });
      // Abandoning = moving to dane/archiwum/ (reversible): the topic and its concepts disappear from learning and reviews.
      const stamp = formatLocal(new Date()).replace(/[ :]/g, '-');
      const archive = path.join(DATA_DIR, 'archiwum', `${slug}-${stamp}`);
      fs.mkdirSync(path.join(archive, 'pojecia'), { recursive: true });
      fs.renameSync(topicDir, path.join(archive, 'temat'));
      let conceptsMoved = 0;
      for (const c of loadConcepts().filter((x) => x.temat === slug)) {
        fs.renameSync(path.join(DIRS.concepts, `${c.slug}.md`), path.join(archive, 'pojecia', `${c.slug}.md`));
        conceptsMoved++;
      }
      return json(res, 200, { ok: true, archive: path.relative(ROOT, archive), conceptsMoved });
    }).catch((error) => json(res, 400, { error: error.message }));
  }

  if (p === '/api/lessons/delete') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Tylko POST.' });
    if (!writeAllowed(req)) return json(res, 403, { error: 'Usuwanie tylko z aplikacji Polymathic.' });
    return readJson(req).then((body) => {
      const name = `${path.basename(String(body.slug ?? ''))}.md`;
      const file = path.join(DIRS.lessons, name);
      if (name.startsWith('.') || !fs.existsSync(file)) return json(res, 404, { error: 'Nie ma takiej lekcji.' });
      // Block re-creation first, then delete — otherwise a running session would write the lesson again.
      let data = {};
      try { data = matter(fs.readFileSync(file, 'utf8'), {}).data; } catch {}
      const id = lessonSessionId(name, data);
      hideLesson(id);
      fs.rmSync(file);
      // Deleting a lesson of the in-app chat also clears the conversation — otherwise it would come back in the chat view.
      const chat = ai.snapshot();
      if (id && chat.id === id && !chat.running) ai.update({ reset: true });
      return json(res, 200, { ok: true });
    }).catch((error) => json(res, 400, { error: error.message }));
  }

  if (p === '/api/materials/file' || p === '/api/materials/description') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Tylko POST.' });
    if (!writeAllowed(req)) return json(res, 403, { error: 'Zapis dozwolony tylko z aplikacji Polymathic.' });
    return p.endsWith('/file') ? saveMaterialFile(req, res, url) : saveMaterialDescription(req, res);
  }

  // On-disk path: material files are served from dane/materialy/<slug>/.
  if (p.startsWith('/materialy/')) return sendMaterial(res, p);

  if (VENDOR[p]) return sendFile(res, VENDOR[p]);

  const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  sendFile(res, file);
});

server.on('error', (e) => {
  if (e.code === 'EPERM' || e.code === 'EACCES') {
    console.error(`✗ Środowisko blokuje otwarcie portu ${PORT} (${e.code}). Polymathic nie zostało uruchomione.\nUruchom plik „Uruchom Polymathic.command” z Findera albo wykonaj npm start w Terminalu, w katalogu projektu.`);
    process.exit(1);
  }
  if (e.code === 'EADDRINUSE') {
    console.error(`✗ Port ${PORT} jest zajęty. Może Polymathic już działa? Otwórz http://localhost:${PORT} albo uruchom: PORT=4322 npm start`);
    process.exit(1);
  }
  throw e;
});

if (path.resolve(process.argv[1] || '') === path.join(ROOT, 'app', 'server.mjs')) {
const createdData = prepareData();
if (createdData.length) console.log(`Pierwszy start: utworzono dane/ z szablonu (${createdData.join(', ')}).`);
server.listen(PORT, HOST, () => {
  const address = `http://localhost:${PORT}`;
  console.log(`Polymathic działa: ${address}  (Ctrl+C, aby zatrzymać)`);
  watchData();
  if (!process.env.POLYMATHIC_NO_OPEN) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} ${address}`, () => {});
  }
});

terminal.attach(server, { allowedOrigins: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`] });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { ai.stop(); terminal.stop(); server.close(); setTimeout(() => process.exit(0), 3000).unref(); });

}

// Shared Polymathic logic: reading data from dane/, FSRS cards, transformation axes, statistics.
// Used by scripts/srs.mjs (CLI) and app/server.mjs (UI). Single source of truth.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { fsrs, generatorParameters, createEmptyCard, Rating, State } from 'ts-fsrs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'dane');
export const DIRS = {
  topics: path.join(DATA_DIR, 'tematy'),
  concepts: path.join(DATA_DIR, 'pojecia'),
  sessions: path.join(DATA_DIR, 'sesje'),
  materials: path.join(DATA_DIR, 'materialy'),
  lessons: path.join(DATA_DIR, 'lekcje'),
};

// ---------- first start ----------
// dane/ holds the learner's private data and never goes into the repository. A fresh clone gets
// the neutral template from data-template/; existing files are never overwritten.
export const DATA_TEMPLATE_DIR = path.join(ROOT, 'data-template');

export function prepareData(target = DATA_DIR, template = DATA_TEMPLATE_DIR) {
  const created = [];
  fs.mkdirSync(target, { recursive: true });
  for (const name of ['tematy', 'pojecia', 'sesje', 'materialy', 'lekcje']) fs.mkdirSync(path.join(target, name), { recursive: true });
  if (!fs.existsSync(template)) return created;
  for (const file of fs.readdirSync(template)) {
    const destination = path.join(target, file);
    if (fs.existsSync(destination)) continue;
    fs.cpSync(path.join(template, file), destination, { recursive: true });
    created.push(file);
  }
  return created;
}

/** Human-given name → folder slug (no Polish characters, hyphens). */
export function slugify(text) {
  const map = { ł: 'l', Ł: 'l' };
  return String(text ?? '')
    .replace(/[łŁ]/g, (c) => map[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ---------- topic categories (folders: "Języki/Hiszpański", "Gotowanie") ----------
// A topic has `kategoria: "Języki/Hiszpański"` in its frontmatter — a slash means a subfolder. Topic files
// never move, so slugs, FSRS and scripts keep working. Empty categories live in dane/kategorie.md.
const CATEGORIES_FILE = () => path.join(DATA_DIR, 'kategorie.md');
const MAX_DEPTH = 3;

/** " Sport /  Bieganie " → "Sport/Bieganie"; null when the name is empty or invalid. */
export function normalizeCategory(name) {
  if (name == null) return null;
  const parts = String(name).replace(/[\u0000-\u001f]/g, '').split('/').map((c) => c.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (!parts.length || parts.length > MAX_DEPTH || parts.some((c) => c.length > 40)) return null;
  return parts.join('/');
}

/** A category together with its ancestors: "Języki/Hiszpański" → ["Języki", "Języki/Hiszpański"]. */
export const withParents = (c) => c.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'));

/** Whether category `c` is `name` or one of its subcategories. */
export const inCategory = (c, name) => !!c && (c === name || c.startsWith(`${name}/`));

/** Full category list: saved in dane/kategorie.md + used by topics, with parents, sorted. */
export function mergeCategories(saved, topics) {
  const all = new Set();
  for (const c of [...saved, ...topics.map((t) => t.kategoria)]) {
    const n = normalizeCategory(c);
    if (n) withParents(n).forEach((x) => all.add(x));
  }
  return [...all].sort((a, b) => a.localeCompare(b, 'pl'));
}

/** Rename (also a move: "Hiszpański" → "Języki/Hiszpański") — applies to the category and all subcategories. */
export function renameCategory(c, from, to) {
  return inCategory(c, from) ? to + c.slice(from.length) : c;
}

/** Removing a category: its topics and subcategories move one level up (or to "no category"). */
export function afterCategoryRemoval(c, name) {
  if (!inCategory(c, name)) return c;
  const parent = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : null;
  const rest = c.slice(name.length).replace(/^\//, '');
  return normalizeCategory([parent, rest].filter(Boolean).join('/'));
}

export function loadSavedCategories() {
  try {
    const list = matter(fs.readFileSync(CATEGORIES_FILE(), 'utf8'), {}).data.kategorie;
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

export function saveCategories(list) {
  const clean = [...new Set(list.map(normalizeCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
  fs.writeFileSync(CATEGORIES_FILE(), `---\nkategorie: ${JSON.stringify(clean)}\n---\n\n# Kategorie tematów\n\nFoldery w Bibliotece. Podkategorię oddziela ukośnik, np. \`Języki/Hiszpański\`. Temat przypisuje się polem \`kategoria\` w jego \`temat.md\`.\nZmieniaj w aplikacji (Biblioteka) albo poproś o to Claude.\n`);
  return clean;
}

export function loadCategories(topics = loadTopics()) {
  return mergeCategories(loadSavedCategories(), topics.filter((t) => !t.error));
}

/** Sets a topic's category in its temat.md (null = no category). */
export function setTopicCategory(slug, category) {
  const file = path.join(DIRS.topics, path.basename(String(slug)), 'temat.md');
  if (!fs.existsSync(file)) throw new Error('Nie ma takiego tematu.');
  const c = category == null || category === '' ? null : normalizeCategory(category);
  if (category && !c) throw new Error('Nieprawidłowa nazwa kategorii.');
  fs.writeFileSync(file, setFrontmatterKey(fs.readFileSync(file, 'utf8'), 'kategoria', JSON.stringify(c ?? '')));
  return c;
}

// ---------- experimental features (feature flags) ----------
// State lives in dane/ustawienia.json: { "funkcje": { "pliki": true } }. Everything is off by default.
// The POLYMATHIC_FEATURES="pliki,-other" variable overrides the file (for experiments and tests).
export const FEATURES = {
  pliki: {
    label: 'Pliki',
    description: 'Przeglądarka notatek w stylu Obsidiana: drzewo wszystkich plików Markdown z dane/, podgląd z formatowaniem, linki [[…]] i lista notatek, które linkują do bieżącej.',
  },
};
const SETTINGS_FILE = () => path.join(DATA_DIR, 'ustawienia.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
  } catch {
    return {};
  }
}

export function loadFeatures() {
  const fromFile = readSettings().funkcje ?? {};
  const result = Object.fromEntries(Object.keys(FEATURES).map((id) => [id, fromFile[id] === true]));
  for (const entry of String(process.env.POLYMATHIC_FEATURES ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const id = entry.replace(/^-/, '');
    if (id in result) result[id] = !entry.startsWith('-');
  }
  return result;
}

export function setFeature(id, enabled) {
  if (!(id in FEATURES)) throw new Error(`Nieznana funkcja „${id}”.`);
  const settings = readSettings();
  settings.funkcje = { ...(settings.funkcje ?? {}), [id]: !!enabled };
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2) + '\n');
  return loadFeatures();
}

// ---------- Markdown files (the "pliki" feature) ----------
/** All .md files in dane/ (excluding hidden ones) as relative paths, sorted by folder. */
export function listMarkdownFiles() {
  const result = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), r);
      else if (entry.isFile() && entry.name.endsWith('.md')) result.push(r);
    }
  };
  if (fs.existsSync(DATA_DIR)) walk(DATA_DIR, '');
  return result.sort((a, b) => a.localeCompare(b, 'pl'));
}

/** Safe path to an .md file inside dane/, or null. */
export function markdownPath(rel) {
  const p = path.normalize(path.join(DATA_DIR, String(rel ?? '')));
  return p.startsWith(DATA_DIR + path.sep) && p.endsWith('.md') && !path.basename(p).startsWith('.') && fs.existsSync(p) ? p : null;
}

/**
 * Resolving [[name]] links like Obsidian: file name without .md (e.g. [[procent-prosty]]),
 * a topic folder name (→ its temat.md) or a relative path. Case-insensitive.
 */
export function linkIndex(list = listMarkdownFiles()) {
  const index = {};
  const add = (key, rel) => {
    const k = key.toLowerCase();
    if (!(k in index)) index[k] = rel;
  };
  for (const rel of list) {
    add(rel.replace(/\.md$/, ''), rel);
    add(path.basename(rel, '.md'), rel);
    if (path.basename(rel) === 'temat.md') add(path.basename(path.dirname(rel)), rel);
  }
  return index;
}

export const WIKILINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g;

/** Notes that link to the given file (via [[…]]). */
export function incomingLinks(rel, list = listMarkdownFiles(), index = linkIndex(list)) {
  return list.filter((other) => {
    if (other === rel) return false;
    const content = fs.readFileSync(path.join(DATA_DIR, other), 'utf8');
    return [...content.matchAll(WIKILINK)].some((m) => index[m[1].trim().toLowerCase()] === rel);
  });
}

// Deleted lessons: session ids whose log is never recreated (neither by the terminal hook nor by the in-app chat).
const HIDDEN_FILE = () => path.join(DIRS.lessons, '.ukryte');
export function hiddenLessons() {
  try {
    return new Set(fs.readFileSync(HIDDEN_FILE(), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}
export function hideLesson(id) {
  if (!id) return;
  fs.mkdirSync(DIRS.lessons, { recursive: true });
  if (!hiddenLessons().has(id)) fs.appendFileSync(HIDDEN_FILE(), `${id}\n`);
}
/** Id of the session a lesson file came from: `sesja` from the frontmatter (hook) or the uuid in polymathic-<uuid>.md (in-app chat). */
export function lessonSessionId(fileName, data = {}) {
  return data.sesja ? String(data.sesja) : fileName.match(/^polymathic-(.+)\.md$/)?.[1] ?? null;
}

/** Live lesson logs (dane/lekcje/*.md, generated by a hook from the Claude Code transcript). */
export function loadLessons() {
  return listMd(DIRS.lessons).map((f) => {
    const file = path.join(DIRS.lessons, f);
    const st = fs.statSync(file);
    return {
      slug: f.replace(/\.md$/, ''),
      modified: formatLocal(st.mtime),
      modifiedMs: st.mtimeMs,
      ...safely(() => {
        const { data, content } = readMarkdown(file);
        return { ...data, content };
      }, file),
    };
  }).sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/** Lesson materials: dane/materialy/<slug>/ with files and opis.md (name, description, upload history). */
export function loadMaterials() {
  const dir = DIRS.materials;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => {
      const folder = path.join(dir, d.name);
      const descriptionFile = path.join(folder, 'opis.md');
      const description = fs.existsSync(descriptionFile) ? safely(() => {
        const { data, content } = readMarkdown(descriptionFile);
        return { ...data, content };
      }, descriptionFile) : {};
      const files = fs.readdirSync(folder, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name !== 'opis.md' && !f.name.startsWith('.'))
        .map((f) => {
          const st = fs.statSync(path.join(folder, f.name));
          return { name: f.name, size: st.size, added: formatLocal(st.mtime) };
        })
        .sort((a, b) => b.added.localeCompare(a.added));
      return { slug: d.name, nazwa: description.nazwa ?? d.name, ...description, files };
    })
    .sort((a, b) => String(b.files[0]?.added ?? b.utworzono ?? '').localeCompare(String(a.files[0]?.added ?? a.utworzono ?? '')));
}

// ---------- FSRS ----------
// Short-term steps (e.g. 10 min) are off: in Polymathic a review is a separate session on another day.
export const scheduler = fsrs(generatorParameters({ enable_fuzz: true, enable_short_term: false }));

export const RATINGS = {
  1: { rating: Rating.Again, label: 'nie pamiętam' },
  2: { rating: Rating.Hard, label: 'z trudem' },
  3: { rating: Rating.Good, label: 'dobrze' },
  4: { rating: Rating.Easy, label: 'łatwo' },
};

// Transformation axes, roughly from easier to harder.
// `minStability` = minimum card stability (in days) at which the axis unlocks.
export const AXES = [
  { id: 'przebranie', label: 'Przebranie', minStability: 0, description: 'ta sama zasada w zupełnie innym kontekście lub dziedzinie' },
  { id: 'odwrocenie', label: 'Odwrócenie', minStability: 0, description: 'znam wynik, szukam przyczyny lub brakującego elementu' },
  { id: 'reprezentacja', label: 'Reprezentacja', minStability: 2, description: 'wyjaśnij rysunkiem, analogią albo dziecku' },
  { id: 'blad', label: 'Błąd', minStability: 4, description: 'przekonujące, ale błędne rozumowanie — wskaż, gdzie się sypie' },
  { id: 'granica', label: 'Granica', minStability: 7, description: 'kiedy zasada przestaje działać; co, jeśli zmienić jedno założenie' },
  { id: 'polaczenie', label: 'Połączenie', minStability: 0, description: 'związek z innym pojęciem z grafu, najlepiej z innego tematu' },
  { id: 'tworzenie', label: 'Tworzenie', minStability: 20, description: 'sam układam zadanie sprawdzające zasadę, AI je ocenia' },
];
export const AXIS_IDS = AXES.map((o) => o.id);

export const QUESTION_CATEGORIES = ['fakt', 'przyczyna', 'granica', 'polaczenie', 'zastosowanie'];

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');

/** Local date as "YYYY-MM-DD HH:MM" — readable for a human, unambiguous for a script. */
export function formatLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function localDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses a date from the frontmatter (local string, ISO or a Date from YAML). */
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    // YAML turns "2026-10-08" into UTC midnight — we treat it as the local start of the day.
    if (v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0) {
      return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
    }
    return v;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function daysBetween(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}

// YAML dates become strings so the JSON for the UI is predictable.
function normalize(v) {
  if (v instanceof Date) {
    const d = parseDate(v);
    return d.getHours() === 0 && d.getMinutes() === 0 ? localDay(d) : formatLocal(d);
  }
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  return v;
}

// ---------- files ----------
export function readMarkdown(file) {
  const raw = fs.readFileSync(file, 'utf8');
  // Passing options ({}) disables the gray-matter cache — the data is always fresh.
  const { data, content } = matter(raw, {});
  return { data: normalize(data || {}), content, raw };
}

function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort();
}

function safely(fn, file) {
  try {
    return fn();
  } catch (e) {
    return { error: `Nie udało się odczytać ${path.relative(ROOT, file)}: ${e.message}` };
  }
}

export function conceptPath(slug) {
  return path.join(DIRS.concepts, `${slug}.md`);
}

export function loadConcepts() {
  return listMd(DIRS.concepts).map((f) => {
    const file = path.join(DIRS.concepts, f);
    const slug = f.replace(/\.md$/, '');
    return {
      slug,
      ...safely(() => {
        const { data, content } = readMarkdown(file);
        return { nazwa: slug, ...data, content };
      }, file),
    };
  });
}

export function loadTopics() {
  if (!fs.existsSync(DIRS.topics)) return [];
  return fs.readdirSync(DIRS.topics, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(DIRS.topics, d.name, 'temat.md')))
    .map((d) => {
      const file = path.join(DIRS.topics, d.name, 'temat.md');
      return { slug: d.name, ...safely(() => {
        const { data, content } = readMarkdown(file);
        return { ...data, content };
      }, file) };
    });
}

export function loadSessions() {
  return listMd(DIRS.sessions).map((f) => {
    const file = path.join(DIRS.sessions, f);
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    return {
      file: f,
      slug: f.replace(/\.md$/, ''),
      date: m ? m[1] : null,
      // Fallback for the `temat` frontmatter key: the topic slug from the file name.
      temat: m ? m[2] : null,
      ...safely(() => {
        const { data, content } = readMarkdown(file);
        return { ...data, content };
      }, file),
    };
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.file.localeCompare(a.file));
}

export function loadProfile() {
  const file = path.join(DATA_DIR, 'profil.md');
  if (!fs.existsSync(file)) return { missing: true };
  return safely(() => {
    const { data, content } = readMarkdown(file);
    return { ...data, content };
  }, file);
}

// ---------- profile settings (edited in the app) ----------
// Frontmatter fields of dane/profil.md that can be changed in the Settings view.
// Saving replaces only the "key: value" line, so comments explaining the fields stay.
export const PROFILE_FIELDS = {
  hamulec_zakresu: {
    label: 'Hamulec zakresu', type: 'choice', default: 'średni',
    description: 'Ile nowych pomysłów AI przyjmuje w trakcie celu, zanim wróci do niego.',
    options: {
      niski: 'Pomysły swobodnie zmieniają kierunek rozmowy.',
      'średni': 'Każdy nowy pomysł trafia jednym zdaniem do backlogu, rozmowa wraca do celu. Po 3 dygresjach pytanie: domykamy czy zmieniamy cel?',
      wysoki: 'Nowe pomysły trafiają do backlogu bez dyskusji; rozmowa zostaje przy celu.',
    },
  },
  tolerancja_zagubienia: {
    label: 'Tolerancja zagubienia', type: 'choice', default: 'średnia',
    description: 'Ile pytań bez postępu znosisz, zanim AI da rusztowanie.',
    options: { niska: 'Rusztowanie po 2 pytaniach bez postępu.', 'średnia': 'Po 3 pytaniach.', wysoka: 'Po 4–5 pytaniach.' },
  },
  poziom_inicjatywy: {
    label: 'Poziom inicjatywy', type: 'choice', default: 1,
    description: 'Kto zadaje pytania (zob. /pytania).',
    options: { 1: 'AI pyta, ja odpowiadam.', 2: 'Dopowiadam własne pytania.', 3: 'Prowadzę, AI dopytuje.', 4: 'Ja pytam, AI ocenia moje pytania.' },
  },
  energia_typowa: { label: 'Energia', type: 'text', default: '', description: 'Kiedy i z jaką energią zwykle się uczysz.' },
  preferowane_analogie: { label: 'Analogie', type: 'list', default: [], description: 'Dziedziny, z których AI bierze analogie (po przecinku).' },
};

function profileFieldValue(key, v) {
  const field = PROFILE_FIELDS[key];
  if (!field) throw new Error(`Nieznane pole profilu „${key}”.`);
  if (field.type === 'choice') {
    const option = Object.keys(field.options).find((o) => o === String(v));
    if (option === undefined) throw new Error(`Niedozwolona wartość „${v}” dla „${field.label}”.`);
    return option;
  }
  const clean = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (field.type === 'list') {
    const items = (Array.isArray(v) ? v : String(v ?? '').split(','))
      .map((s) => clean(s).replace(/[[\],"]/g, '')).filter(Boolean).slice(0, 20);
    return `[${items.join(', ')}]`;
  }
  return JSON.stringify(clean(v));
}

/** Saves selected profile frontmatter fields, leaving comments and the body untouched. */
export function setProfile(changes, file = path.join(DATA_DIR, 'profil.md')) {
  if (!fs.existsSync(file)) throw new Error('Brak pliku dane/profil.md.');
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error('Profil nie ma frontmattera.');
  let front = m[1];
  for (const [key, v] of Object.entries(changes ?? {})) {
    const line = `${key}: ${profileFieldValue(key, v)}`;
    const pattern = new RegExp(`^${key}:.*$`, 'm');
    front = pattern.test(front) ? front.replace(pattern, () => line) : `${front}\n${line}`;
  }
  fs.writeFileSync(file, text.replace(m[1], () => front));
  matter.clearCache?.();
  const { data } = matter(fs.readFileSync(file, 'utf8'));
  return Object.fromEntries(Object.keys(PROFILE_FIELDS).map((k) => [k, data[k] ?? PROFILE_FIELDS[k].default]));
}

/**
 * Question bank: every question is a section
 *   ## YYYY-MM-DD · <concept-slug> · <category>
 *   **Pytanie:** …
 *   **Ocena AI:** …
 *   **Głębiej:** …
 */
export function loadQuestions() {
  const file = path.join(DATA_DIR, 'pytania.md');
  if (!fs.existsSync(file)) return [];
  // Code blocks (e.g. the format description) are not questions.
  const raw = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  const result = [];
  const sections = raw.split(/^## /m).slice(1);
  for (const s of sections) {
    const [heading, ...rest] = s.split('\n');
    const parts = heading.split('·').map((x) => x.trim());
    if (parts.length < 3) continue;
    const body = rest.join('\n');
    const field = (name) => {
      const m = body.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[^*]+:\\*\\*|\\n<!--|$)`));
      return m ? m[1].trim() : '';
    };
    result.push({
      date: parts[0],
      concept: parts[1],
      category: parts[2].toLowerCase().replace('połączenie', 'polaczenie'),
      question: field('Pytanie'),
      assessment: field('Ocena AI'),
      deeper: field('Głębiej'),
    });
  }
  return result.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- editing the frontmatter without destroying formatting ----------
/**
 * Replaces (or appends) a top-level key in the frontmatter.
 * The rest of the file — comments, key order, body — stays untouched.
 */
export function setFrontmatterKey(raw, key, yamlValue) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return `---\n${key}: ${yamlValue}\n---\n\n${raw}`;
  const lines = m[1].split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (start === -1) {
    lines.push(`${key}: ${yamlValue}`);
  } else {
    let end = start + 1;
    while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === '')) end++;
    // Do not swallow empty lines at the end of the block.
    while (end > start + 1 && lines[end - 1].trim() === '') end--;
    lines.splice(start, end - start, `${key}: ${yamlValue}`);
  }
  return raw.replace(m[0], `---\n${lines.join('\n')}\n---`);
}

const yamlStr = (s) => JSON.stringify(s);
const round = (n, k = 2) => Math.round(n * 10 ** k) / 10 ** k;

export function cardToYaml(card) {
  return `{ due: ${yamlStr(formatLocal(card.due))}, stability: ${round(card.stability)}, difficulty: ${round(card.difficulty)}, ` +
    `reps: ${card.reps}, lapses: ${card.lapses}, state: ${State[card.state]}, ` +
    `last_review: ${card.last_review ? yamlStr(formatLocal(card.last_review)) : 'null'}, scheduled_days: ${card.scheduled_days} }`;
}

export function listToYaml(list) {
  return `[${list.join(', ')}]`;
}

/** Rebuilds a ts-fsrs card from the frontmatter (or null when there is none). */
export function cardFromData(f, now = new Date()) {
  if (!f || f.due == null) return null;
  const state = typeof f.state === 'number' ? f.state : State[f.state] ?? State.New;
  const due = parseDate(f.due) ?? now;
  const last = parseDate(f.last_review);
  return {
    ...createEmptyCard(due),
    due,
    stability: Number(f.stability) || 0,
    difficulty: Number(f.difficulty) || 0,
    reps: Number(f.reps) || 0,
    lapses: Number(f.lapses) || 0,
    state,
    last_review: last ?? undefined,
    scheduled_days: Number(f.scheduled_days) || 0,
    elapsed_days: last ? Math.max(0, daysBetween(now, last)) : 0,
    learning_steps: 0,
  };
}

// ---------- axes ----------
export function unlockedAxes(stability = 0) {
  return AXES.filter((o) => (stability || 0) >= o.minStability);
}

/**
 * Suggested axis: unlocked, not used in the latest reviews, least used overall;
 * ties go to the easier one. A newly unlocked axis (0 uses) wins at once — that is how we climb the ladder.
 */
export function suggestedAxis(concept) {
  const stability = concept?.fsrs?.stability ?? 0;
  const available = unlockedAxes(stability);
  const used = Array.isArray(concept?.osie_uzyte) ? concept.osie_uzyte : [];
  const recentWindow = Math.min(3, Math.max(0, available.length - 1));
  const recent = new Set(used.slice(-recentWindow));
  let candidates = available.filter((o) => !recent.has(o.id));
  if (!candidates.length) candidates = available;
  const count = (id) => used.filter((u) => u === id).length;
  candidates.sort((a, b) => count(a.id) - count(b.id) || AXIS_IDS.indexOf(a.id) - AXIS_IDS.indexOf(b.id));
  const axis = candidates[0];
  const next = AXES.find((o) => o.minStability > stability);
  return { ...axis, unlocked: available.map((o) => o.id), nextToUnlock: next ? { id: next.id, minStability: next.minStability } : null };
}

// ---------- reviews ----------
/** Interleaving: concepts from different topics in turn (round-robin), the most overdue first within a topic. */
export function interleave(list) {
  const groups = new Map();
  for (const p of [...list].sort((a, b) => a._due - b._due)) {
    const t = p.temat || '—';
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(p);
  }
  const queues = [...groups.values()].sort((a, b) => b.length - a.length);
  const result = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) result.push(q.shift());
  return result;
}

/** Neighbours of a concept in the graph: parents (zalezy_od) and children (concepts that depend on it). */
export function neighbors(slug, concepts) {
  const p = concepts.find((x) => x.slug === slug);
  const parents = (p?.zalezy_od ?? []).map((s) => ({ slug: s, relation: 'parent' }));
  const children = concepts.filter((x) => (x.zalezy_od ?? []).includes(slug)).map((x) => ({ slug: x.slug, relation: 'child' }));
  return [...parents, ...children]
    .map((s) => ({ ...s, nazwa: concepts.find((x) => x.slug === s.slug)?.nazwa ?? s.slug }));
}

/**
 * Groups for connected tasks: today's concepts linked in the graph, at most 3 per task.
 * A single concept without a neighbour due today gets one neighbour from outside the list (to weave in, unrated).
 */
export function connectedGroups(list) {
  const dueSlugs = new Set(list.map((p) => p.slug));
  const visited = new Set();
  const groups = [];
  for (const start of list) {
    if (visited.has(start.slug)) continue;
    const group = [];
    const stack = [start.slug];
    while (stack.length && group.length < 3) {
      const s = stack.pop();
      if (visited.has(s)) continue;
      visited.add(s);
      group.push(s);
      const p = list.find((x) => x.slug === s);
      for (const n of p?.related ?? []) if (dueSlugs.has(n.slug) && !visited.has(n.slug)) stack.push(n.slug);
    }
    if (group.length > 1) groups.push({ concepts: group, extra: [] });
    else {
      const neighbor = start.related?.find((n) => !dueSlugs.has(n.slug));
      if (neighbor) groups.push({ concepts: group, extra: [neighbor.slug] });
    }
  }
  return groups;
}

export function dueToday(now = new Date(), concepts = loadConcepts()) {
  const limit = endOfDay(now);
  const due = concepts
    .filter((p) => !p.error && p.fsrs?.due)
    .map((p) => ({ ...p, _due: parseDate(p.fsrs.due) }))
    .filter((p) => p._due && p._due <= limit);
  return interleave(due).map((p) => {
    const card = cardFromData(p.fsrs, now);
    return {
      slug: p.slug,
      nazwa: p.nazwa,
      temat: p.temat,
      due: p.fsrs.due,
      overdueDays: Math.max(0, daysBetween(now, p._due)),
      stability: p.fsrs.stability,
      lapses: p.fsrs.lapses ?? 0,
      retrievability: card && card.last_review ? round(scheduler.get_retrievability(card, now, false), 2) : null,
      opanowanie: p.opanowanie ?? 0,
      osie_uzyte: p.osie_uzyte ?? [],
      suggestedAxis: suggestedAxis(p).id,
      related: neighbors(p.slug, concepts).map((n) => ({ ...n, dueToday: due.some((d) => d.slug === n.slug) })),
    };
  });
}

// ---------- statistics ----------
function streakDays(activeDays, now) {
  const set = new Set(activeDays);
  let d = startOfDay(now);
  if (!set.has(localDay(d))) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  let streak = 0;
  while (set.has(localDay(d))) {
    streak++;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  }
  return streak;
}

export function recommendation({ due, topicsInProgress, weak }) {
  if (due.length) {
    const min = Math.max(5, due.length * 4);
    return {
      text: `Powtórka: ${due.length} ${pluralize(due.length, 'pojęcie', 'pojęcia', 'pojęć')} (ok. ${min} min). Najpierw swobodne przypomnienie, potem dialog.`,
      command: '/powtorka',
    };
  }
  if (weak.length) {
    return { text: `Nic do powtórki — wróć do słabego punktu: „${weak[0].nazwa}” (${weak[0].lapses} zapomnień).`, command: `/nauka ${weak[0].temat}` };
  }
  if (topicsInProgress.length) {
    const t = topicsInProgress[0];
    return { text: `Kontynuuj temat „${t.tytul}” (etap: ${t.status}).`, command: `/nauka ${t.slug}` };
  }
  return { text: 'Zacznij nowy temat — od diagnozy, nie od czytania.', command: '/nauka <temat>' };
}

/** Polish plural form: 1 → one, 2–4 (except 12–14) → few, otherwise many. */
export function pluralize(n, one, few, many) {
  if (n === 1) return one;
  const r10 = n % 10, r100 = n % 100;
  return r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? few : many;
}

export function stats(now = new Date()) {
  const concepts = loadConcepts().filter((p) => !p.error);
  const topics = loadTopics();
  const sessions = loadSessions();
  const questions = loadQuestions();
  const profile = loadProfile();

  const due = dueToday(now, concepts);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  // 14-day forecast (overdue ones count as today).
  const forecast = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    return { day: localDay(d), count: 0, concepts: [] };
  });
  for (const p of concepts) {
    const dueDate = parseDate(p.fsrs?.due);
    if (!dueDate) continue;
    const i = Math.max(0, daysBetween(dueDate, now));
    if (i < 14) {
      forecast[i].count++;
      forecast[i].concepts.push(p.slug);
    }
  }

  const activeDays = [
    ...sessions.map((s) => s.date).filter(Boolean),
    ...concepts.map((p) => parseDate(p.fsrs?.last_review)).filter(Boolean).map(localDay),
  ];

  const weak = concepts
    .filter((p) => (p.fsrs?.lapses ?? 0) >= 2 || ((p.fsrs?.reps ?? 0) >= 2 && (p.opanowanie ?? 0) < 40))
    .sort((a, b) => (b.fsrs?.lapses ?? 0) - (a.fsrs?.lapses ?? 0) || (a.opanowanie ?? 0) - (b.opanowanie ?? 0))
    .map((p) => ({ slug: p.slug, nazwa: p.nazwa, temat: p.temat, lapses: p.fsrs?.lapses ?? 0, opanowanie: p.opanowanie ?? 0 }));

  const topicsInProgress = topics
    .filter((t) => !t.error && t.status !== 'utrwalanie')
    .map((t) => ({ slug: t.slug, tytul: t.tytul, status: t.status }));

  const questionCategories = Object.fromEntries(QUESTION_CATEGORIES.map((k) => [k, 0]));
  for (const q of questions) if (q.category in questionCategories) questionCategories[q.category]++;

  const averageInitiative = concepts.length
    ? round(concepts.reduce((s, p) => s + (Number(p.poziom_inicjatywy) || 1), 0) / concepts.length, 1)
    : null;

  const axisUsage = Object.fromEntries(AXIS_IDS.map((o) => [o, 0]));
  for (const p of concepts) for (const o of p.osie_uzyte ?? []) if (o in axisUsage) axisUsage[o]++;

  return {
    now: formatLocal(now),
    conceptCount: concepts.length,
    withoutCard: concepts.filter((p) => !p.fsrs?.due).map((p) => p.slug),
    dueTodayCount: due.length,
    due,
    tomorrow: forecast[1]?.count ?? 0,
    forecast14Days: forecast,
    streakDays: streakDays(activeDays, now),
    topicsInProgress,
    topicCount: topics.length,
    recentSessions: sessions.slice(0, 5).map((s) => ({ slug: s.slug, date: s.date, tryb: s.tryb, temat: s.temat, tytul: s.tytul })),
    weakPoints: weak.slice(0, 5),
    averageMastery: concepts.length ? Math.round(concepts.reduce((s, p) => s + (Number(p.opanowanie) || 0), 0) / concepts.length) : null,
    initiativeLevel: { global: profile.poziom_inicjatywy ?? 1, conceptAverage: averageInitiative },
    questions: { total: questions.length, categories: questionCategories },
    axisUsage,
    recommendation: recommendation({ due, topicsInProgress, weak }),
    _tomorrow: localDay(tomorrow),
  };
}

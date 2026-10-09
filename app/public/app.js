// Polymathic — progress view. Read-only: Claude Code changes the data and this view refreshes itself (SSE).
import { marked } from '/vendor/marked.js';
import { createStudio } from '/studio.js';
import { createTerminal } from '/terminal.js';
import { renderSessionPanel } from '/session-panel.js';

const mermaid = window.mermaid;
const $content = document.getElementById('content');
const APP_HEADERS = { 'Content-Type': 'application/json', 'X-Polymathic': '1' };
const state = {
  data: null,
  concepts: { search: '', topic: '', sort: 'next', direction: 1 },
  questions: { category: '' },
  materials: { files: [], folder: '', description: '', uploading: false, status: '', error: false },
};

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pluralize = (n, a, b, c) => {
  if (n === 1) return a;
  const r10 = n % 10, r100 = n % 100;
  return r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? b : c;
};

// Keys are data values (question categories, topic stages, session modes stored in dane/); values are labels.
const CATEGORY_LABELS = { fakt: 'fakt', przyczyna: 'przyczyna', granica: 'granica', polaczenie: 'połączenie', zastosowanie: 'zastosowanie' };
const STAGES = ['diagnoza', 'plan', 'nauka', 'utrwalanie'];
const MODES = { nauka: 'nauka', powtorka: 'powtórka', pytania: 'pytania', praca: 'praca' };

// dates: "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" (local time)
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (d, options) => (d ? new Intl.DateTimeFormat('pl-PL', options).format(d) : '—');
const fmtShort = (d) => fmt(d, { day: 'numeric', month: 'short' });
const fmtFull = (d) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDate = (d) => fmt(d, { day: 'numeric', month: 'long', year: 'numeric' });

function dueInfo(s) {
  const d = parseDate(s);
  if (!d) return { text: 'brak karty', days: Infinity };
  const n = daysBetween(d, new Date());
  if (n < 0) return { text: `zaległe ${-n} d`, days: n, d };
  if (n === 0) return { text: 'dziś', days: 0, d };
  if (n === 1) return { text: 'jutro', days: 1, d };
  return { text: `za ${n} ${pluralize(n, 'dzień', 'dni', 'dni')}`, days: n, d };
}

// Mastery 0–100 → colour on a "cooling metal" scale (warm = weak, cool = mastered).
function masteryColor(v) {
  const x = Math.max(0, Math.min(100, Number(v) || 0)) / 25;
  const lo = Math.min(3, Math.floor(x));
  const t = Math.round((x - lo) * 100);
  return `color-mix(in oklab, var(--m${lo}) ${100 - t}%, var(--m${lo + 1}))`;
}
function masteryBar(v) {
  const n = Math.round(Number(v) || 0);
  return `<span class="mastery" title="Opanowanie: ${n}%"><span class="mastery-bar"><span style="width:${n}%;background:${masteryColor(n)}"></span></span><span class="mastery-value">${n}%</span></span>`;
}
const scaleLegend = () => `<div class="scale-legend"><span>słabe</span><span class="scale" aria-hidden="true"></span><span>opanowane</span></div>`;

const learnButton = (command) =>
  `<button class="button" type="button" data-learn="${esc(command)}">${command.startsWith('/powtorka') ? 'Zacznij powtórkę' : command.startsWith('/nauka') ? 'Kontynuuj naukę' : 'Otwórz w nauce'} ↗</button>`;

const axisById = (id) => state.data.axes.find((o) => o.id === id);
const conceptBySlug = (slug) => state.data.concepts.find((p) => p.slug === slug);
const topicBySlug = (slug) => state.data.topics.find((t) => t.slug === slug);
const topicLink = (slug) => {
  const t = topicBySlug(slug);
  return t ? `<a href="#/topics/${esc(slug)}">${esc(t.tytul ?? slug)}</a>` : esc(slug ?? '—');
};
const conceptLink = (slug) => {
  const p = conceptBySlug(slug);
  return p ? `<a href="#/concepts/${esc(slug)}">${esc(p.nazwa ?? slug)}</a>` : esc(slug);
};

function stages(status) {
  const i = STAGES.indexOf(status);
  return `<span class="stages" aria-label="Etap: ${esc(status)}">${STAGES.map((e, j) =>
    `${j ? '<span class="arrow" aria-hidden="true">›</span>' : ''}<span ${j < i ? 'data-done' : ''} ${j === i ? 'data-current aria-current="step"' : ''}>${e}</span>`).join('')}</span>`;
}

const pageHeader = (title, description = '', breadcrumbs = '') =>
  `<header class="page-header">${breadcrumbs ? `<div class="breadcrumbs">${breadcrumbs}</div>` : ''}<h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</header>`;

// ---------- markdown + mermaid ----------
marked.use({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      if ((lang || '').trim() === 'mermaid') return `<div class="map" data-mermaid="${encodeURIComponent(text)}"><p class="quiet">Rysuję mapę…</p></div>`;
      return false;
    },
  },
});
// LaTeX formulas ($…$, $$…$$) are cut out before markdown (so marked does not eat _ and *), rendered with KaTeX
// and put back. Code (```…``` and `…`) is protected so that $ in code does not become a formula.
function renderMarkdown(s, inline = false) {
  const codes = [];
  const formulas = [];
  let t = String(s || '').replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => `KZKOD${codes.push(m) - 1}KZ`);
  if (window.katex) {
    t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, f) => `KZWZOR${formulas.push({ f, block: true }) - 1}KZ`)
      .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, p, f) => `${p}KZWZOR${formulas.push({ f, block: false }) - 1}KZ`);
  }
  t = t.replace(/KZKOD(\d+)KZ/g, (_, i) => codes[i]);
  const html = inline ? marked.parseInline(t) : marked.parse(t);
  return (window.DOMPurify ? DOMPurify.sanitize(html) : esc(html)).replace(/KZWZOR(\d+)KZ/g, (_, i) => {
    const { f, block } = formulas[i];
    try {
      return window.katex.renderToString(f, { displayMode: block, throwOnError: false });
    } catch {
      return esc(f);
    }
  });
}
const md = (s) => `<div class="md">${renderMarkdown(s)}</div>`;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function setupMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: cssVar('--sans'),
    themeVariables: {
      background: cssVar('--paper-2'),
      primaryColor: cssVar('--paper-2'),
      primaryTextColor: cssVar('--ink'),
      primaryBorderColor: cssVar('--ink-3'),
      lineColor: cssVar('--ink-3'),
      secondaryColor: cssVar('--line-2'),
      tertiaryColor: cssVar('--paper'),
      fontSize: '15px',
    },
    flowchart: { curve: 'basis', padding: 14, nodeSpacing: 36, rankSpacing: 44 },
  });
}

let mapCounter = 0;
async function drawMaps(root) {
  setupMermaid();
  for (const el of root.querySelectorAll('.map[data-mermaid]')) {
    const source = decodeURIComponent(el.dataset.mermaid);
    try {
      const { svg } = await mermaid.render(`map-${++mapCounter}`, source);
      el.innerHTML = svg;
      colorNodes(el);
    } catch (e) {
      el.innerHTML = `<p class="map-error">Nie udało się narysować mapy: ${esc(e.message || e)}</p><pre>${esc(source)}</pre>`;
    }
  }
}

// A node whose id = concept slug (with "-" → "_") gets the mastery colour and becomes a link.
function colorNodes(el) {
  for (const g of el.querySelectorAll('g.node')) {
    const m = (g.id || '').match(/flowchart-(.+)-\d+$/);
    if (!m) continue;
    const slug = m[1].replace(/_/g, '-');
    const p = conceptBySlug(slug);
    if (!p) continue;
    const color = masteryColor(p.opanowanie);
    for (const shape of g.querySelectorAll('rect, path, polygon, circle, ellipse')) {
      if (shape.closest('.label')) continue;
      shape.style.setProperty('fill', `color-mix(in oklab, ${color} 20%, var(--paper-2))`, 'important');
      shape.style.setProperty('stroke', color, 'important');
      shape.style.setProperty('stroke-width', '1.6px', 'important');
    }
    g.dataset.concept = slug;
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'link');
    g.setAttribute('aria-label', `${p.nazwa}, opanowanie ${p.opanowanie ?? 0}%`);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${p.nazwa} · opanowanie ${p.opanowanie ?? 0}% · powtórka: ${dueInfo(p.fsrs?.due).text}`;
    g.prepend(title);
    const go = () => (location.hash = `#/concepts/${slug}`);
    g.addEventListener('click', go);
    g.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  }
}

// ---------- charts (SVG, no libraries) ----------
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function axisTicks(max) {
  if (max <= 4) return { top: Math.max(1, max), step: 1 };
  const step = Math.ceil(max / 4);
  return { top: step * 4, step };
}

function forecastChart(forecast) {
  const W = 640, H = 210, L = 28, R = 8, T = 18, B = 34;
  const max = Math.max(...forecast.map((d) => d.count), 0);
  const { top, step } = axisTicks(max);
  const width = (W - L - R) / forecast.length;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  let svg = '';
  for (let v = 0; v <= top; v += step) {
    svg += `<line class="${v ? 'grid-line' : 'axis-line'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-text" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  forecast.forEach((d, i) => {
    const dt = parseDate(d.day);
    const x = L + i * width;
    const w = Math.min(26, width - 6);
    const xs = x + (width - w) / 2;
    const h = y(0) - y(d.count);
    const names = d.concepts.map((s) => conceptBySlug(s)?.nazwa ?? s);
    const description = `${i === 0 ? 'Dziś (z zaległymi)' : fmtFull(dt)}: ${d.count} ${pluralize(d.count, 'pojęcie', 'pojęcia', 'pojęć')}${names.length ? ' — ' + names.join(', ') : ''}`;
    if (d.count) {
      svg += `<path class="bar ${i === 0 ? 'bar-today' : ''}" d="${barPath(xs, y(d.count), w, h)}"/>`;
      svg += `<text class="value-text" x="${x + width / 2}" y="${y(d.count) - 5}" text-anchor="middle">${d.count}</text>`;
    }
    const label = i === 0 ? 'dziś' : dt.getDate();
    svg += `<text class="axis-text" x="${x + width / 2}" y="${H - B + 16}" text-anchor="middle">${label}</text>`;
    if (i === 0 || dt.getDate() === 1) svg += `<text class="axis-text" x="${x + width / 2}" y="${H - B + 29}" text-anchor="middle">${i === 0 ? '' : fmt(dt, { month: 'short' })}</text>`;
    svg += `<rect class="hit-area" x="${x}" y="${T}" width="${width}" height="${H - T - B + 20}" data-tooltip="${esc(description)}"><title>${esc(description)}</title></rect>`;
  });
  return `<figure class="chart" style="margin:0">
    <p class="chart-title">Powtórki w najbliższych 14 dniach</p>
    <p class="chart-caption">Liczba pojęć, których termin przypada na dany dzień. Zaległe są wliczone do dziś.</p>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Prognoza powtórek: ${forecast.map((d) => d.count).join(', ')}">${svg}</svg>
    <div class="tooltip" aria-hidden="true"></div>
  </figure>`;
}

function startOfWeek(d) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function questionsChart(questions, categories) {
  if (!questions.length) return '';
  const weeks = new Map();
  const dates = questions.map((q) => parseDate(q.date)).filter(Boolean);
  let t = startOfWeek(new Date(Math.min(...dates)));
  const end = startOfWeek(new Date());
  while (t <= end) {
    weeks.set(dayKey(t), Object.fromEntries(categories.map((k) => [k, 0])));
    t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7);
  }
  for (const q of questions) {
    const d = parseDate(q.date);
    if (!d) continue;
    const k = dayKey(startOfWeek(d));
    if (weeks.has(k) && q.category in weeks.get(k)) weeks.get(k)[q.category]++;
  }
  const rows = [...weeks.entries()].slice(-12);
  const W = 640, H = 200, L = 28, R = 8, T = 14, B = 26;
  const max = Math.max(1, ...rows.map(([, c]) => Object.values(c).reduce((a, b) => a + b, 0)));
  const { top, step } = axisTicks(max);
  const width = (W - L - R) / rows.length;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  let svg = '';
  for (let v = 0; v <= top; v += step) {
    svg += `<line class="${v ? 'grid-line' : 'axis-line'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-text" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  rows.forEach(([key, c], i) => {
    const x = L + i * width;
    const w = Math.min(34, width - 8);
    const xs = x + (width - w) / 2;
    let sum = 0;
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    const nonEmpty = categories.filter((k) => c[k]);
    nonEmpty.forEach((k, j) => {
      const y0 = y(sum), y1 = y(sum + c[k]);
      const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0)); // 2px gap above the previous segment
      svg += j === nonEmpty.length - 1
        ? `<path d="${barPath(xs, y1, w, h)}" fill="var(--cat-${k})"/>` // only the top of the stack is rounded
        : `<rect x="${xs}" y="${y1}" width="${w}" height="${h}" fill="var(--cat-${k})"/>`;
      sum += c[k];
    });
    const dt = parseDate(key);
    const description = `Tydzień od ${fmtShort(dt)}: ${total} ${pluralize(total, 'pytanie', 'pytania', 'pytań')}${total ? ' — ' + nonEmpty.map((k) => `${CATEGORY_LABELS[k]} ${c[k]}`).join(', ') : ''}`;
    svg += `<text class="axis-text" x="${x + width / 2}" y="${H - B + 16}" text-anchor="middle">${fmtShort(dt)}</text>`;
    svg += `<rect class="hit-area" x="${x}" y="${T}" width="${width}" height="${H - T - B + 10}" data-tooltip="${esc(description)}"><title>${esc(description)}</title></rect>`;
  });
  const deep = (list) => list.filter((q) => q.category === 'przyczyna' || q.category === 'granica').length;
  const sorted = [...questions].sort((a, b) => a.date.localeCompare(b.date));
  const half = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, half), second = sorted.slice(half);
  const percent = (l) => (l.length ? Math.round((deep(l) / l.length) * 100) : 0);
  const trend = sorted.length >= 4
    ? `Pytania o przyczyny i granice: ${percent(first)}% w starszej połowie, ${percent(second)}% w nowszej.`
    : `Pytania o przyczyny i granice: ${deep(questions)} z ${questions.length}.`;
  return `<figure class="chart card" style="margin:0 0 28px;max-width:760px">
    <p class="chart-title">Jakość pytań w czasie</p>
    <p class="chart-caption">${esc(trend)} Celem jest coraz więcej pytań o przyczyny i granice.</p>
    <div class="chart-legend">${categories.map((k) => `<span><i style="background:var(--cat-${k})"></i>${CATEGORY_LABELS[k]}</span>`).join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pytania tygodniowo według kategorii">${svg}</svg>
    <div class="tooltip" aria-hidden="true"></div>
  </figure>`;
}

function attachTooltips(root) {
  for (const fig of root.querySelectorAll('.chart')) {
    const tooltip = fig.querySelector('.tooltip');
    if (!tooltip) continue;
    const show = (target, x, y) => {
      tooltip.textContent = target.dataset.tooltip;
      const r = fig.getBoundingClientRect();
      const left = Math.max(90, Math.min(r.width - 90, x - r.left));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${y - r.top}px`;
      tooltip.setAttribute('data-visible', '');
    };
    fig.addEventListener('pointermove', (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (!target) return tooltip.removeAttribute('data-visible');
      show(target, e.clientX, e.clientY);
    });
    fig.addEventListener('pointerleave', () => tooltip.removeAttribute('data-visible'));
  }
}

// ---------- views ----------
function dashboardView(d) {
  const s = d.stats;
  const now = new Date();
  const rec = s.recommendation;
  const extra = ['/powtorka', '/status'].filter((k) => k !== rec.command);
  const topics = s.topicsInProgress;
  const sessions = s.recentSessions.slice(0, 4);
  const live = activeLesson(d);
  return `<section class="today">
    ${live ? `<a class="lesson-banner" href="#/lessons/${esc(live.slug)}"><span class="live" data-state="ok">Trwa lekcja</span> <b>${esc(live.tytul ?? live.slug)}</b> <span class="quiet">Czytaj na żywo</span></a>` : ''}
    <p class="today-date">Dziś, ${esc(fmtFull(now))}</p>
    <p class="recommendation">${esc(rec.text)}</p>
    <div class="recommendation-actions">${learnButton(rec.command)}${extra.map((k) => learnButton(k)).join('')}</div>

    <div class="tiles">
      <a class="card tile" href="#/reviews" style="text-decoration:none;color:inherit">
        <span class="tile-title">Do powtórki dziś</span>
        <span class="tile-value">${s.dueTodayCount}</span>
        <span class="tile-caption">jutro: ${s.tomorrow} · razem pojęć: ${s.conceptCount}</span>
      </a>
      <div class="card tile">
        <span class="tile-title">Aktywne tematy</span>
        <span class="tile-value">${topics.length}</span>
        ${topics.length ? `<ul>${topics.slice(0, 3).map((t) => `<li><a href="#/topics/${esc(t.slug)}">${esc(t.tytul)}</a><span class="quiet">${esc(t.status)}</span></li>`).join('')}</ul>` : '<span class="tile-caption">Zacznij: <code>/nauka &lt;temat&gt;</code></span>'}
      </div>
      <div class="card tile">
        <span class="tile-title">Seria</span>
        <span class="tile-value">${s.streakDays}</span>
        <span class="tile-caption">${pluralize(s.streakDays, 'dzień', 'dni', 'dni')} z rzędu z nauką lub powtórką</span>
      </div>
      <div class="card tile">
        <span class="tile-title">Ostatnie sesje</span>
        ${sessions.length ? `<ul>${sessions.map((x) => `<li><a href="#/sessions/${esc(x.slug)}">${esc(x.tytul || topicBySlug(x.temat)?.tytul || x.temat)}</a><span class="quiet numeric">${esc(fmtShort(parseDate(x.date)))}</span></li>`).join('')}</ul>` : '<span class="tile-caption">Jeszcze żadnej. Pierwsza sesja: <code>/nauka</code></span>'}
      </div>
    </div>

    <div class="two-columns">
      <div class="card">${forecastChart(s.forecast14Days)}</div>
      <div class="card">
        <p class="chart-title">Słabe punkty</p>
        <p class="chart-caption">Pojęcia często zapominane albo z niskim opanowaniem mimo powtórek.</p>
        ${s.weakPoints.length
          ? `<ul style="list-style:none;padding:0;margin:0">${s.weakPoints.map((p) => `<li style="padding:8px 0;border-top:1px solid var(--line-2);display:grid;gap:4px">${conceptLink(p.slug)}<span style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${masteryBar(p.opanowanie)}<span class="quiet" style="font-size:13px">zapomnienia: ${p.lapses}</span></span></li>`).join('')}</ul>`
          : '<p class="quiet" style="margin:0">Brak. Żadne pojęcie nie zostało zapomniane dwa razy.</p>'}
        <p class="chart-title" style="margin-top:20px">Inicjatywa</p>
        <p class="quiet" style="margin:0;font-size:14px">Poziom ${esc(s.initiativeLevel.global)} z 4 · w pojęciach średnio ${esc(s.initiativeLevel.conceptAverage ?? '—')} · moich pytań: ${s.questions.total}</p>
      </div>
    </div>
    <p class="quiet" style="margin-top:28px;font-size:14px;max-width:62ch">Sen i rozłożenie w czasie są częścią metody: lepiej trzy krótkie sesje niż jedna długa.</p>
  </section>`;
}

function topicStats(t, d) {
  const concepts = d.concepts.filter((p) => p.temat === t.slug);
  const average = concepts.length ? Math.round(concepts.reduce((a, p) => a + (Number(p.opanowanie) || 0), 0) / concepts.length) : 0;
  const due = concepts.filter((p) => dueInfo(p.fsrs?.due).days <= 0).length;
  return { concepts, average, due };
}

// ---------- topic categories (folders in the Library) ----------
const normCategory = (k) => String(k ?? '').split('/').map((c) => c.trim()).filter(Boolean).join('/');
const inCategory = (k, name) => !!k && (k === name || k.startsWith(`${name}/`));
const COLLAPSED_KEY = 'polymathic-collapsed-categories';
let collapsedCategories = new Set();
try {
  // One-time fallback to the pre-rename key, so folders the user collapsed stay collapsed.
  collapsedCategories = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? localStorage.getItem('polymathic-zwiniete') ?? '[]'));
  localStorage.removeItem('polymathic-zwiniete');
} catch {}
const saveCollapsed = () => { try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedCategories])); } catch {} };

function categorySelect(t, d) {
  const current = normCategory(t.kategoria);
  return `<select class="category-select" data-topic-category="${esc(t.slug)}" aria-label="Kategoria tematu ${esc(t.tytul || t.slug)}">
    <option value="" ${current ? '' : 'selected'}>Bez kategorii</option>
    ${(d.categories ?? []).map((k) => `<option value="${esc(k)}" ${k === current ? 'selected' : ''}>${esc(k.replace(/\//g, ' › '))}</option>`).join('')}
    <option value="__new">＋ Nowa kategoria…</option>
  </select>`;
}

const libraryTopicCard = (t, d) => `<section class="library-topic"><div><h2><a href="#/topics/${esc(t.slug)}">${esc(t.tytul || t.slug)}</a></h2>${t.cel ? `<p>${esc(t.cel)}</p>` : ''}</div><div class="library-topic-actions">${categorySelect(t, d)}<button type="button" data-learn="${esc(`/nauka ${t.slug}`)}">Kontynuuj →</button><button type="button" class="remove" data-abandon="${esc(t.slug)}">Porzuć</button></div></section>`;

function libraryTree(d) {
  const topics = d.topics.filter((t) => !t.error);
  const categories = d.categories ?? [];
  if (!topics.length && !categories.length) return '<p class="empty">Zacznij temat w Nauce albo dodaj swój materiał. Kategorie (np. Języki, Gotowanie) utworzysz przyciskiem „＋ Nowa kategoria”.</p>';
  const node = (name) => {
    const children = categories.filter((k) => k.startsWith(`${name}/`) && !k.slice(name.length + 1).includes('/'));
    const own = topics.filter((t) => normCategory(t.kategoria) === name);
    const total = topics.filter((t) => inCategory(normCategory(t.kategoria), name)).length;
    return `<details class="category-folder" data-category="${esc(name)}" ${collapsedCategories.has(name) ? '' : 'open'}>
      <summary><span class="category-name">${esc(name.split('/').pop())}</span><small class="category-count">${total} ${pluralize(total, 'temat', 'tematy', 'tematów')}</small>
        <span class="category-actions">${name.split('/').length < 3 ? '<button type="button" data-category-action="subcategory">＋ podkategoria</button>' : ''}<button type="button" data-category-action="rename">Zmień nazwę</button><button type="button" data-category-action="remove">Usuń</button></span></summary>
      <div class="category-content">${own.map((t) => libraryTopicCard(t, d)).join('')}${children.map(node).join('')}
        ${!own.length && !children.length ? '<p class="quiet category-empty">Pusto. Przypisz tu temat wyborem kategorii przy temacie albo zacznij nowy w Nauce.</p>' : ''}</div>
    </details>`;
  };
  const uncategorized = topics.filter((t) => !normCategory(t.kategoria));
  return `<div class="library-tree">${categories.filter((k) => !k.includes('/')).map(node).join('')}
    ${uncategorized.length ? `<details class="category-folder category-none" data-category="" ${collapsedCategories.has('') ? '' : 'open'}><summary><span class="category-name">Bez kategorii</span><small class="category-count">${uncategorized.length} ${pluralize(uncategorized.length, 'temat', 'tematy', 'tematów')}</small></summary><div class="category-content">${uncategorized.map((t) => libraryTopicCard(t, d)).join('')}</div></details>` : ''}</div>`;
}

async function postCategories(route, body) {
  const r = await fetch(route, { method: 'POST', headers: APP_HEADERS, body: JSON.stringify(body) });
  const response = await r.json().catch(() => ({}));
  if (!r.ok) {
    notify(response.error || `Błąd serwera (${r.status})`);
    return null;
  }
  await load();
  await render({ keepScroll: true });
  return response;
}

function libraryView(d) {
  return pageHeader('Biblioteka') + `<div class="library-actions"><button type="button" class="link-action" data-category-action="new">＋ Nowa kategoria</button><a href="#/materials">＋ Dodaj materiał</a><a href="#/lessons">Zapisane lekcje ↗</a><a href="#/concepts">Pojęcia ↗</a></div>
    <div class="library-topics">${libraryTree(d)}</div>
    ${d.materials.length ? `<section class="library-section"><h2>Twoje materiały</h2>${d.materials.map(m => `<a class="library-row" href="#/materials"><span>${esc(m.nazwa || m.slug)}</span><small>${m.files.length} plików</small></a>`).join('')}</section>` : ''}
    ${d.lessons.length ? `<section class="library-section"><h2>Ostatnie lekcje</h2>${d.lessons.slice(0,4).map(l => `<div class="lesson-row"><a class="library-row" href="#/lessons/${esc(l.slug)}"><span>${esc(l.tytul || l.slug)}</span><small>${esc(fmtShort(parseDate(l.start || l.modified)))}</small></a>${deleteLessonButton(l)}</div>`).join('')}</section>` : ''}`;
}
function topicsView(d) { return libraryView(d); }

function topicView(d, slug) {
  const t = topicBySlug(slug);
  if (!t) return pageHeader('Nie ma takiego tematu', `Brak pliku dane/tematy/${esc(slug)}/temat.md.`, '<a href="#/library">Biblioteka</a>');
  const s = topicStats(t, d);
  const order = Array.isArray(t.pojecia) ? t.pojecia : [];
  const concepts = [...s.concepts].sort((a, b) => (order.indexOf(a.slug) + 1 || 999) - (order.indexOf(b.slug) + 1 || 999));
  return pageHeader(esc(t.tytul ?? slug), t.cel ? esc(t.cel) : '', '<a href="#/library">Biblioteka</a>') +
    `<div style="display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center;margin:-8px 0 20px">${stages(t.status)}${t.utworzono ? `<span class="quiet" style="font-size:13px">utworzono ${esc(fmtDate(parseDate(t.utworzono)))}</span>` : ''}</div>
    <div class="topic-layout">
      <article>${scaleLegend()}${md(t.content)}</article>
      <aside class="topic-sidebar card">
        <h3>Pojęcia w temacie</h3>
        ${concepts.length ? `<ul>${concepts.map((p) => `<li>${conceptLink(p.slug)}<span style="display:flex;gap:10px;align-items:center;justify-content:space-between">${masteryBar(p.opanowanie)}<span class="quiet" style="font-size:13px">${esc(dueInfo(p.fsrs?.due).text)}</span></span></li>`).join('')}</ul>` : '<p class="quiet">Brak pojęć — powstaną w fazie planu.</p>'}
        <div style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">${learnButton(`/nauka ${slug}`)}<button type="button" class="remove" data-abandon="${esc(slug)}">Porzuć temat</button></div>
      </aside>
    </div>`;
}

const COLUMNS = [
  { id: 'name', label: 'Nazwa', key: (p) => (p.nazwa ?? '').toLowerCase() },
  { id: 'topic', label: 'Temat', key: (p) => (topicBySlug(p.temat)?.tytul ?? p.temat ?? '').toLowerCase() },
  { id: 'mastery', label: 'Opanowanie', key: (p) => Number(p.opanowanie) || 0 },
  { id: 'next', label: 'Następna powtórka', key: (p) => parseDate(p.fsrs?.due)?.getTime() ?? Infinity },
  { id: 'lapses', label: 'Zapomnienia', key: (p) => p.fsrs?.lapses ?? 0, num: true },
  { id: 'initiative', label: 'Inicjatywa', key: (p) => Number(p.poziom_inicjatywy) || 1, num: true },
  { id: 'axes', label: 'Użyte osie', key: (p) => (p.osie_uzyte ?? []).length },
];

function conceptRows(d) {
  const f = state.concepts;
  const q = f.search.trim().toLowerCase();
  const column = COLUMNS.find((k) => k.id === f.sort) ?? COLUMNS[3];
  const list = d.concepts
    .filter((p) => !f.topic || p.temat === f.topic)
    .filter((p) => !q || `${p.nazwa} ${p.slug} ${p.temat}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const x = column.key(a), y = column.key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * f.direction;
    });
  if (!list.length) return `<tr><td colspan="${COLUMNS.length}" class="quiet">Nic nie pasuje do filtra.</td></tr>`;
  return list.map((p) => {
    const due = dueInfo(p.fsrs?.due);
    return `<tr>
      <td class="name"><a href="#/concepts/${esc(p.slug)}">${esc(p.nazwa)}</a>${p.typ === 'prawda' ? ' <span class="badge" title="bezwarunkowa prawda">prawda</span>' : ''}</td>
      <td>${topicLink(p.temat)}</td>
      <td>${masteryBar(p.opanowanie)}</td>
      <td title="${esc(due.d ? fmtFull(due.d) : '')}" ${due.days <= 0 ? 'style="color:var(--m0)"' : ''}>${esc(due.text)}</td>
      <td class="num">${p.fsrs?.lapses ?? 0}</td>
      <td class="num">${esc(p.poziom_inicjatywy ?? 1)}/4</td>
      <td><span class="badges">${(p.osie_uzyte ?? []).map((o) => `<span class="badge">${esc(axisById(o)?.label ?? o)}</span>`).join('') || '<span class="quiet">—</span>'}</span></td>
    </tr>`;
  }).join('');
}

function conceptsView(d) {
  if (!d.concepts.length) return pageHeader('Pojęcia') + '<p class="empty">Brak pojęć. Powstają podczas <code>/nauka</code> — każde z Twoją zasadą zapisaną własnymi słowami.</p>';
  const f = state.concepts;
  return pageHeader('Pojęcia', 'Wszystkie węzły ze wszystkich tematów. Kliknij nagłówek, aby posortować.') +
    `<div class="filters">
      <input class="field" id="filter-search" type="search" placeholder="Szukaj pojęcia" aria-label="Szukaj pojęcia" value="${esc(f.search)}">
      <select class="field" id="filter-topic" aria-label="Temat">
        <option value="">Wszystkie tematy</option>
        ${d.topics.map((t) => `<option value="${esc(t.slug)}" ${f.topic === t.slug ? 'selected' : ''}>${esc(t.tytul ?? t.slug)}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr>${COLUMNS.map((k) => `<th ${k.num ? 'class="num"' : ''} aria-sort="${f.sort === k.id ? (f.direction > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${k.id}">${k.label}</button></th>`).join('')}</tr></thead>
      <tbody id="concept-rows">${conceptRows(d)}</tbody>
    </table></div>
    <div style="margin-top:12px">${scaleLegend()}</div>`;
}

function conceptView(d, slug) {
  const p = conceptBySlug(slug);
  if (!p) return pageHeader('Nie ma takiego pojęcia', `Brak pliku dane/pojecia/${esc(slug)}.md.`, '<a href="#/concepts">Pojęcia</a>');
  if (p.error) return pageHeader(esc(slug), '', '<a href="#/concepts">Pojęcia</a>') + `<p class="map-error">${esc(p.error)}</p>`;
  const f = p.fsrs ?? {};
  const due = dueInfo(f.due);
  const children = d.concepts.filter((x) => (x.zalezy_od ?? []).includes(slug));
  const axis = axisById(p.suggestedAxis);
  return pageHeader(esc(p.nazwa), '', `<a href="#/concepts">Pojęcia</a> · ${topicLink(p.temat)}`) +
    `<div class="concept-layout">
      <article>${md(p.content)}</article>
      <aside class="card" style="font-size:14px">
        <div style="margin-bottom:14px">${masteryBar(p.opanowanie)}</div>
        <dl class="facts">
          <dt>Typ</dt><dd>${p.typ === 'prawda' ? 'bezwarunkowa prawda' : 'wywód'}</dd>
          <dt>Zależy od</dt><dd>${(p.zalezy_od ?? []).map(conceptLink).join(', ') || '<span class="quiet">— (korzeń)</span>'}</dd>
          <dt>Prowadzi do</dt><dd>${children.map((x) => conceptLink(x.slug)).join(', ') || '<span class="quiet">—</span>'}</dd>
          <dt>Powtórka</dt><dd title="${esc(due.d ? fmtFull(due.d) : '')}">${esc(due.text)}${due.d ? ` <span class="quiet">(${esc(fmtShort(due.d))})</span>` : ''}</dd>
          <dt>Stabilność</dt><dd class="numeric">${f.stability != null ? `${esc(f.stability)} d` : '—'}</dd>
          <dt>Trudność</dt><dd class="numeric">${f.difficulty != null ? esc(f.difficulty) : '—'} <span class="quiet">/ 10</span></dd>
          <dt>Powtórki</dt><dd class="numeric">${f.reps ?? 0} · zapomnienia: ${f.lapses ?? 0}</dd>
          <dt>Inicjatywa</dt><dd>poziom ${esc(p.poziom_inicjatywy ?? 1)} z 4</dd>
          <dt>Użyte osie</dt><dd><span class="badges">${(p.osie_uzyte ?? []).map((o) => `<span class="badge">${esc(axisById(o)?.label ?? o)}</span>`).join('') || '<span class="quiet">—</span>'}</span></dd>
          <dt>Następna oś</dt><dd>${axis ? `<span class="badge next-axis">${esc(axis.label)}</span><br><span class="quiet">${esc(axis.description)}</span>` : '—'}</dd>
        </dl>
      </aside>
    </div>`;
}

function reviewsView(d) {
  const s = d.stats;
  const today = new Date();
  const withCard = d.concepts.filter((p) => parseDate(p.fsrs?.due)).map((p) => ({ ...p, _d: parseDate(p.fsrs.due) }));
  const withoutCard = d.concepts.filter((p) => !p.error && !parseDate(p.fsrs?.due));
  const groups = new Map();
  for (const p of withCard.sort((a, b) => a._d - b._d)) {
    const k = daysBetween(p._d, today) <= 0 ? dayKey(today) : dayKey(p._d);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const calendar = s.forecast14Days.map((x, i) => {
    const dt = parseDate(x.day);
    const label = i === 0 ? 'dziś' : `${fmt(dt, { weekday: 'short' })} ${dt.getDate()}`;
    const tag = x.count ? 'a' : 'div';
    return `<${tag} class="calendar-day" ${x.count ? `href="#/reviews" data-jump="day-${x.day}"` : 'data-empty'} ${i === 0 ? 'data-today' : ''} title="${esc(fmtFull(dt))}"><span>${esc(label)}</span><b>${x.count}</b></${tag}>`;
  }).join('');
  const sections = [...groups.entries()].map(([k, list]) => {
    const dt = parseDate(k);
    const n = daysBetween(dt, today);
    const title = n === 0 ? 'Dziś' : n === 1 ? 'Jutro' : fmtFull(dt);
    const overdue = n === 0 ? list.filter((p) => daysBetween(p._d, today) < 0).length : 0;
    return `<section class="day-group" id="day-${k}">
      <h3>${esc(title)}<small>${list.length} ${pluralize(list.length, 'pojęcie', 'pojęcia', 'pojęć')}${overdue ? `, w tym zaległe: ${overdue}` : ''}</small></h3>
      ${list.map((p) => {
        const late = daysBetween(p._d, today);
        return `<div class="review-row">
          <span class="title">${conceptLink(p.slug)} <span class="quiet" style="font-size:14px">· ${topicLink(p.temat)}</span></span>
          ${late < 0 ? `<span class="quiet">zaległe ${-late} d</span>` : ''}
        </div>`;
      }).join('')}
    </section>`;
  }).join('');
  return pageHeader('Powtórki', s.dueTodayCount ? `${s.dueTodayCount} pojęć gotowych na dziś.` : 'Na dziś wszystko. Wróć do nauki albo zrób przerwę.') +
    `<div style="margin:-8px 0 20px">${learnButton('/powtorka')}</div>
    <details class="review-schedule"><summary>Terminy na kolejne dni</summary><div class="calendar" aria-label="Najbliższe 14 dni">${calendar}</div></details>
    ${sections || '<p class="empty">Brak zaplanowanych powtórek.</p>'}
    ${withoutCard.length ? `<section class="day-group"><h3>Jeszcze bez zaplanowanej powtórki</h3>${withoutCard.map((p) => `<div class="review-row"><span class="title">${conceptLink(p.slug)}</span></div>`).join('')}</section>` : ''}`;
}

function questionsView(d) {
  const categories = d.questionCategories;
  const chosen = state.questions.category;
  const list = d.questions.filter((q) => !chosen || q.category === chosen);
  const count = (k) => d.questions.filter((q) => q.category === k).length;
  if (!d.questions.length) {
    return pageHeader('Moje pytania') + '<p class="empty">Bank jest pusty. Pytania, które sam wymyślisz podczas sesji, trafią tutaj. Trening: <code>/pytania</code>.</p>';
  }
  return pageHeader('Moje pytania', 'Pytania, które sam wymyśliłeś, z oceną kategorii i propozycją, jak zapytać głębiej.') +
    questionsChart(d.questions, categories) +
    `<div class="chips" role="group" aria-label="Filtr kategorii" style="margin-bottom:8px">
      <button type="button" class="chip" data-filter-category="" aria-pressed="${!chosen}">wszystkie ${d.questions.length}</button>
      ${categories.map((k) => `<button type="button" class="chip" data-filter-category="${k}" aria-pressed="${chosen === k}"><i style="background:var(--cat-${k})"></i>${CATEGORY_LABELS[k]} ${count(k)}</button>`).join('')}
    </div>
    <div>${list.map((q) => `<article class="question">
      <div class="question-head"><span class="numeric">${esc(fmtDate(parseDate(q.date)))}</span><span class="category"><i style="background:var(--cat-${esc(q.category)})"></i>${esc(CATEGORY_LABELS[q.category] ?? q.category)}</span><span>${conceptLink(q.concept)}</span></div>
      <p class="question-text">${esc(q.question)}</p>
      <dl>${q.assessment ? `<dt>Ocena</dt><dd>${esc(q.assessment)}</dd>` : ''}${q.deeper ? `<dt>Głębiej</dt><dd>${esc(q.deeper)}</dd>` : ''}</dl>
    </article>`).join('') || '<p class="quiet">Brak pytań w tej kategorii.</p>'}</div>`;
}

function sessionsView(d) {
  if (!d.sessions.length) return pageHeader('Sesje') + '<p class="empty">Dziennik jest pusty. Każda sesja <code>/nauka</code>, <code>/powtorka</code> i <code>/pytania</code> zostawia tu wpis.</p>';
  return pageHeader('Sesje', 'Dziennik sesji, od najnowszej.') +
    `<div class="journal">${d.sessions.map((s) => {
      const meta = [s.tryb && MODES[s.tryb] ? MODES[s.tryb] : s.tryb, s.energia && `energia: ${s.energia}`, s.czas_min && `${s.czas_min} min`].filter(Boolean);
      return `<article class="entry" id="session-${esc(s.slug)}">
        <div class="entry-head">
          <span class="entry-date">${esc(fmtDate(parseDate(s.date)))}</span>
          <span class="entry-meta">${meta.map((m) => `<span class="badge">${esc(m)}</span>`).join('')}${s.temat && topicBySlug(s.temat) ? topicLink(s.temat) : ''}${s.przyklad ? '<span class="badge">przykład</span>' : ''}</span>
          <h2>${esc(s.tytul || topicBySlug(s.temat)?.tytul || s.temat || s.slug)}</h2>
        </div>
        ${s.error ? `<p class="map-error">${esc(s.error)}</p>` : md(s.content)}
      </article>`;
    }).join('')}</div>`;
}

function profileView(d) {
  const p = d.profile;
  if (p.missing) return pageHeader('Profil') + '<p class="empty">Brak pliku <code>dane/profil.md</code>.</p>';
  // Keys are frontmatter keys of dane/profil.md.
  const FIELDS = [
    ['jezyk', 'Język'], ['tolerancja_zagubienia', 'Tolerancja zagubienia'], ['poziom_inicjatywy', 'Poziom inicjatywy'],
    ['preferowane_analogie', 'Analogie'], ['energia_typowa', 'Energia'],
  ];
  const value = (v) => (Array.isArray(v) ? v.join(', ') : v);
  return pageHeader('Profil', 'Jak się uczysz. Ustawienia zmienisz w <a href="#/settings">Ustawieniach</a>, w dane/profil.md albo prosząc Claude.') +
    `<div class="concept-layout">
      <article>${md(p.content)}</article>
      <aside class="card"><dl class="facts">${FIELDS.map(([k, n]) => `<dt>${n}</dt><dd>${esc(value(p[k]) ?? '—')}${k === 'poziom_inicjatywy' ? ' z 4' : ''}</dd>`).join('')}</dl></aside>
    </div>`;
}

// ---------- Settings: profile fields + experimental features ----------
// Scope-brake gauge: an arc in three zones, the needle shows the current level.
function brakeIllustration(level) {
  const angle = { niski: 150, 'średni': 90, wysoki: 30 }[level] ?? 90;
  const point = (a, r) => [110 + r * Math.cos(a * Math.PI / 180), 110 - r * Math.sin(a * Math.PI / 180)].map((v) => v.toFixed(1));
  const arc = (from, to, color) => { const [x1, y1] = point(from - 2, 80), [x2, y2] = point(to + 2, 80); return `<path d="M${x1} ${y1} A80 80 0 0 1 ${x2} ${y2}" stroke="var(${color})" />`; };
  const [nx, ny] = point(angle, 66);
  return `<svg class="settings-illustration" viewBox="0 0 220 150" role="img" aria-label="Hamulec zakresu: ${esc(level ?? 'średni')}">
    <g fill="none" stroke-width="14">${arc(180, 120, '--m1')}${arc(120, 60, '--m3')}${arc(60, 0, '--m4')}</g>
    <g fill="none" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 5"><path d="M44 110 A66 66 0 0 1 176 110" /></g>
    <line x1="110" y1="110" x2="${nx}" y2="${ny}" stroke="var(--ink)" stroke-width="3" stroke-linecap="round" />
    <circle cx="110" cy="110" r="7" fill="var(--paper-2)" stroke="var(--ink)" stroke-width="3" />
    <g font-size="11" fill="var(--ink-3)" font-family="var(--sans)" text-anchor="middle">
      <text x="34" y="132">swobodnie</text><text x="110" y="22">cel</text><text x="186" y="132">twardo</text>
    </g>
    <text x="110" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="var(--ink)" font-family="var(--sans)">${esc(level ?? 'średni')}</text>
  </svg>`;
}

function settingsView(d) {
  const p = d.profile, fields = d.profileFields ?? {};
  const header = `<header class="page-header settings-header">
    <div><h1>Ustawienia</h1><p>Jak ma pracować z Tobą AI. Zmiana zapisuje się od razu w <code>dane/profil.md</code> i obowiązuje od następnej wiadomości.</p></div>
    ${brakeIllustration(p.hamulec_zakresu)}
  </header>`;
  if (p.missing) return header + '<p class="empty">Brak pliku <code>dane/profil.md</code>.</p>' + featuresSection(d);
  const field = (k, o) => {
    const v = p[k] ?? o.default;
    if (o.type === 'choice') {
      return `<fieldset class="setting"><legend>${esc(o.label)}</legend><p class="quiet">${esc(o.description)}</p>
        <div class="setting-options">${Object.entries(o.options).map(([w, description]) => `<label class="option"><input type="radio" name="profile-${esc(k)}" data-profile-field="${esc(k)}" value="${esc(w)}" ${String(v) === w ? 'checked' : ''}>
          <span><b>${esc(w)}</b><small>${esc(description)}</small></span></label>`).join('')}</div></fieldset>`;
    }
    const text = Array.isArray(v) ? v.join(', ') : (v ?? '');
    return `<label class="setting setting-text"><span class="setting-name">${esc(o.label)}</span><span class="quiet">${esc(o.description)}</span>
      <input type="text" data-profile-field="${esc(k)}" value="${esc(text)}" maxlength="200"></label>`;
  };
  return header + `<section class="settings">${Object.entries(fields).map(([k, o]) => field(k, o)).join('')}</section>` + featuresSection(d);
}

// ---------- experimental features (feature flags) ----------
const featureEnabled = (id) => !!state.data?.features?.enabled?.[id];
function featuresSection(d) {
  const f = d.features;
  if (!f) return '';
  return `<section class="features"><h2 class="section-title">Funkcje eksperymentalne</h2>
    <p class="quiet">Nowe funkcje są domyślnie wyłączone. Włączenie zapisuje się w <code>dane/ustawienia.json</code> i działa od razu.</p>
    ${Object.entries(f.definitions).map(([id, o]) => `<label class="feature"><input type="checkbox" data-feature="${esc(id)}" ${f.enabled[id] ? 'checked' : ''}>
      <span><b>${esc(o.label)}</b><small>${esc(o.description)}</small></span></label>`).join('')}
  </section>`;
}

// ---------- Files: Obsidian-style note viewer (behind the "pliki" flag) ----------
const fileHref = (rel) => `#/files/${rel.split('/').map(encodeURIComponent).join('/')}`;
const WIKILINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g;

function filesView(d, arg) {
  if (!d.features?.enabled?.pliki) {
    return pageHeader('Pliki') + '<p class="empty">Ta funkcja jest wyłączona. Włączysz ją w <a href="#/settings">Ustawieniach → Funkcje eksperymentalne</a>.</p>';
  }
  return `<div class="files-layout">
    <nav class="files-tree" id="files-tree" aria-label="Pliki w dane/"><p class="quiet">Wczytuję…</p></nav>
    <article class="files-preview" id="files-preview">${arg ? '<p class="quiet">Wczytuję…</p>' : '<p class="empty">Wybierz notatkę z drzewa po lewej.</p>'}</article>
  </div>`;
}

function treeHtml(list, active) {
  const root = {};
  for (const rel of list) {
    let w = root;
    const parts = rel.split('/');
    parts.slice(0, -1).forEach((c) => (w = w[c] ??= {}));
    (w['.files'] ??= []).push(rel);
  }
  const node = (w, dir) => {
    const folders = Object.keys(w).filter((k) => k !== '.files').sort((a, b) => a.localeCompare(b, 'pl'));
    return `<ul>${folders.map((f) => {
      const full = dir ? `${dir}/${f}` : f;
      const open = !dir || (active ?? '').startsWith(`${full}/`);
      return `<li><details ${open ? 'open' : ''}><summary>${esc(f)}</summary>${node(w[f], full)}</details></li>`;
    }).join('')}${(w['.files'] ?? []).map((rel) => {
      const name = rel.split('/').pop().replace(/\.md$/, '');
      return `<li><a href="${fileHref(rel)}" ${rel === active ? 'aria-current="page"' : ''}>${esc(name)}</a></li>`;
    }).join('')}</ul>`;
  };
  return node(root, '');
}

// [[link]] → link to the note; code blocks are left alone (mermaid has its own [[…]]).
function replaceWikilinks(text, links) {
  return text.split(/(```[\s\S]*?```)/g).map((chunk, i) => (i % 2 ? chunk : chunk.replace(WIKILINK, (_, target, alias) => {
    const rel = links[target.trim().toLowerCase()];
    const label = (alias || target).trim();
    return rel ? `[${label.replace(/[[\]]/g, '')}](${fileHref(rel)})` : `<span class="link-missing" title="Nie ma takiej notatki">${esc(label)}</span>`;
  }))).join('');
}

const propertyValue = (v) => (v == null ? '—' : Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

async function loadFiles(arg) {
  const $tree = document.getElementById('files-tree');
  const $preview = document.getElementById('files-preview');
  if (!$tree) return;
  try {
    const r = await fetch('/api/files', { cache: 'no-store' });
    const { files, links, error } = await r.json();
    if (!r.ok) throw new Error(error);
    $tree.innerHTML = treeHtml(files, arg);
    if (!arg) return;
    const rp = await fetch(`/api/file?path=${encodeURIComponent(arg)}`, { cache: 'no-store' });
    const p = await rp.json();
    if (!rp.ok) throw new Error(p.error);
    const parts = p.path.split('/');
    const title = parts.at(-1) === 'temat.md' && parts.length > 1 ? parts.at(-2) : parts.at(-1).replace(/\.md$/, '');
    const properties = Object.entries(p.data ?? {});
    $preview.innerHTML = `<p class="breadcrumbs">${parts.slice(0, -1).map(esc).join(' / ') || 'dane'}</p>
      <h1 class="files-title">${esc(title)}</h1>
      ${properties.length ? `<details class="properties" open><summary>Właściwości</summary><dl>${properties.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(propertyValue(v))}</dd>`).join('')}</dl></details>` : ''}
      ${md(replaceWikilinks(p.content, links))}
      <footer class="files-footer"><h2>Linkują tutaj</h2>${p.incoming.length ? `<ul>${p.incoming.map((rel) => `<li><a href="${fileHref(rel)}">${esc(rel)}</a></li>`).join('')}</ul>` : '<p class="quiet">Żadna notatka nie linkuje do tej przez [[…]].</p>'}
      <p class="quiet">dane/${esc(p.path)} · zmieniono ${esc(p.modified)}</p></footer>`;
    await drawMaps($preview);
  } catch (e) {
    ($preview ?? $tree).innerHTML = `<p class="empty">Nie udało się wczytać: ${esc(e.message)}</p>`;
  }
}


// ---------- live lessons ----------
const ACTIVE_MS = 15 * 60 * 1000;
const activeLesson = (d) => d.lessons.find((l) => Date.now() - l.modifiedMs < ACTIVE_MS);

const deleteLessonButton = (l) =>
  `<button type="button" class="remove" data-delete-lesson="${esc(l.slug)}" aria-label="Usuń lekcję ${esc(l.tytul ?? l.slug)}">Usuń</button>`;

function lessonsView(d) {
  if (!d.lessons.length) {
    return pageHeader('Lekcje') + '<p class="empty">Tu zostaną Twoje rozmowy i ćwiczenia. <a href="#/studio">Zacznij naukę →</a></p>';
  }
  return pageHeader('Zapisane lekcje', '', '<a href="#/library">Biblioteka</a>') +
    `<div class="topic-list">${d.lessons.map((l) => {
      const live = Date.now() - l.modifiedMs < ACTIVE_MS;
      // `wpis-quiz` is the class log-lesson.mjs writes into the lesson file (on-disk format).
      const quizzes = (l.content?.match(/class="wpis-quiz/g) || []).length;
      return `<div class="lesson-row"><a class="card topic-card" href="#/lessons/${esc(l.slug)}">
        <h3>${esc(l.tytul ?? l.slug)}</h3>
        ${live ? '<span class="badge live-badge">trwa</span>' : '<span></span>'}
        <div class="topic-meta"><span>${esc(fmtDate(parseDate(l.start || l.modified)))}, ${esc(String(l.start ?? '').slice(11))}</span><span>ostatnia zmiana ${esc(String(l.modified).slice(11))}</span>${quizzes ? `<span>quizy: ${quizzes}</span>` : ''}</div>
      </a>${deleteLessonButton(l)}</div>`;
    }).join('')}</div>`;
}

function lessonView(d, slug) {
  const l = d.lessons.find((x) => x.slug === slug);
  if (!l) return pageHeader('Nie ma takiej lekcji', '', '<a href="#/lessons">Lekcje</a>');
  const live = Date.now() - l.modifiedMs < ACTIVE_MS;
  return pageHeader(esc(l.tytul ?? slug), esc(fmtDate(parseDate(l.start || l.modified))), '<a href="#/lessons">Lekcje</a>') +
    `<p class="lesson-actions">${deleteLessonButton(l).replace('>Usuń<', '>Usuń lekcję<')}</p>
    ${live ? '<p class="live-bar"><span class="live" data-state="ok">lekcja trwa — nowe wiadomości pojawią się same</span></p>' : ''}
    <article class="lesson">${md(l.content)}</article>
    <div id="lesson-end"></div>`;
}

// ---------- materials ----------
// Same algorithm as slugify() in scripts/lib.mjs — a preview of the folder name before saving.
const slugify = (t) => String(t ?? '').replace(/[łŁ]/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`);

function folderHint() {
  const m = state.materials;
  const slug = slugify(m.folder);
  if (!m.folder.trim()) return 'Np. Fotosynteza — wykład 3.';
  if (!slug) return 'Nazwa musi zawierać litery lub cyfry.';
  const exists = state.data.materials.find((x) => x.slug === slug);
  return exists ? 'Dołączymy do istniejących materiałów.' : '';
}
const canSave = () => state.materials.files.length > 0 && slugify(state.materials.folder) && !state.materials.uploading;

function updateForm() {
  const hint = document.getElementById('material-hint');
  if (hint) hint.textContent = folderHint();
  const btn = document.getElementById('material-save');
  if (btn) btn.disabled = !canSave();
  const st = document.getElementById('material-status');
  if (st) {
    st.textContent = state.materials.status;
    st.dataset.error = state.materials.error ? '1' : '';
  }
}

function addFiles(list) {
  const added = [...list].filter((f) => f.size > 0 || f.type);
  if (!added.length) return;
  state.materials.files.push(...added);
  state.materials.status = '';
  state.materials.error = false;
}

function materialsView(d) {
  const m = state.materials;
  const folders = d.materials;
  const form = `<section class="card upload" aria-label="Dodaj materiały">
    <div class="dropzone" id="dropzone" role="button" tabindex="0" aria-describedby="dropzone-hint">
      <span class="dropzone-title">Upuść pliki tutaj</span>
      <span id="dropzone-hint" class="quiet">lub wybierz z dysku · do 500 MB na plik</span>
      <input type="file" id="file-picker" multiple hidden>
    </div>
    ${m.files.length ? `<ul class="selected-files">${m.files.map((f, i) => `<li><span class="selected-file-name">${esc(f.name)}</span><span class="quiet numeric">${fmtSize(f.size)}</span>${m.uploading ? '' : `<button type="button" class="remove" data-remove-file="${i}" aria-label="Usuń ${esc(f.name)} z listy">Usuń</button>`}</li>`).join('')}</ul>` : ''}
    <div class="fields">
      <label class="field-label" for="material-folder">Nazwa lekcji</label>
      <input class="field" id="material-folder" list="material-folders" autocomplete="off" value="${esc(m.folder)}" placeholder="np. Fotosynteza — wykład 3" ${m.uploading ? 'disabled' : ''}>
      <datalist id="material-folders">${folders.map((f) => `<option value="${esc(f.nazwa)}"></option>`).join('')}</datalist>
      <p class="hint" id="material-hint">${esc(folderHint())}</p>
      <label class="field-label" for="material-description">Co chcesz z tego zrozumieć? (opcjonalnie)</label>
      <textarea class="field" id="material-description" rows="4" placeholder="Co to jest i do czego ma posłużyć? Np. „Slajdy z wykładu, chcę zrozumieć fazę jasną i ciemną”." ${m.uploading ? 'disabled' : ''}>${esc(m.description)}</textarea>
    </div>
    <div class="actions">
      <button type="button" class="button button-primary" id="material-save" ${canSave() ? '' : 'disabled'}>Zapisz w folderze lekcji</button>
      <span class="status" id="material-status" role="status" data-error="${m.error ? '1' : ''}">${esc(m.status)}</span>
    </div>
  </section>`;

  const list = folders.length
    ? folders.map((f) => {
      const content = (f.content || '').replace(/^\s*# .*\n/, '');
      return `<article class="card folder" id="material-${esc(f.slug)}">
        <header class="folder-head">
          <h3>${esc(f.nazwa)}</h3>
          <span class="quiet">dane/materialy/${esc(f.slug)}/</span>
        </header>
        ${f.files.length ? `<ul class="file-list">${f.files.map((p) => `<li><a href="/materialy/${encodeURIComponent(f.slug)}/${encodeURIComponent(p.name)}" target="_blank" rel="noopener">${esc(p.name)}</a><span class="quiet numeric">${fmtSize(p.size)}</span></li>`).join('')}</ul>` : '<p class="quiet">Folder jest pusty.</p>'}
        ${content.trim() ? `<details class="upload-history"><summary>Opis i historia dodawania</summary>${md(content)}</details>` : ''}
      </article>`;
    }).join('')
    : '<p class="empty">Jeszcze nie ma żadnych materiałów. Wrzuć pierwszy plik powyżej.</p>';

  return pageHeader('Materiały', 'Pliki do lekcji. Upuść plik, nazwij lekcję i opisz go. Zapisze się w dane/materialy/, gdzie Claude zajrzy podczas /nauka.') +
    `<div class="materials">${form}<h2 class="section-title">Foldery lekcji</h2><div class="folders">${list}</div></div>`;
}

function uploadFile(file, folder, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/materials/file?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('X-Polymathic', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let response = {};
      try { response = JSON.parse(xhr.responseText); } catch {}
      xhr.status === 200 ? resolve(response) : reject(new Error(response.error || `Błąd serwera (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Brak połączenia z serwerem. Czy działa npm start?'));
    xhr.send(file);
  });
}

async function saveMaterials() {
  const m = state.materials;
  if (!canSave()) return;
  m.uploading = true;
  m.error = false;
  render({ keepScroll: true });
  const saved = [];
  try {
    for (const [i, file] of m.files.entries()) {
      const response = await uploadFile(file, m.folder, (u) => {
        m.status = `Wysyłam ${i + 1} z ${m.files.length}: ${file.name} (${Math.round(u * 100)}%)`;
        updateForm();
      });
      saved.push(response.file);
    }
    const r = await fetch('/api/materials/description', {
      method: 'POST',
      headers: APP_HEADERS,
      body: JSON.stringify({ folder: m.folder, description: m.description, files: saved }),
    });
    const response = await r.json();
    if (!r.ok) throw new Error(response.error || `Błąd serwera (${r.status})`);
    Object.assign(m, {
      files: [], folder: '', description: '', uploading: false, error: false,
      status: `Zapisano ${saved.length} ${pluralize(saved.length, 'plik', 'pliki', 'plików')} w dane/materialy/${response.slug}/`,
    });
  } catch (e) {
    // Saved files stay on disk; only the ones that failed to upload remain on the list.
    m.files = m.files.slice(saved.length);
    Object.assign(m, { uploading: false, error: true, status: `Nie zapisano: ${e.message}${saved.length ? ` (wysłane wcześniej: ${saved.join(', ')})` : ''}` });
  }
  await load();
  render({ keepScroll: true });
}

// ---------- router ----------
const studio = createStudio({ esc, md, renderMaps: drawMaps });

// ---------- terminal (Learning) ----------
const terminal = createTerminal({ onState: () => refreshTerminalPanel() });

const sessionPanel = d => renderSessionPanel(d.learning, esc, d.learningError);

function terminalPanel(d) {
  const s = terminal.state;
  const status = s.error ? esc(s.error) : s.disconnected ? 'Łączę…' : s.running ? 'Claude · połączony' : s.end ? 'Rozmowa zakończona' : 'Uruchamiam Claude…';
  const due = d.stats.dueTodayCount;
  const topics = d.topics.filter(t => !t.error && t.status !== 'utrwalanie');
  const live = activeLesson(d);
  const active = d.learning && !d.learning.endedAt;
  const command = (prompt, label, small = '') => `<button type="button" class="command" data-prompt="${esc(prompt)}"><span>${esc(label)}</span>${small ? `<small>${esc(small)}</small>` : ''}</button>`;
  const start = 'Przeczytaj .claude/skills/sesja/SKILL.md oraz adekwatny skill nauki. Sprawdź session.mjs status i wykorzystaj poprzedni następny krok. ';
  return `${s.error || s.disconnected ? `<p role="status" class="panel-status">${status}</p>` : ''}<section class="panel-section"><div id="session-focus">${sessionPanel(d)}</div></section>
    ${!active ? `<section class="panel-section"><h2>Zacznij od jednego kroku</h2>
      ${due ? command(start + 'Zacznij 15-minutową sesję powtórek, zapisz plan przez session.mjs start. Dobieraj zadania łączone, gdy znam składowe. Zacznij od jednego problemu.', 'Powtórka · 15 min', `${due} pojęć czeka; sesja wybierze część`) : ''}
      ${topics.slice(0, 2).map(t => command(start + `Kontynuuj naukę tematu ${t.slug}. Zapisz cel i 15-minutowy plan przez session.mjs start, potem przejdź do jednego zadania.`, t.tytul || t.slug)).join('')}
      ${command('/nauka ', 'Nowy temat…')}
    </section>` : ''}
    <section class="panel-section"><h2>Gdy potrzebujesz</h2>
      ${command('Nie rozumiem. Pokaż krótki przykład i wyjaśnij najważniejszy krok. Nie zadawaj kolejnej wersji tego samego pytania. Zapisz użycie pomocy przy ocenie rzeczywistej próby.', 'Wyjaśnij inaczej')}
      ${command('Chcę trudniejsze zastosowanie. W ramach aktualnego celu połącz 2–3 znane, powiązane pojęcia w jednym zadaniu bez zdradzania zasad. Zastąp nim osobne sprawdziany, nie dodawaj serii testów.', 'Daj wyzwanie')}
      ${active ? command('Zakończ sesję. Odczytaj session.mjs status i zapisz finish z jednym następnym krokiem. Podsumuj krótko: co samodzielnie, co z pomocą, co odłożone. Nie dodawaj testu.', 'Na dziś wystarczy') : ''}
    </section>
    <details class="panel-section"><summary>Rozmowa i narzędzia</summary>
      <p class="panel-status"><span class="live" data-state="${s.running ? 'ok' : s.error ? 'error' : ''}"></span>${status}</p>
      <div class="panel-buttons">${s.running ? '' : '<button type="button" class="button" data-terminal="resume">Połącz ponownie</button>'}<button type="button" class="button" data-terminal="new">Nowa rozmowa</button></div>
      ${command('/status', 'Przegląd nauki')}${command('/pytania', 'Trening pytań')}
      ${live ? `<a href="#/lessons/${esc(live.slug)}">Zapis rozmowy ↗</a>` : ''}
      <a href="#/library">Wszystkie tematy ↗</a>
    </details>`;
}

function terminalView(d) {
  return `<div class="terminal-layout"><div class="terminal-slot" id="terminal-slot"></div><aside class="terminal-panel" id="terminal-panel">${terminalPanel(d)}</aside></div>`;
}

function refreshTerminalPanel() {
  const p = document.getElementById('terminal-panel');
  if (p && state.data) p.innerHTML = terminalPanel(state.data);
}
let sessionPollBusy = false;
setInterval(async () => {
  if (document.hidden || route().view !== 'studio' || !state.data || sessionPollBusy) return;
  sessionPollBusy = true;
  try {
    const response = await fetch('/api/learning', { cache: 'no-store' });
    if (!response.ok) {
      const problem = await response.json();
      state.data.learningError = problem.error || 'Nie można odczytać sesji.';
      const slot = document.getElementById('session-focus');
      if (slot) slot.innerHTML = sessionPanel(state.data);
      return;
    }
    const hadError = !!state.data.learningError;
    state.data.learningError = '';
    const next = await response.json();
    if (hadError || JSON.stringify(next) !== JSON.stringify(state.data.learning)) {
      const wasActive = !!state.data.learning && !state.data.learning.endedAt;
      state.data.learning = next;
      if (wasActive !== (!!next && !next.endedAt)) refreshTerminalPanel();
      else {
        const slot = document.getElementById('session-focus');
        if (slot) {
          const opened = !!slot.querySelector('details[open]');
          slot.innerHTML = sessionPanel(state.data);
          if (opened) slot.querySelector('details')?.setAttribute('open', '');
        }
      }
    }
  } catch { /* connection state is shown by the terminal */ }
  finally { sessionPollBusy = false; }
}, 4000);

const VIEWS = {
  library: d => libraryView(d),
  studio: d => terminalView(d),
  files: (d, arg) => filesView(d, arg),
  chat: d => studio.html(d),
  dashboard: (d) => dashboardView(d),
  lessons: (d, slug) => (slug ? lessonView(d, slug) : lessonsView(d)),
  topics: (d, slug) => (slug ? topicView(d, slug) : topicsView(d)),
  concepts: (d, slug) => (slug ? conceptView(d, slug) : conceptsView(d)),
  reviews: (d) => reviewsView(d),
  questions: (d) => questionsView(d),
  materials: (d) => materialsView(d),
  sessions: (d) => sessionsView(d),
  profile: (d) => profileView(d),
  settings: (d) => settingsView(d),
};
// Hash routes from before the English rename (bookmarks, links in old notes) keep working.
const ROUTE_ALIASES = {
  biblioteka: 'library', pliki: 'files', czat: 'chat', pulpit: 'dashboard', lekcje: 'lessons', tematy: 'topics',
  pojecia: 'concepts', powtorki: 'reviews', pytania: 'questions', materialy: 'materials', sesje: 'sessions',
  profil: 'profile', ustawienia: 'settings',
};

function route() {
  const [, raw = 'studio', ...rest] = location.hash.replace(/^#/, '').split('/');
  const view = ROUTE_ALIASES[raw] ?? raw;
  return { view: VIEWS[view] ? view : 'studio', arg: rest.map(decodeURIComponent).join('/') || null };
}

async function render({ keepScroll = false } = {}) {
  if (!state.data) return;
  const { view, arg } = route();
  const y = window.scrollY;
  const focused = document.activeElement?.id;
  const selection = focused && document.activeElement.selectionStart;
  $content.innerHTML = VIEWS[view](state.data, arg);
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.dataset.view === (['topics','concepts','materials','lessons'].includes(view) ? 'library' : view)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const title = $content.querySelector('h1')?.textContent;
  document.title = (quiz ? '● Quiz · ' : '') + (title && view !== 'dashboard' ? `${title} · Polymathic` : 'Polymathic');
  if (view === 'chat') studio.mount($content);
  if (view === 'studio') terminal.mount(document.getElementById('terminal-slot'));
  if (view === 'files' && featureEnabled('pliki')) loadFiles(arg);
  const $navFiles = document.querySelector('.nav a[data-view="files"]');
  if ($navFiles) $navFiles.hidden = !featureEnabled('pliki');
  document.body.dataset.view = view;
  document.querySelector('.nav-more')?.toggleAttribute('open', ['questions','sessions','dashboard','profile','files','chat'].includes(view));
  attachTooltips($content);
  if (focused) {
    const el = document.getElementById(focused);
    if (el) {
      el.focus();
      if (selection != null && el.setSelectionRange) el.setSelectionRange(selection, selection);
    }
  }
  if (view === 'materials' && state.materials.focusFolder) {
    state.materials.focusFolder = false;
    document.getElementById('material-folder')?.focus();
  }
  if (keepScroll) window.scrollTo(0, y);
  await drawMaps($content);
  if (keepScroll) window.scrollTo(0, y);
  if (view === 'sessions' && arg && !keepScroll) document.getElementById(`session-${arg}`)?.scrollIntoView();
}

async function load() {
  const r = await fetch('/api/data', { cache: 'no-store' });
  if (!r.ok) throw new Error(`Serwer zwrócił ${r.status}`);
  state.data = await r.json();
}

// ---------- interactions (delegation) ----------
$content.addEventListener('click', async (e) => {
  const learn = e.target.closest('[data-learn]');
  if (learn) { location.hash = '#/studio'; setTimeout(() => terminal.type(`${learn.dataset.learn}\r`), 400); return; }
  const promptButton = e.target.closest('[data-prompt]');
  if (promptButton) {
    const k = promptButton.dataset.prompt;
    // A command with room to add text (ends with a space) — only type it, do not submit.
    return terminal.type(k.endsWith(' ') ? k : `${k}\r`);
  }
  const term = e.target.closest('[data-terminal]');
  if (term) {
    if (term.dataset.terminal === 'new' && !confirm('Zacząć nową rozmowę z Claude? Obecna zostanie zamknięta (jej zapis zostaje w Lekcjach).')) return;
    return term.dataset.terminal === 'new' ? terminal.newSession() : terminal.resume();
  }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const text = copy.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copy.setAttribute('data-copied', '');
    const label = copy.querySelector('.quiet');
    const old = label?.textContent;
    if (label) label.textContent = 'skopiowano';
    setTimeout(() => {
      copy.removeAttribute('data-copied');
      if (label) label.textContent = old;
    }, 1400);
    return;
  }
  const sort = e.target.closest('[data-sort]');
  if (sort) {
    const f = state.concepts;
    f.direction = f.sort === sort.dataset.sort ? -f.direction : 1;
    f.sort = sort.dataset.sort;
    return render({ keepScroll: true });
  }
  const filter = e.target.closest('[data-filter-category]');
  if (filter) {
    state.questions.category = filter.dataset.filterCategory;
    return render({ keepScroll: true });
  }
  if (e.target.closest('#dropzone')) return document.getElementById('file-picker')?.click();
  const categoryAction = e.target.closest('[data-category-action]');
  if (categoryAction) {
    e.preventDefault(); // a button inside <summary> must not collapse the folder
    const action = categoryAction.dataset.categoryAction;
    const name = categoryAction.closest('[data-category]')?.dataset.category ?? '';
    if (action === 'new' || action === 'subcategory') {
      const given = prompt(action === 'new' ? 'Nazwa nowej kategorii (np. Języki, Gotowanie). Podkategorię oddziel ukośnikiem: Języki/Hiszpański' : `Nazwa podkategorii w „${name}”:`);
      if (!given?.trim()) return;
      const full = action === 'new' ? given : `${name}/${given}`;
      if (await postCategories('/api/categories', { action: 'add', name: full })) notify(`Dodano kategorię „${normCategory(full)}”`);
    } else if (action === 'rename') {
      const to = prompt(`Nowa nazwa kategorii „${name}”.\nMożesz też przenieść ją, zmieniając ścieżkę (np. „Języki/${name.split('/').pop()}”).`, name);
      if (!to?.trim() || normCategory(to) === name) return;
      const response = await postCategories('/api/categories', { action: 'rename', name, to });
      if (response) notify(`Zmieniono na „${normCategory(to)}”${response.topicsChanged ? ` (${response.topicsChanged} ${pluralize(response.topicsChanged, 'temat', 'tematy', 'tematów')})` : ''}`);
    } else if (action === 'remove') {
      const count = state.data.topics.filter((t) => inCategory(normCategory(t.kategoria), name)).length;
      const where = name.includes('/') ? `„${name.slice(0, name.lastIndexOf('/'))}”` : '„Bez kategorii”';
      if (!confirm(`Usunąć kategorię „${name}”?${count ? `\n\n${count} ${pluralize(count, 'temat przejdzie', 'tematy przejdą', 'tematów przejdzie')} do ${where}. Tematy nie są usuwane.` : ''}`)) return;
      if (await postCategories('/api/categories', { action: 'remove', name })) notify(`Usunięto kategorię „${name}”`);
    }
    return;
  }
  const abandon = e.target.closest('[data-abandon]');
  if (abandon) {
    const slug = abandon.dataset.abandon;
    const t = topicBySlug(slug);
    const count = state.data.concepts.filter((p) => p.temat === slug).length;
    if (!confirm(`Porzucić temat „${t?.tytul ?? slug}”?\n\nTemat${count ? ` i ${count} ${pluralize(count, 'pojęcie', 'pojęcia', 'pojęć')}` : ''} znikną z Biblioteki i powtórek. Nic nie jest kasowane — wszystko trafia do dane/archiwum/, skąd można to przywrócić.`)) return;
    const r = await fetch('/api/topics/abandon', { method: 'POST', headers: APP_HEADERS, body: JSON.stringify({ slug }) });
    const response = await r.json().catch(() => ({}));
    if (!r.ok) return notify(`Nie porzucono: ${response.error || r.status}`);
    await load();
    if (route().view === 'topics') location.hash = '#/library';
    else await render({ keepScroll: true });
    return notify(`Porzucono temat — zapis w ${response.archive}`);
  }
  const deleteLesson = e.target.closest('[data-delete-lesson]');
  if (deleteLesson) {
    const slug = deleteLesson.dataset.deleteLesson;
    const title = state.data.lessons.find((l) => l.slug === slug)?.tytul ?? slug;
    if (!confirm(`Usunąć lekcję „${title}”?\n\nZapis zniknie z biblioteki i nie zostanie odtworzony, nawet jeśli ta sesja jeszcze trwa. Pojęcia, powtórki i logi sesji zostają.`)) return;
    const r = await fetch('/api/lessons/delete', { method: 'POST', headers: APP_HEADERS, body: JSON.stringify({ slug }) });
    const response = await r.json().catch(() => ({}));
    if (!r.ok) return notify(`Nie usunięto: ${response.error || r.status}`);
    await load();
    const t = route();
    if (t.view === 'lessons' && t.arg === slug) location.hash = '#/lessons';
    else await render({ keepScroll: true });
    return notify('Usunięto lekcję');
  }
  const removeFile = e.target.closest('[data-remove-file]');
  if (removeFile) {
    state.materials.files.splice(Number(removeFile.dataset.removeFile), 1);
    return render({ keepScroll: true });
  }
  if (e.target.closest('#material-save')) return saveMaterials();
  const jump = e.target.closest('[data-jump]');
  if (jump) {
    e.preventDefault();
    document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
});
$content.addEventListener('toggle', (e) => {
  const el = e.target;
  if (!el.matches?.('details.category-folder')) return;
  const k = el.dataset.category;
  if (el.open) collapsedCategories.delete(k);
  else collapsedCategories.add(k);
  saveCollapsed();
}, true);
$content.addEventListener('keydown', (e) => {
  if (e.target.id === 'dropzone' && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    document.getElementById('file-picker')?.click();
  }
});
$content.addEventListener('change', async (e) => {
  if (e.target.dataset.topicCategory !== undefined) {
    let k = e.target.value;
    if (k === '__new') {
      k = prompt('Nazwa nowej kategorii dla tego tematu (podkategorię oddziel ukośnikiem, np. Języki/Hiszpański):');
      if (!k?.trim()) return render({ keepScroll: true });
    }
    const response = await postCategories('/api/topics/category', { slug: e.target.dataset.topicCategory, category: k });
    if (response) notify(response.category ? `Przeniesiono do „${response.category}”` : 'Temat bez kategorii');
    return;
  }
  if (e.target.dataset.profileField) {
    const key = e.target.dataset.profileField;
    const r = await fetch('/api/profile', { method: 'POST', headers: APP_HEADERS, body: JSON.stringify({ [key]: e.target.value }) });
    const response = await r.json().catch(() => ({}));
    if (!r.ok) {
      await render({ keepScroll: true });
      return notify(`Nie zapisano: ${response.error || r.status}`);
    }
    await load();
    await render({ keepScroll: true });
    return notify(`Zapisano: ${state.data.profileFields?.[key]?.label ?? key}`);
  }
  if (e.target.dataset.feature) {
    const r = await fetch('/api/features', { method: 'POST', headers: APP_HEADERS, body: JSON.stringify({ id: e.target.dataset.feature, enabled: e.target.checked }) });
    const response = await r.json().catch(() => ({}));
    if (!r.ok) {
      e.target.checked = !e.target.checked;
      return notify(`Nie zmieniono: ${response.error || r.status}`);
    }
    await load();
    await render({ keepScroll: true });
    return notify(`${e.target.checked ? 'Włączono' : 'Wyłączono'}: ${state.data.features.definitions[e.target.dataset.feature].label}`);
  }
  if (e.target.id !== 'file-picker') return;
  addFiles(e.target.files);
  render({ keepScroll: true });
});
$content.addEventListener('input', (e) => {
  if (e.target.id === 'material-folder' || e.target.id === 'material-description') {
    state.materials[e.target.id === 'material-folder' ? 'folder' : 'description'] = e.target.value;
    return updateForm();
  }
  if (e.target.id === 'filter-search') state.concepts.search = e.target.value;
  else if (e.target.id === 'filter-topic') state.concepts.topic = e.target.value;
  else return;
  const tbody = document.getElementById('concept-rows');
  if (tbody) tbody.innerHTML = conceptRows(state.data);
});

// Dropping a file anywhere in the app goes to Materials (instead of opening the file in the tab).
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.dataset.dragging = '1';
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) delete document.body.dataset.dragging;
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  delete document.body.dataset.dragging;
  if (state.materials.uploading) return;
  addFiles(e.dataTransfer.files);
  state.materials.focusFolder = true; // after rendering the cursor lands in "Nazwa lekcji"
  if (route().view !== 'materials') location.hash = '#/materials';
  else render({ keepScroll: true });
});

// ---------- quiz (dialog) ----------
const $quiz = document.getElementById('quiz');
const $quizDialog = $quiz.querySelector('.quiz-dialog');
let quiz = null; // { data, selected: Set, dontKnow, note, result, sending, error }
let focusBeforeQuiz = null;
// Quiz series: the next question arrives as soon as the previous one is answered.
// It waits in the queue until the learner has read the explanation and clicked "Dalej".
let nextQuiz = null;
const pageTitle = () => document.title.replace(/^● Quiz · /, '');

function openQuiz(data) {
  if (!data) return;
  if (quiz?.data.id === data.id) return;
  if (quiz && (quiz.result || quiz.sending)) {
    nextQuiz = data;
    return;
  }
  if (!quiz) focusBeforeQuiz = document.activeElement;
  quiz = { data, selected: new Set(), dontKnow: false, note: '', result: null, sending: false, error: '' };
  $quiz.hidden = false;
  document.body.dataset.quiz = '1';
  document.title = `● Quiz · ${pageTitle()}`;
  drawQuiz();
  $quizDialog.querySelector('.quiz-option')?.focus();
}

function closeQuiz() {
  if (nextQuiz) {
    const following = nextQuiz;
    nextQuiz = null;
    quiz = null;
    return openQuiz(following);
  }
  quiz = null;
  $quiz.hidden = true;
  delete document.body.dataset.quiz;
  document.title = pageTitle();
  focusBeforeQuiz?.focus?.();
}

function drawQuiz() {
  if (!quiz) return;
  const { data, selected, dontKnow, result } = quiz;
  const correct = new Set(result?.correct ?? []);
  const options = data.options.map((o) => {
    const classes = ['quiz-option'];
    if (selected.has(o.number)) classes.push('selected');
    if (result && correct.has(o.number)) classes.push('correct');
    if (result && selected.has(o.number) && !correct.has(o.number)) classes.push('wrong');
    const mark = result ? (correct.has(o.number) ? '✓' : selected.has(o.number) ? '✗' : '') : '';
    return `<button type="button" class="${classes.join(' ')}" data-number="${o.number}" aria-pressed="${selected.has(o.number)}" ${result ? 'disabled' : ''}>
      <span class="quiz-number">${mark || o.number}</span><span class="quiz-text">${renderMarkdown(o.text, true)}</span></button>`;
  }).join('');
  let footer;
  if (result) {
    const verdict = result.dontKnow ? ['dont-know', 'Nie wiem — to też informacja'] : result.isCorrect ? ['correct', '✓ Dobrze'] : ['wrong', '✗ Źle'];
    footer = `<div class="quiz-result ${verdict[0]}" role="status"><p class="quiz-verdict">${verdict[1]}</p>${md(result.explanation)}</div>
      <div class="quiz-actions"><button type="button" class="button button-primary" id="quiz-next">Dalej</button><span class="quiet">Enter</span></div>`;
  } else {
    footer = `<label class="quiz-note"><span>Notatka (opcjonalnie): jak o tym myślisz?</span><textarea class="field" id="quiz-note" rows="2">${esc(quiz.note)}</textarea></label>
      <div class="quiz-actions">
        <button type="button" class="button button-primary" id="quiz-check" ${(selected.size || dontKnow) && !quiz.sending ? '' : 'disabled'}>Sprawdź</button>
        <span class="quiet">${data.multiple ? 'zaznacz wszystkie poprawne · ' : ''}klawisze 1–${data.options.length}, 0 = nie wiem, Enter</span>
        ${quiz.error ? `<span class="status" data-error="1">${esc(quiz.error)}</span>` : ''}
      </div>`;
  }
  const series = data.series;
  const remaining = series ? series.total - series.index : 0;
  const skipping = result ? '' : `<span class="quiz-skip-actions">
      <button type="button" class="remove" id="quiz-skip">${series ? 'Pomiń pytanie' : 'Pomiń'}</button>
      ${remaining ? `<button type="button" class="remove" id="quiz-finish" title="Pomija to i pozostałe pytania">Zakończ (pomiń ${remaining + 1})</button>` : ''}
    </span>`;
  $quizDialog.innerHTML = `
    <div class="quiz-top"><span class="quiz-label">Quiz${series ? ` · pytanie ${series.index} z ${series.total}` : ''}${data.multiple ? ' · kilka odpowiedzi' : ''}</span>${skipping}</div>
    ${series ? `<div class="quiz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${series.total}" aria-valuenow="${series.index - 1}"><span style="width:${((series.index - (result ? 0 : 1)) / series.total) * 100}%"></span></div>` : ''}
    <div class="quiz-question" id="quiz-question">${md(data.question)}</div>
    ${data.details ? `<div class="quiz-details">${md(data.details)}</div>` : ''}
    <div class="quiz-options" role="group" aria-label="Odpowiedzi">${options}
      <button type="button" class="quiz-option dont-know ${dontKnow ? 'selected' : ''}" data-number="0" aria-pressed="${dontKnow}" ${result ? 'disabled' : ''}><span class="quiz-number">0</span><span class="quiz-text">Nie wiem</span></button>
    </div>
    ${footer}`;
}

function chooseOption(number) {
  if (!quiz || quiz.result) return;
  if (number === 0) {
    quiz.dontKnow = !quiz.dontKnow;
    quiz.selected.clear();
  } else if (quiz.data.options.some((o) => o.number === number)) {
    quiz.dontKnow = false;
    if (quiz.data.multiple) quiz.selected.has(number) ? quiz.selected.delete(number) : quiz.selected.add(number);
    else quiz.selected = new Set([number]);
  }
  drawQuiz();
  $quizDialog.querySelector(`.quiz-option[data-number="${number}"]`)?.focus();
}

async function submitQuiz() {
  if (!quiz || quiz.result || quiz.sending || (!quiz.selected.size && !quiz.dontKnow)) return;
  const q = quiz; // the SSE "quiz-closed" may arrive before the response — keep our own reference
  q.sending = true;
  q.error = '';
  drawQuiz();
  try {
    const r = await fetch(`/api/quiz/${q.data.id}/answer`, {
      method: 'POST',
      headers: APP_HEADERS,
      body: JSON.stringify({ selected: [...q.selected], dontKnow: q.dontKnow, note: q.note }),
    });
    const response = await r.json();
    if (!r.ok) throw new Error(response.error || `Błąd serwera (${r.status})`);
    q.result = response;
  } catch (e) {
    q.error = e.message;
  }
  q.sending = false;
  if (quiz !== q) return;
  drawQuiz();
  $quizDialog.querySelector('#quiz-next')?.focus();
}

$quizDialog.addEventListener('click', (e) => {
  const option = e.target.closest('.quiz-option');
  if (option) return chooseOption(Number(option.dataset.number));
  if (e.target.closest('#quiz-check')) return submitQuiz();
  if (e.target.closest('#quiz-next')) return closeQuiz();
  if (e.target.closest('#quiz-skip')) return skipQuiz(false);
  if (e.target.closest('#quiz-finish')) return skipQuiz(true);
});

// Skip one question (the next one in the series arrives over SSE) or the whole rest of the series.
async function skipQuiz(wholeSeries) {
  const q = quiz;
  if (!q || q.result || q.sending) return;
  q.sending = true; // meanwhile the next question waits in the queue instead of replacing the current one
  if (wholeSeries) nextQuiz = null;
  try {
    await fetch(`/api/quiz/${q.data.id}/cancel`, {
      method: 'POST',
      headers: APP_HEADERS,
      body: JSON.stringify({ series: wholeSeries }),
    });
  } catch {
    // server unreachable — close the dialog anyway
  }
  q.sending = false;
  if (wholeSeries) nextQuiz = null;
  if (quiz === q) closeQuiz();
}
$quizDialog.addEventListener('input', (e) => {
  if (e.target.id === 'quiz-note' && quiz) quiz.note = e.target.value;
});
document.addEventListener('keydown', (e) => {
  if (!quiz) return;
  const inField = e.target.id === 'quiz-note';
  if (e.key === 'Enter' && !e.shiftKey) {
    if (quiz.result) {
      e.preventDefault();
      return closeQuiz();
    }
    if (!inField || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      return submitQuiz();
    }
  }
  if (inField) return;
  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    chooseOption(Number(e.key));
  }
  if (e.key === 'Escape' && quiz.result) closeQuiz();
});

// ---------- theme ----------
const THEME_KEY = 'polymathic-theme';
const $themeToggle = document.getElementById('theme-toggle');
const THEME_NAMES = { auto: 'auto', light: 'jasny', dark: 'ciemny' };
function setTheme(m) {
  if (m === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = m;
  $themeToggle.textContent = `Motyw: ${THEME_NAMES[m]}`;
  try {
    if (m === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, m);
  } catch {}
}
setTheme(document.documentElement.dataset.theme ?? 'auto');
$themeToggle.addEventListener('click', () => {
  const cycle = ['dark', 'light'];
  const current = document.documentElement.dataset.theme ?? 'auto';
  setTheme(cycle[(cycle.indexOf(current) + 1) % 3]);
  render({ keepScroll: true }); // mermaid needs the new colours
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.documentElement.dataset.theme) render({ keepScroll: true });
});

// ---------- live (SSE) ----------
const $liveStatus = document.getElementById('live-status');
const $toast = document.getElementById('toast');
let toastTimer;
function notify(text) {
  $toast.textContent = text;
  $toast.setAttribute('data-visible', '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.removeAttribute('data-visible'), 2600);
}
function connectLive() {
  const es = new EventSource('/api/events');
  es.onopen = () => {
    fetch('/api/quiz/active').then((r) => r.json()).then(openQuiz).catch(() => {});
    $liveStatus.textContent = 'na żywo';
    $liveStatus.dataset.state = 'ok';
  };
  es.onerror = () => {
    $liveStatus.textContent = 'rozłączono — ponawiam';
    $liveStatus.dataset.state = 'error';
  };
  es.addEventListener('quiz', (e) => openQuiz(JSON.parse(e.data)));
  es.addEventListener('quiz-closed', (e) => {
    const { id } = JSON.parse(e.data);
    if (nextQuiz?.id === id) nextQuiz = null;
    // Closed elsewhere (skipped, timed out) — hide the dialog unless the result is being shown right now.
    if (quiz?.data.id === id && !quiz.result && !quiz.sending) closeQuiz();
  });
  es.addEventListener('change', async (e) => {
    try {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
      await load();
      if (route().view === 'chat') { studio.data(state.data); return; }
      if (route().view === 'studio') { refreshTerminalPanel(); return; } // the terminal is not redrawn
      if (route().view === 'files' && featureEnabled('pliki')) { loadFiles(route().arg); return; } // no scroll jump
      await render({ keepScroll: true });
      const t = route();
      if (t.view === 'lessons' && t.arg && atBottom) document.getElementById('lesson-end')?.scrollIntoView();
      const { files = [] } = JSON.parse(e.data || '{}');
      const shown = files.filter((p) => !/(^|\/)\./.test(p)).slice(0, 2);
      notify(shown.length ? `Zaktualizowano: ${shown.join(', ')}${files.length > 2 ? '…' : ''}` : 'Zaktualizowano dane');
      $content.classList.remove('refreshed');
      void $content.offsetWidth;
      $content.classList.add('refreshed');
    } catch (err) {
      notify(`Nie udało się odświeżyć: ${err.message}`);
    }
  });
}

// ---------- start ----------
window.addEventListener('hashchange', async () => {
  await render();
  window.scrollTo(0, 0);
  if (route().view === 'lessons' && route().arg) document.getElementById('lesson-end')?.scrollIntoView();
  if (route().view === 'sessions' && route().arg) document.getElementById(`session-${route().arg}`)?.scrollIntoView();
});
try {
  await load();
  await render();
} catch (e) {
  $content.innerHTML = `<p class="empty">Nie udało się wczytać danych: ${esc(e.message)}. Czy serwer działa (<code>npm start</code>)?</p>`;
}
connectLive();
fetch('/api/quiz/active').then((r) => r.json()).then(openQuiz).catch(() => {});

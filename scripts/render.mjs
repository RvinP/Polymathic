#!/usr/bin/env node
// Renders a drawing to PNG so it can be LOOKED AT before it is shown to the learner.
// Uses a Chromium-family browser that is already installed (Chrome, Brave, Edge, Chromium).
//
//   node scripts/render.mjs dane/lekcje/rysunki/<name>.mmd     → <name>.png (mermaid)
//   node scripts/render.mjs dane/lekcje/rysunki/<name>.svg     → <name>.png (SVG)
//   options: --theme light|dark (default light), --width 900
//
// A mermaid syntax error is printed readably (fix the source and run again).
// Point to another browser with the POLYMATHIC_CHROME=/path/to/binary variable.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { ROOT } from './lib.mjs';

const args = process.argv.slice(2);
const option = (n, fallback) => {
  const i = args.indexOf(n);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const theme = option('--theme', 'light');
const width = Number(option('--width', 900));
const input = args[0];

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
if (!['light', 'dark'].includes(theme)) fail('--theme przyjmuje light albo dark.');
if (!input || !fs.existsSync(input)) fail('Podaj istniejący plik .mmd albo .svg.');
const extension = path.extname(input).toLowerCase();
if (!['.mmd', '.svg'].includes(extension)) fail('Obsługuję tylko .mmd (mermaid) i .svg.');

function findBrowser() {
  const home = os.homedir();
  const candidates = [
    process.env.POLYMATHIC_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/brave-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  // Browsers from the Playwright cache (if it was ever used).
  const pw = path.join(home, 'Library/Caches/ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      candidates.push(path.join(pw, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
      candidates.push(path.join(pw, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'));
    }
  }
  return candidates.find((c) => c && fs.existsSync(c));
}

const exe = findBrowser();
if (!exe) fail('Nie znalazłem przeglądarki Chrome/Brave/Edge/Chromium. Ustaw POLYMATHIC_CHROME=/ścieżka/do/przeglądarki.');

const background = theme === 'dark' ? '#1a1f27' : '#fdfefd';
const output = input.replace(/\.(mmd|svg)$/i, '.png');
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 600, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:${background};font-family:"Avenir Next","Segoe UI",system-ui,sans-serif}
    #drawing{display:inline-block} #drawing svg{max-width:${width - 48}px;height:auto}
  </style></head><body><div id="drawing"></div></body></html>`);

  if (extension === '.mmd') {
    await page.addScriptTag({ path: path.join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js') });
    const source = fs.readFileSync(input, 'utf8').replace(/^```mermaid\s*\n|```\s*$/g, '');
    const result = await page.evaluate(async (src, dark) => {
      try {
        window.mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', securityLevel: 'strict' });
        const { svg } = await window.mermaid.render('diagram', src);
        document.getElementById('drawing').innerHTML = svg;
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }, source, theme === 'dark');
    if (!result.ok) fail(`Błąd mermaid:\n${result.error}`);
  } else {
    const svg = fs.readFileSync(input, 'utf8');
    if (!/<svg[\s>]/i.test(svg)) fail('Plik nie zawiera elementu <svg>.');
    await page.evaluate((s) => {
      document.getElementById('drawing').innerHTML = s;
    }, svg);
  }

  const el = await page.$('#drawing');
  await el.screenshot({ path: output, omitBackground: false });
  console.log(`✓ ${path.relative(ROOT, path.resolve(output))}`);
  console.log('  Obejrzyj PNG (Read) i sprawdź: poprawność, czytelność, brak nachodzących etykiet.');
} finally {
  await browser.close();
}

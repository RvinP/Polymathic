#!/usr/bin/env node
// Removes example data: files with `przyklad: true` in the frontmatter
// and the <!-- przyklad:start --> … <!-- przyklad:end --> block from dane/pytania.md.
// The profile stays (those are your settings, not an example).

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR, DIRS, readMarkdown } from './lib.mjs';

const removed = [];
const isExample = (file) => {
  try {
    return readMarkdown(file).data.przyklad === true;
  } catch {
    return false;
  }
};

for (const dir of [DIRS.concepts, DIRS.sessions]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const file = path.join(dir, f);
    if (isExample(file)) {
      fs.rmSync(file);
      removed.push(file);
    }
  }
}

if (fs.existsSync(DIRS.topics)) {
  for (const d of fs.readdirSync(DIRS.topics, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const file = path.join(DIRS.topics, d.name, 'temat.md');
    if (fs.existsSync(file) && isExample(file)) {
      fs.rmSync(path.join(DIRS.topics, d.name), { recursive: true });
      removed.push(path.dirname(file) + '/');
    }
  }
}

const questions = path.join(DATA_DIR, 'pytania.md');
if (fs.existsSync(questions)) {
  const raw = fs.readFileSync(questions, 'utf8');
  const cleaned = raw.replace(/\n?<!-- przyklad:start -->[\s\S]*?<!-- przyklad:end -->\n?/g, '\n');
  if (cleaned !== raw) {
    fs.writeFileSync(questions, cleaned.replace(/\n{3,}/g, '\n\n'));
    removed.push(`${questions} (przykładowe pytania)`);
  }
}

if (!removed.length) console.log('Brak danych przykładowych — nic do usunięcia.');
else {
  console.log('Usunięto dane przykładowe:');
  removed.forEach((p) => console.log(`  • ${path.relative(ROOT, p)}`));
}

#!/usr/bin/env node
// Pre-commit guard: searches the files that will go into the repository for private things —
// e-mail addresses, paths containing a user name, strings that look like keys, and words
// from the local .private-patterns list (one regular expression per line; the file is ignored by git).
// Runs as a hook: git config core.hooksPath .githooks (manually: node scripts/check-repo.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// No lib.mjs import: the guard must work even before npm install.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PATTERNS = [
  ['adres e-mail', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['ścieżka z nazwą użytkownika', /\/(?:Users|home)\/(?!<)[A-Za-z0-9._-]+/],
  ['wygląda na klucz/token', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/],
];
const ALLOWED = [/noreply@anthropic\.com/, /@xterm\//, /@anthropic-ai\//];

export function loadPrivatePatterns(file = path.join(ROOT, '.private-patterns')) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => ['słowo z .private-patterns', new RegExp(l, 'i')]);
}

/** Files git would track: committed + new, without ignored ones. */
export function repoFiles(root = ROOT) {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return output.split('\0').filter(Boolean).filter((p) => fs.existsSync(path.join(root, p)));
}

export function check(files, root = ROOT, patterns = [...PATTERNS, ...loadPrivatePatterns()]) {
  const findings = [];
  for (const rel of files) {
    if (rel === 'package-lock.json') continue;
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    if (text.includes('\0')) continue; // binary file
    text.split('\n').forEach((line, i) => {
      for (const [description, pattern] of patterns) {
        const m = line.match(pattern);
        if (m && !ALLOWED.some((a) => a.test(m[0]))) findings.push({ file: rel, line: i + 1, description, match: m[0] });
      }
    });
  }
  return findings;
}

if (path.resolve(process.argv[1] || '') === path.join(ROOT, 'scripts', 'check-repo.mjs')) {
  let files;
  try {
    files = repoFiles();
  } catch {
    console.error('To nie jest repozytorium git. Najpierw: git init');
    process.exit(2);
  }
  const findings = check(files);
  if (!findings.length) {
    console.log(`✓ Sprawdzono ${files.length} plików: nic prywatnego.`);
  } else {
    for (const f of findings) console.error(`✗ ${f.file}:${f.line} · ${f.description}: ${f.match}`);
    console.error(`\n${findings.length} znalezisk. Popraw je albo dopisz plik do .gitignore, zanim zrobisz commit.`);
    process.exit(1);
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prepareData, DATA_TEMPLATE_DIR } from '../scripts/lib.mjs';
import { check, PATTERNS } from '../scripts/check-repo.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polymathic-template-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

test('fresh clone: dane/ is created from the template with folders for topics and concepts', () => {
  const target = path.join(dir, 'fresh');
  const created = prepareData(target);
  assert.deepEqual(created.sort(), fs.readdirSync(DATA_TEMPLATE_DIR).sort());
  for (const k of ['tematy', 'pojecia', 'sesje', 'materialy', 'lekcje']) assert.ok(fs.statSync(path.join(target, k)).isDirectory());
  assert.match(fs.readFileSync(path.join(target, 'profil.md'), 'utf8'), /hamulec_zakresu: średni/);
});

test('existing data is never overwritten', () => {
  const target = path.join(dir, 'mine');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'profil.md'), 'MÓJ PROFIL');
  prepareData(target);
  assert.equal(fs.readFileSync(path.join(target, 'profil.md'), 'utf8'), 'MÓJ PROFIL');
  assert.ok(fs.existsSync(path.join(target, 'kategorie.md')));
});

test('the data template contains nothing private', () => {
  const files = fs.readdirSync(DATA_TEMPLATE_DIR);
  assert.deepEqual(check(files, DATA_TEMPLATE_DIR, PATTERNS), []);
});

test('the guard catches an e-mail, a user path, a token and a word from the private list', () => {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  // Patterns are assembled at runtime so the guard does not flag the test itself.
  const email = ['jan', 'example.com'].join('@'), userPath = ['', 'Users', 'jan', 'x'].join('/'), token = 'ghp' + '_' + 'a'.repeat(30);
  fs.writeFileSync(path.join(repo, 'a.md'), `kontakt: ${email}\nplik w ${userPath}\nklucz ${token}\nchcę być ekspertem od Fortranu\n`);
  fs.writeFileSync(path.join(repo, 'b.md'), 'Ścieżka /Users/<nazwa> w dokumentacji jest w porządku.\n');
  const findings = check(['a.md', 'b.md'], repo, [...PATTERNS, ['private', /fortran/i]]);
  assert.deepEqual(findings.map((x) => `${x.file}:${x.line}`).sort(), ['a.md:1', 'a.md:2', 'a.md:3', 'a.md:4']);
});

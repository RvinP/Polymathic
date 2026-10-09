import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polymathic-settings-'));
process.env.POLYMATHIC_STATE_DIR = dir;
const { server } = await import('../app/server.mjs');
const { setProfile } = await import('../scripts/lib.mjs');
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const host = `127.0.0.1:${process.env.PORT || 4321}`;
function request(url, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve) => {
    const req = Readable.from(body ? [body] : []);
    Object.assign(req, { url, method, headers: { host, ...headers } });
    let status;
    const res = { writeHead(s) { status = s; }, end(data) { resolve({ status, data: String(data || '') }); } };
    server.emit('request', req, res);
  });
}

// Profile file in the on-disk format (Polish frontmatter keys and values).
const PROFILE = `---
# Komentarz objaśniający pole
tolerancja_zagubienia: średnia
poziom_inicjatywy: 1
preferowane_analogie: [muzyka]
---

# Jak się uczę
`;

test('setProfile replaces fields, keeps comments and body, appends missing ones', () => {
  const file = path.join(dir, 'profil.md');
  fs.writeFileSync(file, PROFILE);
  const result = setProfile({ poziom_inicjatywy: '3', hamulec_zakresu: 'wysoki', preferowane_analogie: 'muzyka, ogrodnictwo' }, file);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /# Komentarz objaśniający pole/);
  assert.match(text, /# Jak się uczę/);
  assert.equal(result.poziom_inicjatywy, 3);
  assert.equal(result.hamulec_zakresu, 'wysoki');
  assert.deepEqual(result.preferowane_analogie, ['muzyka', 'ogrodnictwo']);
  assert.equal(result.tolerancja_zagubienia, 'średnia');
});

test('setProfile rejects unknown fields and values outside the list without changing the file', () => {
  const file = path.join(dir, 'profil.md');
  fs.writeFileSync(file, PROFILE);
  assert.throws(() => setProfile({ hamulec_zakresu: 'turbo' }, file), /Niedozwolona/);
  assert.throws(() => setProfile({ cokolwiek: 'x' }, file), /Nieznane pole/);
  assert.equal(fs.readFileSync(file, 'utf8'), PROFILE);
});

test('text with a newline does not inject an extra frontmatter key', () => {
  const file = path.join(dir, 'profil.md');
  fs.writeFileSync(file, PROFILE);
  const result = setProfile({ energia_typowa: 'wieczorem\npoziom_inicjatywy: 4' }, file);
  assert.equal(result.poziom_inicjatywy, 1);
  assert.equal(result.energia_typowa, 'wieczorem poziom_inicjatywy: 4');
});

test('/api/profile: writes only from the app, a bad value → 400', async () => {
  assert.equal((await request('/api/profile', { method: 'POST', body: '{"hamulec_zakresu":"wysoki"}' })).status, 403);
  const bad = await request('/api/profile', { method: 'POST', headers: { 'x-polymathic': '1' }, body: '{"hamulec_zakresu":"turbo"}' });
  assert.equal(bad.status, 400);
});

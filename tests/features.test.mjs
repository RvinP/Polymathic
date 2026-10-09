import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polymathic-features-'));
process.env.POLYMATHIC_STATE_DIR = dir;
const { server } = await import('../app/server.mjs');
const { linkIndex, loadFeatures } = await import('../scripts/lib.mjs');
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

test('"pliki" flag off: the files API does not exist (404)', async (t) => {
  process.env.POLYMATHIC_FEATURES = '-pliki';
  t.after(() => delete process.env.POLYMATHIC_FEATURES);
  assert.equal(loadFeatures().pliki, false);
  assert.equal((await request('/api/files')).status, 404);
  assert.equal((await request('/api/file?path=profil.md')).status, 404);
});

test('"pliki" flag on: tree, preview and path protection', async (t) => {
  process.env.POLYMATHIC_FEATURES = 'pliki';
  t.after(() => delete process.env.POLYMATHIC_FEATURES);
  const list = JSON.parse((await request('/api/files')).data);
  assert.ok(list.files.includes('profil.md'));
  assert.ok(list.files.every((p) => p.endsWith('.md') && !p.split('/').some((c) => c.startsWith('.'))));
  const file = await request('/api/file?path=profil.md');
  assert.equal(file.status, 200);
  assert.ok('tolerancja_zagubienia' in JSON.parse(file.data).data);
  for (const bad of ['../package.json', '../../etc/passwd', 'ustawienia.json', 'lekcje/.ukryte']) {
    assert.equal((await request(`/api/file?path=${encodeURIComponent(bad)}`)).status, 404, bad);
  }
});

test('changing a flag requires the app header and knows only defined features', async () => {
  assert.equal((await request('/api/features', { method: 'POST', body: '{"id":"pliki","enabled":true}' })).status, 403);
  const bad = await request('/api/features', { method: 'POST', headers: { 'x-polymathic': '1', origin: `http://${host}` }, body: '{"id":"does-not-exist","enabled":true}' });
  assert.equal(bad.status, 400);
});

test('[[…]] links resolve by file name, topic folder name and path', () => {
  const i = linkIndex(['tematy/procent/temat.md', 'pojecia/procent-prosty.md', 'profil.md']);
  assert.equal(i['procent-prosty'], 'pojecia/procent-prosty.md');
  assert.equal(i['procent'], 'tematy/procent/temat.md');
  assert.equal(i['pojecia/procent-prosty'], 'pojecia/procent-prosty.md');
  assert.equal(i['profil'], 'profil.md');
});

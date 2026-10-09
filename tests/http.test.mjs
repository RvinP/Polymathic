import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polymathic-http-'));
process.env.POLYMATHIC_STATE_DIR = dir;
const { server } = await import('../app/server.mjs');
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const host = `127.0.0.1:${process.env.PORT || 4321}`;
function request(url, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body ? [body] : []);
    Object.assign(req, { url, method, headers: { host, ...headers } });
    let status, responseHeaders;
    const res = { writeHead(s, h) { status = s; responseHeaders = h; }, end(data) { resolve({ status, headers: responseHeaders, data: String(data || '') }); } };
    server.emit('request', req, res);
  });
}
test('HTTP guards reject foreign host and cross-origin process launch', async () => {
  assert.equal((await request('/api/ai', { headers: { host: 'evil.example:4321' } })).status, 403);
  assert.equal((await request('/api/ai/send', { method: 'POST', headers: { origin: 'http://localhost:9999', 'x-polymathic': '1' }, body: '{"text":"codex"}' })).status, 403);
  assert.equal((await request('/api/ai/send', { method: 'POST', body: '{"text":"codex"}' })).status, 403);
});
test('API context persists, malformed payload is rejected and reset clears current context', async () => {
  const opts = body => ({ method: 'POST', headers: { 'x-polymathic': '1', origin: `http://${host}` }, body });
  assert.equal((await request('/api/ai/context', opts('not json'))).status, 400);
  const result = await request('/api/ai/context', opts(JSON.stringify({ goal: 'Cel', focus: 'Szczegół', park: true })));
  assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.data).parked, ['Szczegół']);
  assert.equal(JSON.parse((await request('/api/ai')).data).goal, 'Cel');
  const reset = await request('/api/ai/context', opts('{"reset":true}'));
  assert.equal(JSON.parse(reset.data).goal, '');
});
test('malformed URL does not crash the server and Markdown sanitizer is served', async () => {
  assert.equal((await request('/%ff')).status, 400);
  const vendor = await request('/vendor/purify.js');
  assert.equal(vendor.status, 200); assert.ok(vendor.data.includes('DOMPurify'));
});

test('shared learning state written by the CLI store is visible through both UI endpoints', async () => {
  const { createSessionStore } = await import('../scripts/session-store.mjs');
  assert.equal(JSON.parse((await request('/api/learning')).data), null);
  const store = createSessionStore();
  const s = store.update('start', { goal: 'Cel wspólny dla CLI i UI', minutes: 15 });
  const response = await request('/api/learning');
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.data).id, s.id);
  const data = JSON.parse((await request('/api/data')).data);
  assert.equal(data.learning.goal, s.goal);
  assert.equal(data.learningError, '');
  assert.equal((await request('/api/learning', { headers: { host: 'evil.example:4321' } })).status, 403);
});

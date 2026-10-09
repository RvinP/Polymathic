import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { normalizeCategory, withParents, inCategory, mergeCategories, renameCategory, afterCategoryRemoval } from '../scripts/lib.mjs';

test('category names: cleanup, subfolders and limits', () => {
  assert.equal(normalizeCategory('  Sport /  Bieganie  '), 'Sport/Bieganie');
  assert.equal(normalizeCategory('Gotowanie//Ciasta/'), 'Gotowanie/Ciasta');
  assert.equal(normalizeCategory(''), null);
  assert.equal(normalizeCategory(' / '), null);
  assert.equal(normalizeCategory('a/b/c/d'), null, 'at most 3 levels');
  assert.equal(normalizeCategory('x'.repeat(41)), null);
  assert.deepEqual(withParents('Sport/Bieganie/Maraton'), ['Sport', 'Sport/Bieganie', 'Sport/Bieganie/Maraton']);
});

test('category list merges saved ones, ones used by topics and their parents', () => {
  const list = mergeCategories(['Gotowanie'], [{ kategoria: 'Sport/Bieganie' }, { kategoria: '' }, {}]);
  assert.deepEqual(list, ['Gotowanie', 'Sport', 'Sport/Bieganie']);
});

test('membership does not confuse name prefixes', () => {
  assert.ok(inCategory('Sport/Bieganie', 'Sport'));
  assert.ok(inCategory('Sport', 'Sport'));
  assert.ok(!inCategory('Sporty', 'Sport'), '"Sporty" is not a subcategory of "Sport"');
  assert.ok(!inCategory('', 'Sport'));
});

test('rename covers subcategories and can move a folder', () => {
  assert.equal(renameCategory('Sport/Bieganie', 'Sport', 'Aktywność'), 'Aktywność/Bieganie');
  assert.equal(renameCategory('Bieganie', 'Bieganie', 'Sport/Bieganie'), 'Sport/Bieganie');
  assert.equal(renameCategory('Sporty', 'Sport', 'X'), 'Sporty');
});

test('removing a category moves topics one level up, nothing is lost', () => {
  assert.equal(afterCategoryRemoval('Sport/Bieganie', 'Sport/Bieganie'), 'Sport');
  assert.equal(afterCategoryRemoval('Sport/Bieganie/Maraton', 'Sport/Bieganie'), 'Sport/Maraton');
  assert.equal(afterCategoryRemoval('Sport', 'Sport'), null, 'no category');
  assert.equal(afterCategoryRemoval('Sport/Bieganie', 'Sport'), 'Bieganie');
  assert.equal(afterCategoryRemoval('Gotowanie', 'Sport'), 'Gotowanie');
});

test('categories API requires the app header and rejects bad input without writing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polymathic-cat-'));
  process.env.POLYMATHIC_STATE_DIR = dir;
  const { server } = await import('../app/server.mjs');
  const host = `127.0.0.1:${process.env.PORT || 4321}`;
  const request = (url, body, headers = {}) => new Promise((resolve) => {
    const req = Readable.from([body]);
    Object.assign(req, { url, method: 'POST', headers: { host, ...headers } });
    let status;
    server.emit('request', req, { writeHead(s) { status = s; }, end() { resolve(status); } });
  });
  const app = { 'x-polymathic': '1', origin: `http://${host}` };
  assert.equal(await request('/api/categories', '{"action":"add","name":"Sport"}'), 403);
  assert.equal(await request('/api/categories', '{"action":"add","name":" / "}', app), 400);
  assert.equal(await request('/api/categories', '{"action":"remove","name":"no-such-category-xyz"}', app), 404);
  assert.equal(await request('/api/topics/category', '{"slug":"../../etc","category":"Sport"}', app), 400);
  fs.rmSync(dir, { recursive: true, force: true });
});

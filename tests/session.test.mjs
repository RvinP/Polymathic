import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planSession, recordAttempt, sessionView } from '../scripts/session-core.mjs';
import { createSessionStore } from '../scripts/session-store.mjs';
const now = new Date('2026-10-07T10:00:00Z');
const concepts = [
  { slug: 'a', nazwa: 'A', temat: 'x', zalezy_od: [], fsrs: { due: '2026-10-07', stability: 5 } },
  { slug: 'b', nazwa: 'B', temat: 'x', zalezy_od: ['a'], fsrs: { due: '2026-10-07', stability: 5 } },
  { slug: 'c', nazwa: 'C', temat: 'y', zalezy_od: [], fsrs: { due: '2026-10-07', stability: 5 } },
  { slug: 'd', nazwa: 'D', temat: 'x', zalezy_od: ['b'] },
];
const plan = () => planSession({ goal: 'Zastosować zasady', mode: 'review', minutes: 15 }, concepts, concepts.filter(c => c.fsrs), now);
const attempt = (s, n, evidence, taskId = 't1') => recordAttempt(s, { sessionId: s.id, id: `answer-${n}`, taskId, question: 'Co się stanie i dlaczego?', answer: 'Odpowiedź człowieka.', evidence }, now);
const evidence = (concept, outcome, helpUsed = false) => ({ concept, outcome, helpUsed, reason: 'Konkretny zaobserwowany krok rozumowania.' });

test('review combines graph neighbors, bounds tasks and never adds future concepts', () => {
  const s = plan();
  assert.deepEqual(s.tasks.map(t => t.concepts), [['a', 'b'], ['c']]);
  assert.equal(s.tasks[0].kind, 'connect');
  assert.ok(s.tasks.length <= 3);
  assert.equal(planSession({ goal: 'Krótko', minutes: 5 }, concepts, [], now).tasks.length, 1);
  assert.throws(() => planSession({ goal: 'Pusto', mode: 'review' }, [], [], now), /Brak pojęć/);
});
test('new components get an example; no concept cards means orientation, not invented mastery', () => {
  const newConcepts = concepts.map(({ fsrs, ...p }) => p);
  assert.ok(planSession({ goal: 'Nowy temat' }, newConcepts, [], now).tasks.every(t => t.kind === 'example'));
  const s = planSession({ goal: 'Nieznany temat' }, [], [], now);
  assert.equal(s.tasks[0].kind, 'orient');
  assert.deepEqual(s.tasks[0].concepts, []);
});
test('help cannot become independent success; partial evidence does not complete a combined task', () => {
  let s = attempt(plan(), 1, [evidence('a', 'independent', true)]);
  assert.equal(s.attempts[0].evidence[0].outcome, 'assisted');
  assert.equal(s.tasks[0].status, 'pending');
  assert.equal(sessionView(s, now).action, 'new-example');
  s = attempt(s, 2, [evidence('a', 'independent'), evidence('b', 'independent')]);
  assert.equal(s.tasks[0].status, 'done');
  assert.equal(sessionView(s, now).next.id, 't2');
});
test('two unsuccessful tries park the gap, block downstream tasks and select independent material', () => {
  let s = planSession({ goal: 'Przejść dalej' }, [concepts[0], concepts[3], concepts[2]], [], now);
  s = attempt(s, 1, [evidence('a', 'not_yet')]);
  s = attempt(s, 2, [evidence('a', 'not_yet')]);
  // Include transitive dependencies even if an intermediate concept is not one of the tasks.
  s.dependencies.b = ['a'];
  const v = sessionView(s, now);
  assert.equal(s.tasks[0].status, 'parked');
  assert.equal(v.next.id, 't3');
  assert.deepEqual(v.blocked, ['t2']);
  assert.equal(v.action, 'explain-and-switch');
  assert.throws(() => attempt(s, 3, [evidence('a', 'not_yet')]), /zamknięte/);
  assert.throws(() => attempt(s, 4, [evidence('d', 'not_yet')], 't2'), /zależy/);
});
test('duplicate retries do not count twice and stale sessions cannot write evidence', () => {
  const s = attempt(plan(), 1, [evidence('a', 'not_yet')]);
  assert.deepEqual(attempt(s, 1, [evidence('a', 'not_yet')]), s);
  assert.throws(() => recordAttempt(s, { sessionId: 'different' }), /zmieniła/);
  assert.throws(() => attempt(s, 2, [evidence('c', 'independent')]), /nie pasuje/);
});
test('time budget prompts a wrap without marking untested tasks as complete', () => {
  const s = plan();
  const v = sessionView(s, new Date(+now + 16 * 60000));
  assert.equal(v.action, 'wrap');
  assert.equal(v.next, null);
  assert.equal(v.completed, 0);
  assert.equal(s.endedAt, null);
});
test('restart preserves exact answer and next step; a new session archives the previous one without FSRS mutations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polymathic-session-'));
  try {
    const before = JSON.stringify(concepts);
    const opts = { directory, concepts: () => concepts, topics: () => [], due: () => concepts.filter(c => c.fsrs), clock: () => now };
    const store = createSessionStore(opts);
    const s = store.update('start', { goal: 'Zastosować', mode: 'review' });
    assert.throws(() => store.update('start', { goal: 'Inny' }), /już trwa/);
    store.update('attempt', { sessionId: s.id, id: '1', taskId: 't1', question: 'Dlaczego?', answer: 'Moje dokładne słowa: `x` i $y.', evidence: [evidence('a', 'assisted', true)] });
    const resumed = createSessionStore(opts);
    assert.equal(resumed.status().attempts[0].answer, 'Moje dokładne słowa: `x` i $y.');
    resumed.update('finish', { sessionId: s.id, nextStep: 'Nowy kontekst bez podpowiedzi.' });
    assert.equal(createSessionStore(opts).status().nextStep, 'Nowy kontekst bez podpowiedzi.');
    resumed.update('start', { goal: 'Kolejny krok' });
    const old = JSON.parse(fs.readFileSync(path.join(directory, 'learning-history', `${s.id}.json`)));
    assert.equal(old.attempts.length, 1);
    assert.equal(old.nextStep, 'Nowy kontekst bez podpowiedzi.');
    assert.equal(JSON.stringify(concepts), before);
    assert.ok(!fs.readdirSync(directory).some(name => name.endsWith('.tmp') || name.endsWith('.lock')));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('corrupt saved data is not silently overwritten', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polymathic-session-corrupt-'));
  try {
    const file = path.join(directory, 'learning-session.json');
    fs.writeFileSync(file, 'broken');
    const store = createSessionStore({ directory });
    assert.throws(() => store.update('start', { goal: 'Nowy cel' }), /nietknięty/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'broken');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('the next lesson prioritizes untested material and retains previous evidence and unfinished work', () => {
  const input = ['a','b','c','d'].map(slug => ({ slug, nazwa: slug, zalezy_od: [] }));
  let first = planSession({ goal: 'Pierwszy krok', minutes: 5 }, input, [], now);
  first = attempt(first, 1, [evidence('a', 'independent')]);
  first.endedAt = now.toISOString(); first.nextStep = 'Zastosować B.';
  const second = planSession({ goal: 'Dalszy ciąg', minutes: 5 }, input, [], now, first);
  assert.deepEqual(second.tasks[0].concepts, ['b']);
  assert.equal(second.memory.a.outcome, 'independent');
  assert.equal(second.carryover.nextStep, 'Zastosować B.');
});
test('a later contradiction is not hidden by an earlier partial success', () => {
  let s = attempt(plan(), 1, [evidence('a', 'independent')]);
  s = attempt(s, 2, [evidence('a', 'not_yet'), evidence('b', 'independent')]);
  assert.equal(s.tasks[0].status, 'parked');
  assert.deepEqual(s.parked[0].concepts, ['a']);
  assert.equal(s.memory.a.outcome, 'not_yet');
});

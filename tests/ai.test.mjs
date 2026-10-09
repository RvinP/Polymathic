import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createAI, cliArgs, readEvent } from '../app/ai.mjs';
import { connectedGroups, suggestedAxis } from '../scripts/lib.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polymathic-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let child, input = '', call;
  const options = { stateDir: path.join(dir, 'state'), lessonsDir: path.join(dir, 'lessons'), spawnProcess: (exe, args, opts) => {
    call = { exe, args, opts }; input = '';
    child = new EventEmitter(); child.pid = undefined;
    child.stdin = new Writable({ write(chunk, encoding, next) { input += chunk; next(); } });
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { setImmediate(() => child.emit('close', null)); return true; };
    return child;
  } };
  const ai = createAI(options);
  return { ai, options, dir, child: () => child, input: () => input, call: () => call };
}
test('CLI is whitelisted and executes without shell interpolation', t => {
  const f = fixture(t);
  assert.throws(() => f.ai.start({ text: 'hi', provider: 'codex; touch /tmp/x' }));
  assert.equal(f.ai.snapshot().messages.length, 0);
  f.ai.start({ text: '$(touch /tmp/x)', provider: 'codex' });
  assert.equal(f.call().opts.shell, false);
  assert.ok(!f.call().args.some(a => a.includes('touch')));
  assert.ok(f.input().includes('$(touch /tmp/x)'));
  assert.ok(cliArgs('codex').includes('workspace-write'));
  const added = f.call().args.indexOf('--add-dir');
  assert.equal(f.call().args[added + 1], f.options.stateDir);
  assert.equal(f.call().opts.env.POLYMATHIC_SESSION_DIR, f.options.stateDir);
  f.child().emit('close', 1);
});
test('full conversation, goal and parked threads persist across process restarts and providers', t => {
  const f = fixture(t);
  f.ai.update({ goal: 'Zrozumieć fotosyntezę', focus: 'faza jasna' }); f.ai.update({ park: true });
  f.ai.start({ text: 'Skąd roślina bierze energię?', provider: 'codex' });
  assert.throws(() => f.ai.start({ text: 'second' }));
  assert.throws(() => f.ai.update({ reset: true }));
  const line = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Odpowiedź' } });
  f.child().stdout.write(line.slice(0, 15)); f.child().stdout.write(line.slice(15)); f.child().emit('close', 0);
  assert.equal(f.ai.snapshot().messages.length, 2);
  const restored = createAI(f.options);
  assert.equal(restored.snapshot().running, false);
  restored.start({ text: 'A w nocy?', provider: 'claude' });
  assert.ok(f.input().includes('Odpowiedź')); assert.ok(f.input().includes('faza jasna')); assert.ok(f.input().includes('Zrozumieć fotosyntezę'));
  f.child().stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Druga' }] } }) + '\n'); f.child().emit('close', 0);
  const oldID = restored.snapshot().id; restored.update({ reset: true });
  assert.notEqual(restored.snapshot().id, oldID);
  assert.equal(restored.snapshot().messages.length, 0);
  assert.ok(fs.readFileSync(path.join(f.dir, 'lessons', `polymathic-${oldID}.md`), 'utf8').includes('Druga'));
});
test('missing CLI yields recoverable error and preserves user message', t => {
  const f = fixture(t); f.ai.start({ text: 'Pytanie' });
  f.child().emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
  assert.match(f.ai.snapshot().error, /Nie znaleziono codex/); assert.equal(f.ai.snapshot().running, false);
  assert.equal(f.ai.snapshot().messages[0].text, 'Pytanie');
});
test('stop releases session only after process exits', async t => {
  const f = fixture(t); f.ai.start({ text: 'Pytanie' }); f.ai.stop();
  assert.equal(f.ai.snapshot().running, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.ai.snapshot().running, false); assert.match(f.ai.snapshot().error, /Zatrzymano/);
});
test('provider failure and tool output are not mistaken for a teacher answer', () => {
  assert.equal(readEvent('codex', { type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'secret' } }).text, undefined);
  assert.equal(readEvent('claude', { type: 'result', is_error: true, errors: ['Denied'] }).error, 'Denied');
});
test('mixed groups keep due concepts unique and supplemental concepts ungraded', () => {
  const groups = connectedGroups([
    { slug: 'a', related: [{ slug: 'b' }] }, { slug: 'b', related: [{ slug: 'a' }] },
    { slug: 'c', related: [{ slug: 'outside' }] },
  ]);
  assert.deepEqual(groups, [{ concepts: ['a','b'], extra: [] }, { concepts: ['c'], extra: ['outside'] }]);
  assert.ok(suggestedAxis({ fsrs: { stability: 0 }, osie_uzyte: [] }).unlocked.includes('polaczenie'));
});
test('a large dependency chain becomes bounded mixed exercises', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ slug: String(i), related: [i-1,i+1].filter(n => n >= 0 && n < 9).map(n => ({ slug: String(n) })) }));
  const groups = connectedGroups(items);
  assert.ok(groups.every(g => g.concepts.length <= 3));
  assert.equal(new Set(groups.flatMap(g => g.concepts)).size, 9);
});
test('structured activities survive commentary, persist hints, and downgrade assisted attempts', t => {
  const f = fixture(t);
  const card = {kind:'challenge',title:'Podróż',body:'Jedź',question:'Jak?',hints:['Pierwsza','Druga'],goal:'Cel',focus:'Prędkość',concepts:['droga'],outcome:'none',takeaway:'',park:''};
  f.ai.start({text:'Zacznij'});
  f.child().stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Czytam źródła.'}})+'\n');
  f.child().stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(card)}})+'\n');
  f.child().emit('close',0);
  assert.equal(f.ai.snapshot().messages.at(-1).card.title,'Podróż');
  assert.deepEqual(f.ai.snapshot().messages.at(-1).card.hints,[]);
  assert.deepEqual(f.ai.hint().messages.at(-1).card.hints,['Pierwsza']);
  f.ai.start({text:'Moja próba',intent:'answer'});
  assert.ok(f.input().includes('hintsUsed'));
  f.child().stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({...card,kind:'feedback',outcome:'independent'})}})+'\n');
  f.child().emit('close',0);
  assert.equal(f.ai.snapshot().messages.at(-1).card.outcome,'assisted');
  assert.equal(f.ai.snapshot().learning.next,'new-independent-example');
});
test('Claude structured_output is used even without a text answer', t => {
  const f=fixture(t); f.ai.start({text:'Wstęp',provider:'claude'});
  const card={kind:'explain',title:'Model',body:'Wyjaśnienie',question:'',hints:[],goal:'Cel',focus:'Model',concepts:[],outcome:'none',takeaway:'',park:''};
  f.child().stdout.write(JSON.stringify({type:'result',is_error:false,structured_output:card})+'\n');
  f.child().emit('close',0);
  assert.equal(f.ai.snapshot().error,'');
  assert.equal(f.ai.snapshot().messages.at(-1).card.title,'Model');
});

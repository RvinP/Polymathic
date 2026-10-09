import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { activitySchema, parseActivity, publicMessage, learningState } from '../app/learning.mjs';
const card = { kind:'challenge', title:'Problem', body:'Samodzielna próba', question:'Dlaczego?', hints:['Uwaga','Fragment','Analogia'], goal:'Cel', focus:'Proporcje', concepts:['proporcje','droga'], outcome:'none', takeaway:'', park:'' };
test('output schema and runtime contract stay in sync', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../app/activity.schema.json', import.meta.url))),activitySchema);
  assert.equal(parseActivity('not json'),null);
  assert.equal(parseActivity({...card,hints:[7]}),null);
  assert.equal(parseActivity({...card,kind:'invented'}),null);
});
test('unrequested hints and concept labels cannot leak through public activity payload', () => {
  const message = {role:'assistant',text:'Problem',card,hintsUsed:0};
  const view = publicMessage(message);
  assert.deepEqual(view.card.hints,[]); assert.deepEqual(view.card.concepts,[]);
  assert.equal(view.card.hintCount,3);
  assert.deepEqual(publicMessage({...message,hintsUsed:1}).card.hints,['Uwaga']);
  assert.equal(card.hints.length,3);
});
test('retrieval activity cannot carry an early takeaway or grade', () => {
  const result = parseActivity({...card,takeaway:'Rozwiązanie',outcome:'independent'});
  assert.equal(result.takeaway,''); assert.equal(result.outcome,'none');
});
test('learning state tracks two unsuccessful attempts without resetting on an explanation', () => {
  const messages = [{card:{...card,kind:'feedback',outcome:'not_yet'}},{card:{...card,kind:'explain'}},{card:{...card,kind:'feedback',outcome:'not_yet'}}];
  assert.equal(learningState(messages).stalled,2);
  assert.equal(learningState(messages).next,'explain-and-switch');
  assert.equal(learningState([...messages,{card:{...card,kind:'feedback',outcome:'independent'}}]).next,'transfer-or-connect');
  assert.equal(learningState([...messages,{card:{...card,kind:'feedback',outcome:'assisted'}}]).next,'new-independent-example');
});

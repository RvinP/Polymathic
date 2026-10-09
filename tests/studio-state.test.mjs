import test from 'node:test';
import assert from 'node:assert/strict';
import { answerFor, draftStore } from '../app/public/studio-state.js';
test('feedback stays attached to the answer it evaluated while a new message is pending',()=>{
 const answer={role:'user',text:'Moja odpowiedź'}, feedback={role:'assistant'}, next={role:'user',text:'Dalej'};
 assert.equal(answerFor([answer,feedback,next],feedback),answer);
 assert.equal(answerFor([feedback],feedback),null);
});
test('a draft survives reload only in its own learning session',()=>{
 const values=new Map(); const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const draft=draftStore(storage);draft.write('lesson-a','Moje rozumowanie');
 assert.equal(draftStore(storage).read('lesson-a'),'Moje rozumowanie');
 assert.equal(draft.read('lesson-b'),'');
 draft.write('lesson-a','');assert.equal(draft.read('lesson-a'),'');
});
test('disabled browser storage never prevents answering',()=>{
 const draft=draftStore(undefined);draft.write('lesson','text');assert.equal(draft.read('lesson'),'');
});

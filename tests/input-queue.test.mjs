import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputQueue } from '../app/public/input-queue.js';
function fixture() {
  const output=[], tasks=new Map(); let id=0, connected=true;
  const queue=createInputQueue({send:s=>output.push(s),ready:()=>connected,schedule:f=>{tasks.set(++id,f);return id;},cancel:id=>tasks.delete(id)});
  const tick=()=>{const first=tasks.entries().next().value;if(first){tasks.delete(first[0]);first[1]();}};
  return {queue,output,tick,disconnect:()=>{connected=false;},connect:()=>{connected=true;},drain:()=>{for(let i=0;tasks.size&&i<20;i++)tick();}};
}
test('two slash commands are submitted sequentially, never pasted together',()=>{
 const f=fixture();f.queue.add('/status\r');f.queue.add('/powtorka\r');f.drain();
 assert.deepEqual(f.output,['/status','\r','\r','/powtorka','\r','\r']);
});
test('manual typing or a new session cancels all delayed Enter keys',()=>{
 const f=fixture();f.queue.add('/status\r');f.queue.add('/powtorka\r');f.queue.clear();f.drain();
 assert.deepEqual(f.output,['/status']);
});
test('connection loss does not submit an old prompt into a reconnected session',()=>{
 const f=fixture();f.queue.add('Problem\r');f.disconnect();f.tick();f.connect();f.drain();
 assert.deepEqual(f.output,['Problem']);
});
test('startup can wait for readiness without losing or duplicating a command',()=>{
 const f=fixture();f.disconnect();f.queue.add('/nauka ');f.queue.flush();assert.deepEqual(f.output,[]);
 f.connect();f.queue.flush();f.drain();assert.deepEqual(f.output,['/nauka ']);
});

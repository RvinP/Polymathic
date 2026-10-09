#!/usr/bin/env node
// Teacher-facing tool: the learner never has to fill out this JSON.
import { createSessionStore } from './session-store.mjs';
const store = createSessionStore();
try {
  const operation = process.argv[2] || 'status';
  if (operation === 'status') console.log(JSON.stringify(store.status(), null, 2));
  else {
    if (!['start', 'attempt', 'finish'].includes(operation)) throw new Error('Użycie: session.mjs status | start | attempt | finish. Zapis przyjmuje JSON ze stdin.');
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 64000) throw new Error('Za duży zapis sesji.');
    }
    console.log(JSON.stringify(store.update(operation, JSON.parse(raw)), null, 2));
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT, loadConcepts, loadTopics, dueToday } from './lib.mjs';
import { planSession, recordAttempt, sessionView } from './session-core.mjs';

export const sessionDirectory = () => process.env.POLYMATHIC_SESSION_DIR || path.join(process.env.POLYMATHIC_STATE_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'Polymathic'), createHash('sha256').update(ROOT).digest('hex').slice(0, 12));
export function createSessionStore({ directory = sessionDirectory(), concepts = loadConcepts, topics = loadTopics, due = dueToday, clock = () => new Date() } = {}) {
  const file = path.join(directory, 'learning-session.json');
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw new Error('Nie można odczytać planu sesji. Zapis pozostaje nietknięty.', { cause: e }); }
  };
  const atomic = (target, value) => {
    const tmp = `${target}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, target); }
    finally { fs.rmSync(tmp, { force: true }); }
  };
  function update(operation, payload = {}) {
    fs.mkdirSync(directory, { recursive: true });
    const lock = `${file}.lock`;
    // Commands are short and synchronous. A crashed writer cannot keep the lock forever.
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (pid > 0) { try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') fs.rmSync(lock, { force: true }); } }
    }
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch { throw new Error('Trwa zapis sesji. Spróbuj ponownie.'); }
    try {
      fs.writeFileSync(fd, String(process.pid));
      const current = read();
      let next;
      if (operation === 'start') {
        if (current && !current.endedAt) throw new Error('Sesja już trwa. Kontynuuj ją albo najpierw zakończ.');
        const all = concepts();
        const topic = payload.topic ? topics().find(t => t.slug === payload.topic && !t.error) : null;
        if (payload.topic && !topic) throw new Error('Nie znaleziono tematu.');
        next = planSession({ ...payload, goal: payload.goal || topic?.cel || topic?.tytul || (payload.mode === 'review' ? 'Zastosować materiał z powtórek w nowych sytuacjach' : '') }, all, due(clock(), all), clock(), current);
        if (current) {
          const archive = path.join(directory, 'learning-history');
          fs.mkdirSync(archive, { recursive: true });
          atomic(path.join(archive, `${current.id}.json`), current);
        }
      } else if (operation === 'attempt') next = recordAttempt(current, payload, clock());
      else if (operation === 'finish') {
        if (!current || payload.sessionId !== current.id) throw new Error('Sesja zmieniła się. Odczytaj status ponownie.');
        const nextStep = typeof payload.nextStep === 'string' ? payload.nextStep.trim().slice(0, 2000) : '';
        if (!nextStep) throw new Error('Zapisz jeden konkretny następny krok.');
        next = current.endedAt ? current : { ...current, endedAt: clock().toISOString(), nextStep };
      } else throw new Error('Nieznana operacja sesji.');
      atomic(file, next);
      return sessionView(next, clock());
    } finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }); }
  }
  return { status: () => sessionView(read(), clock()), update };
}

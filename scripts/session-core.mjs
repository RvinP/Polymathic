// A bounded plan and observed evidence. This module never changes FSRS or claims mastery.
import { randomUUID } from 'node:crypto';

const text = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const linked = (a, b) => (a.zalezy_od || []).includes(b.slug) || (b.zalezy_od || []).includes(a.slug);

export function planSession({ goal, topic = '', mode = 'learn', minutes = 15 } = {}, concepts = [], due = [], now = new Date(), previous = null) {
  if (!['learn', 'review'].includes(mode)) throw new Error('Nieznany tryb sesji.');
  goal = text(goal, 500);
  if (!goal) throw new Error('Podaj konkretny cel sesji.');
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 60) throw new Error('Czas sesji: 5–60 minut.');
  topic = text(topic, 120);
  const known = concepts.filter(p => !p.error);
  const bySlug = new Map(known.map(p => [p.slug, p]));
  const eligible = mode === 'review'
    ? due.map(p => bySlug.get(p.slug)).filter(Boolean).filter(p => !topic || p.temat === topic)
    : known.filter(p => !topic || p.temat === topic);
  const memory = structuredClone(previous?.memory || {});
  const depth = (p, visited = new Set()) => {
    if (visited.has(p.slug)) return 0;
    const branch = new Set([...visited, p.slug]);
    return 1 + Math.max(0, ...(p.zalezy_od || []).map(slug => bySlug.has(slug) ? depth(bySlug.get(slug), branch) : 0));
  };
  const remaining = mode === 'learn' ? [...eligible].sort((a, b) =>
    Number(memory[a.slug]?.outcome === 'independent') - Number(memory[b.slug]?.outcome === 'independent') || depth(a) - depth(b)) : [...eligible];
  const tasks = [];
  const limit = Math.min(4, Math.max(1, Math.floor(minutes / 4)));
  while (remaining.length && tasks.length < limit) {
    const first = remaining.shift();
    const group = [first];
    // Connect only previously encountered components. Unknown components need an example first.
    for (const other of [...remaining]) {
      if (group.length === 3) break;
      if (first.fsrs && other.fsrs && group.some(p => linked(p, other))) {
        group.push(other); remaining.splice(remaining.indexOf(other), 1);
      }
    }
    tasks.push({ id: `t${tasks.length + 1}`, kind: group.length > 1 ? 'connect' : first.fsrs ? 'transfer' : 'example',
      concepts: group.map(p => p.slug), title: group.map(p => p.nazwa || p.slug).join(' + '), status: 'pending' });
  }
  if (!tasks.length && mode === 'learn') tasks.push({ id: 't1', kind: 'orient', concepts: [], title: goal, status: 'pending' });
  if (!tasks.length) throw new Error('Brak pojęć do powtórki w tym zakresie.');
  return { version: 1, id: randomUUID(), goal, topic, mode, minutes, startedAt: now.toISOString(), endedAt: null,
    tasks, attempts: [], parked: [], memory, carryover: previous ? { goal: previous.goal, nextStep: previous.nextStep, parked: previous.parked } : null, nextStep: '', dependencies: Object.fromEntries(known.map(p => [p.slug, p.zalezy_od || []])) };
}

export function sessionView(session, now = new Date()) {
  if (!session) return null;
  const blocked = new Set(session.parked.flatMap(p => p.concepts));
  let changed;
  do {
    changed = false;
    for (const [slug, parents] of Object.entries(session.dependencies)) {
      if (!blocked.has(slug) && parents.some(p => blocked.has(p))) { blocked.add(slug); changed = true; }
    }
  } while (changed);
  const next = session.tasks.find(t => t.status === 'pending' && !t.concepts.some(c => blocked.has(c)));
  const elapsed = Math.max(0, (now - new Date(session.startedAt)) / 60000);
  const budgetReached = elapsed >= session.minutes;
  const last = session.attempts.at(-1);
  const stalled = last && session.tasks.find(t => t.id === last.taskId)?.status === 'parked';
  const action = session.endedAt ? 'finished' : budgetReached || !next ? 'wrap' : stalled ? 'explain-and-switch' : last?.evidence.some(e => e.outcome === 'assisted') && next.id === last.taskId ? 'new-example' : 'continue';
  return { ...session, next: session.endedAt || budgetReached ? null : next || null, action, budgetReached,
    completed: session.tasks.filter(t => t.status === 'done').length,
    blocked: session.tasks.filter(t => t.status === 'pending' && t.concepts.some(c => blocked.has(c))).map(t => t.id),
    elapsedMinutes: Math.floor(elapsed) };
}

export function recordAttempt(session, input, now = new Date()) {
  if (!session || session.endedAt) throw new Error('Brak aktywnej sesji.');
  if (input.sessionId !== session.id) throw new Error('Sesja zmieniła się. Odczytaj status ponownie.');
  const id = text(input.id, 120);
  if (!id) throw new Error('Próba wymaga unikalnego id.');
  if (session.attempts.some(a => a.id === id)) return session; // safe retry, no double evidence
  const task = session.tasks.find(t => t.id === input.taskId);
  if (!task || task.status !== 'pending') throw new Error('To zadanie jest zamknięte lub nie istnieje.');
  if (sessionView(session, now).blocked.includes(task.id)) throw new Error('Zadanie zależy od odłożonej podstawy. Wybierz niezależny wątek.');
  const question = text(input.question), answer = text(input.answer, 8000);
  if (!question || !answer) throw new Error('Zapisz zadanie i rzeczywistą odpowiedź człowieka.');
  if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > 3) throw new Error('Podaj 1–3 dowody, osobno dla każdego sprawdzonego pojęcia.');
  const seen = new Set();
  const evidence = input.evidence.map(e => {
    const concept = text(e.concept, 120);
    if ((!task.concepts.includes(concept) && !(task.concepts.length === 0 && concept === 'orientation')) || seen.has(concept)) throw new Error('Dowód nie pasuje do zadania lub jest powtórzony.');
    seen.add(concept);
    if (!['independent', 'assisted', 'not_yet'].includes(e.outcome) || !text(e.reason)) throw new Error('Wymagany wynik i uzasadnienie dowodu.');
    if (typeof e.helpUsed !== 'boolean') throw new Error('Zaznacz, czy udzielono pomocy.');
    return { concept, outcome: e.helpUsed && e.outcome === 'independent' ? 'assisted' : e.outcome, helpUsed: e.helpUsed, reason: text(e.reason) };
  });
  const next = structuredClone(session);
  next.attempts.push({ id, taskId: task.id, question, answer, evidence, at: now.toISOString() });
  const updated = next.tasks.find(t => t.id === task.id);
  const trials = next.attempts.filter(a => a.taskId === task.id);
  const targets = task.concepts.length ? task.concepts : ['orientation'];
  const latest = Object.fromEntries(trials.flatMap(a => a.evidence.map(e => [e.concept, e])));
  for (const e of evidence) if (e.concept !== 'orientation') next.memory[e.concept] = { outcome: e.outcome, at: now.toISOString(), reason: e.reason };
  const independentlyShown = targets.every(c => latest[c]?.outcome === 'independent');
  if (independentlyShown) updated.status = 'done';
  else if (trials.length >= 2) {
    updated.status = 'parked';
    const gaps = targets.filter(c => latest[c]?.outcome !== 'independent');
    next.parked.push({ taskId: task.id, concepts: gaps.filter(c => c !== 'orientation'), title: task.title,
      reason: evidence.filter(e => gaps.includes(e.concept)).map(e => e.reason).join(' ') || 'Brak samodzielnego dowodu dla części zadania.' });
  }
  return next;
}

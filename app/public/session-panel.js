export function renderSessionPanel(session, esc, error = '') {
  if (error) return `<p role="alert">${esc(error)}</p>`;
  if (!session) return `<p class="quiet">Jeden cel. Jedno zadanie naraz.</p>`;
  const ended = !!session.endedAt;
  const outcomes = { independent: 'Samodzielnie', assisted: 'Z pomocą', not_yet: 'Jeszcze nie' };
  const command = 'Przeczytaj .claude/skills/sesja/SKILL.md i node scripts/session.mjs status. Kontynuuj zapisany cel od następnego kroku. Wykorzystaj dowody z poprzednich prób; nie zaczynaj diagnozy od początku.';
  return `<div class="session-focus">
    <span class="session-eyebrow">${ended ? 'Ostatnia sesja' : 'Cel tej sesji'}</span>
    <p class="session-goal">${esc(session.goal)}</p>
    <div class="session-track" role="img" aria-label="${session.completed} z ${session.tasks.length} zadań z samodzielnym dowodem">${session.tasks.map(t => `<span data-state="${esc(t.status)}"></span>`).join('')}</div>
    <p class="quiet">${session.completed} / ${session.tasks.length} sprawdzone samodzielnie${session.parked.length ? ` · ${session.parked.length} odłożone` : ''}</p>
    ${ended ? `<p>${esc(session.nextStep)}</p>` : session.action === 'wrap' ? '<p class="session-notice">Pora podsumować i zapisać następny krok.</p>' : session.action === 'explain-and-switch' ? '<p class="session-notice">Wyjaśnienie luki → niezależny wątek.</p>' : ''}
    ${!ended ? `<button type="button" class="button" data-prompt="${esc(session.action === 'wrap' ? 'Zakończ sesję nauki: odczytaj session.mjs status, podsumuj rzeczywiste dowody i zapisz finish z konkretnym następnym krokiem. Nie dodawaj kolejnego testu.' : command)}">${session.action === 'wrap' ? 'Podsumuj sesję' : 'Wróć do celu'} ↗</button>` : ''}
    ${session.attempts.length ? `<details class="session-evidence"><summary>Dowody i odłożone wątki</summary>${session.attempts.map(a => `<article><p>${esc(a.question)}</p><blockquote>${esc(a.answer)}</blockquote>${a.evidence.map(e => `<p><strong>${outcomes[e.outcome]}</strong> · ${esc(e.reason)}</p>`).join('')}</article>`).join('')}${session.parked.map(g => `<p><strong>Do powrotu:</strong> ${esc(g.reason)}</p>`).join('')}</details>` : ''}
  </div>`;
}


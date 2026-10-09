import { answerFor, draftStore } from '/studio-state.js';
const KINDS = { explain: 'Zbuduj model', challenge: 'Samodzielna próba', feedback: 'Informacja zwrotna', question: 'Punkt wyjścia', summary: 'Co zostaje z tej sesji' };
const OUTCOMES = { independent: 'Samodzielnie', assisted: 'Ze wsparciem', not_yet: 'Jeszcze do sprawdzenia' };
export function createStudio({ esc, md, renderMaps }) {
  let root, data, session, timer, draft = '', error = '', loading = false, version = 0, signature = '', contextDirty = false, shownActivity = null;
  let storage;
  try { storage = window.sessionStorage; } catch {}
  const drafts = draftStore(storage);
  let draftLoaded = false;
  const el = id => root?.querySelector(`#${id}`);
  const active = () => !!el('studio');
  const lastAI = () => [...(session?.messages || [])].reverse().find(m => m.role === 'assistant');
  async function api(route = '', body) {
    const requestVersion = ++version;
    const response = await fetch('/api/ai' + route, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Polymathic': '1' }, body: JSON.stringify(body),
    });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Uruchom ponownie npm start, aby włączyć nową wersję nauki.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Nie udało się połączyć z AI.');
    if (requestVersion === version) {
      session = result; error = '';
      if (!draftLoaded) { draftLoaded = true; draft ||= drafts.read(session.id); if (el('studio-input')) el('studio-input').value = draft; }
    }
    return result;
  }
  function html(d) {
    data = d;
    const topic = d.topics.find(t => !t.error && t.status !== 'utrwalanie');
    return `<section id="studio" class="learning-space">
      <header class="learn-toolbar"><span class="workspace-name"><span class="signal"></span> Nauka</span><div><button type="button" id="history-toggle" aria-expanded="false" aria-controls="learning-history">Historia</button><button type="button" id="context-toggle" aria-expanded="false" aria-controls="learning-context">Cel i mapa <span aria-hidden="true">⌘</span></button></div></header>
      <div id="goal-anchor" class="goal-anchor" hidden></div>
      <section id="learning-context" class="learning-context" hidden aria-label="Kontekst sesji">
        <form id="context-form"><label for="session-goal">Cel sesji</label><input id="session-goal" maxlength="1000" placeholder="Co chcesz umieć zrobić?"><label for="session-focus">Bieżący wątek</label><input id="session-focus" maxlength="1000"><button type="submit">Zapisz</button></form>
        <div><h2>Odłożone</h2><div id="parked-list"></div></div>
        <div id="context-map">${topic ? `<a href="#/topics/${esc(topic.slug)}">Mapa tematu ↗</a>` : '<a href="#/topics">Twoje tematy ↗</a>'}</div>
      </section>
      <section id="learning-history" class="learning-history" hidden aria-label="Historia tej sesji"></section>
      <div class="learning-center">
        <section id="learning-start" class="learning-start">
          <div class="orbital" aria-hidden="true"><svg viewBox="0 0 160 120"><ellipse cx="80" cy="60" rx="64" ry="25" transform="rotate(-30 80 60)"/><ellipse cx="80" cy="60" rx="64" ry="25" transform="rotate(30 80 60)"/><path d="M80 15v90"/><circle cx="80" cy="60" r="5"/><circle cx="129" cy="27" r="3"/><circle cx="31" cy="27" r="3"/></svg></div>
          <h1>Czego chcesz się nauczyć?</h1>
          ${topic ? `<button type="button" class="resume-topic" data-start="${esc(`/nauka ${topic.slug}. Kontynuuj z zapisanej diagnozy i planu. Wybierz jedną aktywność, która przybliży mnie do celu.`)}" data-goal="${esc(topic.cel || topic.tytul)}"><span class="resume-icon" aria-hidden="true">↗</span><span><small>WRÓĆ DO TEMATU</small><strong>${esc(topic.tytul)}</strong></span><span class="resume-arrow" aria-hidden="true">→</span></button>` : ''}
        </section>
        <article id="learning-card" class="learning-card" hidden></article>
        <div id="learning-hints" class="learning-hints"></div>
        <div id="ai-status" class="ai-status" role="status" aria-live="polite"></div>
        <div id="ai-error" class="ai-error" role="alert" hidden></div>
        <form id="studio-form" class="answer-box">
          <label id="answer-label" for="studio-input">TEMAT LUB PYTANIE</label>
          <textarea id="studio-input" rows="3" maxlength="12000" placeholder="Np. jak działa szczepionka — chcę rozumieć, nie tylko znać nazwy.">${esc(draft)}</textarea>
          <div class="answer-footer"><label class="provider-control"><span class="signal"></span><select id="ai-provider" aria-label="Wybierz AI"><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label><div class="answer-actions"><button type="button" id="ai-stop" hidden>Zatrzymaj</button><button type="button" id="next-step" hidden>Dalej →</button><button type="submit" id="ai-send" title="Wyślij: ⌘ / Ctrl + Enter">Zacznij <span aria-hidden="true">↗</span></button></div></div>
        </form>
        <div id="practice-actions" class="practice-actions"><button type="button" data-start="/powtorka. Ułóż krótką sesję przeplataną: jedno zadanie naraz, łącz powiązane pojęcia. Nie dokładaj osobnych sprawdzianów do tych samych pojęć.">↻ Powtórka${d.stats.dueTodayCount ? ` <span class="due-count">${d.stats.dueTodayCount}</span>` : ''}</button><button type="button" data-start="Daj jedno wymagające zadanie łączące 2–3 powiązane pojęcia z moich materiałów i obecnej wiedzy. Bez zdradzania, jakich zasad użyć. Jeśli nie znasz mojego poziomu, zacznij od jednej sensownej próby.">⌘ Połącz pojęcia</button><a href="#/materials">＋ Dodaj materiał</a></div>
        <div id="learning-controls" class="learning-controls" hidden><button type="button" id="hint-button">Podpowiedź</button><button type="button" data-action="example">Pokaż przykład</button><button type="button" data-action="park">Odłóż ten wątek</button><button type="button" data-action="challenge">Trudniej</button><details class="lesson-more"><summary>···</summary><button type="button" data-action="goal">Wróć do celu</button><button type="button" data-action="finish">Zakończ i podsumuj</button><button type="button" id="new-session">Nowa sesja</button></details></div>
        <div id="learning-evidence" class="learning-evidence" hidden></div>
      </div>
    </section>`;
  }
  async function drawHistory() {
    if (!active() || el('learning-history').hidden) return;
    el('learning-history').innerHTML = `<div class="history-head"><h2>Historia sesji</h2><button type="button" id="history-close">Zamknij ×</button></div>` + (session?.messages || []).map(m => `<article class="history-message ${m.role}"><span>${m.role === 'user' ? 'TY' : esc((m.provider || session.provider).toUpperCase())}</span>${md(m.text)}${m.hintsUsed ? `<small>Użyte podpowiedzi: ${m.hintsUsed}</small>` : ''}</article>`).join('');
    el('history-close')?.addEventListener('click', () => toggle('history'));
    await renderMaps(el('learning-history'));
  }
  function toggle(panel) {
    const box = el(`learning-${panel}`);
    box.hidden = !box.hidden; el(`${panel}-toggle`).setAttribute('aria-expanded', String(!box.hidden));
    if (panel === 'history') drawHistory();
  }
  async function paint() {
    if (!active()) return;
    const busy = loading || session?.running;
    el('ai-error').hidden = !(error || session?.error);
    el('ai-error').textContent = error || session?.error || '';
    el('ai-status').textContent = loading ? 'Łączę…' : session?.activity || '';
    el('ai-stop').hidden = !session?.running;
    el('ai-provider').disabled = !!busy;
    el('ai-send').disabled = !!busy || !session || !draft.trim();
    for (const button of root.querySelectorAll('[data-start], [data-action], #next-step, #new-session, #hint-button, #context-form button, [data-unpark]')) button.disabled = !!busy || !session;
    if (!session) return;
    el('ai-provider').value = session.provider;
    const hasMessages = session.messages.length > 0;
    el('learning-start').hidden = hasMessages;
    el('practice-actions').hidden = hasMessages;
    el('learning-controls').hidden = !hasMessages;
    el('goal-anchor').hidden = !session.goal;
    el('goal-anchor').textContent = session.goal; el('goal-anchor').title = session.goal;
    if (!contextDirty) { el('session-goal').value = session.goal; el('session-focus').value = session.focus; }
    el('parked-list').innerHTML = session.parked.map((p,i) => `<div class="parked-row"><span>${esc(p)}</span><button type="button" data-unpark="${i}" aria-label="Usuń z odłożonych: ${esc(p)}">×</button></div>`).join('') || '<p class="muted">Nic odłożonego.</p>';
    const message = lastAI(), card = message?.card;
    const key = JSON.stringify([message, hasMessages, session.messages.length]);
    el('learning-card').hidden = !message;
    el('answer-label').textContent = hasMessages ? (card?.kind === 'feedback' ? 'TWOJE ROZUMOWANIE LUB PYTANIE' : 'TWOJA PRÓBA') : 'TEMAT LUB PYTANIE';
    el('studio-input').placeholder = hasMessages ? 'Jak do tego dochodzisz? Możesz też napisać „nie wiem”.' : 'Np. jak działa szczepionka — chcę rozumieć, nie tylko znać nazwy.';
    el('ai-send').innerHTML = `${hasMessages ? 'Wyślij' : 'Zacznij'} <span aria-hidden="true">↗</span>`;
    el('next-step').hidden = !card || !!card.question || !['feedback','summary','explain'].includes(card.kind);
    el('next-step').textContent = card?.kind === 'summary' ? 'Nowa sesja →' : 'Następny krok →';
    el('hint-button').hidden = !card?.hintCount || (card.hints?.length || 0) >= card.hintCount;
    if (key === signature) return;
    signature = key;
    if (message) {
      const previousUser = answerFor(session.messages, message);
      el('learning-card').innerHTML = card ? `<div class="activity-meta"><span class="activity-kind">${KINDS[card.kind]}</span>${card.kind === 'feedback' && card.outcome !== 'none' ? `<span class="outcome ${esc(card.outcome)}">${OUTCOMES[card.outcome]}</span>` : ''}</div><h1>${esc(card.title)}</h1>${card.kind === 'feedback' && previousUser ? `<details class="your-attempt"><summary>Twoja odpowiedź</summary>${md(previousUser.text)}</details>` : ''}${md(card.body)}${card.question ? `<div class="activity-question">${md(card.question)}</div>` : ''}${card.takeaway && card.kind !== 'challenge' ? `<div class="takeaway"><span>SEDNO</span>${md(card.takeaway)}</div>` : ''}${card.concepts?.length && card.kind === 'feedback' ? `<div class="concept-links">${card.concepts.map(c => `<span>${esc(c)}</span>`).join('<i aria-hidden="true">↔</i>')}</div>` : ''}` : `<div class="activity-meta"><span class="activity-kind">Nauka</span></div>${md(message.text)}`;
      await renderMaps(el('learning-card'));
      if (!active()) return;
      if (shownActivity && shownActivity !== message.id) el('learning-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
      shownActivity = message.id || null;
    }
    el('learning-hints').innerHTML = (card?.hints || []).map((hint,i) => `<div class="hint-step"><span>WSKAZÓWKA ${i+1}</span>${md(hint)}</div>`).join('');
    const attempts = session.messages.filter(m => m.card && m.card.outcome !== 'none');
    el('learning-evidence').hidden = !attempts.length;
    el('learning-evidence').innerHTML = `<details><summary>Ślad nauki <span>${attempts.length} ${attempts.length === 1 ? 'próba' : 'prób'}</span></summary>${attempts.slice(-8).map(m => `<div><span>${esc(m.card.focus || m.card.title)}</span><small>${OUTCOMES[m.card.outcome]}</small></div>`).join('')}</details>`;
    await drawHistory();
  }
  async function poll() {
    clearTimeout(timer);
    if (!active()) return;
    if (loading) { timer = setTimeout(poll, 1000); return; }
    try { await api(); } catch (e) { error = e.message; }
    await paint(); timer = setTimeout(poll, session?.running ? 1000 : 4000);
  }
  async function mutate(route, body) {
    if (loading) return false;
    loading = true; await paint(); let success = false;
    try { await api(route, body); success = true; } catch (e) { error = e.message; }
    loading = false; await paint(); return success;
  }
  async function send(text, goal, intent = 'answer') {
    if (!text.trim() || loading || session?.running) return;
    const submittedDraft = draft;
    const input = el('studio-input');
    const match = text.trim().match(/^(codex|claude)(?:\s+([\s\S]+))?$/);
    const provider = match?.[1] || el('ai-provider').value;
    loading = true; await paint();
    try {
      await api('/context', { provider, ...(goal ? { goal } : {}), ...(contextDirty ? { goal: el('session-goal').value, focus: el('session-focus').value } : {}) });
      await api('/send', { text: match ? (match[2] || 'Wybierz jeden sensowny następny krok nauki na podstawie mojego kontekstu. Jeśli temat jest nowy, zacznij od krótkiego przykładu.') : text, provider, intent });
      if (draft === submittedDraft) { draft = ''; input.value = ''; drafts.write(session.id, ''); }
      contextDirty = false;
    } catch (e) { error = e.message; }
    loading = false; await paint(); clearTimeout(timer); timer = setTimeout(poll, 1000);
  }
  const actions = {
    example: 'Nie odgaduję dalej. Pokaż krótki rozwiązany przykład analogiczny do problemu, wyjaśnij jeden najważniejszy krok, potem pozwól mi zastosować go w prostszej sytuacji. To nauka ze wsparciem, nie samodzielne przypomnienie.',
    park: 'Odłóż bieżący wątek. Zapisz lukę i wróć do celu sesji przez inny, niezależny problem. Nie zadawaj ponownie tego samego pytania.',
    challenge: 'Podnieś trudność: jeden nowy problem wymagający transferu lub połączenia 2–3 poznanych pojęć. Nie zwiększaj trudności samą długością tekstu ani niejasnością polecenia.',
    goal: 'Wróć do głównego celu sesji. Wybierz jeden następny krok, który przybliży mnie do użycia wiedzy w praktyce.',
    finish: 'Zakończ sesję. Zapisz rzeczywisty postęp i odłożone sprawy; podsumuj krótko czego dowodzą moje próby, co wymaga utrwalenia i jeden następny krok. Nie oceniaj ponownie pojęć już ocenionych przez FSRS w tej sesji.',
  };
  async function newSession() {
    if (await mutate('/context', { reset: true })) { draft = ''; contextDirty = false; drafts.write(session.id, ''); if (!active()) return; el('studio-input').value = ''; await paint(); el('studio-input').focus(); }
  }
  function mount(element) {
    root = element; signature = ''; clearTimeout(timer);
    el('history-toggle').addEventListener('click', () => toggle('history'));
    el('context-toggle').addEventListener('click', () => toggle('context'));
    el('studio-input').addEventListener('input', e => { draft = e.target.value; if (session) drafts.write(session.id, draft); el('ai-send').disabled = loading || session?.running || !session || !draft.trim(); });
    el('studio-form').addEventListener('submit', e => { e.preventDefault(); send(el('studio-input').value); });
    el('studio-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(e.target.value); } });
    el('ai-provider').addEventListener('change', e => mutate('/context', { provider: e.target.value }));
    el('ai-stop').addEventListener('click', () => mutate('/stop', {}));
    el('hint-button').addEventListener('click', () => mutate('/hint', {}));
    el('new-session').addEventListener('click', newSession);
    el('next-step').addEventListener('click', () => lastAI()?.card?.kind === 'summary' ? newSession() : send('Dalej. Dobierz kolejną aktywność na podstawie mojej ostatniej próby i celu sesji. Nie powtarzaj tego samego sprawdzianu.', undefined, 'next'));
    el('context-form').addEventListener('input', () => { contextDirty = true; });
    el('context-form').addEventListener('submit', async e => { e.preventDefault(); if (await mutate('/context', { goal: el('session-goal').value, focus: el('session-focus').value })) { contextDirty = false; toggle('context'); } });
    el('studio').addEventListener('click', async e => {
      const start = e.target.closest('[data-start]');
      if (start) return send(start.dataset.start, start.dataset.goal, 'start');
      const action = e.target.closest('[data-action]');
      if (action) {
        if (action.dataset.action === 'park' && session?.focus && !await mutate('/context', { park: true })) return;
        return send(actions[action.dataset.action], undefined, action.dataset.action);
      }
      const unpark = e.target.closest('[data-unpark]'); if (unpark) mutate('/context', { unpark: Number(unpark.dataset.unpark) });
    });
    if (session) paint(); poll();
  }
  return { html, mount, prepare(text) { draft = text; }, data(d) { data = d; } };
}

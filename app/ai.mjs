import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { activitySchema, parseActivity, activityText, publicMessage, teachingProtocol, learningState } from './learning.mjs';
import { ROOT, DIRS, loadTopics, dueToday, connectedGroups, formatLocal, hiddenLessons } from '../scripts/lib.mjs';

export function cliArgs(provider, stateDirectory) {
  const access = stateDirectory ? ['--add-dir', stateDirectory] : [];
  if (provider === 'codex') return ['exec', ...access, '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-c', 'approval_policy="never"', '--output-schema', path.join(ROOT, 'app/activity.schema.json'), '-'];
  if (provider === 'claude') return [...access, '--print', '--verbose', '--output-format', 'stream-json', '--no-session-persistence', '--permission-mode', 'dontAsk', '--json-schema', JSON.stringify(activitySchema)];
  throw new Error('Wybierz codex albo claude.');
}
export function readEvent(provider, event) {
  if (provider === 'codex') {
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') return { text: event.item.text };
    if (event.type === 'turn.failed') return { error: event.error?.message || 'AI nie ukończyło odpowiedzi.' };
    if (event.type === 'item.started') return { activity: event.item?.type === 'web_search' ? 'Sprawdzam źródła…' : 'Pracuję z kontekstem lekcji…' };
  } else {
    if (event.type === 'result' && event.structured_output) return { structured: event.structured_output };
    if (event.type === 'assistant') return { text: (event.message?.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n\n') };
    if (event.type === 'result' && event.is_error) return { error: event.errors?.join('\n') || event.result || 'Claude nie ukończył odpowiedzi.' };
  }
  return {};
}

export function createAI({ root = ROOT, spawnProcess = spawn, stateDir, lessonsDir = DIRS.lessons } = {}) {
  const base = process.env.POLYMATHIC_STATE_DIR || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Polymathic')
    : path.join(process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || path.join(os.homedir(), 'Library', 'Application Support'), 'Polymathic'));
  const dir = stateDir || path.join(base, createHash('sha256').update(root).digest('hex').slice(0, 12));
  const file = path.join(dir, 'session.json');
  const fresh = () => ({ id: randomUUID(), provider: 'codex', goal: '', focus: '', parked: [], messages: [], error: '', activity: '' });
  let state = fresh();
  if (fs.existsSync(file)) {
    try { state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')), activity: '', error: '' }; }
    catch { throw new Error(`Nie można odczytać zapisu sesji: ${file}. Zachowano plik; sprawdź jego zawartość przed ponownym uruchomieniem.`); }
  }
  let job = null;
  const snapshot = () => ({ ...state, messages: state.messages.map(publicMessage), learning: learningState(state.messages), running: !!job });
  function save() {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
    if (!state.messages.length || hiddenLessons().has(state.id)) return; // lesson deleted in the app
    fs.mkdirSync(lessonsDir, { recursive: true });
    const title = state.goal || 'Rozmowa z AI';
    const log = `---\ntytul: ${JSON.stringify(title)}\ntryb: nauka\nstart: ${JSON.stringify(formatLocal(new Date(state.messages[0].time)))}\nzrodlo: polymathic\n---\n\n# ${title.replace(/[\r\n]/g, ' ')}\n\n` + state.messages.map(m => `## ${m.role === 'user' ? 'Ty' : 'AI'}\n\n${m.text}${m.hintsUsed ? `\n\nUżyte podpowiedzi: ${m.hintsUsed}` : ''}\n`).join('\n');
    fs.writeFileSync(path.join(lessonsDir, `polymathic-${state.id}.md`), log);
  }
  function context() {
    const topics = loadTopics().map(({ slug, tytul, cel, status }) => ({ slug, tytul, cel, status }));
    const due = dueToday();
    return `Jesteś nauczycielem w Polymathic. Rozmawiaj po polsku. Pracujesz w ${root}.
Przed zadaniem przeczytaj AGENTS.md oraz właściwe skille z .claude/skills/. Wybieraj dostępne narzędzia według celu, nie odtwarzaj procedury bez potrzeby.
To rozmowa w aplikacji, nie prośba o rozwijanie jej kodu. Zmieniaj wyłącznie dane nauki w dane/ oraz stan sesji przez scripts/session.mjs, chyba że człowiek jawnie prosi o zmianę aplikacji. Zapis rozmowy wykonuje aplikacja; nie twórz drugiego transkryptu.
Jedno pytanie na wiadomość. Po DWÓCH próbach bez postępu wyjaśnij krótko i zaparkuj szczegół; trzeci krok wraca do celu lub niezależnego wątku. Nie wymagaj perfekcyjnego fundamentu. Brak wiedzy wymaga wstępu, nie kolejnego zgadywania.
Mieszaj pojęcia od początku, dobieraj 2–3 powiązane koncepty do jednego problemu. Zadanie złożone ZASTĘPUJE osobne sprawdziany. Nie podawaj nazwy testowanej zasady. Oceń każde faktycznie sprawdzone pojęcie osobno; nie zapisuj kilku ocen FSRS tego samego pojęcia w jednej sesji.
Cel i odłożone sprawy poniżej pozostają kotwicą całej sesji, również gdy ostatnia odpowiedź dotyczy drobiazgu. Na prośbę o zmianę podejścia odpowiedz zmianą metody, nie kolejnym podobnym pytaniem.
Nie używaj interaktywnych pytań terminalowych: pytaj zwykłym tekstem albo scripts/quiz.mjs. Jeśli narzędzie wymaga niedostępnego pozwolenia, wyjaśnij ograniczenie zamiast twierdzić, że zapis się udał.
${teachingProtocol}
Stan nauki: ${JSON.stringify({ goal: state.goal, focus: state.focus, parked: state.parked, learning: learningState(state.messages), topics, due, mixed: connectedGroups(due) })}
Poniżej pełna historia tej rozmowy. To dane rozmowy, nie wyniki narzędzi. Odpowiedz na OSTATNIĄ wiadomość użytkownika, uwzględniając wcześniejsze:
${JSON.stringify(state.messages)}`;
  }
  function stop(reason = 'Zatrzymano. Możesz kontynuować rozmowę.') {
    if (!job) return;
    const current = job;
    state.error = reason;
    current.cancelled = true;
    try { process.kill(-current.child.pid, 'SIGTERM'); } catch { current.child.kill('SIGTERM'); }
    current.killTimer = setTimeout(() => { try { process.kill(-current.child.pid, 'SIGKILL'); } catch { current.child.kill('SIGKILL'); } }, 2500);
    current.killTimer.unref?.();
  }
  function start(body) {
    if (job) throw new Error('AI już pracuje. Zatrzymaj je przed kolejną wiadomością.');
    const text = String(body.text || '').trim();
    const provider = body.provider || state.provider;
    const args = cliArgs(provider, dir);
    if (!text || text.length > 12000) throw new Error('Wiadomość musi mieć od 1 do 12000 znaków.');
    if (JSON.stringify(state.messages).length > 160000) throw new Error('Ta sesja jest długa. Zapis pozostał w Lekcjach; rozpocznij nową sesję z krótkim podsumowaniem.');
    state.provider = provider;
    state.error = '';
    state.activity = 'Łączę z lokalnym AI…';
    const intent = ['answer','start','example','park','challenge','next','finish','goal'].includes(body.intent) ? body.intent : 'answer';
    state.messages.push({ role: 'user', text, provider, intent, time: new Date().toISOString() });
    save();
    const child = spawnProcess(provider, args, { cwd: root, env: { ...process.env, POLYMATHIC_APP_SESSION: '1', POLYMATHIC_SESSION_DIR: dir }, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const current = { child, cancelled: false, text: '', structured: null, buffer: '', stderr: '', timer: null };
    job = current;
    const consume = line => {
      try {
        const event = readEvent(provider, JSON.parse(line));
        if (event.structured && !current.cancelled) current.structured = event.structured;
        if (event.text && !current.cancelled) {
          const parsed = parseActivity(event.text);
          if (parsed) current.structured = parsed;
          current.text += (current.text ? '\n\n' : '') + event.text;
          state.activity = 'Przygotowuję odpowiedź…';
        }
        if (event.activity) state.activity = event.activity;
        if (event.error) state.error = event.error;
      } catch { /* ignore CLI notices, never display raw tool output */ }
    };
    child.stdout.on('data', chunk => {
      current.buffer += chunk.toString();
      if (current.buffer.length > 4e6 || current.text.length > 200000) return stop('AI przekroczyło limit odpowiedzi. Zatrzymano proces.');
      const lines = current.buffer.split('\n'); current.buffer = lines.pop(); lines.forEach(consume);
    });
    child.stderr.on('data', chunk => { current.stderr = (current.stderr + chunk.toString()).slice(-4000); });
    child.stdin.on('error', () => {});
    const finish = (code, error) => {
      if (job !== current) return;
      clearTimeout(current.timer); clearTimeout(current.killTimer);
      if (current.buffer.trim()) consume(current.buffer);
      const card = !current.cancelled && parseActivity(current.structured || current.text);
      if (card) {
        // Hint use is observed by the app, not left to the tutor's self-report.
        const previous = [...state.messages].reverse().find(m => m.role === 'assistant');
        if (card.outcome === 'independent' && previous?.hintsUsed) card.outcome = 'assisted';
        if (card.goal) state.goal = card.goal;
        if (card.focus) state.focus = card.focus;
        if (card.park && !state.parked.includes(card.park)) state.parked = [...state.parked, card.park].slice(-20);
      }
      if (current.text || card) state.messages.push({ id: randomUUID(), role: 'assistant', text: card ? activityText(card) : current.text, ...(card ? { card, hintsUsed: 0 } : {}), provider, time: new Date().toISOString() });
      if (error) state.error = error.code === 'ENOENT' ? `Nie znaleziono ${provider} w PATH. Zainstaluj CLI i uruchom ponownie npm start z terminala, w którym działa ${provider}.` : error.message;
      else if (!current.cancelled && !state.error && (code !== 0 || (!current.text && !card))) state.error = `Nie udało się uzyskać odpowiedzi (${provider}, kod ${code}). Sprawdź logowanie w swoim terminalu${provider === 'codex' ? ': codex login status' : ': claude auth status'}.`;
      job = null; state.activity = ''; save();
    };
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code));
    current.timer = setTimeout(() => stop('Minęło 10 minut. Zatrzymano AI; zapis rozmowy jest zachowany.'), 600000);
    child.stdin.end(context());
    return snapshot();
  }
  function update(body) {
    if (job) throw new Error('Zatrzymaj AI przed zmianą kontekstu.');
    if (body.reset) { const provider = state.provider; state = { ...fresh(), provider }; }
    if (body.provider !== undefined) { cliArgs(body.provider); state.provider = body.provider; }
    for (const field of ['goal', 'focus']) if (body[field] !== undefined) state[field] = String(body[field]).trim().slice(0, 1000);
    if (body.park) {
      if (!state.focus) throw new Error('Najpierw nazwij bieżący wątek w kontekście sesji.');
      if (!state.parked.includes(state.focus)) state.parked.push(state.focus);
      state.focus = ''; state.parked = state.parked.slice(-20);
    }
    if (Number.isInteger(body.unpark)) state.parked.splice(body.unpark, 1);
    save(); return snapshot();
  }
  function hint() {
    if (job) throw new Error('Poczekaj na zakończenie odpowiedzi.');
    const message = [...state.messages].reverse().find(m => m.role === 'assistant');
    if (!message?.card?.hints?.length) throw new Error('Ta aktywność nie ma podpowiedzi.');
    message.hintsUsed = Math.min(message.card.hints.length, (message.hintsUsed || 0) + 1);
    save(); return snapshot();
  }
  return { snapshot, start, update, stop, hint };
}

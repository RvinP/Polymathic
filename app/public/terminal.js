import { createInputQueue } from '/input-queue.js';
// Terminal client: xterm.js connected over a WebSocket to the real Claude Code on the server.
// The terminal element lives as long as the page — a view only "pins" it,
// so going to the Library and back loses neither the conversation nor the scroll position.

export function createTerminal({ onState = () => {} } = {}) {
  const el = document.createElement('div');
  el.className = 'terminal-host';
  const term = new window.Terminal({
    fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    theme: {
      background: '#0e0c26', foreground: '#e4e2fb', cursor: '#ac9eff', cursorAccent: '#0e0c26',
      selectionBackground: '#3a2f7d',
      black: '#1d1a45', red: '#e5735f', green: '#8fd19e', yellow: '#e2c06b', blue: '#7fb0e6', magenta: '#d39be0', cyan: '#73c7c4', white: '#d6dcd8',
      brightBlack: '#5f5a95', brightRed: '#f08a77', brightGreen: '#a8e2b5', brightYellow: '#eed28a', brightBlue: '#9cc4ef', brightMagenta: '#e0b3ea', brightCyan: '#93d8d5', brightWhite: '#f3f6f4',
    },
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  let opened = false;
  let ws = null;
  let state = { running: false };
  let retryDelay = 500;
  // Claude Code needs a moment to start; text typed earlier waits in the queue.
  let firstOutput = 0;
  const queue = createInputQueue({ send: data => send({ type: 'input', data }), ready: () => ready() && ws?.readyState === 1 });
  const ready = () => state.running && firstOutput && Date.now() - firstOutput > 2500;
  setInterval(() => {
    queue.flush();
  }, 300);

  const send = (message) => ws?.readyState === 1 && ws.send(JSON.stringify(message));
  const fitToSlot = () => {
    if (!el.isConnected || !el.offsetWidth) return;
    try {
      fit.fit();
      send({ type: 'resize', cols: term.cols, rows: term.rows });
    } catch {}
  };

  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/terminal`);
    ws.onopen = () => {
      retryDelay = 500;
      term.reset(); // Reconnection replays the server buffer; discard the old copy first.
      firstOutput = 0;
      fitToSlot();
      // The first connection starts (or resumes) the session; later ones only replay the output.
      send({ type: 'start' });
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'output') {
        if (!firstOutput) firstOutput = Date.now();
        term.write(m.data);
      } else if (m.type === 'reset') {
        queue.clear({ keepPending: true });
        firstOutput = 0;
        term.reset();
      }
      else if (m.type === 'state') {
        state = m;
        onState(m);
      }
    };
    ws.onclose = () => {
      queue.clear();
      state = { ...state, disconnected: true, running: false };
      onState(state);
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 8000);
    };
  }

  term.onData((data) => { queue.clear(); send({ type: 'input', data }); });
  new ResizeObserver(() => fitToSlot()).observe(el);

  return {
    /** Pins the terminal into the given place in the view (the first time it opens it and connects to the server). */
    mount(slot, { focus = true } = {}) {
      if (!slot) return;
      if (el.parentElement !== slot) slot.replaceChildren(el);
      if (!opened) {
        term.open(el);
        opened = true;
        connect();
      }
      requestAnimationFrame(() => {
        fitToSlot();
        term.refresh(0, term.rows - 1);
        if (focus) term.focus();
      });
    },
    /** Types text into Claude as if it were typed on the keyboard (e.g. "/status\r"). */
    type(text) {
      queue.add(text);
      term.focus();
    },
    newSession: () => { queue.clear(); send({ type: 'new' }); },
    resume: () => { queue.clear(); send({ type: 'resume' }); },
    get state() { return state; },
  };
}

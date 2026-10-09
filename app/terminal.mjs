// Terminal: real Claude Code in a pseudo-terminal, connected to the browser over a WebSocket.
// One continuous session (as in a terminal): output is buffered, so after reloading the page
// or switching to another view the terminal comes back with all its content. The session id is
// remembered, so after a server restart the conversation is resumed with `claude --resume <id>`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pty from 'node-pty';
import { WebSocketServer } from 'ws';

const MAX_BUFFER = 400_000; // characters of output history replayed after reconnecting

// Variables of a parent session: when the server was started from inside Claude Code (e.g. quiz.mjs),
// the terminal must not inherit its identity, or it would consider itself a subprocess of that session.
const SESSION_VARIABLES = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PROJECT_DIR|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|CHILD_SESSION|SESSION_[A-Z_]+|MESSAGING_[A-Z_]+))$/;

function findClaude() {
  const dirs = [...(process.env.PATH || '').split(path.delimiter),
    path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.claude/local'), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const d of dirs) {
    const p = path.join(d, process.platform === 'win32' ? 'claude.exe' : 'claude');
    if (d && fs.existsSync(p)) return p;
  }
  return null;
}

// Claude Code keeps transcripts in ~/.claude/projects/<path with "-" instead of characters outside [a-zA-Z0-9]>/.
const transcriptFile = (root, id) => path.join(os.homedir(), '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);

function readSavedState(stateFile, legacyStateFile) {
  for (const file of [stateFile, legacyStateFile].filter(Boolean)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      // The legacy file (konsola.json) used the Polish key `sesjaId`.
      return { sessionId: saved.sessionId ?? saved.sesjaId ?? null, start: saved.start ?? null };
    } catch {
      // no saved state = first session
    }
  }
  return {};
}

export function createTerminal({ root, stateFile, legacyStateFile }) {
  let proc = null;
  let buffer = '';
  let size = { cols: 110, rows: 32 };
  let state = { sessionId: null, start: null, end: null, error: null, ...readSavedState(stateFile, legacyStateFile) };
  const clients = new Set();

  const saveState = () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(stateFile, JSON.stringify({ sessionId: state.sessionId, start: state.start }, null, 2), { mode: 0o600 });
  };

  const send = (ws, message) => ws.readyState === 1 && ws.send(JSON.stringify(message));
  const broadcast = (message) => clients.forEach((ws) => send(ws, message));
  const describeState = () => ({ type: 'state', running: !!proc, sessionId: state.sessionId, start: state.start, end: state.end, error: state.error });

  function start({ fresh = false } = {}) {
    if (proc) return;
    const exe = findClaude();
    if (!exe) {
      state.error = 'Nie znalazłem polecenia „claude”. Zainstaluj Claude Code i uruchom ponownie npm start.';
      return broadcast(describeState());
    }
    // Resume the previous conversation if its transcript exists (a conversation without any message has no file).
    const resume = !fresh && state.sessionId && fs.existsSync(transcriptFile(root, state.sessionId));
    if (!resume) state.sessionId = randomUUID();
    const args = resume ? ['--resume', state.sessionId] : ['--session-id', state.sessionId];
    args.push('--add-dir', path.dirname(stateFile));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SESSION_VARIABLES.test(k)));
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    env.POLYMATHIC_TERMINAL = '1';
    env.POLYMATHIC_SESSION_DIR = path.dirname(stateFile);

    buffer = '';
    broadcast({ type: 'reset' });
    state = { ...state, start: resume ? state.start : new Date().toISOString(), end: null, error: null };
    saveState();
    try {
      proc = pty.spawn(exe, args, { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: root, env });
    } catch (e) {
      proc = null;
      state.error = `Nie udało się uruchomić Claude: ${e.message}`;
      return broadcast(describeState());
    }
    const current = proc;
    current.onData((d) => {
      buffer = (buffer + d).slice(-MAX_BUFFER);
      broadcast({ type: 'output', data: d });
    });
    current.onExit(({ exitCode }) => {
      if (proc !== current) return;
      proc = null;
      state.end = { code: exitCode, time: new Date().toISOString() };
      broadcast(describeState());
    });
    broadcast(describeState());
  }

  function stop() {
    if (!proc) return;
    const p = proc;
    proc = null;
    try { p.kill(); } catch {}
  }

  function handleMessage(ws, raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.type === 'input' && proc && typeof m.data === 'string') proc.write(m.data);
    else if (m.type === 'resize') {
      const cols = Math.max(20, Math.min(400, Number(m.cols) || 0));
      const rows = Math.max(5, Math.min(200, Number(m.rows) || 0));
      size = { cols, rows };
      try { proc?.resize(cols, rows); } catch {}
    } else if (m.type === 'start') start();
    else if (m.type === 'new') {
      stop();
      start({ fresh: true });
    } else if (m.type === 'resume') {
      stop();
      start();
    }
  }

  function attach(server, { allowedOrigins }) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
    server.on('upgrade', (req, socket, head) => {
      if (!req.url.startsWith('/api/terminal')) return socket.destroy();
      // The terminal runs commands on your computer. Only from this app, never from a foreign page.
      if (!allowedOrigins.includes(req.headers.origin) || !allowedOrigins.some((o) => o.endsWith(`//${req.headers.host}`))) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        return socket.destroy();
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws);
        send(ws, describeState());
        if (buffer) send(ws, { type: 'output', data: buffer });
        ws.on('message', (d) => handleMessage(ws, String(d)));
        ws.on('close', () => clients.delete(ws));
      });
    });
  }

  return { attach, stop, start, sendText: (t) => proc?.write(t), get running() { return !!proc; } };
}

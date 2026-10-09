#!/usr/bin/env node
if (process.env.POLYMATHIC_APP_SESSION === '1') process.exit(0);

// Live lesson: a Claude Code hook (UserPromptSubmit / PreToolUse / PostToolUse / Stop) copies the
// conversation from the session transcript into dane/lekcje/<date>-<topic>-<session>.md, and the app shows it
// rendered (markdown, mermaid, formulas). Counterpart of md-log from amosblomqvist/learn.
//
// Only learning sessions are logged: from the first /nauka, /powtorka, /pytania, /sokrates or /quiz command.
// The log contains what is meant to be read: your messages, Claude's text, quizzes and popup questions.
// Tool calls and thinking are skipped.
//
// The HTML classes in the log (wpis-ty, wpis-claude, wpis-quiz dobrze|zle|nie-wiem, wpis-pytanie) are part of
// the lesson file format on disk and stay unchanged so existing lessons keep their styling.
//
// Manually: node scripts/log-lesson.mjs <transcript.jsonl>

import fs from 'node:fs';
import path from 'node:path';
import { DIRS, slugify, formatLocal, localDay, hiddenLessons } from './lib.mjs';

const LEARNING_COMMANDS = /<command-name>\/(nauka|powtorka|pytania|sokrates|quiz)<\/command-name>/;

function input() {
  if (process.argv[2]) return { transcript_path: process.argv[2] };
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

const clockTime = (ts) => (ts ? formatLocal(new Date(ts)).slice(11) : '');

function cleanUserText(t) {
  const command = t.match(/<command-name>(\/[^<]+)<\/command-name>/);
  if (command) {
    const commandArgs = t.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return `\`${command[1]}${commandArgs ? ' ' + commandArgs : ''}\``;
  }
  return t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/<\/?(command|local-command)-[a-z-]+[^>]*>/g, '')
    .trim();
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c.type === 'text').map((c) => c.text).join('\n\n');
}

// Transcripts written before the English rename use the old quiz field names. A resumed old session
// re-renders its whole lesson file, so we still read them (input and result) instead of losing quizzes.
const OLD_QUESTION_KEYS = { pytanie: 'question', szczegoly: 'details', opcje: 'options', poprawna: 'correct', wyjasnienie: 'explanation', pojecie: 'concept', tasuj: 'shuffle', pytania: 'questions' };
const OLD_RESULT_KEYS = { pytanie: 'question', pojecie: 'concept', opcje: 'options', poprawne: 'correctAnswers', nie_wiem: 'dontKnow', poprawnie: 'isCorrect', wybrane: 'selected', notatka: 'note', wyjasnienie: 'explanation' };
const OLD_STATUS_VALUES = { czeka: 'pending', odpowiedziano: 'answered', anulowano: 'cancelled', 'brak-odpowiedzi': 'no-answer' };
const renameKeys = (o, map) => (o && typeof o === 'object' && !Array.isArray(o)
  ? Object.fromEntries(Object.entries(o).map(([k, v]) => [map[k] ?? k, v]))
  : o);
const fromOldQuiz = (q) => {
  if (Array.isArray(q)) return q.map(fromOldQuiz);
  const out = renameKeys(q, OLD_QUESTION_KEYS);
  if (Array.isArray(out?.questions)) out.questions = out.questions.map(fromOldQuiz);
  if (Array.isArray(out?.options)) out.options = out.options.map((o) => (typeof o === 'string' ? o : renameKeys(o, { tekst: 'text', wartosc: 'value' })));
  return out;
};
const fromOldResult = (r) => {
  const out = renameKeys(r, OLD_RESULT_KEYS);
  if (out?.status in OLD_STATUS_VALUES) out.status = OLD_STATUS_VALUES[out.status];
  return out;
};

function quizFromCommand(cmd) {
  // Only a real quiz call — the first line of the command, not text that mentions the script.
  if (!/(^|&&|;|\|)\s*node\s+(\S*\/)?scripts\/quiz\.mjs(\s|$)/.test(String(cmd || '').split('\n')[0])) return null;
  const heredoc = cmd.match(/<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1\s*$/m);
  try {
    if (heredoc) return fromOldQuiz(JSON.parse(heredoc[2]));
    const file = cmd.match(/quiz\.mjs\s+(\S+\.json)/)?.[1];
    if (file && fs.existsSync(file)) return fromOldQuiz(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    // unreadable quiz — we show just "Quiz"
  }
  return {};
}

// All results from the output (a series prints one RESULT_JSON line per question).
// null = no result yet (quiz started in the background).
function resultsFromOutput(text) {
  const results = [...String(text || '').matchAll(/(?:RESULT|WYNIK)_JSON: (\{.*\})/g)].map((m) => {
    try {
      return fromOldResult(JSON.parse(m[1]));
    } catch {
      return { status: 'no-answer' };
    }
  });
  if (results.length) return results;
  return /background|w tle/i.test(String(text || '')) ? null : [];
}

const block = (cssClass, heading, body) => `<div class="${cssClass}">\n\n${heading}\n\n${body.trim()}\n\n</div>`;

function quizBlock(q, result) {
  const options = result?.options ?? (q.options ?? []).map((o, i) => `${i + 1}. ${typeof o === 'string' ? o : o.text}`);
  const lines = [`**${q.question ?? 'Quiz'}**`];
  if (q.details) lines.push('', q.details);
  lines.push('', ...options);
  if (!result) lines.push('', '_czeka na odpowiedź…_');
  else if (result.status === 'cancelled' || result.status === 'no-answer') lines.push('', '_pominięty_');
  else {
    const verdict = result.dontKnow ? '? Nie wiem' : result.isCorrect ? '✓ Dobrze' : '✗ Źle';
    lines.push('', `**${verdict}**${result.selected?.length ? ` · odpowiedź: ${result.selected.join(' | ')}` : ''}`);
    lines.push(`Poprawna: ${result.correctAnswers.join(' | ')}`);
    if (result.note) lines.push('', `Notatka: ${result.note}`);
    if (result.explanation) lines.push('', result.explanation);
  }
  const cssClass = !result ? 'wpis-quiz' : result.dontKnow ? 'wpis-quiz nie-wiem' : result.isCorrect ? 'wpis-quiz dobrze' : 'wpis-quiz zle';
  return block(cssClass, '**Quiz**', lines.join('\n'));
}

function quizBlocks(quiz, results) {
  const list = Array.isArray(quiz) ? quiz : Array.isArray(quiz?.questions) ? quiz.questions : [quiz];
  return list.map((q, i) => quizBlock(q ?? {}, results ? (results[i] ?? { status: 'no-answer' }) : null)).join('\n\n');
}

function questionBlock(toolInput, result) {
  const questions = toolInput?.questions ?? [];
  const answers = result?.answers ?? {};
  const lines = questions.map((q) => {
    const answer = answers[q.question];
    return `**${q.question}**\n\n${(q.options ?? []).map((o) => `- ${o.label}`).join('\n')}\n\n${answer ? `→ **${answer}**` : '_czeka na odpowiedź…_'}`;
  });
  return block('wpis-pytanie', '**Pytanie**', lines.join('\n\n'));
}

function buildLog(lines) {
  const entries = lines.filter((l) => !l.isSidechain && (l.type === 'user' || l.type === 'assistant'));
  const start = entries.findIndex((l) => l.type === 'user' && !l.isMeta && LEARNING_COMMANDS.test(textFromContent(l.message?.content)));
  if (start === -1) return null;

  const first = entries[start];
  const commandText = cleanUserText(textFromContent(first.message.content)).replace(/`/g, '');
  const tools = new Map(); // tool_use_id → { kind, input, index in the output }
  const output = [];
  let previous = null; // merges consecutive Claude texts into one bubble

  for (const l of entries.slice(start)) {
    const content = l.message?.content;
    if (l.type === 'user') {
      if (l.isMeta) continue;
      if (Array.isArray(content) && content.some((c) => c.type === 'tool_result')) {
        for (const c of content.filter((c) => c.type === 'tool_result')) {
          const t = tools.get(c.tool_use_id);
          if (!t) continue;
          if (t.kind === 'quiz') output[t.index] = quizBlocks(t.input, resultsFromOutput(textFromContent(c.content)));
          if (t.kind === 'question') output[t.index] = questionBlock(t.input, l.toolUseResult);
        }
        continue;
      }
      const raw = textFromContent(content);
      if (/^\s*<task-notification>|\[SYSTEM NOTIFICATION/.test(raw)) continue;
      const text = cleanUserText(raw);
      if (!text) continue;
      output.push(block('wpis-ty', `**Ty** · ${clockTime(l.timestamp)}`, text));
      previous = null;
    } else {
      // System messages (API error, computer sleep) are not part of the lesson.
      if (l.isApiErrorMessage || l.message?.model === '<synthetic>') continue;
      for (const c of Array.isArray(content) ? content : []) {
        if (c.type === 'text' && c.text.trim()) {
          if (previous) {
            previous.text += '\n\n' + c.text;
            output[previous.index] = block('wpis-claude', `**Claude** · ${previous.time}`, previous.text);
          } else {
            previous = { text: c.text, time: clockTime(l.timestamp), index: output.length };
            output.push(block('wpis-claude', `**Claude** · ${previous.time}`, c.text));
          }
        } else if (c.type === 'tool_use' && c.name === 'AskUserQuestion') {
          tools.set(c.id, { kind: 'question', input: c.input, index: output.length });
          output.push(questionBlock(c.input, null));
          previous = null;
        } else if (c.type === 'tool_use' && c.name === 'Bash') {
          const q = quizFromCommand(c.input?.command);
          if (q) {
            tools.set(c.id, { kind: 'quiz', input: q, index: output.length });
            output.push(quizBlocks(q, null));
            previous = null;
          }
        }
      }
    }
  }

  const startDate = new Date(first.timestamp);
  const commandArgs = commandText.split(' ').slice(1).join(' ');
  const commandName = commandText.split(' ')[0].slice(1);
  return {
    fileName: `${localDay(startDate)}-${slugify(commandArgs || commandName).slice(0, 50) || 'lekcja'}-${String(first.sessionId).slice(0, 6)}.md`,
    content: `---\ntytul: ${JSON.stringify(commandArgs ? `${commandName}: ${commandArgs}` : commandName[0].toUpperCase() + commandName.slice(1))}\nkomenda: ${JSON.stringify(commandText)}\nsesja: ${JSON.stringify(String(first.sessionId))}\nstart: ${JSON.stringify(formatLocal(startDate))}\n---\n\n${output.join('\n\n')}\n`,
  };
}

const { transcript_path: transcriptPath } = input();
if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean).map((l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
}).filter(Boolean);

const log = buildLog(lines);
if (!log) process.exit(0);
// Lesson deleted in the app — do not recreate it from the transcript.
if (hiddenLessons().has(String(lines.find((l) => l.sessionId)?.sessionId))) process.exit(0);

fs.mkdirSync(DIRS.lessons, { recursive: true });
// Same session = same file, even if the name changes (e.g. after midnight) — look it up by session id.
const sid = log.fileName.match(/-([^-]+)\.md$/)[1];
const existing = fs.readdirSync(DIRS.lessons).find((f) => f.endsWith(`-${sid}.md`));
const file = path.join(DIRS.lessons, existing ?? log.fileName);
if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === log.content) process.exit(0);
const tmp = path.join(DIRS.lessons, `.${path.basename(file)}.tmp`);
fs.writeFileSync(tmp, log.content);
fs.renameSync(tmp, file);

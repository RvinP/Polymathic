export function answerFor(messages, response) {
  const index = messages.indexOf(response);
  return index < 0 ? null : messages.slice(0, index).reverse().find(m => m.role === 'user') || null;
}
export function draftStore(storage, key = 'polymathic-answer-draft') {
  return {
    read(sessionId) {
      try { const item = JSON.parse(storage.getItem(key)); return item?.sessionId === sessionId && typeof item.text === 'string' ? item.text : ''; } catch { return ''; }
    },
    write(sessionId, text) {
      try { if (text) storage.setItem(key, JSON.stringify({ sessionId, text })); else storage.removeItem(key); } catch { /* Storage can be unavailable in private browsing. */ }
    },
  };
}

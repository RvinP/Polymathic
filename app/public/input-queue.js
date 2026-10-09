// Serialize programmatic input so two prompts can never share an Enter sequence.
export function createInputQueue({ send, ready, schedule = setTimeout, cancel = clearTimeout }) {
  const pending = [];
  let timer = null, busy = false;
  function clear({ keepPending = false } = {}) {
    if (timer !== null) cancel(timer);
    timer = null; busy = false;
    if (!keepPending) pending.length = 0;
  }
  function flush() {
    if (busy || !pending.length || !ready()) return;
    busy = true;
    const text = pending.shift();
    const submit = text.endsWith('\r');
    const count = submit ? (text.startsWith('/') ? 2 : 1) : 0;
    send(submit ? text.slice(0, -1) : text);
    let remaining = count;
    function advance() {
      timer = null;
      if (!ready()) { clear(); return; }
      if (remaining > 0) { send('\r'); remaining--; timer = schedule(advance, 400); }
      else { busy = false; flush(); }
    }
    timer = schedule(advance, 350);
  }
  return {
    add(text) { if (typeof text === 'string' && text) { pending.push(text); flush(); } },
    flush, clear,
  };
}

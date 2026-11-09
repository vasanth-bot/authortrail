// Injected into a tab only when you press "Track this tab". Reads edit events, never sends keystrokes.
(() => {
  if (window.__authortrail) return; window.__authortrail = true;
  const zero = () => ({ typed: 0, pasted: 0, deleted: 0, activeSec: 0, bursts: 0 });
  let t = zero(), lastAt = 0, dirty = false, el = null, busy = false;
  const MIN = 20, key = location.origin + location.pathname;
  const editable = e => e && (e.isContentEditable || e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && /^(text|search)$/.test(e.type)));
  const textOf = e => ('value' in e ? e.value : e.innerText) || '';
  addEventListener('beforeinput', e => {
    const n = e.target; if (!editable(n)) return; el = n; dirty = true;
    const now = Date.now(), gap = now - lastAt; lastAt = now;
    if (gap > 5000) { t.bursts++; t.activeSec++; } else t.activeSec += gap / 1000;
    const type = e.inputType || '';
    let len = (e.data || '').length; if (!len && e.dataTransfer) len = e.dataTransfer.getData('text/plain').length;
    if (/^delete/.test(type)) { const sel = 'value' in n ? Math.abs(n.selectionEnd - n.selectionStart) : String(getSelection()).length; t.deleted += sel || 1; }
    else if (/^insert/.test(type)) { if (/Paste|Drop|Yank/.test(type) || len >= MIN) t.pasted += len; else t.typed += len || 1; }
  }, true);
  async function send() {
    if (!dirty || !el || busy) return; busy = true; const snap = { ...t }, text = textOf(el);
    try {
      const r = await chrome.runtime.sendMessage({ type: 'cp', key, title: document.title, text, stats: { ...snap, activeSec: Math.round(snap.activeSec), length: text.length } });
      if (r && r.ok) { for (const k in snap) t[k] -= snap[k]; dirty = Object.values(t).some(v => v > 0.5); }
    } catch {}
    busy = false;
  }
  setInterval(send, 60000); addEventListener('visibilitychange', () => document.hidden && send());
  chrome.runtime.onMessage.addListener(m => { if (m.type === 'flush') send(); });
})();

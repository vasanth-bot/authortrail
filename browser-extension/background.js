// Hashes text and talks to the AuthorTrail server. The text itself is never sent.
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const cfg = async () => { const s = await chrome.storage.local.get({ server: 'http://localhost:3000', library: '', docs: {} }); s.server = s.server.replace(/\/$/, ''); return s; };
async function call(server, path, body, token) {
  const r = await fetch(`${server}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-owner-token': token } : {}) }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j;
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.type !== 'cp') return;
  (async () => {
    const c = await cfg(); let d = c.docs[m.key];
    if (!d) { const r = await call(c.server, 'docs', { title: m.title || m.key, source: 'browser', library: c.library }); d = { id: r.id, token: r.ownerToken, salt: crypto.randomUUID(), n: 0 }; c.docs[m.key] = d; await chrome.storage.local.set({ docs: c.docs }); }
    await call(c.server, `docs/${d.id}/checkpoints`, { contentHash: await sha(d.salt + m.text), stats: m.stats }, d.token);
    d.n++; c.docs[m.key] = d; await chrome.storage.local.set({ docs: c.docs });
    if (sender.tab) chrome.action.setBadgeText({ tabId: sender.tab.id, text: String(d.n) });
    reply({ ok: true, n: d.n });
  })().catch(e => reply({ ok: false, error: e.message }));
  return true;
});

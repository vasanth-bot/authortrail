const $ = s => document.querySelector(s);
(async () => {
  const s = await chrome.storage.local.get({ server: 'http://localhost:3000', library: '', docs: {} });
  $('#server').value = s.server; $('#lib').value = s.library;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const u = tab.url ? new URL(tab.url) : null, d = u ? s.docs[u.origin + u.pathname] : null, status = t => $('#st').textContent = t;
  if (d) status(`This page is tracked: ${d.n} checkpoints.`);
  const save = async () => { await chrome.storage.local.set({ server: $('#server').value.trim(), library: $('#lib').value.trim() }); status('Settings saved.'); };
  $('#save').onclick = save;
  $('#track').onclick = async () => { await save(); try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] }); status('Tracking started. Write in any text box on this page.'); } catch (e) { status('Cannot track this page: ' + e.message); } };
  $('#cp').onclick = async () => { try { await chrome.tabs.sendMessage(tab.id, { type: 'flush' }); status('Checkpoint requested.'); } catch { status('Press Track this tab first.'); } };
  $('#open').onclick = () => chrome.tabs.create({ url: $('#server').value.trim().replace(/\/$/, '') + (d ? '/verify.html?id=' + d.id : '/write.html') });
})();

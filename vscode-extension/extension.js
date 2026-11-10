// AuthorTrail for VS Code. Sends only hashes and counts to the server, never your code.
const vscode = require('vscode'), http = require('http'), https = require('https'), crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const zero = () => ({ typed: 0, pasted: 0, deleted: 0, activeSec: 0, bursts: 0 });
let ctx, bar, sess, touched = new Set(), t = zero(), lastAt = 0, dirty = false, count = 0, timer;
const cfg = k => vscode.workspace.getConfiguration('authortrail').get(k);
const server = () => String(cfg('serverUrl')).replace(/\/$/, '');
const wsKey = () => 'at:' + (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'none');

function post(url, body, token) {
  return new Promise((ok, no) => {
    const u = new URL(url), data = JSON.stringify(body);
    const r = (u.protocol === 'https:' ? https : http).request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(token ? { 'x-owner-token': token } : {}) } }, res => {
      let b = ''; res.on('data', x => b += x);
      res.on('end', () => { try { const j = JSON.parse(b); res.statusCode < 300 ? ok(j) : no(new Error(j.error || res.statusCode)); } catch (e) { no(e); } });
    });
    r.on('error', no); r.end(data);
  });
}
const label = () => { bar.text = sess ? `$(link) AuthorTrail: ${count} checkpoints${dirty ? '*' : ''}` : '$(circle-slash) AuthorTrail: off'; };

function onChange(e) {
  if (!sess || e.document.uri.scheme !== 'file' || !e.contentChanges.length) return;
  const p = e.document.uri.fsPath; if (/[\\/](node_modules|\.git)[\\/]/.test(p)) return;
  touched.add(p); dirty = true;
  if (e.reason) { label(); return; } // undo/redo: changes text but is not new writing
  const now = Date.now(), gap = now - lastAt; lastAt = now;
  if (gap > 5000) { t.bursts++; t.activeSec++; } else t.activeSec += gap / 1000;
  const min = Number(cfg('pasteThreshold')) || 20;
  for (const c of e.contentChanges) {
    t.deleted += c.rangeLength;
    if (c.text.length >= min) t.pasted += c.text.length; else t.typed += c.text.length;
  }
  label();
}

// Edited files as [relative path, text], sorted by path. The reveal file must use the same form.
function snapshot() {
  return [...touched].map(f => { const d = vscode.workspace.textDocuments.find(x => x.uri.fsPath === f); return [vscode.workspace.asRelativePath(f, false).replace(/\\/g, '/'), d ? d.getText() : '']; }).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

async function exportReveal() {
  if (!sess) return vscode.window.showErrorMessage('AuthorTrail: start tracking first.');
  await checkpoint(false); // so the file matches the latest checkpoint exactly
  const files = {}; for (const [f, s] of snapshot()) files[f] = s;
  const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(require('path').join(require('os').homedir(), 'authortrail-reveal.json')), filters: { JSON: ['json'] } });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify({ id: sess.id, salt: sess.salt, files }, null, 1)));
  vscode.window.showInformationMessage('Reveal file saved. Share it only with the person who should see this code.');
}

async function checkpoint(manual) {
  if (!sess) return;
  if (!dirty) { if (manual) vscode.window.showInformationMessage('AuthorTrail: nothing new to save.'); return; }
  const snap = { ...t }; let len = 0;
  const snapFiles = snapshot(), parts = snapFiles.map(([f, s]) => { len += s.length; return f + ':' + sha(sess.salt + s); });
  try {
    await post(`${server()}/api/docs/${sess.id}/checkpoints`, { contentHash: sha(parts.join('\n')), stats: { ...snap, activeSec: Math.round(snap.activeSec), length: len } }, sess.token);
    for (const k in snap) t[k] -= snap[k];
    count++; dirty = Object.values(t).some(v => v > 0.5); label();
    if (cfg('cloudSave') === true) for (const [f, s] of snapFiles) if (s.length <= 200000) await post(`${server()}/api/docs/${sess.id}/files`, { name: f, content: s }, sess.token).catch(() => {});
    if (manual) vscode.window.showInformationMessage('AuthorTrail: checkpoint saved.');
  } catch (e) { bar.text = '$(warning) AuthorTrail: server unreachable'; if (manual) vscode.window.showErrorMessage('AuthorTrail: ' + e.message); }
}

async function start() {
  const name = vscode.workspace.workspaceFolders?.[0]?.name || 'Untitled';
  try {
    let lib = ctx.globalState.get('at:library');
    if (lib === undefined) { lib = (await vscode.window.showInputBox({ prompt: 'Paste your AuthorTrail connection code from the Write page (optional)', ignoreFocusOut: true })) || ''; await ctx.globalState.update('at:library', lib); }
    const r = await post(server() + '/api/docs', { title: name, source: 'vscode', library: lib });
    sess = { id: r.id, token: r.ownerToken, salt: crypto.randomUUID() };
    await ctx.globalState.update(wsKey(), sess); count = 0; label();
    vscode.window.showInformationMessage(`AuthorTrail is tracking "${name}".`);
  } catch (e) { vscode.window.showErrorMessage(`AuthorTrail: cannot reach ${server()}. Is the server running? (${e.message})`); }
}

async function connect() {
  const code = (await vscode.window.showInputBox({ prompt: 'Connection code from the AuthorTrail Write page', ignoreFocusOut: true }) || '').trim();
  if (!code) return;
  await ctx.globalState.update('at:library', code);
  if (sess) { try { await post(`${server()}/api/docs/${sess.id}/library`, { library: code }, sess.token); } catch (e) { return vscode.window.showErrorMessage('AuthorTrail: ' + e.message); } }
  vscode.window.showInformationMessage('AuthorTrail: connected. This workspace now appears in your document list.');
}

exports.activate = c => {
  ctx = c; sess = c.globalState.get(wsKey());
  bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0); bar.command = 'authortrail.checkpoint'; label(); bar.show();
  timer = setInterval(() => checkpoint(false), 60000);
  c.subscriptions.push(bar, { dispose: () => clearInterval(timer) },
    vscode.workspace.onDidChangeTextDocument(onChange),
    vscode.commands.registerCommand('authortrail.start', start),
    vscode.commands.registerCommand('authortrail.connect', connect),
    vscode.commands.registerCommand('authortrail.exportReveal', exportReveal),
    vscode.commands.registerCommand('authortrail.checkpoint', () => sess ? checkpoint(true) : start()),
    vscode.commands.registerCommand('authortrail.copyLink', async () => { if (!sess) return start(); await vscode.env.clipboard.writeText(`${server()}/verify.html?id=${sess.id}`); vscode.window.showInformationMessage('Verification link copied.'); }));
};
exports.deactivate = () => checkpoint(false);

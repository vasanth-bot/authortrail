// AuthorTrail backend: zero dependencies, Node 18+.
// Stores ONLY hashes and statistics, never document text.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, DB = path.join(__dirname, 'data', 'db.json');
fs.mkdirSync(path.dirname(DB), { recursive: true });
let db = { docs: {} };
db.classes = db.classes || {}; db.users = db.users || {}; db.sessions = db.sessions || {};
const scrypt = require('util').promisify(crypto.scrypt), loginTries = {};
const userBySession = req => { const t = (req.headers.authorization || '').replace(/^Bearer /, ''), s = t && db.sessions[sha(t)]; return s && s.exp > Date.now() ? db.users[s.userId] : null; };
// Storage: a Postgres database when DATABASE_URL is set (for free hosting), otherwise a local JSON file.
let pool = null, saving = Promise.resolve();
async function initStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
    await pool.query('CREATE TABLE IF NOT EXISTS store (id INT PRIMARY KEY, data JSONB NOT NULL)');
    const r = await pool.query('SELECT data FROM store WHERE id = 1');
    if (r.rows[0]) db = r.rows[0].data;
    console.log('Using Postgres database');
  } else if (fs.existsSync(DB)) { db = JSON.parse(fs.readFileSync(DB)); console.log('Using local file data/db.json'); }
  db.docs ||= {}; db.classes ||= {}; db.users ||= {}; db.sessions ||= {};
}
const save = () => {
  if (!pool) return fs.writeFileSync(DB, JSON.stringify(db, null, 1));
  const snap = JSON.stringify(db); // writes are queued so they never overlap
  saving = saving.then(() => pool.query('INSERT INTO store (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [snap])).catch(e => console.error('Database save failed:', e.message));
};
process.on('SIGTERM', async () => { await saving; process.exit(0); });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);

// Each entry commits to the previous one, so editing or backdating history breaks the chain.
const entryHash = (prev, c) => sha([prev, c.contentHash, JSON.stringify(c.stats), c.serverTime].join('|'));

function merkleLevels(leaves) {
  let lvl = leaves.slice(); const levels = [lvl];
  while (lvl.length > 1) {
    const next = [];
    for (let i = 0; i < lvl.length; i += 2) next.push(sha(lvl[i] + (lvl[i + 1] ?? lvl[i])));
    levels.push(next); lvl = next;
  }
  return levels;
}
function merkleProof(levels, i) {
  const proof = [];
  for (let l = 0; l < levels.length - 1; l++) {
    const sib = i % 2 ? i - 1 : i + 1;
    proof.push({ hash: levels[l][sib] ?? levels[l][i], left: i % 2 === 1 });
    i = Math.floor(i / 2);
  }
  return proof;
}
function checkChain(chain) {
  let prev = GENESIS;
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i];
    if (c.prevHash !== prev || entryHash(prev, c) !== c.hash) return { ok: false, brokenAt: i };
    if (i && c.serverTime < chain[i - 1].serverTime) return { ok: false, brokenAt: i };
    prev = c.hash;
  }
  return { ok: true };
}
// Describes the process. It never claims "human" or "AI".
function report(chain) {
  const t = k => chain.reduce((a, c) => a + c.stats[k], 0);
  const typed = t('typed'), pasted = t('pasted'), total = typed + pasted;
  return {
    checkpoints: chain.length, typedChars: typed, pastedChars: pasted, deletedChars: t('deleted'),
    typedShare: total ? +(typed / total).toFixed(3) : null,
    activeMinutes: +(t('activeSec') / 60).toFixed(1), writingBursts: t('bursts'),
    largePastes: chain.filter(c => c.stats.pasted >= 200).map(c => ({ index: c.index, chars: c.stats.pasted, at: c.serverTime })),
    spanMinutes: chain.length ? +((chain.at(-1).serverTime - chain[0].serverTime) / 60000).toFixed(1) : 0,
    note: 'Describes how the text was entered in this editor. It cannot prove a person did not read and retype other text.'
  };
}
const num = v => Math.max(0, Math.min(1e7, Math.floor(Number(v) || 0)));
// Originality: a transparent, process-based score. It is NOT an AI detector.
function originality(r) {
  if (r.typedChars + r.pastedChars < 200) return null;
  const entry = r.typedShare, rev = Math.min(1, (r.deletedChars / Math.max(r.typedChars, 1)) / 0.1);
  const cpm = r.activeMinutes ? r.typedChars / r.activeMinutes : Infinity, pace = cpm <= 500 ? 1 : Math.max(0, 1 - (cpm - 500) / 500);
  const score = Math.round(70 * entry + 15 * rev + 15 * pace);
  return { score, label: score >= 80 ? 'High' : score >= 50 ? 'Moderate' : 'Low', parts: { entry: Math.round(entry * 100), revision: Math.round(rev * 100), pace: Math.round(pace * 100) }, formula: '70% how the text was entered + 15% revision + 15% writing pace' };
}
function suggestions(r, o) {
  if (!o) return ['Write a little more (about 200 characters) and a score will appear.'];
  const s = [];
  if (o.parts.entry < 85) s.push(`${100 - o.parts.entry}% of the inserted text arrived by paste${r.largePastes.length ? ` (large pastes at checkpoint ${r.largePastes.map(p => p.index + 1).join(', ')})` : ''}. Rewrite those passages from your own understanding, and keep direct quotes short and cited.`);
  if (o.parts.revision < 60) s.push('Very little was revised. Draft first, then rework sentences: cut, reorder and rephrase as your ideas sharpen.');
  if (o.parts.pace < 70) s.push('Text arrived faster than typical drafting. Work from your own outline in shorter sessions and think as you write.');
  if (r.writingBursts <= 1 && r.activeMinutes > 0) s.push('Everything was written in one sitting. Spreading the work over several sessions shows a more natural drafting process.');
  if (!s.length) s.push('Your process looks healthy. Keep drafting and revising as you are.');
  if (o.score < 80) s.push('Note: retyping text someone else wrote would raise this score without making it your work. The score measures process, not ownership of ideas.');
  return s;
}
const withScore = r => { const o = originality(r); return { ...r, originality: o, suggestions: suggestions(r, o) }; };

// AI coach: set ANTHROPIC_API_KEY on the server. Receives statistics (and a draft only if the author sends one).
const aiCalls = {};
const COACH = 'You are a writing coach inside AuthorTrail, a tool that records how a text was written. You receive process statistics, and sometimes the draft. Give 4 to 6 concrete, personalised steps that help the author make the work genuinely their own: draft from their own outline, revise in their own words, quote and cite sources instead of pasting, write across several sessions. If a draft is included, comment on ideas, structure and voice with questions and pointers, but never rewrite it or generate text for them. Never suggest ways to disguise copied or AI-generated text or to inflate the score; the score only measures how text was entered. Be warm, specific and brief (under 250 words), in plain text.';
function callClaude(system, user) {
  return new Promise((ok, no) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return no(Object.assign(new Error('The AI coach is not set up. The server owner must set ANTHROPIC_API_KEY.'), { code: 503 }));
    const u = new URL((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages');
    const data = JSON.stringify({ model: process.env.AUTHORTRAIL_MODEL || 'claude-sonnet-5-5', max_tokens: 700, system, messages: [{ role: 'user', content: user }] });
    const r = (u.protocol === 'https:' ? https : http).request(u, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(data) } }, res => {
      let b = ''; res.on('data', x => b += x);
      res.on('end', () => { try { const j = JSON.parse(b); res.statusCode < 300 ? ok((j.content || []).map(c => c.text || '').join('')) : no(new Error(j.error?.message || 'AI request failed')); } catch (e) { no(e); } });
    });
    r.on('error', no); r.end(data);
  });
}

// Access: the author (owner token or connection code), a teacher the work was submitted to, or a valid share link.
const authed = (d, req) => sha(req.headers['x-owner-token'] || '') === d.ownerHash || Boolean(d.libHash && sha(req.headers['x-library-code'] || '') === d.libHash);
const classAccess = (d, req) => { const h = sha(req.headers['x-library-code'] || ''); return Object.values(db.classes).some(c => c.ownerHash === h && c.subs.some(s => s.docId === d.id)); };
const canView = (d, req, key) => (d.visibility || 'public') === 'public' || authed(d, req) || classAccess(d, req) || (d.shares || []).some(s => s.key === key && s.expires > Date.now());
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
const view = d => {
  const levels = merkleLevels(d.chain.map(c => c.hash));
  return { id: d.id, title: d.title, createdAt: d.createdAt, chain: d.chain, genesis: GENESIS,
    merkleRoot: levels.at(-1)?.[0] ?? null, integrity: checkChain(d.chain), report: withScore(report(d.chain)) };
};

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }); res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body)); };
const readBody = req => new Promise((ok, no) => { let b = ''; req.on('data', x => { b += x; if (b.length > 10000) { no(new Error('too large')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } }); });
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-owner-token, x-library-code, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); return res.end(); }
    if (p[0] !== 'api') { // static files
      let f = path.join(__dirname, 'public', p.join('/') || 'index.html');
      if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f)) return send(res, 404, 'Not found', 'text/plain');
      return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
    }
    if (p[1] === 'auth') { // accounts: scrypt-hashed passwords, 30-day sessions
      if (req.method === 'GET' && p[2] === 'me') { const u = userBySession(req); return u ? send(res, 200, { user: { name: u.name, email: u.email, libCode: u.libCode } }) : send(res, 401, { error: 'Please sign in.' }); }
      if (req.method === 'POST' && p[2] === 'logout') { delete db.sessions[sha((req.headers.authorization || '').replace(/^Bearer /, ''))]; save(); return send(res, 200, { ok: true }); }
      if (req.method === 'POST' && (p[2] === 'register' || p[2] === 'login')) {
        const b = await readBody(req), email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || ''), now = Date.now(), key = email + '|' + req.socket.remoteAddress;
        loginTries[key] = (loginTries[key] || []).filter(x => now - x < 9e5);
        if (loginTries[key].length >= 10) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
        loginTries[key].push(now);
        let u = Object.values(db.users).find(x => x.email === email);
        if (p[2] === 'register') {
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
          if (pw.length < 8) return send(res, 400, { error: 'Use a password of at least 8 characters.' });
          if (u) return send(res, 409, { error: 'An account with this email already exists. Log in instead.' });
          const want = String(b.libCode || ''), taken = Object.values(db.users).some(x => x.libCode === want), salt = crypto.randomBytes(16).toString('hex'), id = crypto.randomBytes(6).toString('hex');
          u = db.users[id] = { id, name: String(b.name || email.split('@')[0]).trim().slice(0, 60) || 'Author', email, salt, hash: (await scrypt(pw, salt, 64)).toString('hex'), libCode: /^[A-Za-z0-9-]{8,64}$/.test(want) && !taken ? want : crypto.randomBytes(8).toString('hex'), createdAt: now };
        } else if (!u || !crypto.timingSafeEqual(await scrypt(pw, u.salt, 64), Buffer.from(u.hash, 'hex'))) return send(res, 401, { error: 'Email or password is incorrect.' });
        const token = crypto.randomBytes(24).toString('hex'); db.sessions[sha(token)] = { userId: u.id, exp: now + 30 * 864e5 }; save();
        return send(res, p[2] === 'register' ? 201 : 200, { token, user: { name: u.name, email: u.email, libCode: u.libCode } });
      }
    }
    if (req.method === 'POST' && p.length === 2 && p[1] === 'docs') {
      const b = await readBody(req), id = crypto.randomBytes(6).toString('hex'), ownerToken = crypto.randomBytes(24).toString('hex');
      db.docs[id] = { id, title: String(b.title || 'Untitled').slice(0, 120), createdAt: Date.now(), ownerHash: sha(ownerToken), chain: [], source: ['vscode', 'browser'].includes(b.source) ? b.source : 'web', libHash: b.library ? sha(String(b.library)) : null };
      save(); return send(res, 201, { id, ownerToken });
    }
    if (req.method === 'POST' && p[1] === 'ai' && p[2] === 'coach') {
      const b = await readBody(req), d = db.docs[b.id];
      if (!d) return send(res, 404, { error: 'Document not found' });
      const isOwner = sha(req.headers['x-owner-token'] || '') === d.ownerHash, inLib = d.libHash && sha(req.headers['x-library-code'] || '') === d.libHash;
      if (!isOwner && !inLib) return send(res, 403, { error: 'Only the author can ask for coaching.' });
      const now = Date.now(); aiCalls[d.id] = (aiCalls[d.id] || []).filter(x => now - x < 36e5);
      if (aiCalls[d.id].length >= 20) return send(res, 429, { error: 'Coaching limit reached for this hour.' });
      aiCalls[d.id].push(now);
      const r = withScore(report(d.chain)), draft = typeof b.draft === 'string' ? b.draft.slice(0, 8000) : '';
      const stats = { originality: r.originality, typedChars: r.typedChars, pastedChars: r.pastedChars, deletedChars: r.deletedChars, activeMinutes: r.activeMinutes, writingBursts: r.writingBursts, largePastes: r.largePastes.length, checkpoints: r.checkpoints };
      const advice = await callClaude(COACH, `Writing statistics:\n${JSON.stringify(stats)}\n\nBuilt-in suggestions:\n- ${r.suggestions.join('\n- ')}` + (draft ? `\n\nThe author's draft (feedback only, do not rewrite it):\n\"\"\"\n${draft}\n\"\"\"` : ''));
      return send(res, 200, { advice });
    }
    if (req.method === 'GET' && p[1] === 'status') return send(res, 200, { ok: true, ai: Boolean(process.env.ANTHROPIC_API_KEY) });
    if (req.method === 'GET' && p[1] === 'library') { // everything linked to one connection code, from any source
      const h = sha(p[2] || '');
      return send(res, 200, Object.values(db.docs).filter(x => x.libHash === h).map(x => ({ id: x.id, title: x.title, source: x.source || 'web', createdAt: x.createdAt, checkpoints: x.chain.length, lastAt: x.chain.at(-1)?.serverTime ?? null, intact: checkChain(x.chain).ok, score: withScore(report(x.chain)).originality?.score ?? null })).sort((a, b) => b.createdAt - a.createdAt));
    }
    const lib = req.headers['x-library-code'] || '', libH = sha(lib);
    if (p[1] === 'classes') {
      if (req.method === 'POST' && p[2] === 'join') { // a student submits a document to a class
        const b = await readBody(req), d = db.docs[b.docId], c = Object.values(db.classes).find(x => x.joinCode === String(b.joinCode || '').toUpperCase());
        if (!c) return send(res, 404, { error: 'No class has that join code.' });
        if (!d || !authed(d, req)) return send(res, 403, { error: 'You can only submit your own documents.' });
        c.subs = c.subs.filter(s => s.docId !== d.id);
        c.subs.push({ docId: d.id, student: String(b.student || 'Student').slice(0, 80), submittedAt: Date.now(), cp: d.chain.length, lastHash: d.chain.at(-1)?.hash ?? null });
        save(); return send(res, 200, { className: c.name });
      }
      if (!lib) return send(res, 403, { error: 'Missing connection code.' });
      if (req.method === 'POST' && !p[2]) {
        const b = await readBody(req), id = crypto.randomBytes(5).toString('hex');
        const c = db.classes[id] = { id, name: String(b.name || 'My class').slice(0, 80), ownerHash: libH, joinCode: crypto.randomBytes(3).toString('hex').toUpperCase(), createdAt: Date.now(), subs: [] };
        save(); return send(res, 201, { id, name: c.name, joinCode: c.joinCode });
      }
      const own = Object.values(db.classes).filter(c => c.ownerHash === libH);
      if (req.method === 'GET' && !p[2]) return send(res, 200, own.map(c => ({ id: c.id, name: c.name, joinCode: c.joinCode, count: c.subs.length })));
      const c = own.find(x => x.id === p[2]); if (!c) return send(res, 404, { error: 'Class not found' });
      const rows = c.subs.map(s => {
        const d = db.docs[s.docId]; if (!d) return { student: s.student, title: '(deleted by author)', flags: ['Record deleted'], checkpoints: 0, intact: false, score: null };
        const r = withScore(report(d.chain)), ok = checkChain(d.chain).ok, kept = !s.lastHash || d.chain.some(x => x.hash === s.lastHash), after = d.chain.length - s.cp, flags = [];
        if (!ok || !kept) flags.push('Chain broken');
        if (r.originality && r.originality.score < 50) flags.push('Low originality');
        if (r.largePastes.length) flags.push(`${r.largePastes.length} large paste${r.largePastes.length > 1 ? 's' : ''}`);
        if (after > 0) flags.push(`Edited after submission (${after} new checkpoint${after > 1 ? 's' : ''})`);
        return { student: s.student, docId: d.id, title: d.title, submittedAt: s.submittedAt, checkpoints: d.chain.length, intact: ok && kept, score: r.originality ? r.originality.score : null, flags };
      });
      if (p[3] === 'csv') return send(res, 200, ['Student,Document,Submitted,Checkpoints,Integrity,Originality,Flags', ...rows.map(r => [r.student, r.title, r.submittedAt ? new Date(r.submittedAt).toISOString() : '', r.checkpoints, r.intact ? 'Intact' : 'Broken', r.score ?? '', r.flags.join('; ')].map(csvCell).join(','))].join('\n'), 'text/csv');
      return send(res, 200, { id: c.id, name: c.name, joinCode: c.joinCode, rows });
    }
    if (p[1] === 'insights') { // activity across everything linked to this connection code
      if (!lib) return send(res, 403, { error: 'Missing connection code.' });
      const mine = Object.values(db.docs).filter(d => d.libHash === libH), days = {};
      for (const d of mine) for (const c of d.chain) { const k = new Date(c.serverTime).toISOString().slice(0, 10), x = days[k] ||= { day: k, typed: 0, pasted: 0, activeMin: 0 }; x.typed += c.stats.typed; x.pasted += c.stats.pasted; x.activeMin += c.stats.activeSec / 60; }
      const list = Object.values(days).sort((a, b) => a.day < b.day ? -1 : 1).map(x => ({ ...x, activeMin: Math.round(x.activeMin) }));
      let t = Date.now(), streak = 0; if (!days[new Date(t).toISOString().slice(0, 10)]) t -= 864e5;
      while (days[new Date(t).toISOString().slice(0, 10)]) { streak++; t -= 864e5; }
      const best = list.reduce((a, x) => (!a || x.typed > a.typed) ? x : a, null);
      return send(res, 200, { days: list, streak, best, totals: { typed: list.reduce((a, x) => a + x.typed, 0), pasted: list.reduce((a, x) => a + x.pasted, 0), activeMin: list.reduce((a, x) => a + x.activeMin, 0) },
        docs: mine.map(d => ({ id: d.id, title: d.title, source: d.source || 'web', checkpoints: d.chain.length, score: withScore(report(d.chain)).originality?.score ?? null })) });
    }
    const d = db.docs[p[2]];
    if (!d) return send(res, 404, { error: 'Document not found' });
    if (req.method === 'GET' && !canView(d, req, url.searchParams.get('k'))) return send(res, 403, { error: 'This record is private. Ask the author for a share link.' });
    if (req.method === 'POST' && ['settings', 'shares', 'revoke', 'delete'].includes(p[3])) {
      if (!authed(d, req)) return send(res, 403, { error: 'Only the author can change this record.' });
      const b = await readBody(req);
      if (p[3] === 'settings') { if (b.visibility) d.visibility = b.visibility === 'private' ? 'private' : 'public';
        if (b.declaration) d.declaration = ['none', 'grammar', 'ideas', 'drafting'].includes(b.declaration.level) ? { level: b.declaration.level, note: String(b.declaration.note || '').slice(0, 300) } : null;
        save(); return send(res, 200, { visibility: d.visibility || 'public', declaration: d.declaration || null }); }
      if (p[3] === 'shares') { const days = Math.max(0, Math.min(365, Number(b.days) || 0)), s = { key: crypto.randomBytes(9).toString('hex'), expires: days ? Date.now() + days * 864e5 : 8.64e15 }; (d.shares ||= []).push(s); save(); return send(res, 201, s); }
      if (p[3] === 'revoke') { d.shares = []; save(); return send(res, 200, { ok: true }); }
      delete db.docs[d.id]; save(); return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p[3] === 'library') { // link an existing document to a connection code
      if (sha(req.headers['x-owner-token'] || '') !== d.ownerHash) return send(res, 403, { error: 'Invalid owner token' });
      const b = await readBody(req); d.libHash = b.library ? sha(String(b.library)) : null; save(); return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p[3] === 'checkpoints') {
      if (!authed(d, req)) return send(res, 403, { error: 'Invalid owner token' });
      const b = await readBody(req);
      if (!/^[0-9a-f]{64}$/.test(b.contentHash || '')) return send(res, 400, { error: 'contentHash must be a SHA-256 hex string' });
      const s = b.stats || {};
      const c = { index: d.chain.length, contentHash: b.contentHash, serverTime: Date.now(),
        stats: { typed: num(s.typed), pasted: num(s.pasted), deleted: num(s.deleted), activeSec: num(s.activeSec), bursts: num(s.bursts), length: num(s.length) },
        prevHash: d.chain.at(-1)?.hash ?? GENESIS };
      c.hash = entryHash(c.prevHash, c);
      d.chain.push(c); save(); return send(res, 201, c);
    }
    if (req.method === 'GET' && p.length === 3) return send(res, 200, { ...view(d), visibility: d.visibility || 'public', declaration: d.declaration || null, isOwner: authed(d, req) });
    if (req.method === 'GET' && p[3] === 'proof') { // Merkle inclusion proof for selective disclosure
      const i = Number(p[4]); if (!d.chain[i]) return send(res, 404, { error: 'No such checkpoint' });
      const levels = merkleLevels(d.chain.map(c => c.hash));
      return send(res, 200, { index: i, leaf: d.chain[i].hash, proof: merkleProof(levels, i), root: levels.at(-1)[0] });
    }
    if (req.method === 'GET' && p[3] === 'anchor') { // digest to stamp externally, e.g. `ots stamp`
      const levels = merkleLevels(d.chain.map(c => c.hash));
      return send(res, 200, `authortrail:${d.id}:${d.chain.length}:${levels.at(-1)?.[0] ?? GENESIS}\n`, 'text/plain');
    }
    send(res, 404, { error: 'Unknown route' });
  } catch (e) { send(res, e.code === 503 ? 503 : 400, { error: e.message }); }
});
server.on('error', e => { console.error(e.message); process.exit(1); });
initStore().then(() => server.listen(PORT, () => console.log(`AuthorTrail running at http://localhost:${PORT}`))).catch(e => { console.error('Could not start:', e.message); process.exit(1); });

// The API. Runs as one Vercel function (api/index.js) and locally (dev-server.js).
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { CRITERIA, PHASES, SESSION_DAYS, BCRYPT_ROUNDS, MIN_PASSWORD } = require('../config');

const app = express();
const COOKIE = 'hk_session';
const ON_VERCEL = !!process.env.VERCEL;
const SECURE_COOKIE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : (ON_VERCEL || process.env.NODE_ENV === 'production');
if (ON_VERCEL) app.set('trust proxy', true);
else if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

const now = () => Date.now();
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
let dummyHash = null;
const getDummyHash = () => (dummyHash ||= bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS));

class Bad extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------------- headers, parsing, schema, CSRF guard ---------------- */
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(wrap(async (req, res, next) => { await db.ensureSchema(); next(); }));

app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!req.is('application/json')) return res.status(415).json({ error: 'Requests must be sent as JSON.' });
  const origin = req.headers.origin;
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* bad origin */ }
    const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
    if (!allowed.includes(host)) return res.status(403).json({ error: 'Request blocked.' });
  }
  next();
});

/* ---------------- sessions ---------------- */
function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip */ } }
  });
  return out;
}
function setSessionCookie(res, value, maxAgeSec) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${SECURE_COOKIE ? '; Secure' : ''}`);
}
app.use(wrap(async (req, res, next) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const hash = sha256(token);
    const user = await db.get(`
      SELECT u.id, u.username, u.role, u.display_name, u.team_id, t.code_name
      FROM sessions s JOIN users u ON u.id = s.user_id
      LEFT JOIN teams t ON t.id = u.team_id
      WHERE s.token_hash = ? AND s.expires_at > ?`, [hash, now()]);
    if (user) { req.user = user; req.sessionHash = hash; }
  }
  next();
}));
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (role && req.user.role !== role) return res.status(403).json({ error: 'You don’t have access to this.' });
    next();
  };
}

/* ---------------- validation ---------------- */
function text(v, max, name, { required = false } = {}) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new Bad(`${name} must be text.`);
  v = v.trim();
  if (required && !v) throw new Bad(`${name} is required.`);
  if (v.length > max) throw new Bad(`${name} is too long (max ${max} characters).`);
  return v;
}
function username(v) {
  v = text(v, 40, 'Username', { required: true });
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(v)) throw new Bad('Username needs 3 to 40 letters, numbers, dots, dashes or underscores.');
  return v;
}
function password(v) {
  if (typeof v !== 'string' || v.length < MIN_PASSWORD) throw new Bad(`Password needs at least ${MIN_PASSWORD} characters.`);
  if (v.length > 200) throw new Bad('Password is too long.');
  return v;
}
function safeUrl(u) {
  try { const x = new URL(String(u).trim()); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; }
  catch { return null; }
}
function idParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Bad('Not found.', 404);
  return n;
}

/* ---------------- shared helpers ---------------- */
async function getSettings() {
  const s = {};
  (await db.all('SELECT key, value FROM settings')).forEach((r) => { s[r.key] = r.value === '1'; });
  return { submissionsOpen: !!s.submissions_open, phase1Open: !!s.phase1_open, phase2Open: !!s.phase2_open };
}
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, role: u.role, displayName: u.display_name,
    team: u.role === 'team' ? { id: u.team_id, codeName: u.code_name } : null,
  };
}
function mapSubmission(r) {
  if (!r) return null;
  let links = [];
  try { links = JSON.parse(r.links_json); } catch { /* keep empty */ }
  return { title: r.title, problem: r.problem, approach: r.approach, solution: r.solution,
    techStack: r.tech_stack, impact: r.impact, links, updatedAt: r.updated_at };
}
function mapSheet(r) {
  const scores = {};
  CRITERIA.forEach((c) => { scores[c.id] = r[c.column]; });
  return { judgeId: r.judge_id, teamId: r.team_id, phase: r.phase, scores, comment: r.comment, updatedAt: r.updated_at };
}
const sheetSum = (s) => CRITERIA.reduce((a, c) => a + s.scores[c.id], 0);

async function computeStandings() {
  const [teams, judges, rawSheets] = await Promise.all([
    db.all('SELECT id, code_name FROM teams ORDER BY code_name'),
    db.all("SELECT id FROM users WHERE role = 'judge'"),
    db.all("SELECT s.* FROM score_sheets s JOIN users u ON u.id = s.judge_id AND u.role = 'judge'"),
  ]);
  const sheets = rawSheets.map(mapSheet);
  const rows = teams.map((t) => {
    const row = { teamId: t.id, codeName: t.code_name, total: 0, judgeCount: judges.length };
    PHASES.forEach((p) => {
      const sums = sheets.filter((s) => s.teamId === t.id && s.phase === p.id).map(sheetSum);
      const avg = sums.length ? sums.reduce((a, b) => a + b, 0) / sums.length : null;
      row[p.id] = { avg, count: sums.length };
      row.total += avg || 0;
    });
    return row;
  });
  rows.sort((a, b) => b.total - a.total || a.codeName.localeCompare(b.codeName));
  let rank = 0; let prev = null;
  rows.forEach((r, i) => { const key = Math.round(r.total * 100); if (key !== prev) { rank = i + 1; prev = key; } r.rank = rank; });
  return rows;
}
async function getResults() {
  const r = await db.get('SELECT * FROM results WHERE id = 1');
  if (!r || !r.published) return { published: false };
  const names = new Map((await db.all('SELECT id, code_name FROM teams')).map((t) => [t.id, t.code_name]));
  const ranking = JSON.parse(r.ranking_json).filter((x) => names.has(x.teamId)).map((x) => ({ ...x, codeName: names.get(x.teamId) }));
  return { published: true, publishedAt: r.published_at, ranking };
}

/* ---------------- auth ---------------- */
const api = express.Router();
const LIMIT = 10; const WINDOW = 15 * 60 * 1000;

api.post('/login', wrap(async (req, res) => {
  const name = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const pass = typeof req.body.password === 'string' ? req.body.password : '';
  const key = `${req.ip}|${name.toLowerCase()}`;
  const t = now();
  const att = await db.get('SELECT count, reset_at FROM login_attempts WHERE key = ?', [key]);
  if (att && att.reset_at > t && att.count >= LIMIT) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again.' });

  const user = name ? await db.get(`
    SELECT u.*, t.code_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.username = ?`, [name]) : null;
  const ok = await bcrypt.compare(pass, user ? user.password_hash : getDummyHash());
  if (!user || !ok) {
    await db.run(`
      INSERT INTO login_attempts (key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
        reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END`, [key, t + WINDOW, t, t, t + WINDOW]);
    return res.status(401).json({ error: 'Username or password is incorrect.' });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  await db.batch([
    ['DELETE FROM login_attempts WHERE key = ? OR reset_at <= ?', [key, t]],
    ['DELETE FROM sessions WHERE expires_at <= ?', [t]],
    ['INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha256(token), user.id, t + maxAge * 1000]],
  ]);
  setSessionCookie(res, token, maxAge);
  res.json({ user: publicUser(user) });
}));

api.post('/logout', wrap(async (req, res) => {
  if (req.sessionHash) await db.run('DELETE FROM sessions WHERE token_hash = ?', [req.sessionHash]);
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
}));

api.get('/me', wrap(async (req, res) => {
  res.json({
    user: publicUser(req.user),
    settings: req.user ? await getSettings() : null,
    criteria: CRITERIA.map(({ id, name, max }) => ({ id, name, max })),
    phases: PHASES.map(({ id, short, name }) => ({ id, short, name })),
  });
}));

api.get('/results', requireRole(), wrap(async (req, res) => res.json(await getResults())));

/* ---------------- team ---------------- */
api.get('/team/submission', requireRole('team'), wrap(async (req, res) => {
  res.json({ submission: mapSubmission(await db.get('SELECT * FROM submissions WHERE team_id = ?', [req.user.team_id])) });
}));

api.put('/team/submission', requireRole('team'), wrap(async (req, res) => {
  if (!(await getSettings()).submissionsOpen) throw new Bad('Submissions are closed.', 409);
  const b = req.body || {};
  const links = Array.isArray(b.links) ? b.links : [];
  if (links.length > 20) throw new Bad('Add at most 20 links.');
  const cleanLinks = links.map((l, i) => {
    const url = safeUrl(l && l.url);
    if (!url || url.length > 1000) throw new Bad(`Link ${i + 1} needs to be a web address starting with https://`);
    return { label: text(l.label, 80, `Link ${i + 1} label`), url };
  });
  const vals = [
    req.user.team_id,
    text(b.title, 200, 'Project title'),
    text(b.problem, 5000, 'Problem statement'),
    text(b.approach, 5000, 'Approach'),
    text(b.solution, 5000, 'Solution'),
    text(b.techStack, 300, 'Tech stack'),
    text(b.impact, 5000, 'Business impact'),
    JSON.stringify(cleanLinks),
    now(),
  ];
  await db.run(`
    INSERT INTO submissions (team_id, title, problem, approach, solution, tech_stack, impact, links_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id) DO UPDATE SET title = excluded.title, problem = excluded.problem,
      approach = excluded.approach, solution = excluded.solution, tech_stack = excluded.tech_stack,
      impact = excluded.impact, links_json = excluded.links_json, updated_at = excluded.updated_at`, vals);
  res.json({ submission: mapSubmission(await db.get('SELECT * FROM submissions WHERE team_id = ?', [req.user.team_id])) });
}));

/* ---------------- judge (code names only, never members) ---------------- */
api.get('/judge/teams', requireRole('judge'), wrap(async (req, res) => {
  const rows = await db.all(`
    SELECT t.id AS tid, t.code_name AS tname, s.* FROM teams t
    LEFT JOIN submissions s ON s.team_id = t.id ORDER BY t.code_name`);
  res.json({ teams: rows.map((r) => ({ id: r.tid, codeName: r.tname, submission: r.updated_at ? mapSubmission(r) : null })) });
}));

api.get('/judge/scores', requireRole('judge'), wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM score_sheets WHERE judge_id = ?', [req.user.id]);
  res.json({ sheets: rows.map(mapSheet).map(({ judgeId, ...rest }) => rest) });
}));

api.put('/judge/scores/:teamId/:phase', requireRole('judge'), wrap(async (req, res) => {
  const teamId = idParam(req.params.teamId);
  const phase = PHASES.find((p) => p.id === req.params.phase);
  if (!phase) throw new Bad('Not found.', 404);
  if (!(await getSettings())[phase.id + 'Open']) throw new Bad(`${phase.short} judging is closed.`, 409);
  if (!(await db.get('SELECT 1 AS ok FROM teams WHERE id = ?', [teamId]))) throw new Bad('Team not found.', 404);
  const scores = (req.body && req.body.scores) || {};
  const vals = CRITERIA.map((c) => {
    const v = scores[c.id];
    if (!Number.isInteger(v) || v < 1 || v > c.max) throw new Bad(`${c.name} needs a score from 1 to ${c.max}.`);
    return v;
  });
  const cols = CRITERIA.map((c) => c.column);
  await db.run(`
    INSERT INTO score_sheets (judge_id, team_id, phase, ${cols.join(', ')}, comment, updated_at)
    VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)
    ON CONFLICT(judge_id, team_id, phase) DO UPDATE SET
      ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}, comment = excluded.comment, updated_at = excluded.updated_at`,
  [req.user.id, teamId, phase.id, ...vals, text(req.body.comment, 2000, 'Comment'), now()]);
  res.json({ ok: true });
}));

/* ---------------- admin ---------------- */
const admin = express.Router();
admin.use(requireRole('admin'));

admin.get('/data', wrap(async (req, res) => {
  const [teams, judges, sheets, standings, settings, results] = await Promise.all([
    db.all(`
      SELECT t.id AS tid, t.code_name AS tname, t.members AS tmembers, u.id AS user_id, u.username, s.*
      FROM teams t
      LEFT JOIN users u ON u.team_id = t.id AND u.role = 'team'
      LEFT JOIN submissions s ON s.team_id = t.id
      ORDER BY t.code_name`),
    db.all("SELECT id, username, display_name FROM users WHERE role = 'judge' ORDER BY display_name COLLATE NOCASE"),
    db.all('SELECT * FROM score_sheets'),
    computeStandings(), getSettings(), getResults(),
  ]);
  res.json({
    settings,
    teams: teams.map((r) => ({ id: r.tid, codeName: r.tname, members: r.tmembers, accountId: r.user_id, username: r.username,
      submission: r.updated_at ? mapSubmission(r) : null })),
    judges: judges.map((j) => ({ id: j.id, username: j.username, displayName: j.display_name })),
    sheets: sheets.map(mapSheet),
    standings, results,
  });
}));

admin.put('/settings', wrap(async (req, res) => {
  const map = { submissionsOpen: 'submissions_open', phase1Open: 'phase1_open', phase2Open: 'phase2_open' };
  const stmts = [];
  Object.entries(map).forEach(([k, col]) => {
    if (k in (req.body || {})) {
      if (typeof req.body[k] !== 'boolean') throw new Bad(`${k} must be true or false.`);
      stmts.push(['UPDATE settings SET value = ? WHERE key = ?', [req.body[k] ? '1' : '0', col]]);
    }
  });
  if (stmts.length) await db.batch(stmts);
  res.json({ settings: await getSettings() });
}));

admin.post('/teams', wrap(async (req, res) => {
  const b = req.body || {};
  const codeName = text(b.codeName, 60, 'Team name', { required: true });
  const members = text(b.members, 500, 'Members');
  const user = username(b.username);
  const hash = await bcrypt.hash(password(b.password), BCRYPT_ROUNDS);
  const t = now();
  await db.batch([
    ['INSERT INTO teams (code_name, members, created_at) VALUES (?, ?, ?)', [codeName, members, t]],
    [`INSERT INTO users (username, password_hash, role, team_id, display_name, created_at)
      VALUES (?, ?, 'team', (SELECT id FROM teams WHERE code_name = ?), ?, ?)`, [user, hash, codeName, codeName, t]],
  ]);
  const row = await db.get('SELECT id FROM teams WHERE code_name = ?', [codeName]);
  res.status(201).json({ id: row.id });
}));

admin.patch('/teams/:id', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const team = await db.get('SELECT * FROM teams WHERE id = ?', [id]);
  if (!team) throw new Bad('Team not found.', 404);
  const b = req.body || {};
  const codeName = 'codeName' in b ? text(b.codeName, 60, 'Team name', { required: true }) : team.code_name;
  const members = 'members' in b ? text(b.members, 500, 'Members') : team.members;
  const user = 'username' in b ? username(b.username) : null;
  const hash = b.password ? await bcrypt.hash(password(b.password), BCRYPT_ROUNDS) : null;
  const acct = await db.get("SELECT id FROM users WHERE team_id = ? AND role = 'team'", [id]);
  const stmts = [['UPDATE teams SET code_name = ?, members = ? WHERE id = ?', [codeName, members, id]]];
  if (acct) {
    stmts.push(['UPDATE users SET display_name = ? WHERE id = ?', [codeName, acct.id]]);
    if (user) stmts.push(['UPDATE users SET username = ? WHERE id = ?', [user, acct.id]]);
    if (hash) {
      stmts.push(['UPDATE users SET password_hash = ? WHERE id = ?', [hash, acct.id]]);
      stmts.push(['DELETE FROM sessions WHERE user_id = ?', [acct.id]]);
    }
  } else if (user && hash) {
    stmts.push([`INSERT INTO users (username, password_hash, role, team_id, display_name, created_at)
      VALUES (?, ?, 'team', ?, ?, ?)`, [user, hash, id, codeName, now()]]);
  }
  await db.batch(stmts);
  res.json({ ok: true });
}));

admin.delete('/teams/:id', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  if (!(await db.get('SELECT 1 AS ok FROM teams WHERE id = ?', [id]))) throw new Bad('Team not found.', 404);
  await db.batch([
    ['DELETE FROM score_sheets WHERE team_id = ?', [id]],
    ['DELETE FROM submissions WHERE team_id = ?', [id]],
    ["DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE team_id = ?)", [id]],
    ['DELETE FROM users WHERE team_id = ?', [id]],
    ['DELETE FROM teams WHERE id = ?', [id]],
  ]);
  res.json({ ok: true });
}));

admin.post('/judges', wrap(async (req, res) => {
  const b = req.body || {};
  const name = text(b.displayName, 80, 'Name', { required: true });
  const user = username(b.username);
  const hash = await bcrypt.hash(password(b.password), BCRYPT_ROUNDS);
  const r = await db.run("INSERT INTO users (username, password_hash, role, display_name, created_at) VALUES (?, ?, 'judge', ?, ?)",
    [user, hash, name, now()]);
  res.status(201).json({ id: r.lastId });
}));

admin.patch('/judges/:id', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const judge = await db.get("SELECT * FROM users WHERE id = ? AND role = 'judge'", [id]);
  if (!judge) throw new Bad('Judge not found.', 404);
  const b = req.body || {};
  const name = 'displayName' in b ? text(b.displayName, 80, 'Name', { required: true }) : judge.display_name;
  const user = 'username' in b ? username(b.username) : judge.username;
  const hash = b.password ? await bcrypt.hash(password(b.password), BCRYPT_ROUNDS) : null;
  const stmts = [['UPDATE users SET display_name = ?, username = ? WHERE id = ?', [name, user, id]]];
  if (hash) {
    stmts.push(['UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]]);
    stmts.push(['DELETE FROM sessions WHERE user_id = ?', [id]]);
  }
  await db.batch(stmts);
  res.json({ ok: true });
}));

admin.delete('/judges/:id', wrap(async (req, res) => {
  const id = idParam(req.params.id);
  if (!(await db.get("SELECT 1 AS ok FROM users WHERE id = ? AND role = 'judge'", [id]))) throw new Bad('Judge not found.', 404);
  await db.batch([
    ['DELETE FROM score_sheets WHERE judge_id = ?', [id]],
    ['DELETE FROM sessions WHERE user_id = ?', [id]],
    ['DELETE FROM users WHERE id = ?', [id]],
  ]);
  res.json({ ok: true });
}));

admin.post('/results/publish', wrap(async (req, res) => {
  const ranking = (await computeStandings()).map((r) => ({ rank: r.rank, teamId: r.teamId, codeName: r.codeName }));
  await db.run('UPDATE results SET published = 1, ranking_json = ?, published_at = ? WHERE id = 1', [JSON.stringify(ranking), now()]);
  res.json(await getResults());
}));

admin.post('/results/withdraw', wrap(async (req, res) => {
  await db.run("UPDATE results SET published = 0, ranking_json = '[]', published_at = NULL WHERE id = 1");
  res.json(await getResults());
}));

admin.patch('/me/password', wrap(async (req, res) => {
  const b = req.body || {};
  const me = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(b.currentPassword || ''), me.password_hash))) throw new Bad('Current password is incorrect.');
  const hash = await bcrypt.hash(password(b.newPassword), BCRYPT_ROUNDS);
  await db.batch([
    ['UPDATE users SET password_hash = ? WHERE id = ?', [hash, me.id]],
    ['DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [me.id, req.sessionHash]],
  ]);
  res.json({ ok: true });
}));

api.use('/admin', admin);
api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use('/api', api);

/* ---------------- errors ---------------- */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof Bad) return res.status(err.status).json({ error: err.message });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  const msg = String((err && err.message) || '');
  if (msg.includes('UNIQUE constraint failed')) {
    if (msg.includes('users.username')) return res.status(409).json({ error: 'That username is already taken.' });
    if (msg.includes('teams.code_name')) return res.status(409).json({ error: 'A team with that name already exists.' });
    return res.status(409).json({ error: 'That conflicts with existing data.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

module.exports = app;

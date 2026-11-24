// Database access. Uses libSQL, which speaks SQLite:
//  - locally:   a SQLite file (file:./data/hackathon.db)
//  - on Vercel: a hosted Turso database (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const remoteUrl = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
let url = remoteUrl;
if (!url) {
  if (process.env.VERCEL) throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the Vercel project settings.');
  const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'hackathon.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  url = 'file:' + file;
}
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY,
  code_name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  members     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','team','judge')),
  display_name  TEXT NOT NULL DEFAULT '',
  team_id       INTEGER REFERENCES teams(id),
  created_at    INTEGER NOT NULL,
  CHECK ((role = 'team') = (team_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS login_attempts (
  key       TEXT PRIMARY KEY,
  count     INTEGER NOT NULL,
  reset_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  team_id     INTEGER PRIMARY KEY REFERENCES teams(id),
  title       TEXT NOT NULL DEFAULT '',
  problem     TEXT NOT NULL DEFAULT '',
  approach    TEXT NOT NULL DEFAULT '',
  solution    TEXT NOT NULL DEFAULT '',
  tech_stack  TEXT NOT NULL DEFAULT '',
  impact      TEXT NOT NULL DEFAULT '',
  links_json  TEXT NOT NULL DEFAULT '[]',
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS score_sheets (
  judge_id         INTEGER NOT NULL REFERENCES users(id),
  team_id          INTEGER NOT NULL REFERENCES teams(id),
  phase            TEXT NOT NULL CHECK (phase IN ('phase1','phase2')),
  innovation       INTEGER NOT NULL,
  feasibility      INTEGER NOT NULL,
  business_impact  INTEGER NOT NULL,
  execution        INTEGER NOT NULL,
  presentation     INTEGER NOT NULL,
  comment          TEXT NOT NULL DEFAULT '',
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (judge_id, team_id, phase)
);
CREATE TABLE IF NOT EXISTS results (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  published     INTEGER NOT NULL DEFAULT 0,
  ranking_json  TEXT NOT NULL DEFAULT '[]',
  published_at  INTEGER
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('submissions_open', '1'), ('phase1_open', '0'), ('phase2_open', '0');
INSERT OR IGNORE INTO results (id, published) VALUES (1, 0);
`;

let ready = null;
// Creates tables on first use. Safe to run on every cold start.
function ensureSchema() {
  if (!ready) ready = client.executeMultiple(SCHEMA).catch((e) => { ready = null; throw e; });
  return ready;
}

const toObj = (rs, row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]));
const clean = (args) => (args || []).map((a) => (a === undefined ? null : a));

async function all(sql, args) {
  const rs = await client.execute({ sql, args: clean(args) });
  return rs.rows.map((r) => toObj(rs, r));
}
async function get(sql, args) { return (await all(sql, args))[0] || null; }
async function run(sql, args) {
  const rs = await client.execute({ sql, args: clean(args) });
  return { changes: rs.rowsAffected, lastId: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : null };
}
// Runs several statements atomically: all succeed or none do.
async function batch(stmts) {
  return client.batch(stmts.map(([sql, args]) => ({ sql, args: clean(args) })), 'write');
}

module.exports = { client, ensureSchema, all, get, run, batch, isRemote: !!remoteUrl, url };

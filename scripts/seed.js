// Optional: creates the DotKonnekt hackathon teams and judges with generated
// passwords, skipping any that already exist. Works against the local SQLite
// file or against Turso (set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN).
// Writes the new logins to data/credentials-<time>.csv. Delete that file after
// sending the logins out.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const { BCRYPT_ROUNDS } = require('../config');
const { generatePassword } = require('./passwords');

const TEAMS = [
  ['Blue Comet', 'Kishan, Chithra, Vishnu'],
  ['Iron Lotus', 'DJ, P2'],
  ['Silent Owl', 'Sonal, Pradeep'],
  ['Neon Tiger', 'Devika, Shabrish, Bijoy'],
  ['Copper Fox', 'Amrith, Nayasa'],
  ['Crimson Kite', 'Rohtash, Vaibhav, Ishita'],
  ['Jade Phoenix', 'P1, Nripen'],
];
const JUDGES = ['Gaurav', 'Siva', 'Sophia', 'Gitika', 'Sreekar', 'Anurag'];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

(async () => {
  await db.ensureSchema();
  const created = [];
  const stmts = [];
  const t0 = Date.now();
  for (const [codeName, members] of TEAMS) {
    const username = slug(codeName);
    if (await db.get('SELECT 1 AS ok FROM teams WHERE code_name = ?', [codeName])) continue;
    if (await db.get('SELECT 1 AS ok FROM users WHERE username = ?', [username])) continue;
    const password = generatePassword();
    stmts.push(['INSERT INTO teams (code_name, members, created_at) VALUES (?, ?, ?)', [codeName, members, t0]]);
    stmts.push([`INSERT INTO users (username, password_hash, role, team_id, display_name, created_at)
      VALUES (?, ?, 'team', (SELECT id FROM teams WHERE code_name = ?), ?, ?)`,
    [username, bcrypt.hashSync(password, BCRYPT_ROUNDS), codeName, codeName, t0]]);
    created.push(['team', codeName, members, username, password]);
  }
  for (const name of JUDGES) {
    const username = slug(name);
    if (await db.get('SELECT 1 AS ok FROM users WHERE username = ?', [username])) continue;
    const password = generatePassword();
    stmts.push(["INSERT INTO users (username, password_hash, role, display_name, created_at) VALUES (?, ?, 'judge', ?, ?)",
      [username, bcrypt.hashSync(password, BCRYPT_ROUNDS), name, t0]]);
    created.push(['judge', name, '', username, password]);
  }
  if (!created.length) { console.log('Nothing to add. Teams and judges already exist.'); return; }
  await db.batch(stmts);

  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `credentials-${t0}.csv`);
  const csv = [['role', 'name', 'members', 'username', 'password'], ...created]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  fs.writeFileSync(out, csv + '\n', { mode: 0o600 });
  console.table(created.map(([role, name, , username, password]) => ({ role, name, username, password })));
  console.log(db.isRemote ? 'Database: Turso (remote)' : `Database: ${db.url}`);
  console.log(`Saved to ${out}. Send each login privately, then delete the file.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

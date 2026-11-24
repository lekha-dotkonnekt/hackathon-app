// Creates the admin account, or resets its password if it already exists.
//   npm run create-admin -- <username>
// Works against the local SQLite file, or against Turso when TURSO_DATABASE_URL
// and TURSO_AUTH_TOKEN are set (for example in .env).
// Uses ADMIN_PASSWORD if set; otherwise generates one and prints it once.
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const { BCRYPT_ROUNDS, MIN_PASSWORD } = require('../config');
const { generatePassword } = require('./passwords');

(async () => {
  await db.ensureSchema();
  const username = (process.argv[2] || process.env.ADMIN_USERNAME || 'admin').trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error('Username needs 3 to 40 letters, numbers, dots, dashes or underscores.');
  const password = process.env.ADMIN_PASSWORD || generatePassword(16);
  if (password.length < MIN_PASSWORD) throw new Error(`ADMIN_PASSWORD needs at least ${MIN_PASSWORD} characters.`);
  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const existing = await db.get('SELECT id, role FROM users WHERE username = ?', [username]);
  if (existing && existing.role !== 'admin') throw new Error(`"${username}" is already used by a ${existing.role} account.`);
  if (existing) {
    await db.batch([
      ['UPDATE users SET password_hash = ? WHERE id = ?', [hash, existing.id]],
      ['DELETE FROM sessions WHERE user_id = ?', [existing.id]],
    ]);
    console.log(`Password reset for admin "${username}".`);
  } else {
    await db.run("INSERT INTO users (username, password_hash, role, display_name, created_at) VALUES (?, ?, 'admin', 'Organiser', ?)",
      [username, hash, Date.now()]);
    console.log(`Admin "${username}" created.`);
  }
  console.log(db.isRemote ? 'Database: Turso (remote)' : `Database: ${db.url}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`Password: ${password}\nStore it somewhere safe. It is not shown again.`);
})().catch((e) => { console.error(e.message); process.exit(1); });

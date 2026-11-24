# DotKonnekt Hackathon

Team submissions and blind judging, built for Vercel with a SQLite database (Turso in production, a local SQLite file in development).

- **Organiser (admin):** creates, edits and deletes teams; adds, edits and removes judges; sets every username and password; opens and closes each phase; sees all scores; publishes the ranking.
- **Teams:** sign in with the login the organiser gives them and edit their submission (write-up plus any number of links) while submissions are open.
- **Judges:** sign in, see teams by code name only (never members), and score each team 1 to 10 on five criteria in Phase 1 (blind) and Phase 2 (after the demo). Each judge sees only their own scores.
- **Results:** each phase's judge average (out of 50) is turned into a percentage, then weighted: total = 20% of Phase 1 + 80% of Phase 2, out of 100. The weights are set in `config.js`. Teams and judges only ever see the ranking.

The server enforces all of these rules, not just the page.

## Why Turso

Vercel functions don't keep files between requests, so a SQLite file inside the project would lose data. Turso is a hosted database that uses SQLite's format and SQL, so the schema and queries are plain SQLite. Locally the same code uses a normal SQLite file.

## Run it locally

Needs Node.js 22
```bash
npm install
npm run create-admin -- lekha     # prints a generated password once
npm run seed                      # optional: adds the 7 teams and 6 judges
npm run dev                       # http://localhost:3000
```

## Deploy to Vercel

1. **Create the database.** In the Vercel dashboard, add Turso from the Marketplace (Storage), or create a database at turso.tech. You need its URL (starts with `libsql://`) and an auth token.
2. **Set environment variables** in the Vercel project (Settings, Environment Variables): `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. If the Marketplace integration adds variables with different names, copy their values into these two names.
3. **Push the code to GitHub** (or Bitbucket) and import the repo in Vercel. Framework preset: **Other**. Leave the build command empty. `vercel.json` already sets the output directory to `public` and routes `/api/*` to the function.
4. **Create the admin and accounts against Turso** from your machine. Put the same two variables in a local `.env` file, then:

   ```bash
   npm run create-admin -- lekha
   npm run seed          # optional
   ```

   Tables are created automatically on first use.
5. **Check it:** open `https://<your-app>.vercel.app/api/me` (it should return JSON), then sign in on the home page.

Check Vercel's and Turso's current docs for exact dashboard steps and free-tier limits, since those change.

## Security notes

- Passwords are hashed with bcrypt. Sessions are random tokens, stored hashed, in an HttpOnly, Secure, SameSite=Lax cookie that lasts 7 days.
- Changing a password signs that account out everywhere.
- Login is limited to 10 failed attempts per username and IP every 15 minutes (stored in the database, so it works across Vercel instances).
- Changing requests must be JSON from the same site, which blocks cross-site form posts.
- Links must be http or https. User text is always rendered as text, and a strict Content Security Policy blocks inline scripts.
- Judges never receive member names or account details from the API.

## Project layout

```
api/index.js         Vercel function entry (all /api/* requests)
lib/app.js           API routes, auth and role checks
lib/db.js            SQLite schema and database access (libSQL client)
config.js            Criteria, phases, session length
public/              The single-page frontend, served as static files
dev-server.js        Local server (not used on Vercel)
scripts/             create-admin and seed
vercel.json          Routing and security headers
```

To change the criteria, edit `config.js` and the matching columns in `score_sheets` in `lib/db.js`, starting with a fresh database.

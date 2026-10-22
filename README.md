# Aliran Cashflow

A personal cashflow and bill manager for Malaysia. Track bills and due dates, read receipts and payslips with on-device OCR, set budgets and savings goals, and see where your money goes each month.

It runs two ways:

| Mode | How | Where data lives |
|---|---|---|
| **Local** | Open `aliran-cashflow.html` in a browser, or use the Claude artifact | Only in that browser (localStorage) |
| **Server** | Run the Node.js backend and open it in a browser | On your server, encrypted, behind a login; available on any device |

The page detects which mode it is in: served by the backend, it shows a sign-in screen and syncs automatically.

## Quick start (server mode)

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000 and create your account. The first account becomes the owner, and sign-up closes after that.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Build the page and run the server, restarting when server files change |
| `npm run build` | Build `public/index.html` (server) and `aliran-cashflow.html` (standalone) from `src/app.html` |
| `npm start` | Run the server (production) |
| `npm test` | Run all 112 tests: frontend features, backend, security and end to end |
| `npm run lint` | Check code with ESLint |
| `npm run check` | Lint, test and audit dependencies (what CI runs) |
| `npm run gen-key` | Print a new `DATA_ENCRYPTION_KEY` |
| `npm run backup-db` | Copy the database safely while the server runs |

## Deploying

1. `npm run gen-key` and keep the key safe (see [SECURITY.md](SECURITY.md)).
2. Copy `.env.example` to `.env` and set `NODE_ENV=production`, `DATA_ENCRYPTION_KEY` and `PUBLIC_ORIGIN`.
3. Build and run the container:
   ```bash
   docker build -t aliran .
   docker run -d -p 127.0.0.1:3000:3000 -v aliran-data:/data --env-file .env --restart unless-stopped aliran
   ```
4. Put an HTTPS reverse proxy in front of it. With Caddy, the whole config is:
   ```
   money.example.my {
     reverse_proxy 127.0.0.1:3000
   }
   ```
   and set `TRUST_PROXY=true`.

## Project layout

```
src/app.html            the web app (HTML, CSS and JS in one file)
server/
  app.js                routes, security hooks, error handling
  config.js             environment settings, refuses unsafe production setups
  db.js                 SQLite and numbered migrations
  schemas.js            JSON schemas for every request body
  security/             password hashing, encryption, sessions, password rules
scripts/                build, key generation, database backup
tests/frontend/         feature tests for the web app (jsdom)
tests/server/           API, security and end-to-end tests
docs/adr/               architecture decisions
.github/                CI, CodeQL, Dependabot, pull request checklist
```

## API

All responses are JSON. Changes need the session cookie and the `X-CSRF-Token` header from `/api/session`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness and database check |
| GET | `/api/session` | Who is signed in, CSRF token, whether sign-up is open |
| POST | `/api/auth/register` | Create an account `{email, password}` |
| POST | `/api/auth/login` | Sign in `{email, password}` |
| POST | `/api/auth/logout` | Sign out this device |
| POST | `/api/auth/password` | Change password `{currentPassword, newPassword}`; signs out other devices |
| DELETE | `/api/account` | Delete account and data `{password, confirm: "DELETE"}` |
| GET | `/api/state` | Load your data `{version, data}` |
| PUT | `/api/state` | Save `{version, data}`. Returns 409 with the latest data if another device saved first |

## Development workflow

1. Branch from `main`. Keep each change small and focused.
2. Add or update tests with the change. A bug fix starts with a failing test.
3. Run `npm run check` before pushing.
4. Open a pull request; the template has a short security checklist. CI (lint, tests, audit, Docker smoke test) and CodeQL must pass.
5. Record notable changes in [CHANGELOG.md](CHANGELOG.md) and significant design decisions in `docs/adr/`.

See [TEST_REPORT.md](TEST_REPORT.md) for what the tests cover and what they found.

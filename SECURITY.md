# Security

Aliran stores personal financial records, so it is built to fail closed: when in doubt it refuses the request.

## Reporting a vulnerability

Please don't open a public issue. Email the maintainer with steps to reproduce. Expect a reply within 7 days.

## What protects your data

| Threat | Protection | Where |
|---|---|---|
| Someone guesses your password | 12-character minimum; common passwords blocked; 5 wrong tries lock sign-in for 15 minutes; 10 sign-in attempts per 15 minutes per IP | `server/security/passwords.js`, `server/app.js` |
| Discovering which emails have accounts | Same message and similar timing for "wrong password", "no such account" and "locked" | `server/app.js` (login) |
| Stolen database file | Passwords hashed with scrypt (N=2^17). Session tokens stored only as SHA-256 hashes. Financial data encrypted with AES-256-GCM using a key kept outside the database. Deleted rows overwritten (`secure_delete`) | `server/security/crypto.js`, `server/db.js` |
| One user reading another's data | Every data query is scoped to the signed-in user; ciphertext is bound to its owner, so copying it between accounts fails | `server/app.js` (state routes) |
| Session theft through scripts (XSS) | Session cookie is HttpOnly. Strict Content Security Policy allows only the app's own script, by hash. All user text is HTML-escaped before display | `server/app.js` (`pageCsp`), `src/app.html` (`esc`) |
| Cross-site request forgery | SameSite=Strict cookie; per-session CSRF token required on every change; `Origin` and `Sec-Fetch-Site` checked; plain-text form posts rejected | `server/app.js` |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: SAMEORIGIN` | `server/app.js` |
| Tampered CDN libraries | Subresource Integrity hashes on Chart.js, PDF.js and Tesseract.js | `src/app.html` |
| Malformed or malicious input | Every request body validated by JSON schema (types, formats, lengths, item counts); unknown fields dropped; `__proto__` payloads rejected; 64 KB limit (8 MB for data saves) | `server/schemas.js` |
| Abandoned sessions | Sign-out after 30 idle minutes and after 7 days regardless; sign-out ends the session on the server; changing the password signs out other devices | `server/security/sessions.js` |
| Leaking internals | Errors return a generic message; stack traces and paths stay in server logs; cookies, CSRF tokens and request bodies are redacted from logs | `server/app.js` |
| Traffic interception | Production refuses to start without HTTPS settings; `__Host-` Secure cookies; HSTS for one year | `server/config.js` |
| Vulnerable dependencies | `npm audit` in CI; Dependabot weekly; CodeQL scanning; container runs as an unprivileged user with read-only code | `.github/`, `Dockerfile` |

An audit log records sign-ins, failures, lockouts, password changes and account deletion (`audit_log` table) with time and IP.

## Running it safely

1. **Use HTTPS.** Put the app behind a reverse proxy such as Caddy, which gets certificates automatically, and set `TRUST_PROXY=true` and `PUBLIC_ORIGIN=https://your.domain`.
2. **Generate a key** with `npm run gen-key` and store it in a password manager or secret store. Without it the data cannot be decrypted, so back it up, but **separately** from the database backups.
3. **Keep registration on `first`** (the default). Once you've created your account, nobody else can.
4. **Back up** with `npm run backup-db` on a schedule, and test a restore.
5. **Update** when Dependabot opens pull requests; CI must pass before merging.

## Known limits

- No two-factor authentication yet. That is the next security feature to add.
- No password reset by email (deliberately: no email service to compromise). If you forget your password, an administrator with database access must reset it.
- The page allows inline `style` attributes (`style-src 'unsafe-inline'`). Styles cannot run code, but a stricter policy would need the markup reworked.
- OCR downloads its engine from jsDelivr and its language data from `tessdata.projectnaptha.com` on first use. These can't be pinned with integrity hashes. To remove that dependency, self-host the files.

# ADR 0001: Backend stack

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

Aliran started as a single HTML file that keeps all data in the browser's localStorage. It needs a backend so that:

- data survives clearing the browser and is available on more than one device;
- financial records are protected by a login rather than by physical access to one browser.

The app has one owner (sometimes a household), a few thousand records a year, and is self-hosted. The frontend and its 75 tests are plain JavaScript.

## Decision

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 LTS | Same language as the frontend and its tests; one toolchain to maintain. |
| Framework | **Fastify 5** | Validates every request body against a JSON schema before the handler runs, and strips unknown fields. Has maintained plugins for security headers (`@fastify/helmet`), rate limiting and cookies. `inject()` lets tests run the whole server in-process with no network. Faster and with less boilerplate than Express; much lighter than NestJS for a handful of routes. |
| Database | **SQLite** via `better-sqlite3` | A single file: nothing extra to install, run or secure, and backups are a file copy (`npm run backup-db`). Comfortably handles one household's data. Synchronous API removes a class of race conditions. |
| Data model | One encrypted JSON document per user, with a version number | The frontend already works on one state object. Storing it whole keeps the frontend and backend in step (the same schema validates both), and the version number stops two devices silently overwriting each other. |
| Passwords | scrypt from `node:crypto` | Memory-hard and OWASP-recommended, with no native add-on to compile or patch. |
| Encryption at rest | AES-256-GCM from `node:crypto` | Authenticated encryption; each user's data is bound to their account, so ciphertext cannot be swapped between users. |
| Sessions | Server-side, random token in an HttpOnly, SameSite=Strict cookie | Can be revoked instantly (sign out, password change). Not readable by page scripts. JWTs would need a revocation list to do the same. |

## Consequences

- **Good:** small attack surface (4 runtime dependencies plus their sub-dependencies), fast tests, simple deployment (one container and one volume).
- **Trade-off:** each save sends the whole document. At about 250 bytes per transaction, ten years of data is still well under the 8 MB request limit. If that ever changes, move transactions into their own table and sync changes only.
- **Trade-off:** SQLite suits one server. Running several app servers behind a load balancer would need PostgreSQL. The SQL is standard and the migrations are numbered, so that move is contained.
- **Trade-off:** the original "data never leaves the device" promise now applies only in local mode (the standalone file and the Claude artifact). In server mode, data goes to a server the owner controls, encrypted.

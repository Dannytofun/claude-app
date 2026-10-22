# Changelog

Format: [Keep a Changelog](https://keepachangelog.com). Versions follow [Semantic Versioning](https://semver.org).

## [1.0.0] - 2026-10-22

### Added
- Node.js backend (Fastify, SQLite) with accounts, encrypted storage and automatic sync between devices.
- Sign-in screen, account settings (change password, sign out, delete account) and sync status in the web app.
- Security: scrypt password hashing, account lockout, rate limiting, CSRF protection, strict Content Security Policy, Subresource Integrity on CDN scripts, AES-256-GCM encryption at rest, audit log.
- Tooling: ESLint, CI (lint, tests, dependency audit, Docker smoke test), CodeQL, Dependabot, Dockerfile, database backup script.
- 34 backend, security and end-to-end tests (109 in total).
- Due soon lists every unpaid month since a bill started (up to 2 years).
- "Already paid" option when adding a bill whose due date has passed.

### Fixed
- A zero payslip deduction (e.g. PCB 0.00) took the next line's amount.
- A damaged backup file crashed every screen.
- Editing a bill payment's date now updates the bill's paid date.
- Content Security Policy hash failed on Windows checkouts (CRLF line endings), blocking the whole app.

## [0.1.0] - 2026-10-22

### Added
- Single-file web app: dashboard, bills with due-date alerts, receipt and payslip OCR, categories, budgets, savings goals, trends, backup.

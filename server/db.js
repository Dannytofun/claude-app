'use strict';
// SQLite storage with numbered, forward-only migrations.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATIONS = [
  // 1: users, sessions, encrypted per-user state, audit log
  `CREATE TABLE users (
     id            INTEGER PRIMARY KEY,
     email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL,
     failed_logins INTEGER NOT NULL DEFAULT 0,
     locked_until  INTEGER NOT NULL DEFAULT 0,
     created_at    INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     id_hash    TEXT PRIMARY KEY,           -- sha256 of the cookie token; the token itself is never stored
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     csrf_token TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     last_seen  INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE user_state (
     user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     version    INTEGER NOT NULL,
     data       TEXT NOT NULL,              -- AES-256-GCM ciphertext
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE audit_log (
     id      INTEGER PRIMARY KEY,
     user_id INTEGER,
     event   TEXT NOT NULL,
     ip      TEXT,
     at      INTEGER NOT NULL
   );
   CREATE INDEX audit_user ON audit_log(user_id, at);`
];

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON'); // overwrite deleted financial data instead of leaving it in free pages
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const v = i + 1;
    if (done.has(v)) return;
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(v, Date.now());
    })();
  });
}

module.exports = { openDb };

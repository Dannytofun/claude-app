'use strict';
// Makes a consistent copy of the SQLite database while the server is running.
// Usage: npm run backup-db -- [destination-folder]
// The data inside stays encrypted; keep DATA_ENCRYPTION_KEY somewhere separate from these backups.
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { loadConfig } = require('../server/config');

const cfg = loadConfig();
const destDir = path.resolve(process.argv[2] || path.join(path.dirname(cfg.dbFile), 'backups'));
fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, `aliran-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
const db = new Database(cfg.dbFile, { readonly: true, fileMustExist: true });
db.backup(dest)
  .then(() => { console.log('Backup written to', dest); db.close(); })
  .catch(e => { console.error('Backup failed:', e.message); process.exit(1); });

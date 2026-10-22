'use strict';
// Reads and validates configuration from environment variables.
// The server refuses to start in production with unsafe settings.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

function bool(v, def) {
  if (v === undefined || v === '') return def;
  return /^(1|true|yes|on)$/i.test(v);
}
function int(v, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

/** Dev-only: keep one random key on disk so encrypted data survives restarts. */
function devKey(dataDir) {
  const file = path.join(dataDir, '.dev-data-key');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* create below */ }
  const key = crypto.randomBytes(32).toString('base64');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

function loadConfig(env = process.env, overrides = {}) {
  const production = env.NODE_ENV === 'production';
  const dataDir = env.DATA_DIR || path.join(ROOT, 'data');
  const cfg = {
    production,
    host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    port: int(env.PORT, 3000),
    dbFile: env.DB_FILE || path.join(dataDir, 'aliran.db'),
    publicFile: env.PUBLIC_FILE || path.join(ROOT, 'public', 'index.html'),
    // 32-byte key, base64. Encrypts each user's financial data at rest.
    dataKey: env.DATA_ENCRYPTION_KEY || (production ? '' : devKey(dataDir)),
    // Who can create an account: 'first' (only the first user, then closed), 'open', or 'closed'.
    registration: env.REGISTRATION || 'first',
    trustProxy: bool(env.TRUST_PROXY, false),
    secureCookies: bool(env.SECURE_COOKIES, production),
    // Public origin, e.g. https://money.example.com. Used to reject cross-site requests.
    publicOrigin: env.PUBLIC_ORIGIN || '',
    sessionIdleMs: int(env.SESSION_IDLE_MINUTES, 30) * 60_000,
    sessionMaxMs: int(env.SESSION_MAX_HOURS, 24 * 7) * 3_600_000,
    loginMaxFailures: int(env.LOGIN_MAX_FAILURES, 5),
    loginLockMs: int(env.LOGIN_LOCK_MINUTES, 15) * 60_000,
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 300),
    logLevel: env.LOG_LEVEL || (production ? 'info' : 'warn'),
    now: () => Date.now(),
    ...overrides
  };
  validate(cfg);
  return cfg;
}

function validate(cfg) {
  const problems = [];
  const key = Buffer.from(cfg.dataKey || '', 'base64');
  if (key.length !== 32) problems.push('DATA_ENCRYPTION_KEY must be 32 random bytes in base64 (run: npm run gen-key)');
  if (!['first', 'open', 'closed'].includes(cfg.registration)) problems.push('REGISTRATION must be first, open or closed');
  if (cfg.production) {
    if (!cfg.secureCookies) problems.push('SECURE_COOKIES cannot be off in production (cookies must only travel over HTTPS)');
    if (!/^https:\/\//.test(cfg.publicOrigin)) problems.push('PUBLIC_ORIGIN must be set to your https:// address in production');
  }
  if (problems.length) {
    const err = new Error('Invalid configuration:\n - ' + problems.join('\n - '));
    err.code = 'CONFIG_INVALID';
    throw err;
  }
}

module.exports = { loadConfig };

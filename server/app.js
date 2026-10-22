'use strict';
// Builds the Fastify app. Kept separate from server.js so tests can run it in-process.
const fs = require('node:fs');
const crypto = require('node:crypto');
const Fastify = require('fastify');
const { openDb } = require('./db');
const C = require('./security/crypto');
const { createSessionStore, cookieName, cookieOptions } = require('./security/sessions');
const { passwordProblem, normEmail, validEmail } = require('./security/passwords');
const schemas = require('./schemas');

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GENERIC_LOGIN_ERROR = 'Email or password is incorrect. After several failed tries, sign-in pauses for 15 minutes.';

/** CSP for the page: the inline script is allowed by its exact hash, nothing else inline can run. */
function pageCsp(html) {
  // Browsers turn CRLF into LF before hashing a script, so hash the same normalised text
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => `'sha256-${crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net 'wasm-unsafe-eval'`,
    "worker-src 'self' blob: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    // OCR downloads its engine and English language data on first use; data: is its inlined WebAssembly
    "connect-src 'self' data: https://cdn.jsdelivr.net https://tessdata.projectnaptha.com https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
  ].join('; ');
}

async function buildApp(cfg, opts = {}) {
  const db = opts.db || openDb(cfg.dbFile);
  const sessions = createSessionStore(db, cfg);
  const hashParams = opts.hashParams || C.DEFAULT_PARAMS;
  const dummyHash = await C.hashPassword(C.randomToken(), hashParams); // equalises timing for unknown emails

  const app = Fastify({
    logger: opts.logger ?? {
      level: cfg.logLevel,
      redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]', 'req.body']
    },
    trustProxy: cfg.trustProxy,
    bodyLimit: 64 * 1024,
    disableRequestLogging: !cfg.production,
    ajv: { customOptions: { removeAdditional: true, coerceTypes: false, allErrors: false } },
    return503OnClosing: true
  });

  await app.register(require('@fastify/cookie'));
  await app.register(require('@fastify/helmet'), {
    contentSecurityPolicy: false, // set per response below: strict for API, page-specific for HTML
    hsts: cfg.production ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' }
  });
  await app.register(require('@fastify/rate-limit'), {
    global: true, max: cfg.rateLimitPerMinute, timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: 'Too many requests', message: `Slow down and try again in ${Math.ceil(ctx.ttl / 1000)} seconds.` })
  });

  const audit = db.prepare('INSERT INTO audit_log (user_id, event, ip, at) VALUES (?, ?, ?, ?)');
  const log = (req, userId, event) => audit.run(userId ?? null, event, req.ip, cfg.now());

  // ---- every response: strict defaults ----
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (req.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
    return payload;
  });

  // ---- cross-site request protection for anything that changes data ----
  const expectedOrigin = req => cfg.publicOrigin || `${req.protocol}://${req.host}`;
  app.addHook('onRequest', async (req, reply) => {
    if (!UNSAFE.has(req.method)) return;
    const site = req.headers['sec-fetch-site'];
    if (site && !['same-origin', 'none'].includes(site)) return reply.code(403).send({ error: 'Cross-site request blocked' });
    const origin = req.headers.origin;
    if (origin && origin !== expectedOrigin(req)) return reply.code(403).send({ error: 'Cross-site request blocked' });
  });
  // Only JSON bodies are accepted. Plain-text bodies are the one kind an HTML form on another site can send.
  app.removeContentTypeParser('text/plain');

  // ---- session loading ----
  const sidName = cookieName(cfg);
  app.decorateRequest('session', null);
  app.addHook('preHandler', async req => { req.session = sessions.lookup(req.cookies[sidName]); });

  /** Route guard: signed-in, and for writes, the CSRF token must match the session's. */
  const requireAuth = async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: 'Please sign in again.' });
    if (UNSAFE.has(req.method) && !C.safeEqual(req.headers['x-csrf-token'] || '', req.session.csrf)) {
      return reply.code(403).send({ error: 'Security check failed. Reload the page and try again.' });
    }
  };

  const startSession = (reply, userId) => {
    const s = sessions.create(userId);
    reply.setCookie(sidName, s.token, cookieOptions(cfg, cfg.sessionMaxMs));
    return s.csrf;
  };
  const userCount = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const registrationOpen = () => cfg.registration === 'open' || (cfg.registration === 'first' && userCount() === 0);

  const authLimit = { rateLimit: { max: 10, timeWindow: '15 minutes' } };

  // ---- health ----
  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  });

  // ---- session info ----
  app.get('/api/session', async req => ({
    app: 'aliran',
    authenticated: !!req.session,
    email: req.session ? req.session.email : null,
    csrfToken: req.session ? req.session.csrf : null,
    registrationOpen: registrationOpen()
  }));

  app.post('/api/auth/register', { config: authLimit, schema: { body: schemas.credentials } }, async (req, reply) => {
    if (!registrationOpen()) return reply.code(403).send({ error: 'New accounts are switched off on this server.' });
    const email = normEmail(req.body.email);
    if (!validEmail(email)) return reply.code(400).send({ error: 'Enter a valid email address.' });
    const problem = passwordProblem(req.body.password, email);
    if (problem) return reply.code(400).send({ error: problem });
    const hash = await C.hashPassword(req.body.password, hashParams);
    let userId;
    try {
      userId = db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)').run(email, hash, cfg.now()).lastInsertRowid;
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return reply.code(409).send({ error: 'An account with that email already exists. Sign in instead.' });
      throw e;
    }
    log(req, userId, 'register');
    return { email, csrfToken: startSession(reply, Number(userId)) };
  });

  app.post('/api/auth/login', { config: authLimit, schema: { body: schemas.credentials } }, async (req, reply) => {
    const email = normEmail(req.body.email);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const now = cfg.now();
    const ok = await C.verifyPassword(req.body.password, user ? user.password_hash : dummyHash);
    if (!user) { log(req, null, 'login_fail_unknown'); return reply.code(401).send({ error: GENERIC_LOGIN_ERROR }); }
    if (user.locked_until > now) { log(req, user.id, 'login_blocked_locked'); return reply.code(401).send({ error: GENERIC_LOGIN_ERROR }); }
    if (!ok) {
      const fails = user.failed_logins + 1;
      const lock = fails >= cfg.loginMaxFailures;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock ? now + cfg.loginLockMs : 0, user.id);
      log(req, user.id, lock ? 'login_fail_locked' : 'login_fail');
      return reply.code(401).send({ error: GENERIC_LOGIN_ERROR });
    }
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(user.id);
    if (C.needsRehash(user.password_hash, hashParams)) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await C.hashPassword(req.body.password, hashParams), user.id);
    }
    log(req, user.id, 'login_ok');
    return { email: user.email, csrfToken: startSession(reply, user.id) };
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    sessions.destroy(req.session.idHash);
    log(req, req.session.userId, 'logout');
    reply.clearCookie(sidName, cookieOptions(cfg, 0));
    return { ok: true };
  });

  app.post('/api/auth/password', { preHandler: requireAuth, config: authLimit, schema: { body: schemas.changePassword } }, async (req, reply) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!(await C.verifyPassword(req.body.currentPassword, user.password_hash))) {
      log(req, user.id, 'password_change_fail');
      return reply.code(400).send({ error: 'Your current password is incorrect.' });
    }
    const problem = passwordProblem(req.body.newPassword, user.email);
    if (problem) return reply.code(400).send({ error: problem });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await C.hashPassword(req.body.newPassword, hashParams), user.id);
    sessions.destroyOthers(user.id, req.session.idHash); // sign out every other device
    log(req, user.id, 'password_change');
    return { ok: true };
  });

  app.delete('/api/account', { preHandler: requireAuth, config: authLimit, schema: { body: schemas.deleteAccount } }, async (req, reply) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!(await C.verifyPassword(req.body.password, user.password_hash))) return reply.code(400).send({ error: 'Your password is incorrect.' });
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id); // cascades to sessions and state
    log(req, null, 'account_delete');
    reply.clearCookie(sidName, cookieOptions(cfg, 0));
    return { ok: true };
  });

  // ---- the user's cashflow data: one encrypted document with optimistic versioning ----
  const aad = userId => `aliran:user:${userId}`; // ciphertext can't be swapped between users
  app.get('/api/state', { preHandler: requireAuth }, async req => {
    const row = db.prepare('SELECT version, data, updated_at FROM user_state WHERE user_id = ?').get(req.session.userId);
    if (!row) return { version: 0, data: null, updatedAt: null };
    return { version: row.version, data: JSON.parse(C.decrypt(row.data, cfg.dataKey, aad(req.session.userId))), updatedAt: row.updated_at };
  });

  app.put('/api/state', {
    preHandler: requireAuth, bodyLimit: 8 * 1024 * 1024, schema: { body: schemas.putState },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (req, reply) => {
    const uid = req.session.userId;
    const row = db.prepare('SELECT version FROM user_state WHERE user_id = ?').get(uid);
    const current = row ? row.version : 0;
    if (req.body.version !== current) {
      // someone saved from another device first: send back the latest so the client can reload it
      const latest = row && db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(uid);
      return reply.code(409).send({ error: 'Your data changed on another device.', version: current, data: latest ? JSON.parse(C.decrypt(latest.data, cfg.dataKey, aad(uid))) : null });
    }
    const next = current + 1;
    const blob = C.encrypt(JSON.stringify(req.body.data), cfg.dataKey, aad(uid));
    db.prepare(`INSERT INTO user_state (user_id, version, data, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`)
      .run(uid, next, blob, cfg.now());
    return { version: next };
  });

  // ---- the web app itself ----
  let html = null, csp = null;
  const loadPage = () => {
    if (html && cfg.production) return;
    html = fs.readFileSync(cfg.publicFile, 'utf8');
    csp = pageCsp(html);
  };
  app.get('/', (req, reply) => {
    try { loadPage(); } catch { return reply.code(500).type('text/plain').send('App file missing. Run: npm run build'); }
    reply.header('Content-Security-Policy', csp).header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(html);
  });

  // ---- errors: useful messages for people, no internals for attackers ----
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'Not found' }));
  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send({ error: 'Some of the data sent is not valid.', field: err.validation[0] && err.validation[0].instancePath });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.statusCode === 413 ? 'That is too much data to send at once.' : err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the server. Try again shortly.' });
  });

  // hourly housekeeping
  const purge = setInterval(() => sessions.purgeExpired(), 3_600_000);
  purge.unref();
  app.addHook('onClose', async () => { clearInterval(purge); if (!opts.db) db.close(); });

  app.decorate('db', db);
  return app;
}

module.exports = { buildApp, pageCsp };

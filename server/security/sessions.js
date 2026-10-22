'use strict';
// Server-side sessions. The browser holds a random token in an HttpOnly cookie;
// the database stores only its SHA-256, so a leaked database cannot be replayed as logins.
const { randomToken, sha256 } = require('./crypto');

function cookieName(cfg) {
  // __Host- prefix: browser refuses the cookie unless Secure, Path=/ and no Domain (blocks subdomain overwrite)
  return cfg.secureCookies ? '__Host-aliran_sid' : 'aliran_sid';
}

function cookieOptions(cfg, maxAgeMs) {
  return { path: '/', httpOnly: true, sameSite: 'strict', secure: cfg.secureCookies, maxAge: Math.floor(maxAgeMs / 1000) };
}

function createSessionStore(db, cfg) {
  const q = {
    insert: db.prepare('INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?)'),
    get: db.prepare(`SELECT s.id_hash, s.user_id, s.csrf_token, s.last_seen, s.expires_at, u.email
                     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`),
    touch: db.prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?'),
    del: db.prepare('DELETE FROM sessions WHERE id_hash = ?'),
    delUser: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen < ?')
  };
  return {
    create(userId) {
      const now = cfg.now();
      const token = randomToken(32), csrf = randomToken(32);
      q.insert.run(sha256(token), userId, csrf, now, now, now + cfg.sessionMaxMs);
      return { token, csrf };
    },
    /** Returns the live session for a cookie token, or null. Expired sessions are deleted. */
    lookup(token) {
      if (!token || typeof token !== 'string' || token.length > 100) return null;
      const id = sha256(token);
      const s = q.get.get(id);
      if (!s) return null;
      const now = cfg.now();
      if (now > s.expires_at || now - s.last_seen > cfg.sessionIdleMs) { q.del.run(id); return null; }
      if (now - s.last_seen > 30_000) q.touch.run(now, id);
      return { idHash: id, userId: s.user_id, email: s.email, csrf: s.csrf_token };
    },
    destroy(idHash) { q.del.run(idHash); },
    /** Sign out every other device for this user. */
    destroyOthers(userId, keepIdHash = '') { q.delUser.run(userId, keepIdHash); },
    purgeExpired() { const now = cfg.now(); q.purge.run(now, now - cfg.sessionIdleMs); }
  };
}

module.exports = { createSessionStore, cookieName, cookieOptions };

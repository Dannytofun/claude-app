'use strict';
// Password hashing (scrypt), random tokens, and AES-256-GCM encryption at rest.
// Uses only node:crypto, so there are no native crypto dependencies to patch.
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// OWASP-recommended scrypt cost: N=2^17, r=8, p=1 (≈128 MiB, ~0.3 s). Tests can lower it.
const DEFAULT_PARAMS = { N: 2 ** 17, r: 8, p: 1, keyLen: 32 };

async function hashPassword(password, params = DEFAULT_PARAMS) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keyLen } = params;
  const hash = await scrypt(password.normalize('NFKC'), salt, keyLen, { N, r, p, maxmem: 256 * N * r });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length,
    { N: +N, r: +r, p: +p, maxmem: 256 * +N * +r });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Rehash on login when the stored hash used weaker settings than today's. */
function needsRehash(stored, params = DEFAULT_PARAMS) {
  const parts = String(stored || '').split('$');
  return parts[0] !== 'scrypt' || +parts[1] < params.N || +parts[2] !== params.r || +parts[3] !== params.p;
}

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(s).digest('base64url');

/** Constant-time string comparison. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** AES-256-GCM. Output: "v1.<iv>.<tag>.<ciphertext>" (base64url). `aad` binds data to its owner. */
function encrypt(plaintext, keyB64, aad) {
  const key = Buffer.from(keyB64, 'base64');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

function decrypt(blob, keyB64, aad) {
  const [v, iv, tag, ct] = String(blob).split('.');
  if (v !== 'v1') throw new Error('Unknown encryption format');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(iv, 'base64url'));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

module.exports = { hashPassword, verifyPassword, needsRehash, randomToken, sha256, safeEqual, encrypt, decrypt, DEFAULT_PARAMS };

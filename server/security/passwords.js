'use strict';
// Password and email rules (NIST SP 800-63B style: long passphrases, block common ones, no forced symbols).

const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', '123456789012', '1234567890', 'qwertyuiop', 'qwerty123456',
  'iloveyou', 'admin', 'administrator', 'welcome', 'welcome123', 'letmein', 'monkey', 'dragon', 'football',
  'baseball', 'sunshine', 'princess', 'trustno1', 'abc123456789', 'aaaaaaaaaaaa', 'changeme', 'p@ssw0rd',
  'p@ssword123', 'malaysia', 'malaysia123', 'kualalumpur', 'selamat', 'sayangku', 'rahsia', 'katalaluan',
  'aliran', 'aliranpassword', 'cashflow', 'cashflow123', 'mypassword', 'password!', 'superman', 'batman'
]);

const MIN = 12, MAX = 128;

/** Returns a user-facing problem, or '' when the password is acceptable. */
function passwordProblem(password, email = '') {
  if (typeof password !== 'string') return 'Enter a password.';
  if ([...password].length < MIN) return `Use at least ${MIN} characters. A short phrase is easiest to remember.`;
  if ([...password].length > MAX) return `Use at most ${MAX} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[^a-z]/g, ''))) return 'That password is too common. Choose something less predictable.';
  if (/^(.)\1+$/.test(password)) return 'Don’t use one repeated character.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'Don’t include your email name in the password.';
  return '';
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => e.length <= 254 && EMAIL.test(e);

module.exports = { passwordProblem, normEmail, validEmail, MIN, MAX };

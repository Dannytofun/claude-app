// Accounts, sign-in, sessions and lockout
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeServer, Client, GOOD_PW } = require('./helper');

test('registration enforces email and password rules', async () => {
  const { app } = await makeServer();
  const c = new Client(app);
  const cases = [
    ['not-an-email', GOOD_PW, /valid email/],
    ['aina@example.my', 'short', /at least 12 characters/],
    ['aina@example.my', 'Password123', /at least 12/],
    ['aina@example.my', 'Password1234!', /too common/],
    ['aina@example.my', 'Malaysia123!', /too common/],
    ['aina@example.my', 'aaaaaaaaaaaaaa', /repeated character/],
    ['aina@example.my', 'aina is my name ok', /email name/]
  ];
  for (const [email, pw, msg] of cases) {
    const r = await c.register(email, pw);
    assert.equal(r.statusCode, 400, `${email} / ${pw}`);
    assert.match(r.data.error, msg);
  }
  const ok = await c.register('  Aina@Example.MY ', GOOD_PW);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.data.email, 'aina@example.my', 'email normalised');
});

test('session cookie is HttpOnly, SameSite=Strict, and the session endpoint reports the user', async () => {
  const { app } = await makeServer();
  const c = new Client(app);
  const r = await c.register();
  const cookie = [].concat(r.headers['set-cookie'])[0];
  assert.match(cookie, /^aliran_sid=/);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\//);
  const s = await c.req('GET', '/api/session');
  assert.deepEqual([s.data.authenticated, s.data.email, s.data.csrfToken.length > 20], [true, 'aina@example.my', true]);
});

test('with HTTPS cookies on, the cookie uses the __Host- prefix and Secure flag', async () => {
  const { app } = await makeServer({ secureCookies: true });
  const r = await new Client(app).register();
  assert.match([].concat(r.headers['set-cookie'])[0], /^__Host-aliran_sid=.*Secure/);
});

test('registration modes: "first" closes after the owner signs up; "closed" never opens; "open" allows more', async () => {
  const first = await makeServer();
  assert.equal((await new Client(first.app).register()).statusCode, 200);
  const second = await new Client(first.app).register('ali@example.my');
  assert.equal(second.statusCode, 403);
  assert.equal((await new Client(first.app).req('GET', '/api/session')).data.registrationOpen, false);

  const closed = await makeServer({ registration: 'closed' });
  assert.equal((await new Client(closed.app).register()).statusCode, 403);

  const open = await makeServer({ registration: 'open' });
  assert.equal((await new Client(open.app).register()).statusCode, 200);
  assert.equal((await new Client(open.app).register('ali@example.my')).statusCode, 200);
  const dup = await new Client(open.app).register('ALI@example.my');
  assert.equal(dup.statusCode, 409, 'emails are case-insensitive');
});

test('wrong password and unknown email get the same answer (no account discovery)', async () => {
  const { app } = await makeServer();
  await new Client(app).register();
  const wrong = await new Client(app).login('aina@example.my', 'wrong password here');
  const unknown = await new Client(app).login('nobody@example.my', 'wrong password here');
  assert.equal(wrong.statusCode, 401); assert.equal(unknown.statusCode, 401);
  assert.equal(wrong.data.error, unknown.data.error);
  const ok = await new Client(app).login('AINA@example.my');
  assert.equal(ok.statusCode, 200);
});

test('5 wrong passwords lock the account for 15 minutes, with the same message; it unlocks afterwards', async () => {
  const { app, advance } = await makeServer();
  await new Client(app).register();
  const c = new Client(app);
  for (let i = 0; i < 5; i++) assert.equal((await c.login('aina@example.my', 'nope nope nope ' + i)).statusCode, 401);
  const locked = await c.login();
  assert.equal(locked.statusCode, 401, 'correct password refused while locked');
  assert.equal(locked.data.error, (await new Client(app).login('nobody@example.my', 'x')).data.error);
  advance(15 * 60_000 + 1);
  assert.equal((await c.login()).statusCode, 200);
  const events = app.db.prepare('SELECT event FROM audit_log ORDER BY id').all().map(r => r.event);
  assert.ok(events.includes('login_fail_locked') && events.includes('login_blocked_locked') && events.at(-1) === 'login_ok');
});

test('sign-in attempts are rate limited per IP', async () => {
  const { app } = await makeServer();
  const c = new Client(app);
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await c.login('x@example.my', 'whatever password')).statusCode);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
  assert.equal(codes[10], 429);
});

test('passwords and session tokens are only stored as hashes', async () => {
  const { app } = await makeServer();
  const c = new Client(app);
  await c.register();
  const user = app.db.prepare('SELECT password_hash FROM users').get();
  assert.match(user.password_hash, /^scrypt\$/);
  assert.ok(!user.password_hash.includes(GOOD_PW));
  const token = [...c.jar.values()][0];
  const rows = JSON.stringify(app.db.prepare('SELECT * FROM sessions').all());
  assert.ok(!rows.includes(token), 'raw cookie token not in the database');
});

test('sign out ends the session on the server, not just in the browser', async () => {
  const { app } = await makeServer();
  const c = new Client(app);
  await c.register();
  const stolen = new Map(c.jar);
  assert.equal((await c.req('POST', '/api/auth/logout')).statusCode, 200);
  const replay = new Client(app); replay.jar = stolen;
  assert.equal((await replay.req('GET', '/api/state')).statusCode, 401);
});

test('sessions expire after 30 idle minutes, stay alive with activity, and end after 7 days regardless', async () => {
  const { app, advance } = await makeServer({ rateLimitPerMinute: 10000 });
  const c = new Client(app);
  await c.register();
  advance(20 * 60_000); assert.equal((await c.req('GET', '/api/state')).statusCode, 200);
  advance(20 * 60_000); assert.equal((await c.req('GET', '/api/state')).statusCode, 200, 'activity extends it');
  advance(31 * 60_000); assert.equal((await c.req('GET', '/api/state')).statusCode, 401, 'idle timeout');

  await c.login();
  for (let i = 0; i < 360; i++) { advance(29 * 60_000); await c.req('GET', '/api/session'); }
  assert.equal((await c.req('GET', '/api/state')).statusCode, 401, 'absolute 7-day limit');
});

test('changing the password checks the old one, enforces rules, and signs out other devices', async () => {
  const { app } = await makeServer();
  const phone = new Client(app), laptop = new Client(app);
  await phone.register(); await laptop.login();
  assert.equal((await laptop.req('POST', '/api/auth/password', { currentPassword: 'wrong one entirely', newPassword: 'nasi lemak at seven' })).statusCode, 400);
  assert.match((await laptop.req('POST', '/api/auth/password', { currentPassword: GOOD_PW, newPassword: 'short' })).data.error, /12 characters/);
  assert.equal((await laptop.req('POST', '/api/auth/password', { currentPassword: GOOD_PW, newPassword: 'nasi lemak at seven' })).statusCode, 200);
  assert.equal((await laptop.req('GET', '/api/state')).statusCode, 200, 'this device stays signed in');
  assert.equal((await phone.req('GET', '/api/state')).statusCode, 401, 'other device signed out');
  assert.equal((await new Client(app).login()).statusCode, 401);
  assert.equal((await new Client(app).login('aina@example.my', 'nasi lemak at seven')).statusCode, 200);
});

test('deleting the account needs the password and DELETE, then removes the user, data and sessions', async () => {
  const { app } = await makeServer();
  const c = new Client(app);
  await c.register();
  await c.req('PUT', '/api/state', { version: 0, data: require('./helper').state() });
  assert.equal((await c.req('DELETE', '/api/account', { password: GOOD_PW, confirm: 'delete' })).statusCode, 400);
  assert.equal((await c.req('DELETE', '/api/account', { password: 'not my password', confirm: 'DELETE' })).statusCode, 400);
  assert.equal((await c.req('DELETE', '/api/account', { password: GOOD_PW, confirm: 'DELETE' })).statusCode, 200);
  const counts = ['users', 'sessions', 'user_state'].map(t => app.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
  assert.deepEqual(counts, [0, 0, 0]);
});

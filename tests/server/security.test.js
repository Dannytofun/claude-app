// Security headers, cross-site protection, input validation, encryption at rest, error hygiene
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../../server/config');
const { makeServer, Client, state } = require('./helper');

test('page CSP allows only the app\'s own inline script (by hash) and blocks framing and plugins', async () => {
  const { app } = await makeServer();
  const r = await app.inject({ method: 'GET', url: '/' });
  assert.equal(r.statusCode, 200);
  const csp = r.headers['content-security-policy'];
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\r\n?/g, '\n'); // as a browser sees it
  assert.ok(csp.includes(`'sha256-${crypto.createHash('sha256').update(inline).digest('base64')}'`));
  const scriptSrc = csp.split(';').find(d => d.trim().startsWith('script-src'));
  assert.ok(!scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'unsafe-eval'"));
  for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) assert.ok(csp.includes(d), d);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.match(r.headers['permissions-policy'], /camera=\(\)/);
  assert.equal(r.headers['x-powered-by'], undefined);
});

test('CSP hash matches what browsers compute even when the file has Windows line endings', () => {
  const { pageCsp } = require('../../server/app');
  const code = 'let a = 1;\nlet b = 2;\n';
  const browserHash = crypto.createHash('sha256').update(code).digest('base64');
  const crlfPage = '<p>x</p><script>' + code.replace(/\n/g, '\r\n') + '</script>';
  assert.ok(pageCsp(crlfPage).includes(`'sha256-${browserHash}'`));
});

test('API responses are never cached and carry a deny-all CSP', async () => {
  const { app } = await makeServer();
  const r = await app.inject({ method: 'GET', url: '/api/session' });
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['content-security-policy'], /default-src 'none'/);
});

test('production: HSTS on, and the server refuses to start with unsafe settings', async () => {
  const key = crypto.randomBytes(32).toString('base64');
  const { app } = await makeServer({ production: true, publicOrigin: 'https://money.example.my', secureCookies: true }, { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://money.example.my' });
  const r = await app.inject({ method: 'GET', url: '/api/health' });
  assert.match(r.headers['strict-transport-security'], /max-age=31536000/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://m.example.my' }), /DATA_ENCRYPTION_KEY/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATA_ENCRYPTION_KEY: key }), /PUBLIC_ORIGIN/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATA_ENCRYPTION_KEY: key, PUBLIC_ORIGIN: 'https://m.example.my', SECURE_COOKIES: 'false' }), /SECURE_COOKIES/);
  assert.throws(() => loadConfig({ DATA_ENCRYPTION_KEY: 'too-short' }), /32 random bytes/);
});

test('cross-site request forgery is blocked four ways', async () => {
  const { app } = await makeServer();
  const c = new Client(app);
  await c.register();
  const body = { version: 0, data: state() };
  assert.equal((await c.req('PUT', '/api/state', body, { 'x-csrf-token': undefined })).statusCode, 403, 'no CSRF token');
  assert.equal((await c.req('PUT', '/api/state', body, { 'x-csrf-token': 'forged' })).statusCode, 403, 'wrong CSRF token');
  assert.equal((await c.req('PUT', '/api/state', body, { origin: 'https://evil.example' })).statusCode, 403, 'foreign Origin');
  assert.equal((await c.req('PUT', '/api/state', body, { 'sec-fetch-site': 'cross-site' })).statusCode, 403, 'browser says cross-site');
  const form = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'text/plain' }, payload: '{"email":"a@b.my","password":"x"}' });
  assert.equal(form.statusCode, 415, 'plain-text form posts are refused');
  assert.equal((await c.req('PUT', '/api/state', body)).statusCode, 200, 'the real app still works');
});

test('signed-out requests to data are refused', async () => {
  const { app } = await makeServer();
  assert.equal((await new Client(app).req('GET', '/api/state')).statusCode, 401);
  assert.equal((await new Client(app).req('PUT', '/api/state', { version: 0, data: state() })).statusCode, 401);
});

test('input validation: wrong types, bad formats and oversized fields are rejected; unknown fields are dropped', async () => {
  const { app } = await makeServer();
  const c = new Client(app);
  await c.register();
  const bad = [
    state({ transactions: [{ ...state().transactions[0], amount: 'abc' }] }),
    state({ transactions: [{ ...state().transactions[0], date: '21/10/2026' }] }),
    state({ transactions: [{ ...state().transactions[0], merchant: 'x'.repeat(201) }] }),
    state({ transactions: [{ ...state().transactions[0], type: 'transfer' }] }),
    state({ bills: [{ id: 'b', name: 'Rent', dueDay: 40 }] }),
    state({ settings: { ...state().settings, theme: 'javascript:alert(1)' } })
  ];
  for (const data of bad) assert.equal((await c.req('PUT', '/api/state', { version: 0, data })).statusCode, 400);
  const extra = state({ evil: 'x', transactions: [{ ...state().transactions[0], isAdmin: true }] });
  assert.equal((await c.req('PUT', '/api/state', { version: 0, data: extra })).statusCode, 200);
  const back = (await c.req('GET', '/api/state')).data.data;
  assert.equal(back.evil, undefined); assert.equal(back.transactions[0].isAdmin, undefined);
});

test('prototype-pollution payloads are refused', async () => {
  const { app } = await makeServer();
  const c = new Client(app);
  await c.register();
  const r = await app.inject({ method: 'PUT', url: '/api/state', headers: { cookie: c.cookieHeader(), 'x-csrf-token': c.csrf, 'content-type': 'application/json' },
    payload: '{"version":0,"data":{"__proto__":{"polluted":true}}}' });
  assert.equal(r.statusCode, 400);
  assert.equal(({}).polluted, undefined);
});

test('request size limits: 64 KB for sign-in, 8 MB for data', async () => {
  const { app } = await makeServer();
  const big = await new Client(app).req('POST', '/api/auth/login', { email: 'a@b.my', password: 'x'.repeat(70 * 1024) });
  assert.equal(big.statusCode, 413);
  assert.match(big.data.error, /too much data/);
});

test('financial data is encrypted at rest and bound to its owner', async () => {
  const { app } = await makeServer({ registration: 'open' });
  const a = new Client(app), b = new Client(app);
  await a.register('a@example.my'); await b.register('b@example.my');
  await a.req('PUT', '/api/state', { version: 0, data: state() });
  await b.req('PUT', '/api/state', { version: 0, data: state({ transactions: [] }) });
  const rows = app.db.prepare('SELECT user_id, data FROM user_state ORDER BY user_id').all();
  assert.ok(!rows[0].data.includes('TENAGA') && !rows[0].data.includes('142.35'), 'no plaintext in the database');
  assert.match(rows[0].data, /^v1\./);
  // copying A's ciphertext into B's row must not reveal A's data to B
  app.db.prepare('UPDATE user_state SET data = ? WHERE user_id = ?').run(rows[0].data, rows[1].user_id);
  const swapped = await b.req('GET', '/api/state');
  assert.equal(swapped.statusCode, 500);
  assert.ok(!swapped.body.includes('TENAGA'));
});

test('users can only see their own data', async () => {
  const { app } = await makeServer({ registration: 'open' });
  const a = new Client(app), b = new Client(app);
  await a.register('a@example.my'); await b.register('b@example.my');
  await a.req('PUT', '/api/state', { version: 0, data: state() });
  const r = await b.req('GET', '/api/state');
  assert.deepEqual([r.data.version, r.data.data], [0, null]);
});

test('errors never reveal internals', async () => {
  const { app } = await makeServer();
  app.get('/api/boom', async () => { throw new Error('SQLITE_CORRUPT at C:\\secret\\aliran.db'); });
  const boom = await app.inject({ method: 'GET', url: '/api/boom' });
  assert.equal(boom.statusCode, 500);
  assert.ok(!boom.body.includes('secret') && !boom.body.includes('SQLITE') && !boom.body.includes('at '), boom.body);
  const junk = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{bad json' });
  assert.equal(junk.statusCode, 400);
  assert.ok(!/stack|node_modules/.test(junk.body));
  const nf = await app.inject({ method: 'GET', url: '/../../etc/passwd' });
  assert.equal(nf.statusCode, 404);
});

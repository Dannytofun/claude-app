// Runs the real Fastify app in-process (no network) with an in-memory database and a controllable clock.
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('../../server/config');
const { buildApp } = require('../../server/app');

const FAST_HASH = { N: 1024, r: 8, p: 1, keyLen: 32 }; // keeps tests quick; production uses N=2^17
const GOOD_PW = 'teh tarik before payday';

async function makeServer(overrides = {}, env = {}) {
  let clock = Date.UTC(2026, 9, 22, 2, 0, 0);
  const cfg = loadConfig({ DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), ...env }, {
    dbFile: ':memory:',
    publicOrigin: 'http://localhost',
    publicFile: path.join(__dirname, '..', '..', 'public', 'index.html'),
    now: () => clock,
    ...overrides
  });
  const app = await buildApp(cfg, { logger: false, hashParams: FAST_HASH });
  return { app, cfg, advance: ms => { clock += ms; } };
}

/** A browser-like client: keeps cookies, sends same-origin headers and the CSRF token. */
class Client {
  constructor(app) { this.app = app; this.jar = new Map(); this.csrf = null; }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  storeCookies(res) {
    for (const c of [].concat(res.headers['set-cookie'] || [])) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/max-age=0/i.test(c) || /expires=thu, 01 jan 1970/i.test(c) || v === '') this.jar.delete(k); else this.jar.set(k, v);
    }
  }
  async req(method, url, body, headers = {}) {
    const h = { origin: 'http://localhost', 'sec-fetch-site': 'same-origin', ...headers };
    if (this.jar.size) h.cookie = this.cookieHeader();
    if (this.csrf && method !== 'GET' && !('x-csrf-token' in headers)) h['x-csrf-token'] = this.csrf;
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const res = await this.app.inject({ method, url, headers: h, ...(body !== undefined ? { payload: body } : {}) });
    this.storeCookies(res);
    let json = null; try { json = res.json(); } catch { /* not JSON */ }
    res.data = json || {};
    if (res.data.csrfToken) this.csrf = res.data.csrfToken;
    return res;
  }
  register(email = 'aina@example.my', password = GOOD_PW) { return this.req('POST', '/api/auth/register', { email, password }); }
  login(email = 'aina@example.my', password = GOOD_PW) { return this.req('POST', '/api/auth/login', { email, password }); }
}

/** A minimal valid app state, shaped like the frontend's. */
const state = (extra = {}) => ({
  version: 1, hasSample: false,
  transactions: [{ id: 't1', type: 'expense', amount: 142.35, date: '2026-10-21', category: 'Utilities', merchant: 'TENAGA NASIONAL BERHAD', reference: '2810445566', notes: '', sourceFile: 'tnb.png', createdAt: '2026-10-21T00:00:00Z' }],
  bills: [], billPayments: [], goals: [], budgets: { Utilities: 200 },
  categories: ['Utilities', 'Other'],
  settings: { savingsMode: 'percent', savingsPercent: 10, savingsFixed: 500, theme: 'system', currency: 'RM', merchantCategoryMap: {}, keywords: { Utilities: ['TNB'] } },
  ...extra
});

/** fetch() for a jsdom page, routed into the in-process server. Share `jar` to simulate a reload. */
function bridgeFetch(app, jar = new Map()) {
  const client = new Client(app); client.jar = jar;
  return () => async (url, opts = {}) => {
    const u = new URL(url, 'http://localhost');
    const headers = {};
    for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
    const res = await client.req(opts.method || 'GET', u.pathname + u.search, opts.body, { 'x-csrf-token': headers['x-csrf-token'], 'content-type': headers['content-type'] });
    const noBody = res.statusCode === 204 || res.statusCode === 304;
    return new Response(noBody ? null : res.body, { status: res.statusCode, headers: { 'content-type': res.headers['content-type'] || 'text/plain' } });
  };
}

module.exports = { makeServer, Client, state, bridgeFetch, GOOD_PW };

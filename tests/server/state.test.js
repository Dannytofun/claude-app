// Saving and loading the cashflow data, versioning, and compatibility with the real frontend
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeServer, Client, state } = require('./helper');
const { makeApp } = require('../frontend/harness');

test('save and load: version starts at 0, each save increments it', async () => {
  const { app } = await makeServer();
  const c = new Client(app);
  await c.register();
  assert.deepEqual((await c.req('GET', '/api/state')).data, { version: 0, data: null, updatedAt: null });
  assert.equal((await c.req('PUT', '/api/state', { version: 0, data: state() })).data.version, 1);
  assert.equal((await c.req('PUT', '/api/state', { version: 1, data: state({ budgets: { Utilities: 250 } }) })).data.version, 2);
  const r = await c.req('GET', '/api/state');
  assert.deepEqual([r.data.version, r.data.data.budgets.Utilities, r.data.data.transactions[0].merchant], [2, 250, 'TENAGA NASIONAL BERHAD']);
});

test('a save based on an old version is refused with the latest data (no silent overwrite)', async () => {
  const { app } = await makeServer();
  const phone = new Client(app), laptop = new Client(app);
  await phone.register(); await laptop.login();
  await phone.req('PUT', '/api/state', { version: 0, data: state({ budgets: { Utilities: 111 } }) });
  const stale = await laptop.req('PUT', '/api/state', { version: 0, data: state({ budgets: { Utilities: 999 } }) });
  assert.equal(stale.statusCode, 409);
  assert.deepEqual([stale.data.version, stale.data.data.budgets.Utilities], [1, 111]);
  assert.equal((await laptop.req('GET', '/api/state')).data.data.budgets.Utilities, 111);
});

test('the real frontend\'s full sample data (6 months, every record type) passes validation unchanged', async () => {
  const front = makeApp();
  const data = JSON.parse(front.ev('JSON.stringify(S)'));
  data.billPayments.push({ billId: data.bills[0].id, month: '2020-01', paidDate: '2020-01-01', actualAmount: 1, transactionId: null, createdTx: false, beforeTracking: true });
  const { app } = await makeServer();
  const c = new Client(app);
  await c.register();
  const put = await c.req('PUT', '/api/state', { version: 0, data });
  assert.equal(put.statusCode, 200, JSON.stringify(put.data));
  const back = (await c.req('GET', '/api/state')).data.data;
  assert.deepEqual(back, data);
});

test('health check reports the database is reachable', async () => {
  const { app } = await makeServer();
  const r = await app.inject({ method: 'GET', url: '/api/health' });
  assert.deepEqual([r.statusCode, r.json()], [200, { ok: true }]);
});

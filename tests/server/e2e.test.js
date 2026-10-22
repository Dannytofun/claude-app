// End to end: the real web app (in jsdom) talking to the real backend (in-process)
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeServer, Client, bridgeFetch, GOOD_PW } = require('./helper');
const { makeApp } = require('../frontend/harness');

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out waiting'); await wait(20); }
}
async function openBrowser(app, jar = new Map()) {
  const page = makeApp({ fetch: bridgeFetch(app, jar) });
  await until(() => !page.$('#authRoot').hidden || !page.$('.app').hidden && page.ev('S'));
  return page;
}
async function signIn(page, email, pw, register) {
  if (register && page.$('#authRoot h1').textContent !== 'Create your account') page.click('#aSwitch');
  page.$('#aEmail').value = email; page.$('#aPass').value = pw;
  page.$('#authForm').dispatchEvent(new page.win.Event('submit', { cancelable: true, bubbles: true }));
  await until(() => !page.$('.app').hidden || !page.$('#aErr').hidden);
}
const serverState = async (app, email = 'aina@example.my') => { const c = new Client(app); await c.login(email); return (await c.req('GET', '/api/state')).data; };

test('first visit asks the owner to create an account; afterwards sample data is saved to the server, not the browser', async () => {
  const { app } = await makeServer();
  const page = await openBrowser(app);
  assert.equal(page.$('.app').hidden, true, 'no data shown before sign-in');
  assert.equal(page.$('#authRoot h1').textContent, 'Create your account');
  await signIn(page, 'aina@example.my', GOOD_PW, true);
  assert.match(page.$('#sideFoot').textContent, /Signed in as aina@example\.my/);
  assert.ok(page.$$('.kpi').length === 5, 'dashboard shows');
  await until(() => page.$('#syncStatus').dataset.state === 'saved' && !page.ev('API.dirty'));
  const s = await serverState(app);
  assert.equal(s.version, 1);
  assert.ok(s.data.transactions.length > 100);
  assert.equal(page.win.localStorage.getItem('aliran.cashflow.v1'), null, 'no financial data left in browser storage');
});

test('edits sync automatically, and a reload signs straight back in with the same data', async () => {
  const { app } = await makeServer();
  const jar = new Map();
  const page = await openBrowser(app, jar);
  await signIn(page, 'aina@example.my', GOOD_PW, true);
  page.go('transactions'); page.click('[data-act="manual"]');
  page.set('#tAmt', '18.50'); page.set('#tMerch', 'Nasi Kandar Pelita'); page.set('#tCat', 'Food & Dining');
  page.click('#tSave');
  await wait(700);
  await until(() => !page.ev('API.dirty') && page.ev('API.sync') === 'saved');
  const s = await serverState(app);
  assert.ok(s.data.transactions.some(t => t.merchant === 'Nasi Kandar Pelita'));

  const reloaded = await openBrowser(app, jar);
  await until(() => reloaded.ev('S'));
  assert.equal(reloaded.$('#authRoot').hidden, true, 'still signed in');
  assert.ok(reloaded.ev(`S.transactions.some(t => t.merchant === 'Nasi Kandar Pelita')`));
});

test('sign out clears the data from the page and ends the session', async () => {
  const { app } = await makeServer();
  const jar = new Map();
  const page = await openBrowser(app, jar);
  await signIn(page, 'aina@example.my', GOOD_PW, true);
  page.go('backup'); page.click('[data-act="sign-out"]');
  await until(() => !page.$('#authRoot').hidden);
  assert.equal(page.ev('S'), null);
  assert.match(page.$('#authRoot').textContent, /You’ve signed out/);
  const again = await openBrowser(app, jar);
  assert.equal(again.$('#authRoot').hidden, false, 'old cookie no longer works');
});

test('wrong password shows the message from the server and keeps data hidden', async () => {
  const { app } = await makeServer();
  await new Client(app).register();
  const page = await openBrowser(app);
  assert.equal(page.$('#authRoot h1').textContent, 'Sign in', 'registration closed after the owner signed up');
  assert.equal(page.$('#aSwitch'), null);
  await signIn(page, 'aina@example.my', 'definitely not it');
  assert.match(page.$('#aErr').textContent, /incorrect/);
  assert.equal(page.$('.app').hidden, true);
});

test('editing on two devices: the older copy is replaced by the newer one instead of overwriting it', async () => {
  const { app } = await makeServer();
  const phone = await openBrowser(app);
  await signIn(phone, 'aina@example.my', GOOD_PW, true);
  await until(() => !phone.ev('API.dirty') && phone.ev('API.sync') === 'saved');
  const laptop = await openBrowser(app);
  await signIn(laptop, 'aina@example.my', GOOD_PW);
  phone.ev(`S.budgets['Food & Dining'] = 777; save()`);
  await wait(700); await until(() => !phone.ev('API.dirty') && !phone.ev('API.inflight'));
  laptop.ev(`S.budgets['Food & Dining'] = 111; save()`);
  await wait(700); await until(() => !laptop.ev('API.inflight') && laptop.ev('API.sync') === 'saved');
  assert.equal(laptop.ev(`S.budgets['Food & Dining']`), 777, 'laptop now shows the phone\'s newer data');
  assert.match(laptop.toast(), /changed on another device/);
  assert.equal((await serverState(app)).data.budgets['Food & Dining'], 777);
});

test('session times out mid-edit: sign in again and the unsaved change is still saved', async () => {
  const { app, advance } = await makeServer();
  const page = await openBrowser(app);
  await signIn(page, 'aina@example.my', GOOD_PW, true);
  await until(() => !page.ev('API.dirty') && page.ev('API.sync') === 'saved');
  advance(31 * 60_000);
  page.ev(`S.budgets.Health = 321; save()`);
  await until(() => !page.$('#authRoot').hidden, 4000);
  assert.match(page.$('#authRoot').textContent, /session ended/);
  await signIn(page, 'aina@example.my', GOOD_PW);
  await until(() => !page.ev('API.dirty') && !page.ev('API.inflight') && page.ev('API.sync') === 'saved');
  assert.equal((await serverState(app)).data.budgets.Health, 321);
});

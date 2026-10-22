// Feature 8 + quality bar: storage, sample data, backup/restore, CSV, categories, theme, safety
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, emptyApp, tx } = require('./harness');

const TABS = ['dashboard', 'bills', 'transactions', 'budgets', 'backup'];

test('first visit loads realistic sample data; every tab renders for every month without errors', () => {
  const app = makeApp();
  const s = app.S();
  assert.ok(s.hasSample && s.transactions.length > 100 && s.bills.length >= 6 && s.goals.length === 2);
  assert.ok(app.$('#sampleBanner').textContent.includes('example data'));
  for (let k = -6; k <= 1; k++) {
    app.ev(`ui.month = addMonths(curYM(), ${k})`);
    for (const t of TABS) { app.go(t); assert.ok(app.$('#view').textContent.length > 100, `${t} ${k}`); }
  }
  assert.deepEqual(app.errors, []);
});

test('sample current month shows an overdue bill and a bill due soon', () => {
  const app = makeApp();
  const keys = JSON.parse(app.ev(`JSON.stringify(dueSoon().map(x => x.st.key))`));
  assert.ok(keys.includes('overdue'));
  assert.ok(keys.some(k => k === 'due3' || k === 'due7'));
});

test('data survives a reload', () => {
  const a = emptyApp();
  a.seed('transactions', [tx({ merchant: 'Kept' })]);
  const b = makeApp({ stored: a.win.localStorage.getItem('aliran.cashflow.v1') });
  assert.equal(b.S().transactions[0].merchant, 'Kept');
  assert.equal(b.S().hasSample, false, 'sample data is not re-added');
});

test('clear sample data removes only sample records and keeps the user\'s own', () => {
  const app = makeApp();
  app.seed('transactions', [tx({ merchant: 'Mine' })]);
  app.click('[data-act="clear-sample"]'); app.click('#cOk');
  const s = app.stored();
  assert.deepEqual(s.transactions.map(t => t.merchant), ['Mine']);
  assert.deepEqual([s.bills.length, s.billPayments.length, s.goals.length, s.hasSample], [0, 0, 0, false]);
  assert.ok(Object.keys(s.budgets).length > 0, 'budget limits kept');
  assert.equal(app.$('#sampleBanner').hidden, true);
});

test('blocked storage: app still works in memory and warns the user', () => {
  const app = makeApp({ blockStorage: true });
  assert.equal(app.ev('storageOk'), false);
  assert.match(app.$('#sampleBanner').textContent, /blocking storage/);
  app.ev(`S = defaultState(); render();`);
  app.go('transactions'); app.click('[data-act="manual"]');
  app.set('#tAmt', '5'); app.set('#tCat', 'Other'); app.click('#tSave');
  assert.equal(app.S().transactions.length, 1);
  assert.deepEqual(app.errors, []);
});

test('corrupt or partial saved data does not break the app', () => {
  const bad = makeApp({ stored: '{not json' });
  assert.ok(bad.S().transactions.length > 0, 'falls back to a working state');
  const partial = makeApp({ stored: { transactions: [tx({ merchant: 'Old' })], budgets: [] } });
  const s = partial.S();
  assert.equal(s.transactions[0].merchant, 'Old');
  assert.equal(s.categories.length, 13);
  assert.equal(s.settings.savingsPercent, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(s.budgets)), {});
  assert.deepEqual(partial.errors, []);
});

test('JSON backup round-trip restores everything into another browser', async () => {
  const a = makeApp();
  a.go('backup'); a.click('[data-act="export-json"]');
  const text = a.$('#expText').value;
  const b = emptyApp();
  b.win.__f = new b.win.File([text], 'backup.json', { type: 'application/json' });
  b.ev('importJSON(window.__f)');
  await b.tick(50);
  assert.match(b.$('.modal-b').textContent, /Everything currently in this browser is replaced/);
  b.click('#cOk');
  const sa = a.S(), sb = b.stored();
  assert.equal(sb.transactions.length, sa.transactions.length);
  assert.deepEqual(sb.bills, JSON.parse(JSON.stringify(sa.bills)));
  assert.equal(b.ev(`monthTotals('2026-10').net`), a.ev(`monthTotals('2026-10').net`));
});

test('importing a file that is not a backup is refused and changes nothing', async () => {
  const b = emptyApp();
  b.seed('transactions', [tx()]);
  b.win.__f = new b.win.File(['{"hello":1}'], 'x.json', { type: 'application/json' });
  b.ev('importJSON(window.__f)'); await b.tick(50);
  assert.match(b.toast(), /doesn’t look like an Aliran backup/);
  b.win.__f = new b.win.File(['nope'], 'x.json', { type: 'application/json' });
  b.ev('importJSON(window.__f)'); await b.tick(50);
  assert.match(b.toast(), /isn’t valid JSON/);
  assert.equal(b.stored().transactions.length, 1);
});

test('imported backup with damaged records still renders every tab', async () => {
  const b = emptyApp();
  const backup = { transactions: [{ id: 'x', type: 'income', category: 'Salary', amount: '4000' }, { id: 'y', type: 'expense', amount: 'abc', date: '2026-10-01', category: 'Other' }, null], bills: [{ id: 'b', name: 'Rent', category: 'Housing', amount: 1000, dueDay: 1, frequency: 'monthly' }] };
  b.win.__f = new b.win.File([JSON.stringify(backup)], 'b.json', { type: 'application/json' });
  b.ev('importJSON(window.__f)'); await b.tick(50); b.click('#cOk');
  for (const t of TABS) b.go(t);
  b.go('bills'); b.click('[data-act="pay"]');
  assert.deepEqual(b.errors, []);
  assert.ok(b.$('#pOk'), 'mark-as-paid still opens');
});

test('CSV export: header, date order, and quoting of commas and quotes', () => {
  const app = emptyApp();
  app.seed('transactions', [tx({ merchant: 'Kedai "Pak" Mat, SS2', amount: 12.5, date: '2026-10-12' }), tx({ merchant: 'First', date: '2026-10-01' })]);
  app.go('backup'); app.click('[data-act="export-csv"]');
  const lines = app.$('#expText').value.split('\n');
  assert.equal(lines[0], 'date,type,category,merchant_or_source,reference,amount,bill,goal,notes,source_file');
  assert.match(lines[1], /^2026-10-01,expense,Other,First,/);
  assert.equal(lines[2], '2026-10-12,expense,Other,"Kedai ""Pak"" Mat, SS2",,12.50,,,,');
});

test('categories: add (appears in budgets), remove (records move to Other)', () => {
  const app = emptyApp();
  app.ev(`S.budgets.Health = 100`);
  app.seed('transactions', [tx({ category: 'Health' })]);
  app.seed('bills', [{ id: 'b', name: 'Gym', category: 'Health', amount: 99, dueDay: 1, frequency: 'monthly', startMonth: '2026-01' }]);
  app.go('backup');
  app.set('#newCat', 'Pets'); app.click('[data-act="add-cat"]');
  assert.equal(app.S().categories.at(-2), 'Pets');
  app.set('#newCat', 'pets'); app.click('[data-act="add-cat"]');
  assert.match(app.toast(), /already exists/);
  app.click('[data-act="del-cat"][data-c="Health"]'); app.click('#cOk');
  const s = app.stored();
  assert.ok(!s.categories.includes('Health'));
  assert.deepEqual([s.transactions[0].category, s.bills[0].category, s.budgets.Health], ['Other', 'Other', undefined]);
  app.go('budgets');
  assert.ok(app.$('[data-budget="Pets"]'));
});

test('clear all data needs DELETE typed before the button works', () => {
  const app = makeApp();
  app.go('backup'); app.click('[data-act="clear-all"]');
  assert.equal(app.$('#delOk').disabled, true);
  app.set('#delConf', 'delete');
  assert.equal(app.$('#delOk').disabled, false);
  app.click('#delOk');
  const s = app.stored();
  assert.deepEqual([s.transactions.length, s.bills.length, s.goals.length, s.hasSample], [0, 0, 0, false]);
});

test('theme: light/dark setting applies and persists; "system" defers to the device', () => {
  const app = emptyApp();
  app.go('backup'); app.set('#setTheme', 'dark');
  assert.equal(app.win.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(app.stored().settings.theme, 'dark');
  app.set('#setTheme', 'system');
  assert.equal(app.win.document.documentElement.getAttribute('data-theme'), null);
});

test('payee and category names from receipts cannot inject HTML', () => {
  const app = emptyApp();
  const evil = '<img src=x onerror="window.__pwned=1">';
  app.seed('bills', [{ id: 'b', name: evil, category: 'Other', amount: 1, dueDay: 21, frequency: 'monthly', startMonth: '2026-01' }]);
  app.seed('transactions', [tx({ merchant: evil, reference: evil, notes: evil })]);
  for (const t of TABS) app.go(t);
  app.go('transactions');
  assert.equal(app.$$('#view img, .due img').length, 0);
  assert.ok(app.$('#view').textContent.includes('<img src=x'), 'shown as text');
  app.go('bills');
  assert.equal(app.$$('.due img').length, 0);
  assert.equal(app.win.__pwned, undefined);
});

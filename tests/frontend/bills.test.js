// Feature 2: recurring bills, due dates, status badges, mark as paid
const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyApp, tx } = require('./harness');

const bill = o => Object.assign({ id: 'b1', name: 'Unifi', category: 'Phone & Internet', amount: 129, isVariable: false, dueDay: 10, frequency: 'monthly', startMonth: '2026-01' }, o);
const status = (app, id, m) => app.ev(`billStatus(S.bills.find(b=>b.id==='${id}'), '${m}').key`);
const label = (app, id, m) => app.ev(`billStatus(S.bills.find(b=>b.id==='${id}'), '${m}').label`);

test('month helpers cross year boundaries and handle leap years', () => {
  const app = emptyApp();
  assert.equal(app.ev(`addMonths('2026-12', 1)`), '2027-01');
  assert.equal(app.ev(`addMonths('2026-01', -1)`), '2025-12');
  assert.equal(app.ev(`addMonths('2026-10', -14)`), '2025-08');
  assert.equal(app.ev(`monthDiff('2025-11', '2026-02')`), 3);
  assert.equal(app.ev(`daysInMonth('2028-02')`), 29);
});

test('due day 31 falls on the last day of shorter months', () => {
  const app = emptyApp();
  app.seed('bills', [bill({ dueDay: 31 })]);
  assert.equal(app.ev(`toISO(billDueDate(S.bills[0], '2027-02'))`), '2027-02-28');
  assert.equal(app.ev(`toISO(billDueDate(S.bills[0], '2028-02'))`), '2028-02-29');
  assert.equal(app.ev(`toISO(billDueDate(S.bills[0], '2026-11'))`), '2026-11-30');
});

test('frequency: quarterly and yearly bills appear only in their months, never before the first month', () => {
  const app = emptyApp();
  app.seed('bills', [bill({ id: 'q', frequency: 'quarterly', startMonth: '2026-01' }), bill({ id: 'y', frequency: 'yearly', startMonth: '2026-03' })]);
  const due = (id, m) => app.ev(`billDueIn(S.bills.find(b=>b.id==='${id}'), '${m}')`);
  assert.deepEqual(['2025-12', '2026-01', '2026-02', '2026-04', '2026-05', '2026-07'].map(m => due('q', m)), [false, true, false, true, false, true]);
  assert.deepEqual(['2026-03', '2026-09', '2027-03'].map(m => due('y', m)), [true, false, true]);
});

test('status badges relative to today (22 Oct): Overdue, Due today, ≤3 days, ≤7 days, upcoming', () => {
  const app = emptyApp();
  app.seed('bills', [21, 22, 25, 29, 30].map(d => bill({ id: 'd' + d, dueDay: d })));
  assert.deepEqual([21, 22, 25, 29, 30].map(d => status(app, 'd' + d, '2026-10')), ['overdue', 'due3', 'due3', 'due7', 'upcoming']);
  assert.equal(label(app, 'd21', '2026-10'), 'Overdue 1 day');
  assert.equal(label(app, 'd22', '2026-10'), 'Due today');
  assert.equal(label(app, 'd25', '2026-10'), 'Due in 3 days');
  assert.equal(status(app, 'd30', '2026-09'), 'overdue', 'unpaid in an earlier month stays overdue');
});

test('bills auto-appear each month as unpaid; a payment marks only that month paid', () => {
  const app = emptyApp();
  app.seed('bills', [bill({ dueDay: 28 })]);
  app.seed('billPayments', [{ billId: 'b1', month: '2026-10', paidDate: '2026-10-05', actualAmount: 129, transactionId: 'x', createdTx: true }]);
  assert.equal(status(app, 'b1', '2026-10'), 'paid');
  assert.equal(status(app, 'b1', '2026-11'), 'upcoming');
});

test('"Due soon" strip lists overdue (including last month) and bills due within 7 days, and nothing else', () => {
  const app = emptyApp();
  app.seed('bills', [bill({ id: 'early', name: 'Rent', dueDay: 2, startMonth: '2026-09' }), bill({ id: 'soon', name: 'Takaful', dueDay: 27, startMonth: '2026-10' }), bill({ id: 'later', name: 'Netflix', dueDay: 30, startMonth: '2026-10' })]);
  const items = JSON.parse(app.ev(`JSON.stringify(dueSoon().map(x => x.b.id + ' ' + x.m + ' ' + x.st.key))`));
  assert.deepEqual(items, ['early 2026-09 overdue', 'early 2026-10 overdue', 'soon 2026-10 due7']);
  const strip = app.$('.due').textContent;
  assert.match(strip, /Rent/); assert.match(strip, /Takaful/); assert.doesNotMatch(strip, /Netflix/);
  assert.equal(app.$('#nav .count').textContent, '2', 'sidebar shows the overdue count');
});

test('"Due soon" looks into next month near month end', () => {
  const app = emptyApp({ now: [2026, 9, 28] });
  app.seed('bills', [bill({ dueDay: 2, startMonth: '2026-10' })]);
  app.seed('billPayments', [{ billId: 'b1', month: '2026-10', paidDate: '2026-10-02', actualAmount: 129, transactionId: 'x' }]);
  const items = JSON.parse(app.ev(`JSON.stringify(dueSoon().map(x => x.m + ' ' + x.st.label))`));
  assert.deepEqual(items, ['2026-11 Due in 5 days']);
});

test('add-bill form rejects missing name, zero amount and an invalid due day, then saves a valid bill', () => {
  const app = emptyApp();
  app.go('bills');
  app.click('[data-act="add-bill"]');
  app.click('#bSave');
  assert.equal(app.S().bills.length, 0); assert.match(app.toast(), /name/);
  app.set('#bName', 'TNB electricity'); app.click('#bSave');
  assert.equal(app.S().bills.length, 0); assert.match(app.toast(), /amount/);
  app.set('#bAmt', '120'); app.set('#bDay', '32'); app.click('#bSave');
  assert.equal(app.S().bills.length, 0); assert.match(app.toast(), /between 1 and 31/);
  app.set('#bDay', '15'); app.set('#bVar', '1'); app.click('#bSave');
  const b = app.stored().bills[0];
  assert.deepEqual([b.name, b.category, b.amount, b.isVariable, b.dueDay, b.frequency, b.startMonth], ['TNB electricity', 'Utilities', 120, true, 15, 'monthly', '2026-10']);
});

test('mark a variable bill as paid with the actual amount: creates one expense, updates the estimate', () => {
  const app = emptyApp();
  app.seed('bills', [bill({ name: 'TNB electricity', category: 'Utilities', amount: 120, isVariable: true, dueDay: 15, startMonth: '2026-10' })]);
  app.go('bills');
  app.click('[data-act="pay"][data-id="b1"]');
  app.click('#pOk');
  assert.equal(app.S().transactions.length, 0, 'variable bill needs the actual amount');
  app.set('#pAmt', '143.60'); app.click('#pOk');
  const s = app.stored();
  assert.equal(s.transactions.length, 1);
  assert.deepEqual([s.transactions[0].amount, s.transactions[0].billId, s.transactions[0].category], [143.6, 'b1', 'Utilities']);
  assert.deepEqual([s.billPayments[0].month, s.billPayments[0].actualAmount], ['2026-10', 143.6]);
  assert.equal(s.bills[0].amount, 143.6, 'next month estimate follows the last actual');
  assert.equal(status(app, 'b1', '2026-10'), 'paid');
  assert.equal(app.ev(`monthTotals('2026-10').bills`), 143.6);
});

test('link an uploaded receipt instead of creating a duplicate expense', () => {
  const app = emptyApp();
  app.seed('bills', [bill({ dueDay: 10, startMonth: '2026-10' })]);
  app.seed('transactions', [tx({ id: 'r1', amount: 129, merchant: 'UNIFI', category: 'Other', date: '2026-10-09', sourceFile: 'unifi.png' })]);
  app.go('bills');
  app.click('[data-act="pay"][data-id="b1"]');
  assert.ok(app.$$('#pLink option').some(o => o.value === 'r1'), 'receipt offered');
  app.set('#pLink', 'r1'); app.click('#pOk');
  const s = app.stored();
  assert.equal(s.transactions.length, 1, 'no duplicate');
  assert.deepEqual([s.transactions[0].billId, s.transactions[0].category], ['b1', 'Phone & Internet']);
  assert.equal(s.billPayments[0].createdTx, false);
});

test('undo payment: removes an expense it created, but only unlinks an uploaded receipt', () => {
  const app = emptyApp();
  app.seed('bills', [bill({ id: 'b1' }), bill({ id: 'b2', name: 'Maxis' })]);
  app.seed('transactions', [tx({ id: 'made', amount: 129, billId: 'b1' }), tx({ id: 'linked', amount: 68, billId: 'b2' })]);
  app.seed('billPayments', [{ billId: 'b1', month: '2026-10', paidDate: '2026-10-10', actualAmount: 129, transactionId: 'made', createdTx: true }, { billId: 'b2', month: '2026-10', paidDate: '2026-10-10', actualAmount: 68, transactionId: 'linked', createdTx: false }]);
  app.go('bills');
  app.click('[data-act="unpay"][data-id="b1"]'); app.click('#cOk');
  app.click('[data-act="unpay"][data-id="b2"]'); app.click('#cOk');
  const s = app.stored();
  assert.deepEqual(s.transactions.map(t => t.id), ['linked']);
  assert.equal(s.transactions[0].billId, undefined);
  assert.equal(s.billPayments.length, 0);
});

/* ---- improvements made after the first test report ---- */

const dueList = app => JSON.parse(app.ev(`JSON.stringify(dueSoon().map(x => x.b.id + ' ' + x.m))`));

test('Due soon lists every unpaid month since the bill started, not just the last 3', () => {
  const app = emptyApp();
  app.seed('bills', [bill({ id: 'old', dueDay: 2, startMonth: '2026-03' })]);
  const items = dueList(app);
  assert.deepEqual(items, ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map(m => 'old ' + m));
  assert.equal(app.$('#nav .count').textContent, '8');
});

test('Due soon skips paid months and stops 2 years back; bills with no start month look back 3 months', () => {
  const app = emptyApp();
  app.seed('bills', [bill({ id: 'p', dueDay: 2, startMonth: '2026-08' }), bill({ id: 'ancient', dueDay: 2, startMonth: '2019-01' }), bill({ id: 'nostart', dueDay: 2, startMonth: '' })]);
  app.seed('billPayments', ['2026-08', '2026-09'].map(m => ({ billId: 'p', month: m, paidDate: m + '-02', actualAmount: 129, transactionId: null })));
  const items = dueList(app);
  assert.deepEqual(items.filter(i => i.startsWith('p ')), ['p 2026-10']);
  const anc = items.filter(i => i.startsWith('ancient'));
  assert.equal(anc.length, 25); assert.equal(anc[0], 'ancient 2024-10');
  assert.deepEqual(items.filter(i => i.startsWith('nostart')), ['2026-07', '2026-08', '2026-09', '2026-10'].map(m => 'nostart ' + m));
});

test('new bill with a passed due date: "already paid" marks that month paid without adding spending', () => {
  const app = emptyApp();
  app.go('bills');
  app.click('[data-act="add-bill"]');
  app.set('#bName', 'Unifi'); app.set('#bAmt', '129');
  app.set('#bDay', '25');
  assert.equal(app.$('#bPaidWrap').hidden, true, 'due date still ahead: no option');
  app.set('#bDay', '10');
  assert.equal(app.$('#bPaidWrap').hidden, false);
  assert.match(app.$('#bPaidLbl').textContent, /October 2026 bill \(due 10 Oct 2026\)/);
  app.$('#bPaidNow').checked = true;
  app.click('#bSave');
  const s = app.stored();
  assert.equal(status(app, s.bills[0].id, '2026-10'), 'paid');
  assert.equal(s.billPayments[0].beforeTracking, true);
  assert.equal(s.transactions.length, 0, 'no expense invented');
  assert.equal(app.ev(`monthTotals('2026-10').bills`), 0);
  assert.deepEqual(dueList(app), []);
  assert.match(app.$('table.t').textContent, /before tracking began/);
  assert.equal(status(app, s.bills[0].id, '2026-11'), 'upcoming', 'next month is still tracked');
});

test('new bill left unticked starts Overdue, and an "already paid" mark can be undone', () => {
  const app = emptyApp();
  app.go('bills');
  app.click('[data-act="add-bill"]');
  app.set('#bName', 'Maxis'); app.set('#bAmt', '68'); app.set('#bDay', '18');
  app.click('#bSave');
  const id = app.stored().bills[0].id;
  assert.equal(status(app, id, '2026-10'), 'overdue');
  app.seed('billPayments', [{ billId: id, month: '2026-10', paidDate: '2026-10-18', actualAmount: 68, transactionId: null, createdTx: false, beforeTracking: true }]);
  app.click(`[data-act="unpay"][data-id="${id}"]`); app.click('#cOk');
  assert.equal(app.stored().billPayments.length, 0);
  assert.deepEqual(app.errors, []);
});

test('editing a bill payment\'s date updates its paid date but it still pays the same month', () => {
  const app = emptyApp();
  app.seed('bills', [bill({ startMonth: '2026-09' })]);
  app.seed('transactions', [tx({ id: 'p', amount: 129, billId: 'b1', date: '2026-09-10', category: 'Phone & Internet', merchant: 'Unifi' })]);
  app.seed('billPayments', [{ billId: 'b1', month: '2026-09', paidDate: '2026-09-10', actualAmount: 129, transactionId: 'p', createdTx: true }]);
  app.go('transactions'); app.set('#fM', 'all');
  app.click('[data-act="edit-tx"][data-id="p"]');
  assert.match(app.$('.modal-b .note').textContent, /payment for Unifi, September 2026 bill/);
  app.set('#tDate', '2026-10-03'); app.click('#tSave');
  const p = app.stored().billPayments[0];
  assert.deepEqual([p.month, p.paidDate], ['2026-09', '2026-10-03']);
  assert.equal(status(app, 'b1', '2026-09'), 'paid');
});

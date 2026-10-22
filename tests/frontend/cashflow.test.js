// Features 1, 5, 6, 7: dashboard totals, savings, budgets, month-to-month trends
const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyApp, tx } = require('./harness');

function octoberApp() {
  const app = emptyApp();
  app.seed('goals', [{ id: 'g1', name: 'Emergency fund', target: 5000, savedAmount: 1000 }]);
  app.seed('transactions', [
    tx({ type: 'income', amount: 5000, category: 'Salary', merchant: 'Rimba Sdn Bhd' }),
    tx({ amount: 1200, category: 'Housing', billId: 'rent' }),
    tx({ amount: 300, category: 'Food & Dining' }),
    tx({ amount: 200, category: 'Groceries' }),
    tx({ type: 'savings', amount: 500, category: 'Savings', goalId: 'g1' }),
    tx({ amount: 999, date: '2026-09-30', category: 'Shopping' }) // other month
  ]);
  return app;
}

test('money format: RM, thousands separators, 2 decimals, signs; MYR option', () => {
  const app = emptyApp();
  assert.equal(app.ev(`money(1234.5)`), 'RM 1,234.50');
  assert.equal(app.ev(`money(-5)`), '−RM 5.00');
  assert.equal(app.ev(`money(12, {sign:true})`), '+RM 12.00');
  app.go('backup'); app.set('#setCur', 'MYR');
  assert.equal(app.ev(`money(7)`), 'MYR 7.00');
});

test('monthly totals: bills vs other spending, savings, and net = income − all outflows', () => {
  const app = octoberApp();
  const t = JSON.parse(app.ev(`JSON.stringify(monthTotals('2026-10'))`));
  assert.deepEqual([t.income, t.bills, t.other, t.saved, t.spending, t.net], [5000, 1200, 500, 500, 1700, 2800]);
  assert.deepEqual(t.byCat, { Housing: 1200, 'Food & Dining': 300, Groceries: 200 });
  assert.deepEqual(t.savByGoal, { 'Emergency fund': 500 });
  assert.deepEqual(t.incomeBySource, { 'Salary · Rimba Sdn Bhd': 5000 });
});

test('dashboard cards and cashflow statement show those totals', () => {
  const app = octoberApp();
  const kpi = app.$$('.kpi .v').map(e => e.textContent);
  assert.deepEqual(kpi, ['RM 5,000.00', 'RM 1,200.00', 'RM 500.00', 'RM 500.00', '+RM 2,800.00']);
  const stmt = app.$('.stmt').textContent;
  assert.match(stmt, /Total out\s*RM 2,200\.00/);
  assert.match(stmt, /Net cashflow\s*\+RM 2,800\.00/);
});

test('net cashflow card turns red when outflows exceed income', () => {
  const app = octoberApp();
  app.seed('transactions', [tx({ amount: 3000, category: 'Shopping' })]);
  assert.ok(app.$('.kpi.net').classList.contains('negative'));
  assert.equal(app.$('.kpi.net .v').textContent, '−RM 200.00');
});

test('month selector moves the dashboard to past months', () => {
  const app = octoberApp();
  app.click('#mPrev');
  assert.equal(app.$('#mSel').value, '2026-09');
  assert.equal(app.$$('.kpi .v')[2].textContent, 'RM 999.00');
});

test('budget bar states: under 80% ok, 80% amber, 100% red, with dashboard warnings', () => {
  const app = emptyApp();
  app.ev(`S.budgets = {'Food & Dining': 500, 'Groceries': 500, 'Transport': 500}`);
  app.seed('transactions', [tx({ amount: 399, category: 'Food & Dining' }), tx({ amount: 400, category: 'Groceries' }), tx({ amount: 520, category: 'Transport' })]);
  const st = JSON.parse(app.ev(`JSON.stringify(budgetRows('2026-10').map(r => r.c + ':' + r.state))`));
  assert.deepEqual(st, ['Transport:over', 'Food & Dining:ok', 'Groceries:warn']);
  const alerts = app.$$('.alert').map(a => a.textContent);
  assert.equal(alerts.length, 2);
  assert.ok(alerts.some(a => /Transport is over budget.*RM 20\.00 over/.test(a)));
  assert.ok(alerts.some(a => /Groceries is close to its limit/.test(a)));
  app.go('budgets');
  assert.ok(app.$$('.budget .fill.over').length === 1 && app.$$('.budget .fill.warn').length === 1);
});

test('setting and clearing a budget limit on the Budgets tab', () => {
  const app = emptyApp();
  app.go('budgets');
  app.set('[data-budget="Health"]', '150');
  assert.equal(app.stored().budgets.Health, 150);
  app.set('[data-budget="Health"]', '');
  assert.equal(app.stored().budgets.Health, undefined);
});

test('month comparison: savings rate and top 3 increased categories with insight text', () => {
  const app = emptyApp();
  app.seed('transactions', [
    tx({ type: 'income', amount: 4000, date: '2026-09-25', category: 'Salary' }), tx({ type: 'savings', amount: 400, date: '2026-09-25', category: 'Savings' }),
    tx({ amount: 100, date: '2026-09-05', category: 'Food & Dining' }), tx({ amount: 50, date: '2026-09-05', category: 'Transport' }), tx({ amount: 80, date: '2026-09-05', category: 'Health' }),
    tx({ type: 'income', amount: 4000, date: '2026-10-21', category: 'Salary' }), tx({ type: 'savings', amount: 600, date: '2026-10-21', category: 'Savings' }),
    tx({ amount: 220, category: 'Food & Dining' }), tx({ amount: 90, category: 'Transport' }), tx({ amount: 30, category: 'Shopping' }), tx({ amount: 15, category: 'Groceries' })
  ]);
  const chips = app.$$('.cmp ~ .row .chip').map(c => c.textContent);
  assert.deepEqual(chips, ['Food & Dining +RM 120.00', 'Transport +RM 40.00', 'Shopping +RM 30.00']);
  const ins = app.$('.insights').textContent;
  assert.match(ins, /You spent RM 120\.00 more on Food & Dining than last month\./);
  assert.match(ins, /Health came down by RM 80\.00/);
  assert.match(ins, /savings rate rose to 15\.0% \(from 10\.0%\)/);
});

test('6-month trend covers the selected month and the 5 before it (table fallback when charts are unavailable)', () => {
  const app = octoberApp();
  const months = app.$$('#trendTblWrap tbody tr td:first-child').map(td => td.textContent);
  assert.deepEqual(months, ['May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026']);
  assert.ok(app.$('#trendTblWrap').open, 'chart library missing -> table shown instead');
});

test('pay-yourself-first amount: percent of net pay or a fixed amount, set on the Budgets tab', () => {
  const app = emptyApp();
  assert.equal(app.ev(`suggestedSavings(5000)`), 500, 'default 10%');
  app.go('budgets');
  app.set('#svVal', '15');
  assert.equal(app.ev(`suggestedSavings(5000)`), 750);
  app.set('#svMode', 'fixed'); app.set('#svVal', '800');
  assert.equal(app.ev(`suggestedSavings(5000)`), 800);
  assert.deepEqual([app.stored().settings.savingsMode, app.stored().settings.savingsFixed], ['fixed', 800]);
});

test('goal progress = starting balance + transfers; estimate uses the last 3 months', () => {
  const app = emptyApp();
  app.seed('goals', [{ id: 'g1', name: 'Emergency fund', target: 5000, savedAmount: 1000 }]);
  app.seed('transactions', [
    tx({ type: 'savings', amount: 900, date: '2026-07-25', goalId: 'g1' }), // outside window
    tx({ type: 'savings', amount: 100, date: '2026-08-25', goalId: 'g1' }),
    tx({ type: 'savings', amount: 100, date: '2026-09-25', goalId: 'g1' }),
    tx({ type: 'savings', amount: 100, date: '2026-10-21', goalId: 'g1' })
  ]);
  assert.equal(app.ev(`goalSaved(S.goals[0])`), 2200);
  assert.equal(app.ev(`goalRate(S.goals[0])`), 100);
  app.go('budgets');
  const g = app.$('.goal').textContent;
  assert.match(g, /RM 2,200\.00/); assert.match(g, /44%/);
  assert.match(g, /About 28 months to go at RM 100\.00\/month \(around Feb 2029\)/);
});

test('goal with no recent transfers says so; reached goal says reached', () => {
  const app = emptyApp();
  app.seed('goals', [{ id: 'a', name: 'A', target: 1000, savedAmount: 0 }, { id: 'b', name: 'B', target: 1000, savedAmount: 1000 }]);
  app.go('budgets');
  const [a, b] = app.$$('.goal').map(e => e.textContent);
  assert.match(a, /no estimate yet/); assert.match(b, /Goal reached/);
});

test('create, contribute to and delete a goal through the UI', () => {
  const app = emptyApp();
  app.go('budgets');
  app.click('[data-act="add-goal"]');
  app.set('#gName', 'Japan trip'); app.set('#gTarget', '6000'); app.click('#gSave');
  const id = app.stored().goals[0].id;
  app.click(`[data-act="contrib"][data-id="${id}"]`);
  app.set('#cAmt', '250'); app.click('#cOk2');
  assert.equal(app.ev(`goalSaved(S.goals[0])`), 250);
  app.click(`[data-act="edit-goal"][data-id="${id}"]`); app.click('#gDel'); app.click('#cOk');
  const s = app.stored();
  assert.equal(s.goals.length, 0);
  assert.equal(s.transactions.length, 1, 'savings history is kept');
  assert.equal(s.transactions[0].goalId, undefined);
});

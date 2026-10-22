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

const pctW = el => parseFloat(el.style.width); // bar width as a number
const legend = app => Object.fromEntries(app.$$('.alloc-legend span').map(s => [s.childNodes[1].textContent.trim(), (s.querySelector('b') || {}).textContent]));

test('dashboard headline: money left, where income went, and the full statement folded away', () => {
  const app = octoberApp();
  assert.equal(app.$('#heroNum').textContent, 'RM 2,800.00');
  assert.match(app.$('.hero').textContent, /Left this month/);
  assert.match(app.$('.hero-sub').textContent, /of RM 5,000\.00 income/);
  assert.deepEqual(legend(app), { Bills: 'RM 1,200.00', 'Other spending': 'RM 500.00', Saved: 'RM 500.00', Left: undefined });
  assert.deepEqual(app.$$('.alloc .seg').map(pctW), [24, 10, 10, 56], 'bar segments are shares of income');
  assert.equal(app.$('#stmtWrap').open, false, 'statement folded by default');
  const stmt = app.$('.stmt').textContent;
  assert.match(stmt, /Total out\s*RM 2,200\.00/);
  assert.match(stmt, /Net cashflow\s*\+RM 2,800\.00/);
});

test('overspending: headline turns red, status says so, and the bar marks where income ran out', () => {
  const app = octoberApp();
  app.seed('transactions', [tx({ amount: 3000, category: 'Shopping' })]);
  assert.ok(app.$('#heroNum').classList.contains('neg'));
  assert.equal(app.$('#heroNum').textContent, 'RM 200.00');
  assert.match(app.$('.hero .eyebrow').textContent, /Overspent this month/);
  assert.equal(app.$('.hero .pill').textContent, 'Spending more than you earn');
  assert.ok(app.$('.pill').classList.contains('bad'));
  assert.equal(parseFloat(app.$('.income-mark').style.left), 96.15, 'income line at 5,000 of 5,200 out');
});

test('status label: on track, or spending ahead of the month\'s pace', () => {
  const app = emptyApp();
  app.ev(`S.budgets = {'Food & Dining': 1000}`);
  app.seed('transactions', [tx({ type: 'income', amount: 5000, category: 'Salary' }), tx({ amount: 500, category: 'Food & Dining' })]);
  assert.equal(app.$('.hero .pill').textContent, 'On track', '50% used, 71% of month gone');
  app.seed('transactions', [tx({ amount: 400, category: 'Food & Dining' })]);
  assert.equal(app.$('.hero .pill').textContent, 'Spending ahead of pace', '90% used, 71% of month gone');
});

test('"This month so far" shows progress bars for the month, bills, budget and savings target', () => {
  const app = octoberApp();
  app.ev(`S.budgets = {'Food & Dining': 600}; S.bills.push({id:'b1', name:'Rent', category:'Housing', amount:1200, dueDay:1, frequency:'monthly', startMonth:'2026-10'}, {id:'b2', name:'Unifi', category:'Phone & Internet', amount:129, dueDay:10, frequency:'monthly', startMonth:'2026-10'}); S.billPayments.push({billId:'b1', month:'2026-10', paidDate:'2026-10-01', actualAmount:1200, transactionId:null}); save(); render();`);
  const rows = Object.fromEntries(app.$$('.prow').map(r => [r.querySelector('.prow-lbl').textContent, [r.querySelector('.prow-val').textContent, pctW(r.querySelector('.fill'))]]));
  assert.deepEqual(rows['Month'], ['Day 22 of 31', 71]);
  assert.deepEqual(rows['Bills paid'], ['1 of 2', 50]);
  assert.deepEqual(rows['Budget used'], ['50%', 50]);
  assert.deepEqual(rows['Savings target'], ['Reached', 100], 'saved 500 of the 10% target (500)');
  assert.equal(parseFloat(app.$('.prow .pace-mark').style.left), 71, 'pace line on the budget bar');
  app.click('#mPrev');
  assert.ok(!app.$$('.prow-lbl').some(e => e.textContent === 'Month'), 'no month bar for a finished month');
});

test('month selector moves the dashboard to past months', () => {
  const app = octoberApp();
  app.click('#mPrev');
  assert.equal(app.$('#mSel').value, '2026-09');
  assert.equal(legend(app)['Other spending'], 'RM 999.00');
});

test('budget bar states: under 80% ok, 80% amber, 100% red, with dashboard warnings', () => {
  const app = emptyApp();
  app.ev(`S.budgets = {'Food & Dining': 500, 'Groceries': 500, 'Transport': 500}`);
  app.seed('transactions', [tx({ amount: 399, category: 'Food & Dining' }), tx({ amount: 400, category: 'Groceries' }), tx({ amount: 520, category: 'Transport' })]);
  const st = JSON.parse(app.ev(`JSON.stringify(budgetRows('2026-10').map(r => r.c + ':' + r.state))`));
  assert.deepEqual(st, ['Transport:over', 'Food & Dining:ok', 'Groceries:warn']);
  const alerts = app.$$('.alert').map(a => a.textContent);
  assert.equal(alerts.length, 2);
  assert.ok(alerts.some(a => /Transport is over budget by RM 20\.00/.test(a)));
  assert.ok(alerts.some(a => /Groceries is close to its budget/.test(a)));
  const cat = Object.fromEntries(app.$$('.bar-row').map(r => [r.querySelector('.lbl').textContent, r.querySelector('.fill').className]));
  assert.deepEqual([cat.Transport, cat.Groceries, cat['Food & Dining']], ['fill over', 'fill warn', 'fill '], 'category bars coloured by budget state');
  app.go('budgets');
  assert.ok(app.$$('.budget .fill.over').length === 1 && app.$$('.budget .fill.warn').length === 1);
  assert.equal(app.$$('.budget .pace-mark').length, 3, 'each budget bar shows the month\'s pace');
  assert.match(app.$('.summary-bar').textContent, /All budgets/);
  assert.equal(app.$('details.raw').open, false, 'categories without a limit are folded away');
  app.click('#mPrev');
  assert.equal(app.$$('.budget .pace-mark').length, 0, 'no pace line for a finished month');
});

test('setting and clearing a budget limit on the Budgets tab', () => {
  const app = emptyApp();
  app.go('budgets');
  app.set('[data-budget="Health"]', '150');
  assert.equal(app.stored().budgets.Health, 150);
  app.set('[data-budget="Health"]', '');
  assert.equal(app.stored().budgets.Health, undefined);
});

test('month comparison: paired bars for income, spending and savings rate, plus the top 3 increases in words', () => {
  const app = emptyApp();
  app.seed('transactions', [
    tx({ type: 'income', amount: 4000, date: '2026-09-25', category: 'Salary' }), tx({ type: 'savings', amount: 400, date: '2026-09-25', category: 'Savings' }),
    tx({ amount: 100, date: '2026-09-05', category: 'Food & Dining' }), tx({ amount: 50, date: '2026-09-05', category: 'Transport' }), tx({ amount: 80, date: '2026-09-05', category: 'Health' }),
    tx({ type: 'income', amount: 4000, date: '2026-10-21', category: 'Salary' }), tx({ type: 'savings', amount: 600, date: '2026-10-21', category: 'Savings' }),
    tx({ amount: 220, category: 'Food & Dining' }), tx({ amount: 90, category: 'Transport' }), tx({ amount: 30, category: 'Shopping' }), tx({ amount: 15, category: 'Groceries' })
  ]);
  const pairs = app.$$('.pair').map(p => [...p.querySelector('.prow-top').children].map(e => e.textContent.trim()).join(' '));
  assert.deepEqual(pairs, ['Income Same', 'Spending ▲ RM 125.00', 'Savings rate ▲ 5.0 pts']);
  assert.ok(app.$$('.pair')[1].querySelector('.neg'), 'more spending shown as bad');
  assert.ok(app.$$('.pair')[2].querySelector('.pos'), 'higher savings rate shown as good');
  const ins = app.$('.insights').textContent;
  assert.match(ins, /You spent RM 120\.00 more on Food & Dining than last month\./);
  assert.match(ins, /RM 40\.00 more on Transport/);
  assert.match(ins, /RM 30\.00 more on Shopping/);
  assert.doesNotMatch(ins, /Groceries/, 'only the top 3 increases');
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
  assert.equal(pctW(app.$('.goal .fill')), 44);
  assert.match(g, /About 28 months to go \(around Feb 2029\)/);
  assert.match(app.$('.goal .hint span').title, /RM 100\.00 a month/, 'the rate is in the hover detail');
});

test('goal with no recent transfers says so; reached goal says reached', () => {
  const app = emptyApp();
  app.seed('goals', [{ id: 'a', name: 'A', target: 1000, savedAmount: 0 }, { id: 'b', name: 'B', target: 1000, savedAmount: 1000 }]);
  app.go('budgets');
  const [a, b] = app.$$('.goal').map(e => e.textContent);
  assert.match(a, /Add savings to see when/); assert.match(b, /Goal reached/);
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

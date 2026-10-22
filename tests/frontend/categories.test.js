// Feature 4: auto spending categories, keywords and remembered corrections
const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyApp } = require('./harness');

const sug = (app, merchant, text = '') => JSON.parse(app.ev(`JSON.stringify(suggestCategory(${JSON.stringify(merchant)}, ${JSON.stringify(text)}))`)).cat;

test('spec examples: TNB -> Utilities, Grab -> Transport', () => {
  const app = emptyApp();
  assert.equal(sug(app, 'TNB'), 'Utilities');
  assert.equal(sug(app, 'Grab'), 'Transport');
});

test('longer keyword wins: GrabFood is Food & Dining, ShopeeFood is not Shopping', () => {
  const app = emptyApp();
  assert.equal(sug(app, 'GrabFood order 1234'), 'Food & Dining');
  assert.equal(sug(app, 'SHOPEEFOOD'), 'Food & Dining');
  assert.equal(sug(app, 'Shopee'), 'Shopping');
});

test('keywords match whole words only: "TM" does not match inside "ATM"', () => {
  const app = emptyApp();
  assert.equal(sug(app, 'ATM WITHDRAWAL'), '');
  assert.equal(sug(app, 'TM Unifi'), 'Phone & Internet');
});

test('receipt body is used when the payee is unknown, but only for keywords of 4+ letters', () => {
  const app = emptyApp();
  assert.equal(sug(app, '', 'Payment to NETFLIX.COM successful'), 'Subscriptions');
  assert.equal(sug(app, '', 'SAVE TIME AT TM POINT'), '', 'short words in long text are too likely to be accidental');
});

test('a remembered payee overrides keywords, unless its category was removed', () => {
  const app = emptyApp();
  app.ev(`S.settings.merchantCategoryMap['SHELL PUCHONG'] = 'Other'`);
  assert.equal(sug(app, 'Shell Puchong'), 'Other');
  app.ev(`S.settings.merchantCategoryMap['SHELL PUCHONG'] = 'Pets'`);
  assert.equal(sug(app, 'Shell Puchong'), 'Transport');
});

test('editing keywords in Settings changes suggestions', () => {
  const app = emptyApp();
  app.go('backup');
  app.set('[data-kw="Groceries"]', 'LOTUS, KEDAI PAK MAT');
  assert.deepEqual(app.stored().settings.keywords.Groceries, ['LOTUS', 'KEDAI PAK MAT']);
  assert.equal(sug(app, 'Kedai Pak Mat SS2'), 'Groceries');
  assert.equal(sug(app, 'Jaya Grocer'), '', 'removed keyword no longer matches');
});

test('changing a suggested category on save remembers it for that payee; keeping it stores nothing', () => {
  const app = emptyApp();
  app.go('transactions');
  // correction
  app.click('[data-act="manual"]');
  app.set('#tAmt', '80'); app.set('#tMerch', 'Shell Puchong');
  assert.equal(app.$('#tCat').value, 'Transport', 'suggested on payee change');
  app.set('#tCat', 'Other');
  app.click('#tSave');
  assert.equal(app.stored().settings.merchantCategoryMap['SHELL PUCHONG'], 'Other');
  // accepted suggestion
  app.click('[data-act="manual"]');
  app.set('#tAmt', '20'); app.set('#tMerch', 'Watsons');
  app.click('#tSave');
  assert.equal(app.stored().settings.merchantCategoryMap['WATSONS'], undefined);
  // next time the correction is suggested
  app.click('[data-act="manual"]');
  app.set('#tMerch', 'SHELL  puchong');
  assert.equal(app.$('#tCat').value, 'Other');
});

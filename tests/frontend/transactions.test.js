// Feature 3 (continued): upload pipeline, review form, manual entry, list/search/edit/delete
const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyApp, tx } = require('./harness');

function withFile(app, name, type, body = 'x') { app.win.__f = new app.win.File([body], name, { type }); }

test('manual entry: validation blocks incomplete entries, a valid one is saved and persisted', () => {
  const app = emptyApp();
  app.go('transactions');
  app.click('[data-act="manual"]');
  app.click('#tSave');
  assert.equal(app.S().transactions.length, 0);
  assert.match(app.toast(), /an amount above zero/);
  app.set('#tAmt', '45.90'); app.set('#tMerch', 'Lotus\'s Puchong');
  app.click('#tSave');
  const t = app.stored().transactions[0];
  assert.deepEqual([t.type, t.amount, t.date, t.category, t.merchant], ['expense', 45.9, '2026-10-22', 'Groceries', "Lotus's Puchong"]);
  assert.equal(app.$('#modalRoot').innerHTML, '', 'form closes');
});

test('upload: image is OCR-read and the review form is pre-filled, with missing fields highlighted', async () => {
  const app = emptyApp();
  app.go('transactions');
  app.ev(`ocrImage = async (src, onProg) => { onProg('Recognizing text', 0.5); return 'Payment Successful\\nMerchant: SHELL BANDAR PUCHONG\\nAmount: RM 78.50'; }`);
  withFile(app, 'tng.png', 'image/png');
  await app.ev('handleFile(window.__f)');
  assert.equal(app.$('#mTitle').textContent, 'Check receipt details');
  assert.equal(app.$('#tAmt').value, '78.5');
  assert.equal(app.$('#tMerch').value, 'SHELL BANDAR PUCHONG');
  assert.equal(app.$('#tCat').value, 'Transport');
  assert.equal(app.$('#tFile').value, 'tng.png');
  assert.deepEqual(app.$$('.in.missing').map(e => e.id).sort(), ['tDate', 'tRef'], 'date and reference not found');
  assert.match(app.$('.modal-b .note').textContent, /found 2 of 4 fields/);
  assert.ok(app.$('#upProg').hidden, 'progress indicator hidden when done');
  app.set('#tDate', '2026-10-18');
  assert.ok(!app.$('#tDate').classList.contains('missing'), 'highlight clears once filled');
  app.click('#tSave');
  assert.equal(app.stored().transactions[0].sourceFile, 'tng.png', 'file name kept, not the file');
});

test('upload: text-based PDF is read directly (no OCR) and lines are rebuilt in reading order', async () => {
  const app = emptyApp();
  app.go('transactions');
  let ocrCalled = false;
  app.win.__ocr = () => { ocrCalled = true; };
  app.ev(`loadScript = () => Promise.resolve(); ocrImage = async () => { window.__ocr(); return ''; };`);
  const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
  app.win.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [
    item('RM 88.00', 220, 701), item('Amount:', 50, 700), item('Biller Name: Unifi', 50, 680), item('Date: 02/10/2026', 50, 660), item('Reference No: 99887766', 50, 640)
  ] }) }) }) }) };
  withFile(app, 'unifi-bill.pdf', 'application/pdf', 'Amount RM 88.00 (padding so the text is long enough)');
  await app.ev('handleFile(window.__f)');
  assert.equal(ocrCalled, false);
  assert.match(app.$('.modal-b .note').textContent, /Read with PDF text: found 4 of 4/);
  assert.deepEqual([app.$('#tAmt').value, app.$('#tDate').value, app.$('#tMerch').value, app.$('#tRef').value, app.$('#tCat').value], ['88', '2026-10-02', 'Unifi', '99887766', 'Phone & Internet']);
});

test('upload: auto-detect opens the payslip form; forcing "Receipt" does not', async () => {
  const slip = 'PAYSLIP\\nPay Period: October 2026\\nGross Pay 5,000.00\\nEPF 550.00\\nSOCSO 24.75\\nEIS 9.90\\nPCB 0.00\\nNet Pay 4,415.35';
  const app = emptyApp();
  app.go('transactions');
  app.ev(`ocrImage = async () => '${slip}'`);
  withFile(app, 'slip.jpg', 'image/jpeg');
  await app.ev('handleFile(window.__f)');
  assert.equal(app.$('#mTitle').textContent, 'Check payslip details');
  assert.equal(app.$('#tType').value, 'income');
  assert.equal(app.$('#pPeriod').value, '2026-10');
  assert.match(app.$('#pCalc').textContent, /matches net pay/);
  app.click('[data-close]');
  app.click('[data-act="upkind"][data-k="receipt"]');
  await app.ev('handleFile(window.__f)');
  assert.equal(app.$('#mTitle').textContent, 'Check receipt details');
});

test('payslip form offers gross − deductions when net pay was not found', async () => {
  const app = emptyApp();
  app.go('transactions');
  app.ev(`ocrImage = async () => 'PAYSLIP\\nGross Pay 5,000.00\\nEPF 550.00\\nSOCSO 24.75\\nEIS 9.90\\nPCB 100.00'`);
  withFile(app, 'slip.png', 'image/png');
  await app.ev('handleFile(window.__f)');
  assert.ok(app.$('#tAmt').classList.contains('missing'));
  app.click('#useCalc');
  assert.equal(app.$('#tAmt').value, '4315.35');
});

test('OCR failure falls back to manual entry with an explanation', async () => {
  const app = emptyApp();
  app.go('transactions');
  app.ev(`loadScript = () => Promise.reject(new Error('Could not load tesseract.min.js'))`);
  withFile(app, 'photo.jpg', 'image/jpeg');
  await app.ev('handleFile(window.__f)');
  assert.match(app.$('.modal-b .note.bad').textContent, /Couldn't read photo\.jpg automatically.*Could not load/s);
  assert.deepEqual(app.$$('.in.missing').map(e => e.id).sort(), ['tAmt', 'tDate', 'tMerch', 'tRef']);
  app.set('#tAmt', '12'); app.set('#tDate', '2026-10-20'); app.set('#tCat', 'Food & Dining');
  app.click('#tSave');
  assert.equal(app.stored().transactions.length, 1, 'user can still save by hand');
  assert.equal(app.ev('busy'), false, 'uploader is ready for the next file');
});

test('unsupported file types are refused with a clear message', async () => {
  const app = emptyApp();
  app.go('transactions');
  withFile(app, 'notes.txt', 'text/plain');
  await app.ev('handleFile(window.__f)');
  assert.match(app.$('.modal-b .note.bad').textContent, /Unsupported file type\. Use PNG, JPG or PDF\./);
});

test('stalled OCR times out instead of hanging; active OCR is not cut off', async () => {
  const app = emptyApp();
  await assert.rejects(app.ev(`withStall(() => new Promise(() => {}), 40)`), /stopped responding/);
  const ok = await app.ev(`withStall(async kick => { for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 25)); kick(); } return 'done'; }, 40)`);
  assert.equal(ok, 'done');
});

test('saving a payslip prompts "set aside RM X to savings" and records the transfer to the chosen goal', async () => {
  const app = emptyApp();
  app.seed('goals', [{ id: 'g1', name: 'Emergency fund', target: 5000, savedAmount: 0 }]);
  app.go('transactions');
  app.ev(`openTxForm(null, {parsed: parsePayslip('Net Pay 4,000.00\\nGross Pay 4,500.00'), raw: 'x', method: 'OCR', sourceFile: 's.pdf', fromFile: true})`);
  app.set('#tDate', '2026-10-21');
  app.click('#tSave');
  await app.tick(300);
  assert.equal(app.$('#mTitle').textContent, 'Pay yourself first');
  assert.match(app.$('.modal-b').textContent, /Set aside RM 400\.00 to savings now\?/);
  app.click('#pyOk');
  const sav = app.stored().transactions.find(t => t.type === 'savings');
  assert.deepEqual([sav.amount, sav.goalId, sav.date], [400, 'g1', '2026-10-21']);
  assert.equal(app.ev(`monthTotals('2026-10').net`), 3600);
});

test('declining the savings prompt records nothing; expenses never trigger it', async () => {
  const app = emptyApp();
  app.go('transactions');
  app.click('[data-act="manual"]');
  app.set('#tType', 'income'); app.set('#tAmt', '3000'); app.click('#tSave');
  await app.tick(300);
  app.click('[data-close]');
  app.click('[data-act="manual"]');
  app.set('#tAmt', '30'); app.set('#tCat', 'Other'); app.click('#tSave');
  await app.tick(300);
  assert.equal(app.$('#modalRoot').innerHTML, '');
  assert.equal(app.stored().transactions.filter(t => t.type === 'savings').length, 0);
});

test('list filters: search, type, category and all-months', () => {
  const app = emptyApp();
  app.seed('transactions', [
    tx({ merchant: 'Netflix', category: 'Subscriptions', reference: 'NF-1' }),
    tx({ merchant: 'Lotus', category: 'Groceries' }),
    tx({ type: 'income', merchant: 'Employer', category: 'Salary', amount: 3000 }),
    tx({ merchant: 'Old Netflix', category: 'Subscriptions', date: '2026-07-01' })
  ]);
  app.go('transactions');
  const rows = () => app.$$('table.t tbody tr .cell-title').map(e => e.textContent);
  assert.equal(rows().length, 3, 'selected month only by default');
  app.ev(`ui.f.q = 'nf-1'; render()`);
  assert.deepEqual(rows(), ['Netflix'], 'search matches reference');
  app.ev(`ui.f.q = ''; render()`);
  app.set('#fT', 'income'); assert.deepEqual(rows(), ['Employer']);
  app.set('#fT', 'all'); app.set('#fC', 'Subscriptions'); app.set('#fM', 'all');
  assert.deepEqual(rows().sort(), ['Netflix', 'Old Netflix']);
});

test('edit a transaction and delete one linked to a bill (bill goes back to unpaid)', () => {
  const app = emptyApp();
  app.seed('bills', [{ id: 'b1', name: 'Unifi', category: 'Phone & Internet', amount: 129, dueDay: 10, frequency: 'monthly', startMonth: '2026-01' }]);
  app.seed('transactions', [tx({ id: 'p', amount: 129, billId: 'b1', category: 'Phone & Internet', merchant: 'Unifi' })]);
  app.seed('billPayments', [{ billId: 'b1', month: '2026-10', paidDate: '2026-10-10', actualAmount: 129, transactionId: 'p', createdTx: true }]);
  app.go('transactions');
  app.click('[data-act="edit-tx"][data-id="p"]');
  app.set('#tAmt', '139'); app.click('#tSave');
  assert.equal(app.stored().billPayments[0].actualAmount, 139, 'bill payment follows the edited amount');
  app.click('[data-act="del-tx"][data-id="p"]');
  assert.match(app.$('.modal-b').textContent, /also marks Unifi as unpaid/);
  app.click('#cOk');
  assert.equal(app.stored().transactions.length, 0);
  assert.equal(app.ev(`billStatus(S.bills[0], '2026-10').key`), 'overdue');
});

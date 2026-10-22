// Feature 3: reading receipts and payslips (text -> fields)
const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyApp } = require('./harness');

const app = emptyApp();
const call = (fn, text) => JSON.parse(app.ev(`JSON.stringify(${fn}(${JSON.stringify(text)}))`));

test('Maybank transfer receipt: all four fields', () => {
  const r = call('parseReceipt', 'Maybank2u\nTransfer Successful\nReference ID: 2810445566\nDate: 21 Oct 2026 08:42 PM\nRecipient Name: TENAGA NASIONAL BERHAD\nAmount: RM 142.35\nRecipient Reference: Bill Oct');
  assert.deepEqual([r.amount, r.date, r.merchant, r.reference], [142.35, '2026-10-21', 'TENAGA NASIONAL BERHAD', '2810445566']);
});

test('DuitNow receipt: payee on the line after "To", zero fee ignored', () => {
  const r = call('parseReceipt', 'DuitNow Transfer\nSuccessful\nRM 25.00\nTo\nGRABFOOD MALAYSIA\nTransaction Date 05/10/2026\nDuitNow Ref No. M2610051234567\nFee RM 0.00');
  assert.deepEqual([r.amount, r.date, r.merchant, r.reference], [25, '2026-10-05', 'GRABFOOD MALAYSIA', 'M2610051234567']);
});

test('Malay-language receipt (Jumlah, Tarikh, Penerima, Rujukan) and balance line skipped', () => {
  const r = call('parseReceipt', 'Pindahan Berjaya\nBaki Tersedia: RM 4,000.00\nTarikh: 3 Ogos 2026\nNama Penerima: Kedai Runcit Pak Mat\nJumlah: RM1,250.00\nNo. Rujukan: 88812345');
  assert.deepEqual([r.amount, r.date, r.merchant, r.reference], [1250, '2026-08-03', 'Kedai Runcit Pak Mat', '88812345']);
});

test('amount next to "Total" wins over an earlier available-balance figure', () => {
  const r = call('parseReceipt', 'Available Balance RM 9,999.00\nTotal Amount RM 59.90');
  assert.equal(r.amount, 59.9);
});

test('unreadable text leaves every field blank (so the form highlights them)', () => {
  const r = call('parseReceipt', 'Thank you for using our service');
  assert.deepEqual([r.amount, r.date, r.merchant, r.reference], [null, '', '', '']);
});

test('a reference with no digits (a free-text note) is not used as a reference number', () => {
  assert.equal(call('parseReceipt', 'Reference: Rent October\nAmount RM 10.00').reference, '');
});

test('date formats: ISO, day-first numeric, month names (English and Malay), invalid dates rejected', () => {
  const d = s => call('datesIn', s);
  assert.deepEqual(d('2026-10-05'), ['2026-10-05']);
  assert.deepEqual(d('05/10/26'), ['2026-10-05'], 'numeric dates are read day-first, as in Malaysia');
  assert.deepEqual(d('Oct 5, 2026'), ['2026-10-05']);
  assert.deepEqual(d('5th October 2026'), ['2026-10-05']);
  assert.deepEqual(d('12 Dis 2026'), ['2026-12-12']);
  assert.deepEqual(d('31/02/2026'), [], '31 February does not exist');
  assert.deepEqual(d('13/13/2026'), []);
});

test('English payslip: gross, net, employee deductions (employer EPF ignored), period, date, employer', () => {
  const p = call('parsePayslip', 'RIMBA ANALYTICS SDN BHD\nPAYSLIP\nPay Period: September 2026\nBasic Salary 6,500.00\nGross Pay 7,150.00\nEPF (Employer) 930.00\nEPF (Employee) 11% 787.00\nSOCSO 29.75\nEIS 11.90\nPCB 418.20\nNet Pay 5,903.15\nPayment Date: 25/09/2026');
  assert.equal(p.amount, 5903.15, 'net pay becomes the income amount');
  assert.deepEqual(p.payslip, { gross: 7150, epf: 787, socso: 29.75, eis: 11.9, pcb: 418.2, period: '2026-09' });
  assert.equal(p.date, '2026-09-25');
  assert.equal(p.merchant, 'RIMBA ANALYTICS SDN BHD');
  assert.equal(p.type, 'income');
});

test('Malay payslip (Slip Gaji: KWSP, PERKESO, SIP, Cukai Pendapatan, Gaji Bersih)', () => {
  const p = call('parsePayslip', 'SLIP GAJI\nSyarikat: Kilang Maju Sdn Bhd\nBulan: Ogos 2026\nGaji Kasar 4,200.00\nKWSP 462.00\nPERKESO 20.75\nSIP 8.20\nCukai Pendapatan 55.00\nGaji Bersih 3,654.05');
  assert.equal(p.amount, 3654.05);
  assert.deepEqual(p.payslip, { gross: 4200, epf: 462, socso: 20.75, eis: 8.2, pcb: 55, period: '2026-08' });
  assert.equal(p.merchant, 'Kilang Maju Sdn Bhd');
});

test('a zero deduction (PCB 0.00) is read as 0 and never takes the next line\'s value', () => {
  const p = call('parsePayslip', 'Gross Pay 3,000.00\nEPF 330.00\nPCB 0.00\nNet Pay 2,670.00\nEIS\nSOCSO 14.75');
  assert.equal(p.payslip.pcb, 0);
  assert.equal(p.amount, 2670);
  assert.equal(p.payslip.eis, null, 'a label with no value stays blank instead of borrowing SOCSO');
});

test('amount printed on the line under its label is still found', () => {
  assert.equal(call('parseReceipt', 'Amount\nRM 25.00\nTo GRAB').amount, 25);
});

test('payslip period given as a date range resolves to that month', () => {
  assert.equal(call('parsePayslip', 'Pay Period: 01/09/2026 - 30/09/2026\nNet Pay 100.00').payslip.period, '2026-09');
});

test('auto-detect tells payslips from receipts', () => {
  assert.equal(app.ev(`isPayslip('Net Pay 4,000.00')`), true);
  assert.equal(app.ev(`isPayslip('KWSP 400.00\\nPERKESO 20.00')`), true);
  assert.equal(app.ev(`isPayslip('DuitNow Transfer RM 25.00 to GRABFOOD')`), false);
});

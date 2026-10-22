# Aliran Cashflow: test report

**Result:** 112 tests, 112 passing (78 frontend, 34 backend, security and end-to-end). Testing found 5 bugs across three rounds; all are fixed, and the ones a test can catch have regression tests.

Run the tests with `npm test`. Frontend tests (`tests/frontend/`) load the real `src/app.html` in a simulated browser (jsdom) with "today" fixed at 22 Oct 2026. Backend tests (`tests/server/`) run the real server in-process with an in-memory database.

## Coverage by feature

| Feature (from the spec) | File | Tests | What is checked |
|---|---|---|---|
| 1. Dashboard | `cashflow.test.js` | 5 | Totals (income, bills, other spending, saved, net = income − all outflows), cards and statement text, red net card when negative, month selector |
| 2. Recurring bills | `bills.test.js` | 16 | Month maths (year boundary, leap years), due day 31 in short months, quarterly/yearly, status badges at each threshold, Due soon strip including last month and next month, add-bill validation, mark paid (variable amount), link an uploaded receipt without duplicating, undo payment, full overdue history, "already paid" option for new bills, payment date sync |
| 3. Receipt and payslip upload | `parsing.test.js`, `transactions.test.js` | 13 + 12 | Maybank, DuitNow and Malay-language receipts; date formats and invalid dates; English and Malay payslips; employer EPF ignored; zero deductions; image OCR path; text-PDF path (no OCR); auto-detect vs forced type; missing fields highlighted; OCR failure falls back to manual entry; stalled OCR times out; unsupported files refused; manual entry validation; search and filters; edit/delete |
| 4. Auto categories | `categories.test.js` | 7 | Spec examples, longest keyword wins, whole-word matching (TM not inside ATM), receipt-body fallback, remembered payees, editing keywords, corrections remembered only when changed |
| 5. Pay yourself first | `cashflow.test.js`, `transactions.test.js` | 3 | Percent and fixed rules, prompt after saving a payslip, transfer recorded to the chosen goal, declining records nothing, expenses never prompt |
| Goals | `cashflow.test.js` | 3 | Progress = starting balance + transfers, 3-month rate and months-to-goal estimate, "reached" and "no estimate" states, create/contribute/delete |
| 6. Budgets | `cashflow.test.js` | 2 | OK / amber at 80% / red at 100%, dashboard warnings, set and clear limits |
| 7. Trends | `cashflow.test.js` | 2 | Top 3 increased categories, insight sentences, savings-rate change, 6-month window, table fallback without the chart library |
| 8. Settings and backup | `storage-settings.test.js` | 14 | Data survives reload, blocked storage still works and warns, corrupt and partial saved data, JSON backup round trip, bad imports refused, damaged backup renders, CSV quoting, add/remove categories, clear sample data, clear all requires typing DELETE, theme, HTML injection through payee names |

## Bugs found and fixed

1. **A zero payslip deduction took the next line's value.** When a payslip showed `PCB 0.00`, the parser treated 0.00 as "not found", read the next line instead, and recorded PCB as RM 4,415.35 (the net pay). Now a labelled 0.00 is read as zero. The parser only uses the next line when it holds just a number, so one field can no longer borrow another field's value.
2. **A damaged backup crashed every tab.** Importing a backup with a blank record, a missing date or a text amount threw an error on every screen. Saved and imported data is now repaired on load: blank records are dropped, amounts become numbers, bad dates are cleared, and bill due days are kept between 1 and 31.

## Improvements made from the first report (round 2: 5 more tests, 75 in total, all passing)

The first report listed three behaviours worth changing. All three are now changed and tested in `bills.test.js`.

1. **Due soon shows every unpaid month.** It used to look back only 3 months, so a bill unpaid for longer dropped off the strip and the sidebar count. It now lists every unpaid month since the bill's first month, up to 2 years back. Bills with no first month (from old backups) still look back 3 months.
2. **New bills can be marked "already paid".** Adding a bill whose due date this month had already passed made it Overdue straight away. The add-bill form now shows a tick box, "I've already paid the October 2026 bill (due 10 Oct 2026)", only when the due date has passed. Ticking it marks that month paid as "before tracking began", without adding an expense the app never saw. Left unticked, the bill shows Overdue, so a bill you really forgot is still flagged.
3. **Editing a bill payment keeps the bill in step.** Changing the date of a payment transaction now updates the bill's paid date too. The payment still counts for the original month, since a late payment still pays that month's bill. The edit form now says which bill and month the payment covers.

## Not covered by these tests

- **The real OCR and PDF libraries.** Tests replace Tesseract.js and PDF.js with stand-ins, so they check the app's handling, not the libraries. Real OCR on a generated receipt image was checked by hand in the browser earlier and found all four fields.
- **Chart drawing and visual layout.** These were checked with screenshots, not automated tests.
- **Downloads inside the Claude viewer.** The viewer blocks them; the copy-text fallback is what the export tests check.

## Round 3: backend, security and end-to-end (34 tests)

| Area | File | Tests | What is checked |
|---|---|---|---|
| Accounts and sessions | `tests/server/auth.test.js` | 12 | Email and password rules (length, common passwords, repeated characters, email name), cookie flags (HttpOnly, SameSite=Strict, `__Host-` + Secure over HTTPS), registration modes, same answer for wrong password and unknown email, lockout after 5 failures and unlock after 15 minutes, rate limit on sign-in, passwords and session tokens stored only as hashes, server-side sign-out, 30-minute idle and 7-day absolute expiry, password change signs out other devices, account deletion removes everything |
| Security | `tests/server/security.test.js` | 12 | Page CSP (hash-only scripts, no framing, no plugins) including Windows line endings, API no-cache and deny-all CSP, HSTS in production, server refuses unsafe production config, CSRF blocked four ways, signed-out access refused, schema validation (types, formats, lengths, enums) with unknown fields dropped, `__proto__` payloads refused, size limits, encryption at rest with owner binding, user isolation, no internals in errors |
| Data sync | `tests/server/state.test.js` | 4 | Versioned save and load, stale saves refused with the latest data, the frontend's full sample data passes validation unchanged, health check |
| End to end | `tests/server/e2e.test.js` | 6 | Real page + real server: owner sign-up then sample data saved to the server and none left in browser storage, edits sync and survive a reload, sign-out clears the page and kills the session, wrong password message, two devices editing (older copy replaced, never overwritten), session timeout mid-edit keeps the unsaved change after signing in again |

### Bugs found in round 3

1. **The whole app was blocked on Windows checkouts.** The server hashed the inline script with Windows line endings, but browsers hash it with plain line endings, so the Content Security Policy refused to run the app. Found by running the real server in a browser, not by the unit tests, because both the test and the server hashed the same raw bytes. Fixed in the build (writes LF), the server (hashes as browsers do) and `.gitattributes`; covered by a new regression test.
2. **After deleting the account, the page offered "Sign in" instead of "Create your account".** It didn't re-check whether sign-up had reopened. Fixed for sign-out and account deletion.
3. **OCR's WebAssembly was blocked by the policy**, so it fell back to a slower loading path. Allowed `data:` for connections, which can't reach any outside host.

### Checked by hand in the browser (real server)

Owner sign-up, dashboard and chart loading under the strict policy (Chart.js passes its integrity check), automatic sync, real OCR of a receipt image under the policy, account deletion, and every security header on the page response.

// Loads the real app (src/app.html) into jsdom with "today" fixed (default 22 Oct 2026).
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app.html'), 'utf8');

/**
 * @param {object} opts
 * @param {object|string} [opts.stored] state to pre-load into localStorage (omit = first visit)
 * @param {boolean} [opts.blockStorage] make every localStorage access throw
 * @param {number[]} [opts.now] [year, monthIndex, day] to use as "today"
 * @param {Function} [opts.fetch] (window) => fetch implementation; gives the page a backend to talk to
 */
function makeApp(opts = {}) {
  const [y, m, d] = opts.now || [2026, 9, 22];
  const FIXED = new Date(y, m, d, 10, 0, 0).getTime();
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', e => errors.push(String(e)));
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + SRC + '</body></html>';
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      const RealDate = win.Date;
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(FIXED); }
        static now() { return FIXED; }
      }
      win.Date = FakeDate;
      win.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      win.scrollTo = () => {};
      if (opts.fetch) win.fetch = opts.fetch(win);
      if (!win.Blob.prototype.arrayBuffer) {
        win.Blob.prototype.arrayBuffer = function () {
          return new Promise(res => { const r = new win.FileReader(); r.onload = () => res(r.result); r.readAsArrayBuffer(this); });
        };
      }
      if (opts.blockStorage) {
        Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError: storage blocked'); } });
      } else if (opts.stored !== undefined) {
        win.localStorage.setItem('aliran.cashflow.v1', typeof opts.stored === 'string' ? opts.stored : JSON.stringify(opts.stored));
      }
    }
  });
  const win = dom.window;
  const ev = code => win.eval(code);
  const $ = s => win.document.querySelector(s);
  const $$ = s => Array.from(win.document.querySelectorAll(s));
  const click = s => {
    const el = typeof s === 'string' ? $(s) : s;
    if (!el) throw new Error('No element ' + s);
    el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };
  const set = (s, v) => {
    const el = $(s);
    if (!el) throw new Error('No element ' + s);
    el.value = v;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const S = () => ev('S');
  const stored = () => JSON.parse(win.localStorage.getItem('aliran.cashflow.v1'));
  const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
  const toast = () => ($('#toast') && !$('#toast').hidden ? $('#toast').textContent : '');
  const go = tab => click(`#nav button[data-tab="${tab}"]`);
  /** add records directly, then persist and re-render */
  const seed = (key, items) => { ev(`S.${key}.push(...${JSON.stringify(items)}); save(); render();`); };
  return { dom, win, ev, $, $$, click, set, S, stored, errors, tick, toast, go, seed };
}

/** An app with no data at all, for exact arithmetic. */
function emptyApp(opts) {
  const a = makeApp(opts);
  a.ev('S = defaultState(); save(); render();');
  return a;
}

let n = 0;
const tx = o => Object.assign({ id: 't' + (++n), type: 'expense', amount: 10, date: '2026-10-10', category: 'Other', merchant: '', reference: '', notes: '', sourceFile: '', createdAt: '2026-10-01T00:00:00Z' }, o);

module.exports = { makeApp, emptyApp, tx };

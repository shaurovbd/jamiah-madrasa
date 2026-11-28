'use strict';
/**
 * /admin/ledger এর পরীক্ষা — API ও ভাউচার এন্ট্রি ফর্ম (jsdom-এ আসল স্ক্রিপ্ট চালিয়ে)।
 * চালানোর আগে তাজা সিডেড ডেটাবেস থাকতে হবে।
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const mysql = require('mysql2/promise');
const express = require('express');
const ledgerRouter = require('./routes/ledger');
const views = require('./views/ledger-views');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  ✅', m); };
const bad = (m) => { fail++; console.log('  ❌', m); };
const eq  = (label, got, want) =>
  (String(got) === String(want) ? ok(label) : bad(label + ' — পেলাম ' + got + ', চাই ' + want));

const pool = mysql.createPool({
  host: '127.0.0.1', user: 'jamiah', password: 'test_pw_local',
  database: 'jamiah', decimalNumbers: true, connectionLimit: 5,
});

let role = 'principal';
const app = express();
app.use('/admin/ledger', ledgerRouter({
  pool, getActor: () => ({ userId: 1, role, ip: '127.0.0.1' }),
}));

async function main() {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = async (p) => (await fetch(base + p)).json();
  const post = async (p, body) => {
    const r = await fetch(base + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return { status: r.status, body: await r.json() };
  };

  // ================================================================
  console.log('\n── ক. API ──');
  const meta = await get('/admin/ledger/api/meta');
  meta.ok ? ok('meta লোড হয়েছে') : bad('meta ব্যর্থ');
  ok('পোস্টযোগ্য হিসাব: ' + meta.accounts.length + 'টি, ফান্ড: ' + meta.funds.length + 'টি');

  // --- প্রারম্ভিক জমা: টেস্ট যেন আগের ডেটার ওপর নির্ভর না করে ---
  const accOf = (c) => meta.accounts.find((a) => a.code === c).id;
  const fundOf = (c) => meta.funds.find((f) => f.code === c).id;
  const DATE = new Date().toISOString().slice(0, 10);
  for (const [amt, incomeAcc, fund, label] of [
    [60000, '4201', 'ZAK', 'যাকাত'], [40000, '4204', 'GEN', 'সাধারণ অনুদান'],
  ]) {
    const r = await post('/admin/ledger/api/vouchers', {
      voucher_type: 'RV', voucher_date: DATE, payment_method: 'cash',
      narration_bn: 'প্রারম্ভিক ' + label,
      lines: [
        { account_id: accOf('1101'), fund_id: fundOf(fund), debit: amt, credit: 0 },
        { account_id: accOf(incomeAcc), fund_id: fundOf(fund), debit: 0, credit: amt },
      ],
    });
    r.status === 201 && r.body.status === 'posted'
      ? ok('প্রারম্ভিক জমা ' + label + ' Tk ' + amt.toLocaleString())
      : bad('প্রারম্ভিক জমা ব্যর্থ: ' + JSON.stringify(r.body));
  }
  meta.accounts.every((a) => a.account_class) ? ok('প্রতিটি হিসাবে শ্রেণি আছে') : bad('শ্রেণি অনুপস্থিত');

  const zak = meta.funds.find((f) => f.code === 'ZAK');
  const rules = meta.fundRules[zak.id];
  rules && rules.allow.length === 6 && rules.block.length === 18
    ? ok('যাকাতের বিধিনিষেধ API-তে এসেছে (allow 6, block 18)')
    : bad('যাকাতের বিধি ভুল: ' + JSON.stringify(rules && {
        allow: rules.allow.length, block: rules.block.length }));

  const waq = meta.funds.find((f) => f.code === 'WAQ');
  Number(waq.corpus_protected) === 1 ? ok('ওয়াকফে corpus_protected চিহ্ন আছে') : bad('corpus চিহ্ন নেই');

  // পেজগুলো রেন্ডার হয়
  for (const [p, needle] of [
    ['/admin/ledger', 'ভাউচার ও খতিয়ান'],
    ['/admin/ledger/new?type=PV', 'lineTpl'],
    ['/admin/ledger/day-book', 'dayBookOut'],
  ]) {
    const html = await (await fetch(base + p)).text();
    html.includes(needle) ? ok('পেজ রেন্ডার: ' + p) : bad('পেজ ভাঙা: ' + p);
  }

  // ================================================================
  console.log('\n── খ. ভাউচার এন্ট্রি ফর্ম (jsdom) ──');
  const ui = await bootForm(meta, 'PV');

  // -- দুই ফান্ডে ভাগ করা এক ব্যয় --
  ui.set('narration', 'নভেম্বরের চাল ও ডাল ক্রয়');
  ui.select('cashAccount', ui.accId('1101'));
  ui.fillLine(0, { acc: '5201', fund: 'ZAK', amount: '45000' });
  ui.fillLine(1, { acc: '5201', fund: 'GEN', amount: '15000' });

  const built = ui.api.buildLines();
  eq('ম্যানুয়াল লাইন ২টি', built.manual.length, 2);
  eq('নগদের লাইন ফান্ড অনুযায়ী ২টিতে ভাগ হয়েছে', built.auto.length, 2);
  eq('মোট লাইন ৪টি', built.all.length, 4);

  const autoZak = built.auto.find((l) => String(l.fund_id) === String(zak.id));
  const gen = meta.funds.find((f) => f.code === 'GEN');
  const autoGen = built.auto.find((l) => String(l.fund_id) === String(gen.id));
  eq('যাকাত ফান্ডের নগদ লাইন ক্রেডিট 45000', autoZak && autoZak.credit, 4500000);
  eq('সাধারণ ফান্ডের নগদ লাইন ক্রেডিট 15000', autoGen && autoGen.credit, 1500000);
  built.auto.every((l) => String(l.account_id) === String(ui.accId('1101')))
    ? ok('দুটো নগদ লাইনই প্রধান ক্যাশে') : bad('নগদ লাইনের হিসাব ভুল');

  const tD = built.all.reduce((s, l) => s + l.debit, 0);
  const tC = built.all.reduce((s, l) => s + l.credit, 0);
  tD === tC && tD === 6000000 ? ok('ডেবিট = ক্রেডিট = 60,000') : bad('অসমান: ' + tD + '/' + tC);
  ui.text('totalsBox').includes('✓ সমান') ? ok('পর্দায় "সমান" দেখাচ্ছে') : bad('সমান দেখাচ্ছে না');

  // -- ফান্ড জের প্রিভিউ --
  const fundBoxText = ui.text('fundBox');
  fundBoxText.includes('যাকাত ফান্ড') && fundBoxText.includes('→')
    ? ok('ফান্ড জের প্রিভিউ দেখাচ্ছে (আগে → পরে)') : bad('ফান্ড প্রিভিউ নেই');

  // -- নিষিদ্ধ খাত: নরম বাধা + override বাক্স --
  const ui2 = await bootForm(meta, 'PV');
  ui2.set('narration', 'বিদ্যুৎ বিল');
  ui2.select('cashAccount', ui2.accId('1101'));
  ui2.fillLine(0, { acc: '5301', fund: 'ZAK', amount: '1000' });
  const warn = ui2.row(0).querySelector('.v-line-warn');
  !warn.hidden && warn.textContent.includes('ব্যয় করা যাবে না')
    ? ok('যাকাত → বিদ্যুৎ বিল: লাইনেই সতর্কতা') : bad('সতর্কতা দেখায়নি');
  !ui2.$('overrideBox').hidden
    ? ok('মুহতামিমকে override বাক্স দেখানো হয়েছে') : bad('override বাক্স আসেনি');
  !ui2.$('saveBtn').disabled
    ? ok('নরম বাধা — সংরক্ষণ বোতাম সক্রিয় (কারণ দিয়ে এগোনো যায়)') : bad('বোতাম অকারণে বন্ধ');
  // সার্ভার-পাশে শেষ কথা: নিষিদ্ধ খাত override ছাড়া আটকাবেই (অংশ গ-তে যাচাই)

  // -- হিসাবরক্ষকের কাছে override বাক্স আসবে না --
  role = 'accountant';
  const metaAcc = await get('/admin/ledger/api/meta');
  const ui3 = await bootForm(metaAcc, 'PV');
  ui3.select('cashAccount', ui3.accId('1101'));
  ui3.fillLine(0, { acc: '5301', fund: 'ZAK', amount: '1000' });
  ui3.$('overrideBox').hidden
    ? ok('হিসাবরক্ষক override বাক্স দেখেন না') : bad('হিসাবরক্ষক override দেখছেন');
  role = 'principal';

  // -- কঠিন বাধা: ওয়াকফ কর্পাস --
  const ui4 = await bootForm(meta, 'PV');
  ui4.select('cashAccount', ui4.accId('1111'));
  ui4.fillLine(0, { acc: '5201', fund: 'WAQ', amount: '5000' });
  const w4 = ui4.row(0).querySelector('.v-line-warn');
  !w4.hidden && w4.textContent.includes('কর্পাস') ? ok('ওয়াকফ কর্পাসে সতর্কতা') : bad('কর্পাস সতর্কতা নেই');
  ui4.$('saveBtn').disabled ? ok('কঠিন বাধা — সংরক্ষণ বোতাম বন্ধ') : bad('কর্পাসেও বোতাম খোলা');

  // -- ফান্ডে ঘাটতি --
  const ui5 = await bootForm(meta, 'PV');
  ui5.select('cashAccount', ui5.accId('1101'));
  ui5.fillLine(0, { acc: '5201', fund: 'ZAK', amount: '999999' });
  ui5.text('fundBox').includes('⚠') && !ui5.$('saveBtn').disabled
    ? ok('ফান্ড ঘাটতিতে ⚠ সতর্কতা, কিন্তু বোতাম খোলা (জের বাসি হতে পারে — সার্ভার সিদ্ধান্ত নেবে)')
    : bad('ঘাটতির ব্যবহার ভুল: warn=' + ui5.text('fundBox').includes('⚠') +
          ' disabled=' + ui5.$('saveBtn').disabled);
  ui5.text('fundBox').includes('সার্ভার আবার যাচাই করবে')
    ? ok('জের বাসি হওয়ার কথা ব্যবহারকারীকে জানানো হয়েছে') : bad('স্ন্যাপশট নোট নেই');

  // -- অনুমোদন স্তরের হিসাব --
  eq('Tk 1,500 → হিসাবরক্ষক', ui.api.requiredApprover(150000, []), 'accountant');
  eq('Tk 15,000 → প্রধান হিসাবরক্ষক', ui.api.requiredApprover(1500000, []), 'chief_accountant');
  eq('Tk 1,50,000 → কমিটি', ui.api.requiredApprover(15000000, []), 'committee');
  eq('Tk 100 + ওয়াকফ → কমিটি', ui.api.requiredApprover(10000, [waq]), 'committee');
  ui.text('approverNote').length > 0 ? ok('অনুমোদন স্তর পর্দায় জানানো হচ্ছে') : bad('স্তর জানায়নি');

  // -- জার্নাল মোড --
  const ui6 = await bootForm(meta, 'JV');
  eq('JV-তে মোড journal', ui6.api.getMode(), 'journal');
  ui6.$('cashAccountField').hidden ? ok('JV-তে নগদ হিসাব ফিল্ড লুকানো') : bad('JV-তে নগদ ফিল্ড দেখাচ্ছে');
  ui6.fillLine(0, { acc: '1201', fund: 'GEN', debit: '5000' });
  ui6.fillLine(1, { acc: '4102', fund: 'GEN', credit: '5000' });
  const b6 = ui6.api.buildLines();
  eq('JV-তে অটো লাইন নেই', b6.auto.length, 0);
  eq('JV-তে ২টি লাইন', b6.all.length, 2);

  // -- জমা ভাউচার: দিক উল্টো --
  const ui7 = await bootForm(meta, 'RV');
  ui7.select('cashAccount', ui7.accId('1121'));
  ui7.fillLine(0, { acc: '4102', fund: 'GEN', amount: '8000' });
  const b7 = ui7.api.buildLines();
  b7.manual[0].credit === 800000 && b7.auto[0].debit === 800000
    ? ok('RV-তে আয় ক্রেডিট, নগদ ডেবিট') : bad('RV-তে দিক ভুল');

  // ================================================================
  console.log('\n── গ. ফর্ম থেকে তৈরি পেলোড সার্ভারে পাঠানো (end-to-end) ──');
  const payload = {
    voucher_type: 'PV', voucher_date: new Date().toISOString().slice(0, 10),
    payment_method: 'cash', narration_bn: 'নভেম্বরের চাল ও ডাল — দুই ফান্ডে ভাগ',
    source_module: 'manual',
    lines: built.all.map((l) => ({
      account_id: l.account_id, fund_id: l.fund_id,
      cost_center_id: l.cost_center_id,
      debit: l.debit / 100, credit: l.credit / 100,
    })),
  };
  const created = await post('/admin/ledger/api/vouchers', payload);
  created.status === 201 && created.body.ok
    ? ok('ভাউচার তৈরি: ' + created.body.voucher_no + ' (' + created.body.status + ')')
    : bad('তৈরি হয়নি: ' + JSON.stringify(created.body));

  if (created.body.id) {
    const [dbLines] = await pool.query(
      `SELECT a.code, f.code fund, vl.debit, vl.credit
         FROM voucher_lines vl JOIN accounts a ON a.id=vl.account_id
         JOIN funds f ON f.id=vl.fund_id WHERE vl.voucher_id=? ORDER BY vl.line_no`,
      [created.body.id]);
    eq('ডেটাবেসে ৪টি লাইন', dbLines.length, 4);
    const cashLines = dbLines.filter((l) => l.code === '1101');
    eq('নগদের লাইন ২টি (ফান্ড অনুযায়ী)', cashLines.length, 2);
    const zakCash = cashLines.find((l) => l.fund === 'ZAK');
    eq('যাকাতের নগদ লাইন 45000 ক্রেডিট', Number(zakCash.credit), 45000);

    // ফান্ড-ওয়ারি নগদ বিভাজন: যাকাতে 60,000 ঢুকেছে, 45,000 বেরিয়েছে
    const [[zc]] = await pool.query(
      `SELECT balance FROM v_fund_cash_split WHERE fund_code='ZAK' AND account_code='1101'`);
    eq('যাকাতের নগদ বিভাজন 15,000', Number(zc.balance), 15000);
    const [[zf]] = await pool.query(
      `SELECT available_balance b FROM v_fund_available WHERE code='ZAK'`);
    eq('যাকাত ফান্ডের জের 15,000', Number(zf.b), 15000);
    const [[gf]] = await pool.query(
      `SELECT available_balance b FROM v_fund_available WHERE code='GEN'`);
    eq('সাধারণ ফান্ডের জের 25,000', Number(gf.b), 25000);
  }

  // নিষিদ্ধ খাত সার্ভারে আটকায়
  const blocked = await post('/admin/ledger/api/vouchers', {
    voucher_type: 'PV', voucher_date: new Date().toISOString().slice(0, 10),
    payment_method: 'cash', narration_bn: 'যাকাত দিয়ে বিদ্যুৎ বিল',
    lines: [
      { account_id: ui.accId('5301'), fund_id: zak.id, debit: 500, credit: 0 },
      { account_id: ui.accId('1101'), fund_id: zak.id, debit: 0, credit: 500 },
    ],
  });
  blocked.status === 422 && blocked.body.errors[0].includes('ব্যয় করা যাবে না')
    ? ok('সার্ভার নিষিদ্ধ খাত আটকেছে (৪২২): ' + blocked.body.errors[0])
    : bad('সার্ভার আটকায়নি: ' + JSON.stringify(blocked.body));

  // ত্রুটির আকার ফ্রন্টএন্ডের প্রত্যাশা মতো
  Array.isArray(blocked.body.errors) && blocked.body.ok === false
    ? ok('ত্রুটির আকার { ok:false, errors:[...] }') : bad('ত্রুটির আকার ভুল');

  console.log('\n' + '─'.repeat(64) + '\nফলাফল:  ✅ ' + pass + ' পাস   ❌ ' + fail + ' ফেল\n');
  server.close();
  await pool.end();
  process.exit(fail ? 1 : 0);
}

// =====================================================================
// jsdom-এ ফর্ম চালু করা
// =====================================================================
async function bootForm(meta, type) {
  const html = views.page({ title: 't', body: views.voucherForm({ type }) });
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;

  w.Element.prototype.scrollIntoView = function () {};
  w.alert = () => {};
  w.fetch = (url) => Promise.resolve({
    json: () => Promise.resolve(url.indexOf('/meta') >= 0 ? meta : { ok: true }),
  });

  const code = fs.readFileSync(path.join(__dirname, 'public/js/voucher-entry.js'), 'utf8');
  w.eval(code);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 30));   // meta promise সমাধানের সুযোগ

  const $ = (id) => w.document.getElementById(id);
  const api = w.__voucherEntry;
  const rows = () => Array.from(w.document.querySelectorAll('#lineBody tr.v-line'));
  const fire = (el, ev) => el.dispatchEvent(new w.Event(ev, { bubbles: true }));

  const accId = (code) => {
    const a = meta.accounts.find((x) => x.code === code);
    if (!a) throw new Error('হিসাব নেই: ' + code);
    return a.id;
  };
  const fundId = (code) => meta.funds.find((f) => f.code === code).id;

  return {
    dom, w, api, $, accId,
    row: (i) => rows()[i],
    text: (id) => $(id).textContent,
    set: (id, v) => { $(id).value = v; fire($(id), 'input'); },
    select: (id, v) => { $(id).value = String(v); fire($(id), 'change'); },
    fillLine(i, { acc, fund, amount, debit, credit }) {
      while (rows().length <= i) api.addLine();
      const tr = rows()[i];
      tr.querySelector('.v-acc-id').value = String(accId(acc));
      tr.querySelector('.v-acc-input').value = acc;
      tr.querySelector('.v-fund').value = String(fundId(fund));
      fire(tr.querySelector('.v-fund'), 'change');
      if (amount !== undefined) {
        tr.querySelector('.v-amount').value = amount;
        fire(tr.querySelector('.v-amount'), 'input');
      }
      if (debit !== undefined) {
        tr.querySelector('.v-debit').value = debit;
        fire(tr.querySelector('.v-debit'), 'input');
      }
      if (credit !== undefined) {
        tr.querySelector('.v-credit').value = credit;
        fire(tr.querySelector('.v-credit'), 'input');
      }
      api.recompute();
      return tr;
    },
  };
}

main().catch((e) => { console.error('\n💥', e); process.exit(1); });

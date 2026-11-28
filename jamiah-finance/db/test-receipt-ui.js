'use strict';
/** রশিদের রাউট, প্রিন্ট টেমপ্লেট ও পাবলিক যাচাই পেজের পরীক্ষা */
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const receipts = require('./routes/receipts');
const ledger = require('./routes/ledger');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  ✅', m); };
const bad = (m) => { fail++; console.log('  ❌', m); };
const has = (label, html, needle) =>
  (html.indexOf(needle) >= 0 ? ok(label) : bad(label + ' — পাওয়া যায়নি: ' + needle));
const hasNot = (label, html, needle) =>
  (html.indexOf(needle) < 0 ? ok(label) : bad(label + ' — থাকা উচিত ছিল না: ' + needle));

async function main() {
  const pool = mysql.createPool({
    host: '127.0.0.1', user: 'jamiah', password: 'test_pw_local',
    database: 'jamiah', decimalNumbers: true, connectionLimit: 5,
  });

  let role = 'principal';
  const actor = () => ({ userId: 1, role, ip: '127.0.0.1' });

  // অ্যাডমিন রাউটারে কড়া auth বসাই — পাবলিক যাচাই তাতেও খোলা থাকবে কি না দেখতে
  let authCalls = 0;
  const requireAuth = (req, res, next) => { authCalls++; next(); };

  const app = express();
  app.use('/css', express.static(path.join(__dirname, 'public/css')));
  app.use('/js', express.static(path.join(__dirname, 'public/js')));
  app.get('/js/bangla-number.js', (req, res) =>
    res.type('application/javascript').sendFile(path.join(__dirname, 'lib/bangla-number.js')));
  app.use('/admin/receipts', receipts.admin({ pool, requireAuth, getActor: actor }));
  app.use('/admin/ledger', ledger({ pool, getActor: actor }));
  app.use('/verify', receipts.publicVerify({ pool }));

  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const text = async (p) => {
    const r = await fetch(base + p, { redirect: 'manual' });
    return { status: r.status, html: await r.text(), loc: r.headers.get('location') };
  };
  const post = async (p, body) => {
    const r = await fetch(base + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return { status: r.status, body: await r.json() };
  };
  const json = async (p) => (await fetch(base + p)).json();

  const today = new Date().toISOString().slice(0, 10);

  // ================================================================
  console.log('\n── ক. পেজ রেন্ডার ──');
  for (const [p, needle, label] of [
    ['/admin/receipts', 'আজকের সংগ্রহ', 'রশিদ তালিকা'],
    ['/admin/receipts/new?type=ZAK', 'receipt-entry.js', 'রশিদ কাটার ফর্ম'],
    ['/admin/receipts/books', 'bookBody', 'রশিদ বই রেজিস্টার'],
  ]) {
    const r = await text(p);
    r.status === 200 ? has(label, r.html, needle) : bad(label + ' — HTTP ' + r.status);
  }
  const form = await text('/admin/receipts/new?type=ZAK');
  has('ফর্মে সংখ্যা-লাইব্রেরি লোড হচ্ছে', form.html, '/js/bangla-number.js');
  has('ভুল ধরনেও ফর্ম খোলে (ডিফল্ট)', (await text('/admin/receipts/new?type=XXX')).html, 'receipt-entry.js');
  const lib = await text('/js/bangla-number.js');
  lib.status === 200 && lib.html.indexOf('BanglaNumber') >= 0
    ? ok('একই লাইব্রেরি ফাইল ব্রাউজারেও পরিবেশিত') : bad('লাইব্রেরি পরিবেশিত হয়নি');

  const meta = await json('/admin/receipts/api/meta');
  meta.ok && meta.types.length === 10
    ? ok('meta-তে ১০টি রশিদের ধরন') : bad('ধরন: ' + (meta.types || []).length);
  meta.cashAccounts.every((a) => a.balance !== undefined)
    ? ok('নগদ হিসাবের সাথে চলতি জের এসেছে') : bad('জের নেই');

  // ================================================================
  console.log('\n── খ. রশিদ কাটা ও প্রিন্ট ──');
  const issued = await post('/admin/receipts/api/receipts', {
    receipt_type: 'ZAK', receipt_date: today, amount: 125000.5,
    payer_name: 'হাজী মোঃ ইব্রাহিম', payer_mobile: '01811223344',
    cash_account_id: meta.cashAccounts.find((a) => a.code === '1101').id,
    payment_method: 'cash', purpose_bn: '১৪৪৭ হিজরির যাকাত',
  });
  issued.status === 201 && issued.body.ok
    ? ok('রশিদ কাটা হলো: ' + issued.body.receipt_no + ' · ' + issued.body.amount_in_words)
    : bad('রশিদ কাটা যায়নি: ' + JSON.stringify(issued.body));
  const rid = issued.body.id;
  const token = issued.body.verify_token;

  const a4 = await text('/admin/receipts/r/' + rid + '?size=a4');
  has('A4 প্রিন্ট পেজ', a4.html, 'rcpt-a4');
  has('রশিদ নম্বর ছাপা হয়েছে', a4.html, issued.body.receipt_no);
  has('টাকা কথায় ছাপা হয়েছে', a4.html, 'এক লাখ পঁচিশ হাজার টাকা ও পঞ্চাশ পয়সা');
  has('QR কোড SVG এসেছে', a4.html, '<svg');
  has('যাচাই লিংক ছাপা হয়েছে', a4.html, '/verify/' + token);
  has('বাংলা অঙ্কে পরিমাণ', a4.html, '১,২৫,০০০.৫০'.replace('১,২৫,০০০.৫০', '১২৫,০০০.৫০'));
  has('দাতার নাম', a4.html, 'হাজী মোঃ ইব্রাহিম');
  has('স্বাক্ষরের ঘর', a4.html, 'গ্রহণকারীর স্বাক্ষর');
  hasNot('প্রথম কপিতে জলছাপ নেই', a4.html, 'নকল কপি');

  const a4again = await text('/admin/receipts/r/' + rid + '?size=a4');
  has('দ্বিতীয় প্রিন্টে "নকল কপি" জলছাপ', a4again.html, 'নকল কপি');

  const thermal = await text('/admin/receipts/r/' + rid + '?size=thermal');
  has('থার্মাল লেআউট', thermal.html, 'rcpt-thermal');
  const half = await text('/admin/receipts/r/' + rid + '?size=half');
  has('হাফ-পেজ লেআউট', half.html, 'rcpt-half');

  const vlink = await text('/admin/receipts/r/' + rid + '/voucher');
  vlink.status === 302 && /\/admin\/ledger\/v\/\d+/.test(vlink.loc || '')
    ? ok('রশিদ থেকে ভাউচারে যাওয়া যায় (' + vlink.loc + ')') : bad('ভাউচার লিংক ভুল: ' + vlink.status);

  const miss = await text('/admin/receipts/r/999999');
  miss.status === 404 ? ok('অস্তিত্বহীন রশিদে ৪০৪') : bad('HTTP ' + miss.status);

  // ================================================================
  console.log('\n── গ. পাবলিক যাচাই পেজ ──');
  const authBefore = authCalls;
  const vok = await text('/verify/' + token);
  has('যাচাই পেজ: রশিদটি সঠিক', vok.html, 'রশিদটি সঠিক');
  has('যাচাইয়ে রশিদ নম্বর', vok.html, issued.body.receipt_no);
  has('যাচাইয়ে টাকা কথায়', vok.html, 'এক লাখ পঁচিশ হাজার টাকা');
  hasNot('যাচাই পেজে মোবাইল নম্বর নেই', vok.html, '01811223344');
  authCalls === authBefore
    ? ok('যাচাই পেজে auth মিডলওয়্যার চলেনি — সত্যিই পাবলিক') : bad('যাচাইয়ে auth চলেছে');

  const vbad = await text('/verify/ffffffffffffffffffffffffffffffff');
  vbad.status === 404 && vbad.html.indexOf('পাওয়া যায়নি') >= 0
    ? ok('ভুল টোকেনে ৪০৪ ও বার্তা') : bad('ভুল টোকেন: HTTP ' + vbad.status);
  const vshort = await text('/verify/abc');
  vshort.status === 404 ? ok('অবৈধ আকারের টোকেনেও ৪০৪') : bad('HTTP ' + vshort.status);
  const vroot = await text('/verify');
  vroot.html.indexOf('পাওয়া যায়নি') >= 0 ? ok('/verify খালি হলে সহায়ক বার্তা') : bad('/verify ভাঙা');

  // ================================================================
  console.log('\n── ঘ. বাতিল ──');
  role = 'accountant';
  const vfail = await post('/admin/receipts/api/receipts/' + rid + '/void', { reason: 'ভুল' });
  vfail.status === 422 && vfail.body.errors[0].indexOf('প্রধান হিসাবরক্ষক') >= 0
    ? ok('হিসাবরক্ষকের বাতিল আটকেছে (৪২২)') : bad(JSON.stringify(vfail.body));
  role = 'principal';

  const vdone = await post('/admin/receipts/api/receipts/' + rid + '/void',
    { reason: 'দাতা অন্য প্রতিষ্ঠানে দিতে চেয়েছেন' });
  vdone.status === 200 && vdone.body.ok
    ? ok('বাতিল হলো, রিভার্সাল ' + vdone.body.reversal_voucher_no) : bad(JSON.stringify(vdone.body));

  const vafter = await text('/verify/' + token);
  has('যাচাই পেজে এখন "বাতিল"', vafter.html, 'এই রশিদ বাতিল করা হয়েছে');
  has('যাচাইয়ে বাতিলের কারণ', vafter.html, 'দাতা অন্য প্রতিষ্ঠানে');
  const pvoid = await text('/admin/receipts/r/' + rid);
  has('প্রিন্টে "বাতিল" জলছাপ', pvoid.html, 'rcpt-cancel');
  hasNot('বাতিল রশিদে আর বাতিলের বোতাম নেই', pvoid.html, 'id="voidBtn"');

  // ================================================================
  console.log('\n── ঙ. দৈনিক সারসংক্ষেপ ও বই ──');
  await post('/admin/receipts/api/receipts', {
    receipt_type: 'DON', receipt_date: today, amount: 7500,
    payer_name: 'জনাব করিম',
    cash_account_id: meta.cashAccounts.find((a) => a.code === '1121').id,
    payment_method: 'bkash', instrument_no: 'TrxID AB12CD',
  });
  const daily = await json('/admin/receipts/api/daily?date=' + today);
  daily.ok && daily.byType.length > 0
    ? ok('দৈনিক সারসংক্ষেপ: ' + daily.count + 'টি রশিদ, মোট ' + daily.total) : bad('সারসংক্ষেপ ব্যর্থ');
  daily.byMethod.some((m) => m.payment_method === 'bkash')
    ? ok('মাধ্যম অনুযায়ী ভাগ এসেছে (ক্যাশ মিলানোর জন্য)') : bad('মাধ্যম ভাগ নেই');
  const voidedNotCounted = !daily.byType.some((t) => Number(t.total_amount) >= 125000);
  voidedNotCounted ? ok('বাতিল রশিদ দৈনিক হিসাবে গোনা হয়নি') : bad('বাতিল রশিদ গোনা হয়েছে');

  const books = await json('/admin/receipts/api/books');
  books.ok && books.rows.length === 3 ? ok('৩টি রশিদ বই নিবন্ধিত') : bad('বই: ' + (books.rows || []).length);
  const bk = books.rows.find((b) => b.book_no === 'BK-002');
  const asg = await post('/admin/receipts/api/books/' + bk.id + '/assign',
    { staff_name: 'মাঠ কলেক্টর — রফিক', staff_id: 9 });
  asg.body.ok ? ok('বই BK-002 কলেক্টরকে দেওয়া হলো') : bad(JSON.stringify(asg.body));
  const asg2 = await post('/admin/receipts/api/books/' + bk.id + '/assign', { staff_name: 'অন্য' });
  asg2.status === 422 ? ok('একই বই দুজনকে দেওয়া আটকেছে') : bad('HTTP ' + asg2.status);
  const ret = await post('/admin/receipts/api/books/' + bk.id + '/return', {});
  ret.body.ok ? ok('বই ফেরত নেওয়া হলো') : bad(JSON.stringify(ret.body));

  // ================================================================
  console.log('\n── চ. হিসাবের মিল ──');
  const [[tb]] = await pool.query('SELECT SUM(total_debit) d, SUM(total_credit) c FROM v_trial_balance');
  Math.abs(Number(tb.d) - Number(tb.c)) < 0.01
    ? ok('রেওয়ামিল মিলেছে — ' + Number(tb.d).toFixed(2)) : bad('মেলেনি: ' + tb.d + '/' + tb.c);
  const [[chk]] = await pool.query(
    `SELECT COALESCE(SUM(r.amount),0) rs,
            (SELECT COALESCE(SUM(v.total_debit),0) FROM vouchers v
              WHERE v.source_module='receipt' AND v.reversed_at IS NULL) vs
       FROM receipts r WHERE r.status='issued'`);
  Math.abs(Number(chk.rs) - Number(chk.vs)) < 0.01
    ? ok('বৈধ রশিদের মোট = বৈধ রশিদ-ভাউচারের মোট (' + Number(chk.rs).toFixed(2) + ')')
    : bad('মিলছে না: ' + chk.rs + ' / ' + chk.vs);

  console.log('\n' + '─'.repeat(64) + '\nফলাফল:  ✅ ' + pass + ' পাস   ❌ ' + fail + ' ফেল\n');
  server.close();
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('\n💥', e); process.exit(1); });

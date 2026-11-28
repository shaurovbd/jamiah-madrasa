'use strict';
/**
 * তারিখ রেন্ডারিংয়ের রিগ্রেশন টেস্ট।
 * ডেটাবেস থেকে DATE দুই রকমে আসতে পারে — JS Date অবজেক্ট (ডিফল্ট) বা
 * স্ট্রিং (dateStrings: true)। দুই ক্ষেত্রেই রশিদে, বিবরণীতে ও প্রতিবেদনে
 * একই সঠিক তারিখ ছাপা হতে হবে।
 */
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const receipts = require('./routes/receipts');
const donorRouter = require('./routes/donors');
const orphanRouter = require('./routes/orphans');
const ledger = require('./routes/ledger');
const ReceiptService = require('./receipt-service');
const DonorService = require('./donor-service');
const OrphanService = require('./orphan-service');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  ✅', m); };
const bad = (m) => { fail++; console.log('  ❌', m); };
const has = (l, h, n) => (h.indexOf(n) >= 0 ? ok(l) : bad(l + ' — নেই: ' + n));
const hasNot = (l, h, n) => (h.indexOf(n) < 0 ? ok(l) : bad(l + ' — থাকা উচিত নয়: ' + n));

// ২০২৬ সালের ৫ নভেম্বর — বাংলা অঙ্কে ০৫/১১/২০২৬
const D = '2026-11-05';
const BN_D = '০৫/১১/২০২৬';
const WRONG_D = '০৪/১১/২০২৬';   // টাইমজোনে একদিন পিছিয়ে গেলে এটা আসত

async function run(label, poolOpts) {
  console.log('\n── ' + label + ' ──');
  const pool = mysql.createPool(Object.assign({
    host: '127.0.0.1', user: 'jamiah', password: 'test_pw_local',
    database: 'jamiah', decimalNumbers: true, connectionLimit: 5,
  }, poolOpts));

  const [[chk]] = await pool.query('SELECT start_date FROM fiscal_years LIMIT 1');
  ok('DB থেকে DATE আসছে: ' + (chk.start_date instanceof Date ? 'Date অবজেক্ট' : 'স্ট্রিং'));

  const donors = new DonorService(pool);
  const rsvc = new ReceiptService(pool, { donorService: donors });
  const osvc = new OrphanService(pool);
  const actor = () => ({ userId: 1, role: 'principal', ip: '127.0.0.1' });

  const app = express();
  app.use('/admin/receipts', receipts.admin({ pool, getActor: actor }));
  app.use('/admin/donors', donorRouter({ pool, getActor: actor }));
  app.use('/admin/orphans', orphanRouter({ pool, getActor: actor }));
  app.use('/admin/ledger', ledger({ pool, getActor: actor }));
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const text = async (p) => (await fetch(base + p)).text();

  const [accs] = await pool.query('SELECT id, code FROM accounts');
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  // ---- রশিদ ----
  const r = await rsvc.issue({
    receipt_type: 'DON', receipt_date: D, amount: 5000,
    payer_name: 'তারিখ পরীক্ষা', payer_mobile: '01700000' + Math.floor(Math.random() * 900 + 100),
    cash_account_id: A['1101'], payment_method: 'cash',
  }, actor());

  const print = await text('/admin/receipts/r/' + r.id + '?size=a4');
  has('রশিদে সঠিক তারিখ ' + BN_D, print, BN_D);
  hasNot('একদিন পিছিয়ে যায়নি', print, WRONG_D);
  hasNot('ইংরেজি দিনের নাম ছাপা হয়নি', print, 'Thu ');
  hasNot('মাসের নাম ইংরেজিতে আসেনি', print, 'Nov 0');

  // ---- ভাউচার বিস্তারিত ----
  const vdetail = await text('/admin/ledger/v/' + r.voucher_id);
  has('ভাউচারের পেজে সঠিক তারিখ', vdetail, D);
  hasNot('ভাউচারে ইংরেজি দিনের নাম নেই', vdetail, 'Thu Nov');

  // ---- দাতার বার্ষিক বিবরণী ----
  const st = await text('/admin/donors/d/' + r.donor_id + '/statement?from=2026-01-01&to=2026-12-31');
  has('বিবরণীতে সঠিক তারিখ', st, BN_D);
  hasNot('বিবরণীতে একদিন পিছিয়ে যায়নি', st, WRONG_D);

  // ---- এতিমের প্রতিবেদন ----
  const o = await osvc.createOrphan({
    full_name: 'তারিখ পরীক্ষা শিশু', orphan_status: 'both_deceased',
    enrolled_date: D, need_food: 1000,
  }, actor());
  await osvc.addDocument(o.id, {
    doc_type: 'death_certificate', file_path: '/s/a.pdf', file_name: 'a.pdf' }, actor());
  await osvc.verifyOrphan(o.id, actor());
  const sp = await osvc.createSponsorship({
    orphan_id: o.id, donor_id: r.donor_id, monthly_amount: 1000, start_date: D,
  }, actor());
  const rep = await text('/admin/orphans/s/' + sp.id + '/report');
  has('প্রতিবেদনে ভর্তির সঠিক তারিখ', rep, BN_D);
  hasNot('প্রতিবেদনে একদিন পিছিয়ে যায়নি', rep, WRONG_D);

  // ---- API (ক্লায়েন্ট তালিকা যা পায়) ----
  const list = await (await fetch(base + '/admin/receipts/api/receipts')).json();
  const row = list.rows.find((x) => x.id === r.id);
  const asSeen = String(row.receipt_date);
  const clientYmd = (d) => {
    const s = String(d);
    if (s.indexOf('T') > 0 && s.indexOf('Z') > 0) {
      const t = new Date(s); const p = (n) => String(n).padStart(2, '0');
      return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    }
    return s.slice(0, 10);
  };
  clientYmd(asSeen) === D
    ? ok('তালিকার API থেকে ব্রাউজারে সঠিক তারিখ (' + asSeen.slice(0, 24) + ')')
    : bad('ব্রাউজারে ভুল তারিখ: ' + clientYmd(asSeen) + ' (চাই ' + D + ')');

  server.close();
  await pool.end();
}

async function main() {
  console.log('\nতারিখ রেন্ডারিংয়ের পরীক্ষা — সার্ভারের টাইমজোন: ' +
    Intl.DateTimeFormat().resolvedOptions().timeZone);
  await run('ক. ডিফল্ট পুল (DATE → JS Date অবজেক্ট)', {});
  await run('খ. dateStrings: true (সুপারিশকৃত)', { dateStrings: true });
  console.log('\n' + '─'.repeat(64) + '\nফলাফল:  ✅ ' + pass + ' পাস   ❌ ' + fail + ' ফেল\n');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('\n💥', e); process.exit(1); });

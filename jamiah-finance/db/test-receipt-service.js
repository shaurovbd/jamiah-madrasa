'use strict';
/** রশিদ সার্ভিসের পরীক্ষা — আসল MySQL-এ। তাজা সিডেড ডেটাবেস দরকার। */
const mysql = require('mysql2/promise');
const ReceiptService = require('./receipt-service');
const { takaInWords } = require('./lib/bangla-number');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  ✅', m); };
const bad = (m) => { fail++; console.log('  ❌', m); };
const eq  = (l, got, want) =>
  (String(got) === String(want) ? ok(l) : bad(l + ' — পেলাম ' + got + ', চাই ' + want));

async function main() {
  const pool = mysql.createPool({
    host: '127.0.0.1', user: 'jamiah', password: 'test_pw_local',
    database: 'jamiah', decimalNumbers: true, connectionLimit: 5,
  });
  const svc = new ReceiptService(pool);

  const [accs] = await pool.query('SELECT id, code FROM accounts');
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  const [fs] = await pool.query('SELECT id, code FROM funds');
  const F = Object.fromEntries(fs.map((f) => [f.code, f.id]));

  const today = new Date().toISOString().slice(0, 10);
  const principal  = { userId: 1, role: 'principal', ip: '127.0.0.1' };
  const accountant = { userId: 2, role: 'accountant', ip: '127.0.0.1' };
  const chief      = { userId: 3, role: 'chief_accountant', ip: '127.0.0.1' };

  const fundBal = async (code) => {
    const [[r]] = await pool.query('SELECT available_balance b FROM v_fund_available WHERE code=?', [code]);
    return Number(r.b);
  };
  const cashBal = async (code) => {
    const [[r]] = await pool.query('SELECT balance b FROM v_cash_position WHERE code=?', [code]);
    return Number(r.b);
  };
  const expectFail = async (label, fn, needle) => {
    try { await fn(); bad(label + ' — আটকায়নি!'); }
    catch (e) {
      const j = (e.errors || [e.message]).join(' | ');
      if (needle && j.indexOf(needle) < 0) bad(label + ' — অন্য কারণে আটকেছে: ' + j);
      else ok(label + ' → ' + (e.errors ? e.errors[0] : e.message));
    }
  };

  // ================================================================
  console.log('\n── ১. যাকাতের রশিদ Tk 25,000 নগদে ──');
  const r1 = await svc.issue({
    receipt_type: 'ZAK', receipt_date: today, amount: 25000,
    payer_name: 'আব্দুল করিম', payer_mobile: '01711000000',
    cash_account_id: A['1101'], payment_method: 'cash',
    purpose_bn: '১৪৪৭ হিজরির যাকাত',
  }, accountant);

  eq('রশিদ নম্বর', r1.receipt_no, 'ZAK-2026-00001');
  eq('টাকা কথায়', r1.amount_in_words, 'পঁচিশ হাজার টাকা মাত্র');
  eq('ভাউচার পোস্টেড (অনুমোদনের অপেক্ষা নেই)', r1.voucher_status, 'posted');
  /^RV-2026-/.test(r1.voucher_no) ? ok('জমা ভাউচার ' + r1.voucher_no) : bad(r1.voucher_no);
  eq('যাকাত ফান্ডে 25,000', await fundBal('ZAK'), 25000);
  eq('প্রধান ক্যাশে 25,000', await cashBal('1101'), 25000);
  r1.verify_token && r1.verify_token.length === 32
    ? ok('যাচাই টোকেন ৩২ অক্ষরের') : bad('টোকেন ভুল: ' + r1.verify_token);

  const [[v1]] = await pool.query(
    `SELECT v.source_module, v.receipt_id, v.narration_bn FROM vouchers v WHERE v.id=?`, [r1.voucher_id]);
  eq('ভাউচারে source_module', v1.source_module, 'receipt');
  eq('ভাউচার থেকে রশিদে ফেরত লিংক', v1.receipt_id, r1.id);
  v1.narration_bn.indexOf(r1.receipt_no) >= 0
    ? ok('ভাউচারের বিবরণে রশিদ নম্বর আছে') : bad('বিবরণে নম্বর নেই');

  const [l1] = await pool.query(
    `SELECT a.code, f.code fund, vl.debit, vl.credit FROM voucher_lines vl
      JOIN accounts a ON a.id=vl.account_id JOIN funds f ON f.id=vl.fund_id
      WHERE vl.voucher_id=? ORDER BY vl.line_no`, [r1.voucher_id]);
  eq('২টি লাইন', l1.length, 2);
  l1[0].code === '1101' && Number(l1[0].debit) === 25000 && l1[0].fund === 'ZAK'
    ? ok('নগদ ডেবিট, যাকাত ফান্ডে ট্যাগ') : bad(JSON.stringify(l1[0]));
  l1[1].code === '4201' && Number(l1[1].credit) === 25000
    ? ok('যাকাত আদায় খাতে ক্রেডিট') : bad(JSON.stringify(l1[1]));

  // ================================================================
  console.log('\n── ২. প্রতিটি ধরনের আলাদা সিরিজ ──');
  const r2 = await svc.issue({
    receipt_type: 'ZAK', receipt_date: today, amount: 5000,
    payer_name: 'রহিমা বেগম', cash_account_id: A['1101'],
  }, accountant);
  eq('দ্বিতীয় যাকাত রশিদ', r2.receipt_no, 'ZAK-2026-00002');

  const r3 = await svc.issue({
    receipt_type: 'DON', receipt_date: today, amount: 10000,
    payer_name: 'জনাব সালাম', cash_account_id: A['1121'], payment_method: 'bkash',
    instrument_no: 'TrxID 9F2K8LQ', purpose_bn: 'লিল্লাহ অনুদান',
  }, accountant);
  eq('অনুদানের সিরিজ আলাদা', r3.receipt_no, 'DON-2026-00001');
  eq('সদকা ফান্ডে 10,000', await fundBal('SAD'), 10000);
  eq('বিকাশে 10,000', await cashBal('1121'), 10000);

  // ================================================================
  console.log('\n── ৩. শিক্ষার্থী ফি — প্রাপ্য কমে, ফান্ডের জের বদলায় না ──');
  await expectFail('শিক্ষার্থী ছাড়া ফি রশিদ', () => svc.issue({
    receipt_type: 'FEE', receipt_date: today, amount: 1200,
    payer_name: 'অভিভাবক', cash_account_id: A['1101'],
  }, accountant), 'শিক্ষার্থী নির্বাচন');

  const genBefore = await fundBal('GEN');
  const r4 = await svc.issue({
    receipt_type: 'FEE', receipt_date: today, amount: 1200,
    payer_name: 'হাসান জাকারিয়ার অভিভাবক', student_id: 1,
    cash_account_id: A['1101'], purpose_bn: 'নভেম্বর ২০২৬ এর বেতন',
  }, accountant);
  eq('ফি রশিদের নম্বর', r4.receipt_no, 'FEE-2026-00001');
  const [l4] = await pool.query(
    `SELECT a.code, vl.credit, vl.student_id FROM voucher_lines vl
      JOIN accounts a ON a.id=vl.account_id WHERE vl.voucher_id=? AND vl.credit>0`, [r4.voucher_id]);
  eq('বাকি ফি হিসাবে ক্রেডিট (১২০১)', l4[0].code, '1201');
  eq('লাইনে শিক্ষার্থী আইডি বসেছে', l4[0].student_id, 1);
  eq('সাধারণ ফান্ডের জের অপরিবর্তিত (আয় আগেই ইনভয়েসে ধরা হয়েছে)',
     await fundBal('GEN'), genBefore);
  eq('তবু নগদ বেড়েছে', await cashBal('1101'), 25000 + 5000 + 1200);

  // ================================================================
  console.log('\n── ৪. ফান্ড বদলের নিয়ম ──');
  await expectFail('যাকাতে ফান্ড বদল', () => svc.issue({
    receipt_type: 'ZAK', receipt_date: today, amount: 1000,
    payer_name: 'ক', cash_account_id: A['1101'], fund_id: F['GEN'],
  }, accountant), 'ফান্ড বদলানো যাবে না');

  const r5 = await svc.issue({
    receipt_type: 'DON', receipt_date: today, amount: 50000,
    payer_name: 'প্রবাসী দাতা', cash_account_id: A['1111'], payment_method: 'bank',
    fund_id: F['CON'], purpose_bn: 'নতুন ভবনের জন্য নির্দিষ্ট',
  }, accountant);
  eq('অনুদানে ফান্ড বদল চলে → নির্মাণ ফান্ডে', await fundBal('CON'), 50000);
  ok(r5.receipt_no + ' — দাতার নির্দিষ্ট খাতে');

  // ================================================================
  console.log('\n── ৫. পক্ষ লাগে এমন খাত (ঋণ ফেরত) ──');
  await expectFail('পক্ষ ছাড়া ঋণ ফেরত', () => svc.issue({
    receipt_type: 'LON', receipt_date: today, amount: 2000,
    payer_name: 'মাওলানা সাহেব', cash_account_id: A['1101'],
  }, accountant), 'নির্বাচন করতে হবে');

  const r6 = await svc.issue({
    receipt_type: 'LON', receipt_date: today, amount: 2000,
    payer_name: 'মাওলানা সাহেব', party_type: 'staff', party_id: 5,
    cash_account_id: A['1101'], purpose_bn: 'অগ্রিমের কিস্তি',
  }, accountant);
  ok(r6.receipt_no + ' — স্টাফ ঋণ ফেরত গৃহীত');

  // ================================================================
  console.log('\n── ৬. অ্যাটমিসিটি: ব্যর্থ হলে নম্বরও ফেরত যায় ──');
  const [[seqBefore]] = await pool.query(
    `SELECT last_no FROM receipt_sequences rs JOIN receipt_types rt ON rt.id=rs.receipt_type_id
      WHERE rt.code='ZAK'`);
  await expectFail('শিরোনাম হিসাবে জমা (ভাউচার যাচাইয়ে আটকাবে)', () => svc.issue({
    receipt_type: 'ZAK', receipt_date: today, amount: 999,
    payer_name: 'খ', cash_account_id: A['1101'],
    credit_account_id: A['4200'],          // গ্রুপ হিসাব
  }, accountant), 'শিরোনাম হিসাব');
  const [[seqAfter]] = await pool.query(
    `SELECT last_no FROM receipt_sequences rs JOIN receipt_types rt ON rt.id=rs.receipt_type_id
      WHERE rt.code='ZAK'`);
  eq('সিরিজ বাড়েনি (রোলব্যাক হয়েছে)', seqAfter.last_no, seqBefore.last_no);

  const r7 = await svc.issue({
    receipt_type: 'ZAK', receipt_date: today, amount: 3000,
    payer_name: 'গ', cash_account_id: A['1101'],
  }, accountant);
  eq('পরের রশিদে সিরিজে ফাঁক নেই', r7.receipt_no, 'ZAK-2026-00003');

  const [[orphan]] = await pool.query(
    `SELECT COUNT(*) n FROM vouchers WHERE source_module='receipt' AND receipt_id IS NULL`);
  eq('রশিদবিহীন কোনো রশিদ-ভাউচার নেই', orphan.n, 0);

  // ================================================================
  console.log('\n── ৭. যাচাই (QR) ──');
  const vr = await svc.verify(r1.verify_token);
  vr && vr.receipt_no === r1.receipt_no ? ok('টোকেন দিয়ে রশিদ পাওয়া গেল') : bad('যাচাই ব্যর্থ');
  vr && vr.payer_mobile === undefined
    ? ok('মোবাইল নম্বর পাবলিক যাচাইয়ে ফেরত যায় না') : bad('মোবাইল ফাঁস হচ্ছে');
  eq('যাচাইয়ে টাকা কথায়', vr.amount_in_words, 'পঁচিশ হাজার টাকা মাত্র');
  (await svc.verify('ffffffffffffffffffffffffffffffff')) === null
    ? ok('ভুল টোকেনে কিছু পাওয়া যায় না') : bad('ভুল টোকেনে ডেটা ফিরেছে');
  (await svc.verify('abc')) === null ? ok('অবৈধ আকারের টোকেন নাকচ') : bad('অবৈধ টোকেন গৃহীত');

  // ================================================================
  console.log('\n── ৮. প্রিন্ট গণনা ──');
  eq('প্রথম প্রিন্ট', await svc.markPrinted(r1.id), 1);
  eq('দ্বিতীয় প্রিন্ট (নকল কপি হবে)', await svc.markPrinted(r1.id), 2);

  // ================================================================
  console.log('\n── ৯. বাতিল ──');
  await expectFail('হিসাবরক্ষকের বাতিল', () => svc.void(r2.id, 'ভুল', accountant), 'প্রধান হিসাবরক্ষক');
  await expectFail('কারণ ছাড়া বাতিল', () => svc.void(r2.id, '  ', chief), 'কারণ লিখতে হবে');

  const zakBefore = await fundBal('ZAK');
  const cashBefore = await cashBal('1101');
  const vd = await svc.void(r2.id, 'দাতা টাকা ফেরত নিয়েছেন', chief);
  ok(r2.receipt_no + ' বাতিল — রিভার্সাল ' + vd.reversal_voucher_no);
  eq('যাকাত ফান্ড থেকে 5,000 ফেরত গেছে', await fundBal('ZAK'), zakBefore - 5000);
  eq('নগদ থেকেও 5,000 কমেছে', await cashBal('1101'), cashBefore - 5000);

  const [[rv2]] = await pool.query(
    `SELECT status, reversed_at FROM vouchers WHERE id=?`, [r2.voucher_id]);
  rv2.status === 'posted' && rv2.reversed_at
    ? ok('মূল ভাউচার খতিয়ানে রয়ে গেছে, রিভার্সাল চিহ্নিত') : bad('ভাউচারের অবস্থা ভুল');

  const vvoid = await svc.verify(r2.verify_token);
  vvoid.status === 'void' && vvoid.void_reason
    ? ok('যাচাই পেজে "বাতিল" দেখাবে কারণসহ') : bad('বাতিল অবস্থা দেখায়নি');
  await expectFail('দ্বিতীয়বার বাতিল', () => svc.void(r2.id, 'আবার', chief), 'আগেই বাতিল');

  const r8 = await svc.issue({
    receipt_type: 'ZAK', receipt_date: today, amount: 100,
    payer_name: 'ঘ', cash_account_id: A['1101'],
  }, accountant);
  eq('বাতিল রশিদের নম্বর পুনর্ব্যবহার হয়নি', r8.receipt_no, 'ZAK-2026-00004');

  // ================================================================
  console.log('\n── ১০. ম্যানুয়াল রশিদ বই ──');
  const [[bk]] = await pool.query(`SELECT id, book_no FROM receipt_books WHERE book_no='BK-001'`);
  await expectFail('বই না দিয়েই বইয়ের রশিদ', () => svc.issue({
    receipt_type: 'DON', receipt_date: today, amount: 500, payer_name: 'ঙ',
    cash_account_id: A['1101'], book_id: bk.id, manual_no: '1005',
  }, accountant), 'দেওয়া নেই');

  await svc.assignBook(bk.id, { staffId: 7, staffName: 'মাঠ কলেক্টর — জসিম' }, principal);
  ok('বই ' + bk.book_no + ' কলেক্টরকে দেওয়া হলো');
  await expectFail('একই বই দুজনকে',
    () => svc.assignBook(bk.id, { staffName: 'অন্য কেউ' }, principal), 'ইতিমধ্যে');

  await expectFail('বইয়ের সীমার বাইরের নম্বর', () => svc.issue({
    receipt_type: 'DON', receipt_date: today, amount: 500, payer_name: 'চ',
    cash_account_id: A['1101'], book_id: bk.id, manual_no: '5555',
  }, accountant), 'এর বাইরে');

  const rb = await svc.issue({
    receipt_type: 'DON', receipt_date: today, amount: 500, payer_name: 'গ্রামের দাতা',
    cash_account_id: A['1103'], book_id: bk.id, manual_no: '1005',
  }, accountant);
  ok(rb.receipt_no + ' — বইয়ের ১০০৫ নম্বরের বিপরীতে');
  await expectFail('একই বই-নম্বর দুবার', () => svc.issue({
    receipt_type: 'DON', receipt_date: today, amount: 300, payer_name: 'ছ',
    cash_account_id: A['1103'], book_id: bk.id, manual_no: '1005',
  }, accountant), 'আগেই ব্যবহার');

  const retd = await svc.returnBook(bk.id, principal);
  eq('বই ফেরত, ব্যবহৃত সংখ্যা', retd.used_count, 1);

  // ================================================================
  console.log('\n── ১১. অন্যান্য যাচাই ──');
  await expectFail('শূন্য পরিমাণ', () => svc.issue({
    receipt_type: 'DON', receipt_date: today, amount: 0,
    payer_name: 'জ', cash_account_id: A['1101'],
  }, accountant), 'শূন্যের বেশি');

  await expectFail('নগদ নয় এমন হিসাবে জমা', () => svc.issue({
    receipt_type: 'DON', receipt_date: today, amount: 100,
    payer_name: 'ঝ', cash_account_id: A['5201'],
  }, accountant), 'নগদ/ব্যাংক হিসাব নয়');

  await pool.query(
    `UPDATE fiscal_periods SET status='locked' WHERE ? BETWEEN start_date AND end_date`, [today]);
  await expectFail('বন্ধ পিরিয়ডে রশিদ', () => svc.issue({
    receipt_type: 'DON', receipt_date: today, amount: 100,
    payer_name: 'ঞ', cash_account_id: A['1101'],
  }, accountant), 'পিরিয়ড বন্ধ');
  await pool.query(
    `UPDATE fiscal_periods SET status='open' WHERE ? BETWEEN start_date AND end_date`, [today]);

  // ================================================================
  console.log('\n── ১২. হিসাবের সামগ্রিক মিল ──');
  const [[tb]] = await pool.query(
    `SELECT SUM(total_debit) d, SUM(total_credit) c FROM v_trial_balance`);
  Math.abs(Number(tb.d) - Number(tb.c)) < 0.01
    ? ok('রেওয়ামিল মিলেছে — ' + Number(tb.d).toFixed(2))
    : bad('রেওয়ামিল মেলেনি: ' + tb.d + ' / ' + tb.c);

  const [[sum]] = await pool.query(
    `SELECT COALESCE(SUM(amount),0) s FROM receipts WHERE status='issued'`);
  const [[vsum]] = await pool.query(
    `SELECT COALESCE(SUM(v.total_debit),0) s FROM vouchers v
      WHERE v.source_module='receipt' AND v.reversed_at IS NULL`);
  Math.abs(Number(sum.s) - Number(vsum.s)) < 0.01
    ? ok('বৈধ রশিদের মোট = রশিদ-ভাউচারের মোট (' + Number(sum.s).toFixed(2) + ')')
    : bad('মিলছে না: রশিদ ' + sum.s + ' বনাম ভাউচার ' + vsum.s);

  const [daily] = await pool.query(
    `SELECT type_code, type_name, receipt_count, total_amount FROM v_receipt_daily
      WHERE receipt_date=? ORDER BY type_code`, [today]);
  console.log('\n  আজকের সংগ্রহ (ধরন অনুযায়ী):');
  for (const d of daily) {
    console.log('    ' + d.type_code + '  ' + d.type_name.padEnd(24) +
      String(d.receipt_count).padStart(3) + 'টি   ' + String(d.total_amount).padStart(11));
  }
  const [methods] = await pool.query(
    `SELECT payment_method, cash_name, total_amount FROM v_receipt_by_method
      WHERE receipt_date=? ORDER BY payment_method`, [today]);
  console.log('\n  মাধ্যম অনুযায়ী (ক্যাশ মিলানোর জন্য):');
  for (const m of methods) {
    console.log('    ' + String(m.payment_method).padEnd(8) + m.cash_name.padEnd(26) +
      String(m.total_amount).padStart(11));
  }

  console.log('\n' + '─'.repeat(64) + '\nফলাফল:  ✅ ' + pass + ' পাস   ❌ ' + fail + ' ফেল\n');
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('\n💥', e); process.exit(1); });

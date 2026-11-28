'use strict';
/** ভাউচার সার্ভিসের পরীক্ষা — আসল MySQL 8-এ চলে
 *  চালানোর নিয়ম:  node test-voucher-service.js   (তাজা সিডেড ডেটাবেসে)
 */
const mysql = require('mysql2/promise');
const VoucherService = require('./voucher-service');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  ✅', m); };
const bad = (m) => { fail++; console.log('  ❌', m); };

async function main() {
  const pool = mysql.createPool({
    host: '127.0.0.1', user: 'jamiah', password: 'test_pw_local',
    database: 'jamiah', decimalNumbers: true, connectionLimit: 5,
  });
  const svc = new VoucherService(pool);

  const [accs] = await pool.query('SELECT id, code FROM accounts');
  const A = Object.fromEntries(accs.map(a => [a.code, a.id]));
  const [fs] = await pool.query('SELECT id, code FROM funds');
  const F = Object.fromEntries(fs.map(f => [f.code, f.id]));
  const [ccs] = await pool.query('SELECT id, code FROM cost_centers');
  const C = Object.fromEntries(ccs.map(c => [c.code, c.id]));

  const today = new Date().toISOString().slice(0, 10);
  const principal  = { userId: 1, role: 'principal',  ip: '127.0.0.1' };
  const accountant = { userId: 2, role: 'accountant', ip: '127.0.0.1' };
  const committee  = { userId: 3, role: 'committee',  ip: '127.0.0.1' };

  const fundBal = async (code) => {
    const [[r]] = await pool.query('SELECT available_balance b FROM v_fund_available WHERE code=?', [code]);
    return Number(r.b);
  };
  const cashBal = async (code) => {
    const [[r]] = await pool.query('SELECT balance b FROM v_cash_position WHERE code=?', [code]);
    return Number(r.b);
  };

  const expectFail = async (label, fn, mustInclude) => {
    try { await fn(); bad(label + ' — আটকায়নি! (আটকানো উচিত ছিল)'); }
    catch (e) {
      if (e.name !== 'VoucherError') { bad(label + ' — ভুল ধরনের ত্রুটি: ' + e.message); return; }
      const joined = e.errors.join(' | ');
      if (mustInclude && !joined.includes(mustInclude)) {
        bad(label + ' — আটকেছে, কিন্তু অন্য কারণে: ' + e.errors[0]);
      } else ok(label + ' → ' + e.errors[0]);
    }
  };

  console.log('\n── ১. আদায়: যাকাত Tk 50,000 নগদে ──');
  const rv = await svc.create({
    voucher_type: 'RV', voucher_date: today, payment_method: 'cash',
    narration_bn: 'যাকাত গ্রহণ — আব্দুল করিম সাহেব',
    lines: [
      { account_id: A['1101'], fund_id: F['ZAK'], debit: 50000, credit: 0 },
      { account_id: A['4201'], fund_id: F['ZAK'], debit: 0, credit: 50000 },
    ],
  }, principal);
  rv.status === 'posted' ? ok(rv.voucher_no + ' পোস্ট হয়েছে') : bad('অবস্থা ' + rv.status);
  rv.voucher_no === 'RV-2026-00001' ? ok('নম্বর সিরিজ সঠিক') : bad('নম্বর ' + rv.voucher_no);

  console.log('\n── ২. আদায়: শিক্ষার্থী ফি Tk 20,000 বিকাশে (সাধারণ ফান্ড) ──');
  const rv2 = await svc.create({
    voucher_type: 'RV', voucher_date: today, payment_method: 'bkash',
    narration_bn: 'নভেম্বরের বেতন আদায়',
    lines: [
      { account_id: A['1121'], fund_id: F['GEN'], debit: 20000, credit: 0 },
      { account_id: A['4102'], fund_id: F['GEN'], debit: 0, credit: 20000, cost_center_id: C['HIFZ'] },
    ],
  }, principal);
  rv2.voucher_no === 'RV-2026-00002' ? ok('গ্যাপলেস নম্বরিং কাজ করছে') : bad(rv2.voucher_no);

  console.log('\n── ৩. যাকাত → শিক্ষার্থীর খাবার Tk 30,000 (অনুমোদিত খাত) ──');
  const pv = await svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'cash',
    narration_bn: 'এতিম ও গরিব শিক্ষার্থীর খাবার',
    lines: [
      { account_id: A['5201'], fund_id: F['ZAK'], debit: 30000, credit: 0, cost_center_id: C['HOSTEL'] },
      { account_id: A['1101'], fund_id: F['ZAK'], debit: 0, credit: 30000 },
    ],
  }, principal);
  pv.status === 'posted' ? ok(pv.voucher_no + ' — অনুমোদিত খাতে ব্যয় পাস') : bad(pv.status);

  console.log('\n── ৪–৫. যাকাত → নিষিদ্ধ খাত ──');
  await expectFail('যাকাত → বিদ্যুৎ বিল', () => svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'cash',
    lines: [
      { account_id: A['5301'], fund_id: F['ZAK'], debit: 5000, credit: 0 },
      { account_id: A['1101'], fund_id: F['ZAK'], debit: 0, credit: 5000 },
    ],
  }, principal), 'ব্যয় করা যাবে না');
  await expectFail('যাকাত → শিক্ষক বেতন', () => svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'cash',
    lines: [
      { account_id: A['5101'], fund_id: F['ZAK'], debit: 10000, credit: 0 },
      { account_id: A['1101'], fund_id: F['ZAK'], debit: 0, credit: 10000 },
    ],
  }, principal), 'ব্যয় করা যাবে না');

  console.log('\n── ৬. ফান্ডে ঘাটতি (যাকাতে বাকি 20,000, চাওয়া 45,000) ──');
  await expectFail('ফান্ড ঘাটতি', () => svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'cash',
    lines: [
      { account_id: A['5201'], fund_id: F['ZAK'], debit: 45000, credit: 0 },
      { account_id: A['1101'], fund_id: F['ZAK'], debit: 0, credit: 45000 },
    ],
  }, principal), 'অবশিষ্ট');

  console.log('\n── ৭–১০. কাঠামোগত ভুল ──');
  await expectFail('ডেবিট ≠ ক্রেডিট', () => svc.create({
    voucher_type: 'JV', voucher_date: today,
    lines: [
      { account_id: A['5201'], fund_id: F['GEN'], debit: 1000, credit: 0 },
      { account_id: A['1101'], fund_id: F['GEN'], debit: 0, credit: 900 },
    ],
  }, principal), 'সমান হয়নি');
  await expectFail('শিরোনাম (গ্রুপ) হিসাব', () => svc.create({
    voucher_type: 'JV', voucher_date: today,
    lines: [
      { account_id: A['1100'], fund_id: F['GEN'], debit: 1000, credit: 0 },
      { account_id: A['4204'], fund_id: F['GEN'], debit: 0, credit: 1000 },
    ],
  }, principal), 'শিরোনাম হিসাব');
  await expectFail('ফান্ড ছাড়া লাইন', () => svc.create({
    voucher_type: 'JV', voucher_date: today,
    lines: [
      { account_id: A['5201'], debit: 1000, credit: 0 },
      { account_id: A['1101'], fund_id: F['GEN'], debit: 0, credit: 1000 },
    ],
  }, principal), 'ফান্ড নির্বাচন করুন');
  await expectFail('পার্টি ছাড়া বাকি-ফি হিসাব', () => svc.create({
    voucher_type: 'JV', voucher_date: today,
    lines: [
      { account_id: A['1201'], fund_id: F['GEN'], debit: 1000, credit: 0 },
      { account_id: A['4102'], fund_id: F['GEN'], debit: 0, credit: 1000 },
    ],
  }, principal), 'নির্বাচন করুন');
  await expectFail('ভবিষ্যৎ তারিখ', () => svc.create({
    voucher_type: 'RV', voucher_date: '2099-01-01', payment_method: 'cash',
    lines: [
      { account_id: A['1101'], fund_id: F['GEN'], debit: 100, credit: 0 },
      { account_id: A['4204'], fund_id: F['GEN'], debit: 0, credit: 100 },
    ],
  }, principal), 'ভবিষ্যৎ');

  console.log('\n── ১১. ওয়াকফ কর্পাস ব্যয় (চিরনিষিদ্ধ, override-ও চলবে না) ──');
  const waqf = await svc.create({
    voucher_type: 'RV', voucher_date: today, payment_method: 'bank',
    narration_bn: 'ওয়াকফ গ্রহণ',
    lines: [
      { account_id: A['1111'], fund_id: F['WAQ'], debit: 100000, credit: 0 },
      { account_id: A['4208'], fund_id: F['WAQ'], debit: 0, credit: 100000 },
    ],
  }, committee);
  waqf.status === 'posted'
    ? ok(waqf.voucher_no + ' — ওয়াকফ Tk 100,000 গৃহীত (কমিটির অনুমোদনে)')
    : bad('ওয়াকফ ভাউচার পোস্ট হয়নি: ' + waqf.status);
  // ওয়াকফ ফান্ডে মুহতামিমের একক অনুমোদন চলবে না
  const waqfTry = await svc.create({
    voucher_type: 'RV', voucher_date: today, payment_method: 'bank',
    narration_bn: 'ওয়াকফ গ্রহণ — মুহতামিমের একক চেষ্টা',
    lines: [
      { account_id: A['1111'], fund_id: F['WAQ'], debit: 5000, credit: 0 },
      { account_id: A['4208'], fund_id: F['WAQ'], debit: 0, credit: 5000 },
    ],
  }, principal);
  waqfTry.status === 'pending' && waqfTry.required_approver === 'committee'
    ? ok('ওয়াকফ ফান্ডে কমিটির অনুমোদন বাধ্যতামূলক')
    : bad('ওয়াকফ অনুমোদন স্তর ভুল: ' + waqfTry.status + '/' + waqfTry.required_approver);
  await expectFail('ওয়াকফ কর্পাস ব্যয়', () => svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'bank',
    lines: [
      { account_id: A['5201'], fund_id: F['WAQ'], debit: 10000, credit: 0 },
      { account_id: A['1111'], fund_id: F['WAQ'], debit: 0, credit: 10000 },
    ],
  }, principal), 'কর্পাস');
  await expectFail('ওয়াকফ কর্পাস + override', () => svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'bank',
    fatwa_override: true, fatwa_note: 'জরুরি প্রয়োজন',
    lines: [
      { account_id: A['5201'], fund_id: F['WAQ'], debit: 10000, credit: 0 },
      { account_id: A['1111'], fund_id: F['WAQ'], debit: 0, credit: 10000 },
    ],
  }, principal), 'কর্পাস');

  console.log('\n── ১২. নগদে ঘাটতি (ফান্ডে টাকা আছে, ক্যাশবক্সে নেই) ──');
  await svc.create({
    voucher_type: 'RV', voucher_date: today, payment_method: 'bank',
    narration_bn: 'বড় অনুদান — ব্যাংকে জমা',
    lines: [
      { account_id: A['1111'], fund_id: F['GEN'], debit: 300000, credit: 0 },
      { account_id: A['4204'], fund_id: F['GEN'], debit: 0, credit: 300000 },
    ],
  }, committee);
  const genBefore = await fundBal('GEN');
  Math.abs(genBefore - 320000) < 0.01
    ? ok('সাধারণ ফান্ড 320,000 (20,000 ফি + 300,000 অনুদান)')
    : bad('সাধারণ ফান্ড জের ' + genBefore + ', হওয়া উচিত 320000');
  console.log('     প্রধান ক্যাশ: ' + (await cashBal('1101')) + ' | সাধারণ ফান্ড: ' + genBefore);
  await expectFail('ক্যাশ ঘাটতি', () => svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'cash',
    lines: [
      { account_id: A['5301'], fund_id: F['GEN'], debit: 100000, credit: 0 },
      { account_id: A['1101'], fund_id: F['GEN'], debit: 0, credit: 100000 },
    ],
  }, principal), 'পরিশোধ করা যাবে না');

  console.log('\n── ১৩. ফতোয়া নোট দিয়ে বিধিনিষেধ অতিক্রম ──');
  await expectFail('কারণ ছাড়া override', () => svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'cash',
    fatwa_override: true,
    lines: [
      { account_id: A['5301'], fund_id: F['ZAK'], debit: 1000, credit: 0 },
      { account_id: A['1101'], fund_id: F['ZAK'], debit: 0, credit: 1000 },
    ],
  }, principal), 'ফতোয়া নোট');
  await expectFail('হিসাবরক্ষকের override', () => svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'cash',
    fatwa_override: true, fatwa_note: 'তামলিকের পর ব্যয়',
    lines: [
      { account_id: A['5301'], fund_id: F['ZAK'], debit: 1000, credit: 0 },
      { account_id: A['1101'], fund_id: F['ZAK'], debit: 0, credit: 1000 },
    ],
  }, accountant), 'শুধু মুহতামিম');
  const ovr = await svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'cash',
    fatwa_override: true,
    fatwa_note: 'মুহতামিমের সিদ্ধান্ত: হীলায়ে তামলিকের পর এই ব্যয় অনুমোদিত। রেফ: ফতোয়া নং ১২/২০২৬',
    lines: [
      { account_id: A['5301'], fund_id: F['ZAK'], debit: 1000, credit: 0 },
      { account_id: A['1101'], fund_id: F['ZAK'], debit: 0, credit: 1000 },
    ],
  }, principal);
  ovr.status === 'posted' ? ok(ovr.voucher_no + ' — লিখিত কারণে অতিক্রম অনুমোদিত') : bad(ovr.status);

  console.log('\n── ১৪. অনুমোদন স্তর ──');
  const big = await svc.create({
    voucher_type: 'PV', voucher_date: today, payment_method: 'bkash',
    narration_bn: 'কিতাব ক্রয় — Tk 15,000',
    lines: [
      { account_id: A['5204'], fund_id: F['GEN'], debit: 15000, credit: 0 },
      { account_id: A['1121'], fund_id: F['GEN'], debit: 0, credit: 15000 },
    ],
  }, accountant);
  big.status === 'pending'
    ? ok('হিসাবরক্ষকের ভাউচার অনুমোদনের অপেক্ষায় (প্রয়োজন: ' + big.required_approver + ')')
    : bad(big.status);

  // রিগ্রেশন: অপোস্টেড (pending) ভাউচার কোনো জেরে প্রভাব ফেলবে না
  Math.abs((await fundBal('GEN')) - genBefore) < 0.01
    ? ok('পেন্ডিং ভাউচার ফান্ড জেরে ঢোকেনি (রিগ্রেশন)')
    : bad('পেন্ডিং ভাউচার ফান্ড জের বদলে দিয়েছে');
  const [[tbp]] = await pool.query("SELECT total_debit d FROM v_trial_balance WHERE code='5204'");
  Number(tbp.d) === 0
    ? ok('পেন্ডিং ভাউচার রেওয়ামিলেও ঢোকেনি (রিগ্রেশন)')
    : bad('রেওয়ামিলে পেন্ডিং ভাউচার ঢুকেছে: ' + tbp.d);

  await expectFail('নিজের স্তরের বাইরে অনুমোদন',
    () => svc.approve(big.id, accountant), 'স্তরের অনুমোদন প্রয়োজন');
  (await svc.approve(big.id, principal)).status === 'approved'
    ? ok('মুহতামিম অনুমোদন দিয়েছেন') : bad('অনুমোদন হয়নি');
  (await svc.post(big.id, principal)).status === 'posted'
    ? ok('পোস্ট হয়েছে') : bad('পোস্ট হয়নি');
  await expectFail('দ্বিতীয়বার পোস্ট', () => svc.post(big.id, principal), 'আগেই পোস্ট');
  Math.abs((await fundBal('GEN')) - (genBefore - 15000)) < 0.01
    ? ok('পোস্টের পর ফান্ড জের কমেছে') : bad('পোস্টের পর জের মেলেনি');

  console.log('\n── ১৫. রিভার্সাল ──');
  const balBefore = await fundBal('GEN');
  const rev = await svc.reverse(big.id, 'ভুল খাতে বসানো হয়েছিল', principal);
  ok(rev.reversal_no + ' তৈরি হয়েছে');
  const [[orig]] = await pool.query(
    'SELECT status, reversed_at, reversed_by_voucher_id FROM vouchers WHERE id=?', [big.id]);
  orig.status === 'posted' && orig.reversed_at && orig.reversed_by_voucher_id
    ? ok('মূল ভাউচার খতিয়ানে রয়ে গেছে, রিভার্সালের চিহ্ন বসেছে')
    : bad('রিভার্সাল চিহ্ন ভুল: status=' + orig.status + ' reversed_at=' + orig.reversed_at);
  const [[net5204]] = await pool.query(
    "SELECT total_debit - total_credit n FROM v_trial_balance WHERE code='5204'");
  Math.abs(Number(net5204.n)) < 0.01
    ? ok('কিতাব খাতের নিট প্রভাব শূন্য — দুই এন্ট্রি পরস্পরকে কেটেছে')
    : bad('5204 খাতে নিট ' + net5204.n + ' রয়ে গেছে');
  const diff = (await fundBal('GEN')) - balBefore;
  Math.abs(diff - 15000) < 0.01 ? ok('ফান্ড জের ফিরে এসেছে (+' + diff + ')')
                                : bad('জের ফেরেনি, পার্থক্য ' + diff);
  await expectFail('দ্বিতীয়বার রিভার্স',
    () => svc.reverse(big.id, 'আবার', principal), 'আগেই রিভার্স');
  await expectFail('রিভার্সালকে রিভার্স',
    () => svc.reverse(rev.reversal_id, 'পরীক্ষা', principal), 'আবার রিভার্স করা যায় না');
  await expectFail('হিসাবরক্ষকের রিভার্সাল',
    () => svc.reverse(pv.id, 'পরীক্ষা', accountant), 'প্রধান হিসাবরক্ষকের');

  console.log('\n── ১৬. পিরিয়ড লক ──');
  await pool.query(
    "UPDATE fiscal_periods SET status='locked', locked_by=1, locked_at=NOW() WHERE ? BETWEEN start_date AND end_date", [today]);
  await expectFail('বন্ধ পিরিয়ডে এন্ট্রি', () => svc.create({
    voucher_type: 'RV', voucher_date: today, payment_method: 'cash',
    lines: [
      { account_id: A['1101'], fund_id: F['GEN'], debit: 100, credit: 0 },
      { account_id: A['4204'], fund_id: F['GEN'], debit: 0, credit: 100 },
    ],
  }, principal), 'পিরিয়ড বন্ধ');
  await pool.query("UPDATE fiscal_periods SET status='open' WHERE ? BETWEEN start_date AND end_date", [today]);

  console.log('\n── ১৭. রিপোর্ট যাচাই ──');
  const [[tb]] = await pool.query('SELECT SUM(total_debit) d, SUM(total_credit) c FROM v_trial_balance');
  Math.abs(Number(tb.d) - Number(tb.c)) < 0.01
    ? ok('রেওয়ামিল মিলেছে — ডেবিট = ক্রেডিট = ' + Number(tb.d).toFixed(2))
    : bad('রেওয়ামিল মেলেনি: ' + tb.d + ' বনাম ' + tb.c);

  const [frows] = await pool.query(
    'SELECT code, name_bn, total_received, total_spent, available_balance FROM v_fund_available WHERE total_received <> 0 OR total_spent <> 0 ORDER BY code');
  console.log('\n  ফান্ড-ওয়ারি অবস্থা:');
  for (const f of frows) {
    console.log('    ' + f.code.padEnd(4) + ' ' + f.name_bn.padEnd(20) +
      ' আদায় ' + String(f.total_received).padStart(11) +
      ' | ব্যয় ' + String(f.total_spent).padStart(10) +
      ' | অবশিষ্ট ' + String(f.available_balance).padStart(11));
  }
  const zak = frows.find(f => f.code === 'ZAK');
  Math.abs(Number(zak.available_balance) - 19000) < 0.01
    ? ok('যাকাত ফান্ড সঠিক: 50,000 − 30,000 − 1,000 = 19,000')
    : bad('যাকাত জের ' + zak.available_balance + ', হওয়া উচিত 19000');

  // ব্যালেন্স শিট পরিচয়: সম্পদ − দায় = ফান্ড ব্যালেন্স (আয় − ব্যয় সহ)
  const [[bs]] = await pool.query(`
    SELECT
      SUM(CASE WHEN account_class='asset'     THEN total_debit - total_credit ELSE 0 END) assets,
      SUM(CASE WHEN account_class='liability' THEN total_credit - total_debit ELSE 0 END) liabilities,
      SUM(CASE WHEN account_class IN ('fund','income','expense')
               THEN total_credit - total_debit ELSE 0 END) funds
    FROM v_trial_balance`);
  const lhs = Number(bs.assets) - Number(bs.liabilities);
  Math.abs(lhs - Number(bs.funds)) < 0.01
    ? ok('স্থিতিপত্র মিলেছে: সম্পদ (' + bs.assets + ') − দায় (' + bs.liabilities + ') = ফান্ড (' + bs.funds + ')')
    : bad('স্থিতিপত্র মেলেনি: ' + lhs + ' বনাম ' + bs.funds);

  const [split] = await pool.query('SELECT * FROM v_fund_cash_split ORDER BY fund_code, account_code');
  console.log('\n  কোন ফান্ডের টাকা কোথায় আছে:');
  for (const s of split) {
    console.log('    ' + s.fund_code.padEnd(4) + ' ' + s.account_name.padEnd(28) + String(s.balance).padStart(11));
  }

  const genFinal = await fundBal('GEN');
  Math.abs(genFinal - 320000) < 0.01
    ? ok('রিভার্সালের পর সাধারণ ফান্ড আবার 320,000')
    : bad('সাধারণ ফান্ড জের ' + genFinal + ', হওয়া উচিত 320000');

  const [[al]] = await pool.query('SELECT COUNT(*) n FROM audit_logs');
  Number(al.n) > 0 ? ok('অডিট লগে ' + al.n + 'টি রেকর্ড') : bad('অডিট লগ খালি');

  const [[gap]] = await pool.query(`
    SELECT COUNT(*) n FROM vouchers v1
     WHERE v1.voucher_type='RV'
       AND NOT EXISTS (SELECT 1 FROM voucher_lines l WHERE l.voucher_id=v1.id)`);
  Number(gap.n) === 0 ? ok('লাইনবিহীন কোনো ভাউচার নেই') : bad(gap.n + 'টি ভাউচারে লাইন নেই');

  console.log('\n' + '─'.repeat(64) + '\nফলাফল:  ✅ ' + pass + ' পাস   ❌ ' + fail + ' ফেল\n');
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('\n💥 অপ্রত্যাশিত ত্রুটি:', e); process.exit(1); });

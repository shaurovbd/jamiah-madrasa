'use strict';
/** দাতা, প্রচারাভিযান, প্রতিশ্রুতি ও মাসিক পরিকল্পনার পরীক্ষা — আসল MySQL-এ */
const mysql = require('mysql2/promise');
const DonorService = require('./donor-service');
const ReceiptService = require('./receipt-service');
const { normalizeMobile } = DonorService;

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
  const donors = new DonorService(pool);
  const receipts = new ReceiptService(pool, { donorService: donors });

  const [accs] = await pool.query('SELECT id, code FROM accounts');
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  const [fs] = await pool.query('SELECT id, code FROM funds');
  const F = Object.fromEntries(fs.map((f) => [f.code, f.id]));
  const [rts] = await pool.query('SELECT id, code FROM receipt_types');
  const RT = Object.fromEntries(rts.map((t) => [t.code, t.id]));
  const [cmps] = await pool.query('SELECT id, code FROM campaigns');
  const C = Object.fromEntries(cmps.map((c) => [c.code, c.id]));

  const today = '2026-11-23';
  const ctx = { userId: 1, role: 'principal', ip: '127.0.0.1' };
  const chief = { userId: 3, role: 'chief_accountant', ip: '127.0.0.1' };

  const expectFail = async (label, fn, needle) => {
    try { await fn(); bad(label + ' — আটকায়নি!'); }
    catch (e) {
      const j = (e.errors || [e.message]).join(' | ');
      if (needle && j.indexOf(needle) < 0) bad(label + ' — অন্য কারণে: ' + j);
      else ok(label + ' → ' + (e.errors ? e.errors[0] : e.message));
    }
  };
  const give = (p) => receipts.issue(Object.assign({
    receipt_date: today, cash_account_id: A['1101'], payment_method: 'cash',
  }, p), ctx);

  // ================================================================
  console.log('\n── ১. মোবাইল নম্বর এক চেহারায় আনা ──');
  [['01711223344', '01711223344'], ['+8801711223344', '01711223344'],
   ['8801711223344', '01711223344'], ['0171-122 3344', '01711223344'],
   ['01711223344 ', '01711223344']].forEach(function (c) {
    normalizeMobile(c[0]) === c[1] ? ok(c[0] + ' → ' + c[1]) : bad(c[0] + ' → ' + normalizeMobile(c[0]));
  });
  eq('বিদেশি নম্বরও এক চেহারায়', normalizeMobile('+971501234567'), '971501234567');
  eq('একই বিদেশি নম্বর দুই চেহারায় মেলে',
     normalizeMobile('971 50 123 4567'), normalizeMobile('+971501234567'));

  // ================================================================
  console.log('\n── ২. রশিদ কাটলেই দাতা তৈরি হয় ──');
  const g1 = await give({
    receipt_type: 'ZAK', amount: 25000,
    payer_name: 'হাজী আব্দুল করিম', payer_mobile: '01711223344',
    district: 'কুমিল্লা', purpose_bn: '১৪৪৭ হিজরির যাকাত',
  });
  g1.donor_id && g1.donor_created ? ok('নতুন দাতা তৈরি হলো (আইডি ' + g1.donor_id + ')') : bad('দাতা তৈরি হয়নি');

  // একই নম্বর, ভিন্ন চেহারায় ও ভিন্ন বানানে
  const g2 = await give({
    receipt_type: 'DON', amount: 10000,
    payer_name: 'আব্দুল করিম সাহেব', payer_mobile: '+8801711223344',
    address: 'লাকসাম বাজার',
  });
  eq('একই নম্বরে একই দাতা', g2.donor_id, g1.donor_id);
  g2.donor_created === false ? ok('নতুন রেকর্ড তৈরি হয়নি') : bad('ডুপ্লিকেট তৈরি হয়েছে');

  const d1 = await donors.getDonor(g1.donor_id);
  eq('দাতার কোড', d1.donor.donor_code, 'DNR-00001');
  eq('মোট দান', d1.donor.total_given, 35000);
  eq('দানের সংখ্যা', d1.donor.gift_count, 2);
  eq('নাম প্রথমবারের টাই থাকে', d1.donor.name, 'হাজী আব্দুল করিম');
  eq('খালি ঘর ভরে গেছে (ঠিকানা)', d1.donor.address, 'লাকসাম বাজার');
  eq('প্রথমবারের জেলা অপরিবর্তিত', d1.donor.district, 'কুমিল্লা');
  d1.byType.length === 2 ? ok('ধরন অনুযায়ী ভাগ: ' + d1.byType.map((t) => t.type_name).join(', '))
                         : bad('ধরন ভাগ ভুল');

  console.log('\n── ৩. ফি ও ঋণের রশিদে দাতা তৈরি হয় না ──');
  const gf = await give({
    receipt_type: 'FEE', amount: 1200, payer_name: 'অভিভাবক সাহেব',
    payer_mobile: '01999888777', student_id: 1,
  });
  gf.donor_id === null ? ok('শিক্ষার্থী ফিতে দাতা রেকর্ড হয়নি (CRM পরিষ্কার থাকে)')
                       : bad('ফি রশিদে দাতা তৈরি হয়েছে');

  // ================================================================
  console.log('\n── ৪. প্রচারাভিযান ──');
  const cg = await give({
    receipt_type: 'CON', amount: 500000,
    payer_name: 'প্রবাসী দাতা — আবু বকর', payer_mobile: '+971501234567',
    country: 'সংযুক্ত আরব আমিরাত', is_expatriate: true,
    campaign_id: C['BUILD-2026'], cash_account_id: A['1111'], payment_method: 'bank',
  });
  const cp = await donors.getCampaign(C['BUILD-2026']);
  eq('সংগৃহীত', cp.campaign.raised, 500000);
  eq('অগ্রগতি %', cp.campaign.pct, 10);
  eq('দাতার সংখ্যা', cp.campaign.donor_count, 1);
  eq('বাকি', cp.campaign.remaining, 4500000);
  cp.campaign.days_left > 0 ? ok('দিন বাকি: ' + cp.campaign.days_left) : bad('দিন হিসাব ভুল');

  // ফান্ড না মিললে
  await expectFail('যাকাতের রশিদ নির্মাণ প্রচারাভিযানে', () => give({
    receipt_type: 'ZAK', amount: 1000, payer_name: 'ক',
    campaign_id: C['BUILD-2026'],
  }), 'ফান্ডের সাথে মেলে না');

  // অনুদানে ফান্ড বদল চলে, তাই ক্যাম্পেইনের ফান্ডই বসে
  const cg2 = await give({
    receipt_type: 'DON', amount: 25000, payer_name: 'জনাব সালাম',
    payer_mobile: '01811111111', campaign_id: C['BUILD-2026'],
  });
  const [[cgRow]] = await pool.query(
    `SELECT f.code FROM receipts r JOIN funds f ON f.id=r.fund_id WHERE r.id=?`, [cg2.id]);
  eq('ক্যাম্পেইনের ফান্ড (নির্মাণ) বসেছে', cgRow.code, 'CON');

  const [[closed]] = await pool.query(`SELECT id FROM campaigns WHERE code='IFTAR-1447'`);
  await pool.query(`UPDATE campaigns SET status='closed' WHERE id=?`, [closed.id]);
  await expectFail('বন্ধ প্রচারাভিযানে রশিদ', () => give({
    receipt_type: 'IFT', amount: 12000, payer_name: 'খ', campaign_id: closed.id,
  }), 'সক্রিয় নয়');
  await pool.query(`UPDATE campaigns SET status='active' WHERE id=?`, [closed.id]);

  // ================================================================
  console.log('\n── ৫. প্রতিশ্রুতি: ৫০ হাজারের কথা, ২০ হাজার এসেছে ──');
  const pl = await donors.createPledge({
    donor_id: g1.donor_id, campaign_id: C['WINTER-2026'],
    fund_id: F['ORP'], amount: 50000, pledged_date: '2026-11-01',
    due_date: '2026-11-30', purpose_bn: 'শীতবস্ত্রের জন্য',
  }, ctx);
  eq('প্রতিশ্রুতির অবস্থা', pl.status, 'open');
  eq('বাকি', pl.outstanding, 50000);

  const p1 = await give({
    receipt_type: 'ORP', amount: 20000, payer_name: 'হাজী আব্দুল করিম',
    donor_id: g1.donor_id, pledge_id: pl.pledge_id,
  });
  const [[ps1]] = await pool.query(`SELECT * FROM v_pledge_status WHERE pledge_id=?`, [pl.pledge_id]);
  eq('আংশিক পরিশোধ', ps1.status, 'partial');
  eq('এসেছে', ps1.received, 20000);
  eq('বাকি', ps1.outstanding, 30000);

  await expectFail('অন্য দাতার প্রতিশ্রুতিতে জমা', () => give({
    receipt_type: 'ORP', amount: 1000, payer_name: 'জনাব সালাম',
    payer_mobile: '01811111111', pledge_id: pl.pledge_id,
  }), 'অন্য দাতার');

  const p2 = await give({
    receipt_type: 'ORP', amount: 30000, payer_name: 'হাজী আব্দুল করিম',
    donor_id: g1.donor_id, pledge_id: pl.pledge_id,
  });
  const [[ps2]] = await pool.query(`SELECT * FROM v_pledge_status WHERE pledge_id=?`, [pl.pledge_id]);
  eq('পূর্ণ হয়েছে', ps2.status, 'fulfilled');
  eq('বাকি শূন্য', ps2.outstanding, 0);

  await expectFail('পূর্ণ প্রতিশ্রুতিতে আবার জমা', () => give({
    receipt_type: 'ORP', amount: 500, payer_name: 'হাজী আব্দুল করিম',
    donor_id: g1.donor_id, pledge_id: pl.pledge_id,
  }), 'আগেই পূর্ণ');
  await expectFail('পূর্ণ প্রতিশ্রুতি বাতিল',
    () => donors.cancelPledge(pl.pledge_id, 'পরীক্ষা', ctx), 'পূর্ণ হওয়া');

  // বাতিল করলে প্রতিশ্রুতি আবার আংশিকে ফিরবে
  await receipts.void(p2.id, 'দাতা পরে দেবেন বলেছেন', chief);
  const [[ps3]] = await pool.query(`SELECT * FROM v_pledge_status WHERE pledge_id=?`, [pl.pledge_id]);
  eq('রশিদ বাতিলের পর আবার আংশিক', ps3.status, 'partial');
  eq('এসেছে আবার 20,000', ps3.received, 20000);

  console.log('\n── ৬. ফলো-আপ তালিকা ──');
  const fu = await donors.pledgeFollowUps();
  fu.length === 1 && fu[0].outstanding === 30000
    ? ok('বাকি থাকা প্রতিশ্রুতি তালিকায় এসেছে (' + fu[0].donor_name + ', বাকি ' + fu[0].outstanding + ')')
    : bad('ফলো-আপ তালিকা ভুল: ' + JSON.stringify(fu.map((x) => x.outstanding)));
  const rem = await donors.markReminded(pl.pledge_id, ctx);
  eq('রিমাইন্ডার গণনা', rem.reminder_count, 1);

  const plOld = await donors.createPledge({
    donor_id: g1.donor_id, fund_id: F['SAD'], amount: 5000,
    pledged_date: '2026-09-01', due_date: '2026-09-30', purpose_bn: 'মেয়াদ পেরোনো',
  }, ctx);
  const over = await donors.pledgeFollowUps({ overdue: true });
  over.length === 1 && over[0].pledge_id === plOld.pledge_id
    ? ok('মেয়াদ পেরোনো ফিল্টার কাজ করছে (' + over[0].days_to_due + ' দিন)')
    : bad('overdue ফিল্টার ভুল: ' + over.length);

  // যোগাযোগ করতে চান না বললে তালিকায় আসবেন না
  await donors.updateDonor(g1.donor_id, { allow_contact: false }, ctx);
  (await donors.pledgeFollowUps()).length === 0
    ? ok('যোগাযোগে অসম্মত দাতা ফলো-আপে আসেন না') : bad('অসম্মত দাতা তালিকায় এসেছেন');
  await donors.updateDonor(g1.donor_id, { allow_contact: true }, ctx);

  // ================================================================
  console.log('\n── ৭. মাসিক নিয়মিত দাতা ──');
  const plan = await donors.createRecurring({
    donor_id: g1.donor_id, receipt_type_id: RT['ORP'], fund_id: F['ORP'],
    amount: 3000, day_of_month: 5, start_date: '2026-01-01',
    note_bn: 'এক এতিমের মাসিক খরচ',
  }, ctx);
  ok('মাসিক পরিকল্পনা তৈরি (প্রতি মাসের ৫ তারিখ, Tk 3,000)');

  const due1 = await donors.recurringDue('2026-11-10');
  due1.rows.length === 1 && due1.rows[0].plan_id === plan.id
    ? ok('১০ নভেম্বর: বাকি আছে (' + due1.rows[0].days_overdue + ' দিন দেরি)')
    : bad('বাকি তালিকা ভুল: ' + due1.rows.length);

  const due0 = await donors.recurringDue('2026-11-03');
  due0.rows.length === 0 ? ok('৩ নভেম্বর: এখনো তারিখ আসেনি, তালিকায় নেই') : bad('তারিখের আগেই দেখাচ্ছে');

  await give({
    receipt_type: 'ORP', amount: 3000, payer_name: 'হাজী আব্দুল করিম',
    donor_id: g1.donor_id, recurring_plan_id: plan.id, receipt_date: '2026-11-05',
  });
  (await donors.recurringDue('2026-11-10')).rows.length === 0
    ? ok('এ মাসের টাকা এসে গেছে, আর বাকি নেই') : bad('জমা দেওয়ার পরেও বাকি দেখাচ্ছে');
  (await donors.recurringDue('2026-12-10')).rows.length === 1
    ? ok('পরের মাসে আবার বাকি দেখাচ্ছে') : bad('পরের মাসে দেখায়নি');

  await donors.setRecurringStatus(plan.id, 'paused', ctx);
  (await donors.recurringDue('2026-12-10')).rows.length === 0
    ? ok('স্থগিত পরিকল্পনা বাকির তালিকায় নেই') : bad('স্থগিত পরিকল্পনা দেখাচ্ছে');
  await donors.setRecurringStatus(plan.id, 'active', ctx);

  // ================================================================
  console.log('\n── ৮. নিষ্ক্রিয় দাতা (lapsed) ──');
  const oldD = await donors.upsertDonor({ name: 'পুরনো দাতা — মোঃ ইউসুফ', mobile: '01555000111' }, ctx);
  await give({
    receipt_type: 'DON', amount: 40000, donor_id: oldD.id,
    payer_name: 'পুরনো দাতা — মোঃ ইউসুফ', receipt_date: '2026-02-15',
  });
  const quiet = await donors.upsertDonor({ name: 'অসম্মত দাতা', mobile: '01555000222' }, ctx);
  await give({
    receipt_type: 'DON', amount: 9000, donor_id: quiet.id,
    payer_name: 'অসম্মত দাতা', receipt_date: '2026-01-10',
  });
  await donors.updateDonor(quiet.id, { allow_contact: false }, ctx);

  const lap = await donors.lapsedDonors({ months: 6 });
  const names = lap.rows.map((r) => r.name);
  names.indexOf('পুরনো দাতা — মোঃ ইউসুফ') >= 0
    ? ok('৯ মাস আগে দেওয়া দাতা তালিকায় (মাস: ' +
        lap.rows.find((r) => r.name.indexOf('ইউসুফ') >= 0).months_since_last + ')')
    : bad('নিষ্ক্রিয় দাতা পাওয়া যায়নি');
  names.indexOf('হাজী আব্দুল করিম') < 0
    ? ok('সদ্য দেওয়া দাতা তালিকায় নেই') : bad('সক্রিয় দাতা তালিকায় এসেছেন');
  names.indexOf('অসম্মত দাতা') < 0
    ? ok('যোগাযোগে অসম্মত দাতা বাদ পড়েছেন') : bad('অসম্মত দাতা তালিকায়');
  (await donors.lapsedDonors({ months: 6, minTotal: 50000 })).rows.length === 0
    ? ok('ন্যূনতম দানের ফিল্টার কাজ করছে') : bad('minTotal ফিল্টার ভুল');

  // ================================================================
  console.log('\n── ৯. রিপোর্ট ──');
  const top = await donors.topDonors({ limit: 5 });
  top.length && Number(top[0].total_given) >= Number(top[top.length - 1].total_given)
    ? ok('টপ দাতা অবরোহী ক্রমে: ' + top.slice(0, 3).map((t) =>
        t.name.slice(0, 14) + ' (' + t.total_given + ')').join(', '))
    : bad('টপ দাতার ক্রম ভুল');

  const area = await donors.areaReport();
  area.some((a) => Number(a.is_expatriate) === 1)
    ? ok('প্রবাসী দাতা আলাদা করে দেখা যাচ্ছে') : bad('প্রবাসী ভাগ নেই');

  const tr = await donors.monthlyTrend(2026);
  tr.rows.length >= 2 && tr.rows.some((r) => Number(r.this_year) > 0)
    ? ok('মাস-ওয়ারি তুলনা: ' + tr.rows.filter((r) => Number(r.this_year) > 0)
        .map((r) => r.mn + 'মাস=' + r.this_year).join(', '))
    : bad('মাসিক তুলনা ভুল');

  const st = await donors.statement(g1.donor_id, { from: '2026-01-01', to: '2026-12-31' });
  st && st.rows.length > 0 ? ok('বার্ষিক বিবরণী: ' + st.rows.length + 'টি দান, মোট ' + st.total)
                           : bad('বিবরণী ব্যর্থ');
  st.total_in_words && st.total_in_words.indexOf('টাকা') > 0
    ? ok('বিবরণীতে টাকা কথায়: ' + st.total_in_words) : bad('কথায় নেই');
  st.byFund.length > 0 ? ok('ফান্ড অনুযায়ী ভাগ: ' + st.byFund.map((b) => b.fund_name).join(', '))
                       : bad('ফান্ড ভাগ নেই');

  // ================================================================
  console.log('\n── ১০. ডুপ্লিকেট দাতা একীভূত করা ──');
  const dupA = await donors.upsertDonor({ name: 'মোঃ রফিকুল ইসলাম', district: 'ঢাকা' }, ctx);
  const dupB = await donors.upsertDonor({ name: 'রফিকুল ইসলাম', mobile: '01777666555' }, ctx);
  await give({ receipt_type: 'DON', amount: 5000, donor_id: dupA.id, payer_name: 'মোঃ রফিকুল ইসলাম' });
  await give({ receipt_type: 'DON', amount: 7000, donor_id: dupB.id, payer_name: 'রফিকুল ইসলাম' });

  const mg = await donors.mergeDonors(dupA.id, dupB.id, ctx);
  eq('সরানো রশিদের সংখ্যা', mg.moved_receipts, 1);
  eq('সরানো টাকা', mg.moved_amount, 7000);
  const merged = await donors.getDonor(dupA.id);
  eq('একীভূত করার পর মোট', merged.donor.total_given, 12000);
  eq('মোবাইল নম্বরটি রাখা রেকর্ডে এসেছে', merged.donor.mobile, '01777666555');
  const [[goneRow]] = await pool.query(`SELECT mobile, is_active, merged_into_id FROM donors WHERE id=?`, [dupB.id]);
  goneRow.merged_into_id === dupA.id && !goneRow.is_active && goneRow.mobile === null
    ? ok('পুরনো রেকর্ড মুছে না গিয়ে চিহ্নিত হয়েছে (ইতিহাস থাকে)') : bad('একীভূত চিহ্ন ভুল');

  // এখন ওই নম্বরে রশিদ কাটলে রাখা দাতার সাথেই যুক্ত হবে
  const after = await give({
    receipt_type: 'DON', amount: 2000,
    payer_name: 'রফিকুল ইসলাম', payer_mobile: '01777666555',
  });
  eq('একীভূত নম্বরে নতুন দান রাখা দাতার নামে', after.donor_id, dupA.id);
  await expectFail('একীভূত দাতাকে আবার একীভূত',
    () => donors.mergeDonors(dupA.id, dupB.id, ctx), 'আগেই একীভূত');
  await expectFail('নিজের সাথে একীভূত',
    () => donors.mergeDonors(dupA.id, dupA.id, ctx), 'নিজের সাথে');

  (await donors.searchDonors({ q: 'রফিক' })).length === 1
    ? ok('খোঁজায় একীভূত রেকর্ড আর দেখায় না') : bad('একীভূত রেকর্ড খোঁজায় আসছে');
  (await donors.searchDonors({ q: '01711' })).length === 1
    ? ok('মোবাইল দিয়ে খোঁজা যায়') : bad('মোবাইল খোঁজা ব্যর্থ');

  // ================================================================
  console.log('\n── ১১. হিসাবের মিল ──');
  const [[tb]] = await pool.query('SELECT SUM(total_debit) d, SUM(total_credit) c FROM v_trial_balance');
  Math.abs(Number(tb.d) - Number(tb.c)) < 0.01
    ? ok('রেওয়ামিল মিলেছে — ' + Number(tb.d).toFixed(2)) : bad('মেলেনি: ' + tb.d + '/' + tb.c);
  const [[m]] = await pool.query(
    `SELECT (SELECT COALESCE(SUM(amount),0) FROM receipts WHERE status='issued' AND donor_id IS NOT NULL) a,
            (SELECT COALESCE(SUM(total_given),0) FROM v_donor_summary WHERE merged_into_id IS NULL) b`);
  Math.abs(Number(m.a) - Number(m.b)) < 0.01
    ? ok('দাতাভিত্তিক মোট = রশিদের মোট (' + Number(m.a).toFixed(2) + ')')
    : bad('মিলছে না: ' + m.a + ' / ' + m.b);
  const [[orphanR]] = await pool.query(
    `SELECT COUNT(*) n FROM receipts r LEFT JOIN donors d ON d.id=r.donor_id
      WHERE r.donor_id IS NOT NULL AND d.id IS NULL`);
  eq('দাতাবিহীন donor_id নেই', orphanR.n, 0);

  console.log('\n' + '─'.repeat(64) + '\nফলাফল:  ✅ ' + pass + ' পাস   ❌ ' + fail + ' ফেল\n');
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('\n💥', e); process.exit(1); });

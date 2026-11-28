'use strict';
/** দাতা মডিউলের রাউট, পেজ ও বার্ষিক বিবরণীর পরীক্ষা */
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const donorRouter = require('./routes/donors');
const receipts = require('./routes/receipts');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  ✅', m); };
const bad = (m) => { fail++; console.log('  ❌', m); };
const has = (l, html, n) => (html.indexOf(n) >= 0 ? ok(l) : bad(l + ' — নেই: ' + n));
const hasNot = (l, html, n) => (html.indexOf(n) < 0 ? ok(l) : bad(l + ' — থাকা উচিত নয়: ' + n));
const eq = (l, got, want) => (String(got) === String(want) ? ok(l) : bad(l + ' — ' + got + ' ≠ ' + want));

async function main() {
  const pool = mysql.createPool({
    host: '127.0.0.1', user: 'jamiah', password: 'test_pw_local',
    database: 'jamiah', decimalNumbers: true, connectionLimit: 5,
  });
  const actor = () => ({ userId: 1, role: 'principal', ip: '127.0.0.1' });
  const app = express();
  app.use('/css', express.static(path.join(__dirname, 'public/css')));
  app.use('/js', express.static(path.join(__dirname, 'public/js')));
  app.get('/js/bangla-number.js', (req, res) =>
    res.type('application/javascript').sendFile(path.join(__dirname, 'lib/bangla-number.js')));
  app.use('/admin/donors', donorRouter({ pool, getActor: actor }));
  app.use('/admin/receipts', receipts.admin({ pool, getActor: actor }));

  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const text = async (p) => { const r = await fetch(base + p); return { status: r.status, html: await r.text() }; };
  const json = async (p) => (await fetch(base + p)).json();
  const post = async (p, b, m) => {
    const r = await fetch(base + p, {
      method: m || 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b || {}),
    });
    return { status: r.status, body: await r.json() };
  };

  const today = '2026-11-23';
  const meta0 = await json('/admin/receipts/api/meta');
  const cash = meta0.cashAccounts.find((a) => a.code === '1101').id;
  const bank = meta0.cashAccounts.find((a) => a.code === '1111').id;
  const campBuild = meta0.campaigns.find((c) => c.code === 'BUILD-2026');

  const give = (p) => post('/admin/receipts/api/receipts', Object.assign({
    receipt_date: today, cash_account_id: cash, payment_method: 'cash',
  }, p));

  // ================================================================
  console.log('\n── ক. রশিদের ফর্মে প্রচারাভিযান ──');
  meta0.campaigns && meta0.campaigns.length >= 3
    ? ok('রশিদের meta-তে সক্রিয় প্রচারাভিযান (' + meta0.campaigns.length + 'টি)')
    : bad('প্রচারাভিযান নেই');
  campBuild && campBuild.fund_code === 'CON'
    ? ok('প্রচারাভিযানের ফান্ডও এসেছে (' + campBuild.fund_code + ')') : bad('ফান্ড নেই');
  const rform = await text('/admin/receipts/new?type=DON');
  has('ফর্মে প্রচারাভিযানের ঘর', rform.html, 'campaignId');
  has('ফর্মে প্রসঙ্গ দেখানোর জায়গা', rform.html, 'rContext');

  // ================================================================
  console.log('\n── খ. দাতা তৈরি ও পেজ ──');
  const g1 = await give({
    receipt_type: 'ZAK', amount: 60000,
    payer_name: 'হাজী আব্দুল করিম', payer_mobile: '01711223344', district: 'কুমিল্লা',
  });
  const donorId = g1.body.donor_id;
  donorId ? ok('রশিদ থেকে দাতা তৈরি (আইডি ' + donorId + ')') : bad('দাতা তৈরি হয়নি');

  const g2 = await give({
    receipt_type: 'CON', amount: 450000, cash_account_id: bank, payment_method: 'bank',
    payer_name: 'প্রবাসী দাতা — আবু বকর', payer_mobile: '+971501234567',
    country: 'সংযুক্ত আরব আমিরাত', is_expatriate: true, campaign_id: campBuild.id,
  });
  g2.body.campaign_id === campBuild.id ? ok('প্রচারাভিযানের সাথে যুক্ত হয়েছে') : bad('ক্যাম্পেইন যুক্ত হয়নি');

  for (const [p, needle, label] of [
    ['/admin/donors', 'দাতার তালিকা', 'দাতা তালিকা পেজ'],
    ['/admin/donors/campaigns', 'campaignBox', 'প্রচারাভিযান পেজ'],
    ['/admin/donors/followups', 'tabBox', 'ফলো-আপ পেজ'],
    ['/admin/donors/reports', 'reportBox', 'রিপোর্ট পেজ'],
  ]) {
    const r = await text(p);
    r.status === 200 ? has(label, r.html, needle) : bad(label + ' — HTTP ' + r.status);
  }

  const prof = await text('/admin/donors/d/' + donorId);
  has('প্রোফাইল পেজ: নাম', prof.html, 'হাজী আব্দুল করিম');
  has('প্রোফাইলে দানের ইতিহাস', prof.html, 'দানের ইতিহাস');
  has('প্রোফাইলে মোট দান', prof.html, 'মোট দান');
  has('প্রোফাইলে বার্ষিক বিবরণীর লিংক', prof.html, '/statement');
  const prof404 = await text('/admin/donors/d/999999');
  prof404.status === 404 ? ok('অস্তিত্বহীন দাতায় ৪০৪') : bad('HTTP ' + prof404.status);

  const meta = await json('/admin/donors/api/meta');
  meta.ok && Number(meta.totals.donors) === 2
    ? ok('meta-তে মোট দাতা ২ জন') : bad('দাতা: ' + JSON.stringify(meta.totals));
  Number(meta.totals.expats) === 1 ? ok('প্রবাসী গণনা ঠিক') : bad('প্রবাসী: ' + meta.totals.expats);
  meta.districts.indexOf('কুমিল্লা') >= 0 ? ok('জেলার তালিকা এসেছে') : bad('জেলা নেই');

  const list = await json('/admin/donors/api/donors?sort=total');
  list.rows.length === 2 && Number(list.rows[0].total_given) >= Number(list.rows[1].total_given)
    ? ok('তালিকা মোট দান অনুযায়ী সাজানো') : bad('সাজানো ভুল');
  (await json('/admin/donors/api/donors?q=01711')).rows.length === 1
    ? ok('মোবাইল দিয়ে খোঁজা যায়') : bad('খোঁজা ব্যর্থ');
  (await json('/admin/donors/api/donors?expat=true')).rows.length === 1
    ? ok('প্রবাসী ফিল্টার কাজ করছে') : bad('প্রবাসী ফিল্টার ভুল');

  // ================================================================
  console.log('\n── গ. প্রচারাভিযান ──');
  const camps = await json('/admin/donors/api/campaigns');
  const cb = camps.rows.find((c) => c.code === 'BUILD-2026');
  eq('সংগৃহীত', cb.raised, 450000);
  eq('অগ্রগতি %', cb.pct, 9);
  const cdetail = await text('/admin/donors/campaigns/' + cb.campaign_id);
  has('প্রচারাভিযানের পেজ', cdetail.html, 'd-prog-fill');
  has('প্রগ্রেস শতকরা', cdetail.html, 'অগ্রগতি' in {} ? '' : 'd-prog-label');
  has('সাম্প্রতিক অনুদানে দাতার লিংক', cdetail.html, '/admin/donors/d/');

  const nc = await post('/admin/donors/api/campaigns', {
    code: 'TUBEWELL-2027', title_bn: 'গভীর নলকূপ স্থাপন',
    fund_id: meta.funds.find((f) => f.code === 'SAD').id,
    target_amount: 180000, end_date: '2027-06-30', is_public: true,
  });
  nc.status === 201 && nc.body.campaign.code === 'TUBEWELL-2027'
    ? ok('নতুন প্রচারাভিযান তৈরি') : bad(JSON.stringify(nc.body));
  const upd = await post('/admin/donors/api/campaigns/' + nc.body.campaign.campaign_id,
    { target_amount: 200000 }, 'PATCH');
  eq('লক্ষ্য হালনাগাদ', upd.body.campaign.target_amount, 200000);

  // ================================================================
  console.log('\n── ঘ. প্রতিশ্রুতি ও ফলো-আপ ──');
  const pl = await post('/admin/donors/api/pledges', {
    donor_id: donorId, fund_id: meta.funds.find((f) => f.code === 'ORP').id,
    amount: 50000, pledged_date: '2026-11-01', due_date: '2026-11-10',
    purpose_bn: 'শীতবস্ত্রের জন্য',
  });
  pl.status === 201 ? ok('প্রতিশ্রুতি তৈরি: ' + pl.body.amount) : bad(JSON.stringify(pl.body));

  await give({
    receipt_type: 'ORP', amount: 20000, donor_id: donorId,
    payer_name: 'হাজী আব্দুল করিম', pledge_id: pl.body.pledge_id,
  });
  const fu = await json('/admin/donors/api/pledges');
  fu.rows.length === 1 && Number(fu.rows[0].outstanding) === 30000
    ? ok('ফলো-আপে বাকি ৩০,০০০ দেখাচ্ছে') : bad(JSON.stringify(fu.rows.map((r) => r.outstanding)));
  const over = await json('/admin/donors/api/pledges?overdue=true');
  over.rows.length === 1 ? ok('মেয়াদ পেরোনো ফিল্টার কাজ করছে') : bad('overdue: ' + over.rows.length);

  const rem = await post('/admin/donors/api/pledges/' + pl.body.pledge_id + '/remind', {});
  eq('রিমাইন্ডার গণনা', rem.body.reminder_count, 1);
  const cancelFail = await post('/admin/donors/api/pledges/' + pl.body.pledge_id + '/cancel', {});
  cancelFail.status === 422 ? ok('কারণ ছাড়া বাতিল আটকেছে') : bad('HTTP ' + cancelFail.status);

  // ================================================================
  console.log('\n── ঙ. মাসিক পরিকল্পনা ──');
  const plan = await post('/admin/donors/api/recurring', {
    donor_id: donorId, receipt_type_id: meta.receiptTypes.find((t) => t.code === 'ORP').id,
    fund_id: meta.funds.find((f) => f.code === 'ORP').id,
    amount: 3000, day_of_month: 5, start_date: '2026-01-01',
  });
  plan.status === 201 ? ok('মাসিক পরিকল্পনা তৈরি') : bad(JSON.stringify(plan.body));
  const due = await json('/admin/donors/api/recurring/due?date=2026-11-20');
  due.rows.length === 1 && Number(due.rows[0].days_overdue) === 15
    ? ok('২০ নভেম্বর: ১৫ দিন দেরি দেখাচ্ছে') : bad(JSON.stringify(due.rows));
  due.rows[0].type_code === 'ORP'
    ? ok('রশিদ কাটার লিংকের জন্য ধরনের কোড এসেছে') : bad('type_code নেই');

  const paused = await post('/admin/donors/api/recurring/' + plan.body.id + '/status',
    { status: 'paused' });
  eq('স্থগিত করা হলো', paused.body.status, 'paused');
  (await json('/admin/donors/api/recurring/due?date=2026-11-20')).rows.length === 0
    ? ok('স্থগিত পরিকল্পনা আর বাকিতে নেই') : bad('স্থগিত তবু দেখাচ্ছে');

  // ================================================================
  console.log('\n── চ. বার্ষিক বিবরণী (প্রিন্টযোগ্য) ──');
  const st = await text('/admin/donors/d/' + donorId + '/statement?from=2026-01-01&to=2026-12-31');
  has('বিবরণীর শিরোনাম', st.html, 'অনুদানের বার্ষিক বিবরণী');
  has('দাতার নাম', st.html, 'হাজী আব্দুল করিম');
  has('মোট টাকা কথায়', st.html, 'আশি হাজার টাকা মাত্র');
  has('বাংলা অঙ্কে মোট', st.html, '৮০,০০০.০০');
  has('ফান্ড অনুযায়ী ভাগ', st.html, 'আপনার দান যে খাতে ব্যবহৃত হয়েছে');
  has('কৃতজ্ঞতার বার্তা', st.html, 'জাযাকাল্লাহু খাইরান');
  has('স্বাক্ষরের ঘর', st.html, 'মুহতামিম');
  hasNot('বিবরণীতে বাতিল রশিদ নেই', st.html, 'বাতিল');

  const stj = await json('/admin/donors/api/donors/' + donorId + '/statement?from=2026-01-01&to=2026-12-31');
  eq('API-তে মোট', stj.total, 80000);
  eq('API-তে কথায়', stj.total_in_words, 'আশি হাজার টাকা মাত্র');

  // ================================================================
  console.log('\n── ছ. রিপোর্ট API ──');
  const top = await json('/admin/donors/api/reports/top?limit=5');
  top.rows.length === 2 && top.rows[0].name.indexOf('আবু বকর') >= 0
    ? ok('টপ দাতা: ' + top.rows[0].name + ' (' + top.rows[0].total_given + ')')
    : bad('টপ দাতা ভুল: ' + JSON.stringify(top.rows.map((r) => r.name)));
  const area = await json('/admin/donors/api/reports/area');
  area.rows.some((a) => Number(a.is_expatriate) === 1)
    ? ok('এলাকা রিপোর্টে প্রবাসী আলাদা') : bad('প্রবাসী ভাগ নেই');
  const mon = await json('/admin/donors/api/reports/monthly?year=2026');
  mon.rows.some((r) => Number(r.this_year) > 0)
    ? ok('মাস-ওয়ারি রিপোর্ট এসেছে') : bad('মাসিক রিপোর্ট খালি');
  const lap = await json('/admin/donors/api/lapsed?months=1');
  lap.ok ? ok('নিষ্ক্রিয় দাতার API চলছে (' + lap.rows.length + 'জন, ' + lap.months + ' মাস)')
         : bad('lapsed API ব্যর্থ');

  // ================================================================
  console.log('\n── জ. দাতা একীভূত করা (API) ──');
  const dupA = await post('/admin/donors/api/donors', { name: 'মোঃ রফিকুল ইসলাম', district: 'ঢাকা' });
  const dupB = await post('/admin/donors/api/donors', { name: 'রফিকুল ইসলাম', mobile: '01777666555' });
  await give({ receipt_type: 'DON', amount: 7000, donor_id: dupB.body.id, payer_name: 'রফিকুল ইসলাম' });
  const mg = await post('/admin/donors/api/donors/merge',
    { keep_id: dupA.body.id, merge_id: dupB.body.id });
  mg.body.ok && Number(mg.body.moved_amount) === 7000
    ? ok('একীভূত: ' + mg.body.moved_receipts + 'টি রশিদ, ' + mg.body.moved_amount + ' টাকা সরেছে')
    : bad(JSON.stringify(mg.body));
  const mergedProf = await text('/admin/donors/d/' + dupB.body.id);
  has('একীভূত রেকর্ডে মূল রেকর্ডের লিংক', mergedProf.html, 'মূল রেকর্ড দেখুন');

  const patch = await post('/admin/donors/api/donors/' + dupA.body.id,
    { recognition_tier: 'জীবনসদস্য', notes_bn: 'স্থানীয় ব্যবসায়ী' }, 'PATCH');
  patch.body.donor.recognition_tier === 'জীবনসদস্য'
    ? ok('দাতার তথ্য সম্পাদনা হয়েছে') : bad(JSON.stringify(patch.body.donor && patch.body.donor.recognition_tier));
  has('প্রোফাইলে স্বীকৃতি দেখাচ্ছে', (await text('/admin/donors/d/' + dupA.body.id)).html, 'জীবনসদস্য');

  // ================================================================
  console.log('\n── ঝ. হিসাবের মিল ──');
  const [[tb]] = await pool.query('SELECT SUM(total_debit) d, SUM(total_credit) c FROM v_trial_balance');
  Math.abs(Number(tb.d) - Number(tb.c)) < 0.01
    ? ok('রেওয়ামিল মিলেছে — ' + Number(tb.d).toFixed(2)) : bad('মেলেনি');
  const [[cmp]] = await pool.query(
    `SELECT (SELECT COALESCE(SUM(raised),0) FROM v_campaign_progress) a,
            (SELECT COALESCE(SUM(amount),0) FROM receipts
              WHERE status='issued' AND campaign_id IS NOT NULL) b`);
  Math.abs(Number(cmp.a) - Number(cmp.b)) < 0.01
    ? ok('প্রচারাভিযানের সংগ্রহ = ক্যাম্পেইন-ট্যাগ করা রশিদের মোট') : bad(cmp.a + ' ≠ ' + cmp.b);

  console.log('\n' + '─'.repeat(64) + '\nফলাফল:  ✅ ' + pass + ' পাস   ❌ ' + fail + ' ফেল\n');
  server.close();
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('\n💥', e); process.exit(1); });

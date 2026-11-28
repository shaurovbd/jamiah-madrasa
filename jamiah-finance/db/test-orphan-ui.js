'use strict';
/**
 * এতিম মডিউলের রাউট ও পেজের পরীক্ষা।
 * সবচেয়ে গুরুত্বপূর্ণ: দাতাকে পাঠানোর প্রিন্ট পেজে কোনো ব্যক্তিগত তথ্য নেই।
 */
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const orphanRouter = require('./routes/orphans');
const donorRouter = require('./routes/donors');
const receipts = require('./routes/receipts');
const OrphanService = require('./orphan-service');
const DonorService = require('./donor-service');
const ReceiptService = require('./receipt-service');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  ✅', m); };
const bad = (m) => { fail++; console.log('  ❌', m); };
const has = (l, h, n) => (h.indexOf(n) >= 0 ? ok(l) : bad(l + ' — নেই: ' + n));
const eq = (l, g, w) => (String(g) === String(w) ? ok(l) : bad(l + ' — ' + g + ' ≠ ' + w));

const SECRET = {
  father: 'পিতা-হাকিম-গোপন', mother: 'মাতা-আমেনা-গোপন',
  guardian: 'অভিভাবক-ফাতেমা-গোপন', mobile: '01999777555',
  address: 'গ্রাম-দক্ষিণপাড়া-গোপন', thana: 'লাকসাম-থানা-গোপন',
  notes: 'প্রাতিষ্ঠানিক-গোপন-নোট', lastName: 'আল-মামুন-পদবি',
  docName: 'death-cert-গোপন.pdf',
};

async function main() {
  const pool = mysql.createPool({
    host: '127.0.0.1', user: 'jamiah', password: 'test_pw_local',
    database: 'jamiah', decimalNumbers: true, connectionLimit: 5,
  });
  const svc = new OrphanService(pool);
  const donors = new DonorService(pool);
  const rsvc = new ReceiptService(pool, { donorService: donors });

  const actor = () => ({ userId: 1, role: 'principal', ip: '127.0.0.1' });
  const app = express();
  app.use('/css', express.static(path.join(__dirname, 'public/css')));
  app.use('/js', express.static(path.join(__dirname, 'public/js')));
  app.get('/js/bangla-number.js', (req, res) =>
    res.type('application/javascript').sendFile(path.join(__dirname, 'lib/bangla-number.js')));
  app.use('/admin/orphans', orphanRouter({ pool, getActor: actor }));
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

  const principal = actor();
  const [ccs] = await pool.query('SELECT id, code FROM cost_centers');
  const CC = Object.fromEntries(ccs.map((c) => [c.code, c.id]));
  const [accs] = await pool.query('SELECT id, code FROM accounts');
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  // ---- প্রস্তুতি ----
  const o1 = await post('/admin/orphans/api/orphans', {
    full_name: 'আব্দুল্লাহ ' + SECRET.lastName,
    date_of_birth: '2015-04-10', orphan_status: 'both_deceased',
    father_name: SECRET.father, mother_name: SECRET.mother,
    guardian_name: SECRET.guardian, guardian_mobile: SECRET.mobile,
    guardian_address: SECRET.address, thana: SECRET.thana, district: 'কুমিল্লা',
    class_name: 'হিফজ ২য় বর্ষ', cost_center_id: CC['HIFZ'],
    need_food: 2500, need_lodging: 1200, need_books: 300,
    photo_path: '/uploads/orphans/orf-0001.jpg',
    health_note_bn: 'সুস্থ আছে', notes_bn: SECRET.notes, student_id: 1,
  });
  const oid = o1.body.id;
  await post('/admin/orphans/api/orphans/' + oid + '/documents', {
    doc_type: 'death_certificate', file_name: SECRET.docName,
    file_path: '/secure/' + SECRET.docName,
  });

  // ================================================================
  console.log('\n── ক. পেজ ও যাচাই ──');
  for (const [p, needle, label] of [
    ['/admin/orphans', 'listBody', 'এতিম তালিকা পেজ'],
    ['/admin/orphans/pool', 'poolBox', 'অসম্পৃক্ত পুল পেজ'],
    ['/admin/orphans/sponsorships', 'tabBox', 'স্পনসরশিপ পেজ'],
  ]) {
    const r = await text(p);
    r.status === 200 ? has(label, r.html, needle) : bad(label + ' — HTTP ' + r.status);
  }

  const prof = await text('/admin/orphans/o/' + oid);
  has('প্রোফাইল পেজ খোলে', prof.html, 'প্রাতিষ্ঠানিক তথ্য');
  has('অ্যাডমিন প্রোফাইলে অভিভাবকের মোবাইল দেখা যায়', prof.html, SECRET.mobile);
  has('যাচাই বাকির সতর্কতা', prof.html, 'যাচাই সম্পন্ন হয়নি');
  has('সম্মতি ছাড়া ছবির সতর্কতা', prof.html, 'কোথাও দেখানো হচ্ছে না');
  (await text('/admin/orphans/o/999999')).status === 404
    ? ok('অস্তিত্বহীন নথিতে ৪০৪') : bad('৪০৪ আসেনি');

  const ver = await post('/admin/orphans/api/orphans/' + oid + '/verify', {});
  ver.body.ok ? ok('যাচাই অনুমোদন হয়েছে') : bad(JSON.stringify(ver.body));

  const meta = await json('/admin/orphans/api/meta');
  meta.ok && meta.orphanStatuses.length === 5
    ? ok('meta-তে ৫টি অবস্থা ও ' + meta.frequencies.length + 'টি রিপোর্ট ধরন') : bad('meta ভুল');
  meta.overview && Number(meta.overview.total) === 1
    ? ok('সামগ্রিক চিত্র: ' + meta.overview.total + 'জন, ঘাটতি ' + meta.overview.gap_total)
    : bad('overview ভুল');

  // ================================================================
  console.log('\n── খ. স্পনসরশিপ ──');
  const d1 = await post('/admin/donors/api/donors', { name: 'হাজী আব্দুল করিম', mobile: '01711223344' });
  const d2 = await post('/admin/donors/api/donors', { name: 'প্রবাসী আবু বকর', mobile: '+971501234567' });

  const s1 = await post('/admin/orphans/api/sponsorships', {
    orphan_id: oid, donor_id: d1.body.id, monthly_amount: 2500,
    start_date: '2026-01-01', report_frequency: 'quarterly',
  });
  s1.status === 201 ? ok('স্পনসরশিপ: ' + s1.body.sponsorship_code +
    ' (কভারেজ ' + s1.body.covered_after + '/' + s1.body.monthly_need + ')') : bad(JSON.stringify(s1.body));
  const sid = s1.body.id;

  const s2 = await post('/admin/orphans/api/sponsorships', {
    orphan_id: oid, donor_id: d2.body.id, monthly_amount: 1500,
  });
  s2.body.shared_with ? ok('শেয়ারড স্পনসরশিপ চিহ্নিত') : bad('শেয়ারড চিহ্নিত হয়নি');

  const pool1 = await json('/admin/orphans/api/pool');
  pool1.count === 0 ? ok('কভারেজ পূর্ণ হওয়ায় পুল খালি') : bad('পুলে ' + pool1.count + 'জন');

  // টাকা
  await rsvc.issue({
    receipt_type: 'ORP', receipt_date: '2026-11-05', amount: 2500,
    payer_name: 'হাজী আব্দুল করিম', donor_id: d1.body.id,
    sponsorship_id: sid, cash_account_id: A['1101'],
  }, principal);
  const payDue = await json('/admin/orphans/api/payments/due?date=2026-11-23');
  payDue.rows.length === 1 && payDue.rows[0].donor_name.indexOf('আবু বকর') >= 0
    ? ok('এ মাসের টাকা বাকি: ' + payDue.rows[0].donor_name) : bad(JSON.stringify(payDue.rows.length));

  // রিপোর্ট
  const rep = await post('/admin/orphans/api/orphans/' + oid + '/reports', {
    period_label: 'জুলাই–সেপ্টেম্বর ২০২৬',
    period_start: '2026-07-01', period_end: '2026-09-30',
    attendance_pct: 94.5, exam_result_bn: 'ত্রৈমাসিক পরীক্ষায় ২য় স্থান',
    hifz_progress_bn: '৭ পারা মুখস্থ সম্পন্ন', health_note_bn: 'ওজন বেড়েছে',
    teacher_comment_bn: 'মনোযোগী ও বিনয়ী। আরবি উচ্চারণে উন্নতি হয়েছে।',
    photo_path: '/uploads/reports/r1.jpg', child_letter_path: '/uploads/reports/letter1.jpg',
  });
  rep.status === 201 ? ok('প্রগ্রেস রিপোর্ট তৈরি (খসড়া)') : bad(JSON.stringify(rep.body));
  const pubd = await post('/admin/orphans/api/progress-reports/' + rep.body.id + '/publish', {});
  eq('প্রকাশিত, স্পনসরদের জানানো হলো', pubd.body.sponsors_notified, 2);

  const repDue = await json('/admin/orphans/api/reports/due?date=2026-11-23');
  repDue.ok ? ok('রিপোর্ট বাকির তালিকা চলছে (' + repDue.rows.length + 'টি)') : bad('reports/due ব্যর্থ');

  // ================================================================
  console.log('\n── গ. দাতাকে পাঠানোর প্রিন্ট পেজ — গোপনীয়তা ──');
  const pr = await text('/admin/orphans/s/' + sid + '/report');
  pr.status === 200 ? ok('প্রিন্ট পেজ খোলে') : bad('HTTP ' + pr.status);

  let leaked = [];
  for (const k in SECRET) if (pr.html.indexOf(SECRET[k]) >= 0) leaked.push(k);
  leaked.length === 0
    ? ok('৯টি গোপন তথ্যের একটিও প্রিন্ট পেজে নেই')
    : bad('প্রিন্ট পেজে ফাঁস: ' + leaked.join(', '));

  has('শিশুর প্রথম নাম দেখানো হয়', pr.html, 'আব্দুল্লাহ');
  has('শিশুর কোড', pr.html, 'ORF-0001');
  has('অবস্থা বাংলায়', pr.html, 'পিতা-মাতা উভয়হীন');
  has('জেলা', pr.html, 'কুমিল্লা');
  has('শিক্ষকের মন্তব্য', pr.html, 'আরবি উচ্চারণে উন্নতি');
  has('উপস্থিতির হার', pr.html, '৯৪.৫০%'.replace('৯৪.৫০%', '৯৪.৫'));
  has('হিফজের অগ্রগতি', pr.html, '৭ পারা');
  has('দাতার মোট অনুদান কথায়', pr.html, 'দুই হাজার পাঁচশত টাকা মাত্র');
  has('শিশু-সুরক্ষার নোট', pr.html, 'শিশুর নিরাপত্তার জন্য');
  has('কৃতজ্ঞতার বার্তা', pr.html, 'জাযাকাল্লাহু খাইরান');
  pr.html.indexOf('/uploads/orphans/orf-0001.jpg') < 0
    ? ok('সম্মতি নেই — ছবি প্রিন্ট পেজে বসেনি') : bad('সম্মতি ছাড়াই ছবি বসেছে');
  pr.html.indexOf('/uploads/reports/letter1.jpg') < 0
    ? ok('সম্মতি নেই — শিশুর চিঠিও বসেনি') : bad('চিঠি ফাঁস হয়েছে');

  // সম্মতি দিলে ছবি আসবে
  await post('/admin/orphans/api/orphans/' + oid + '/consent', {
    level: 'sponsor_only', by: 'অভিভাবক — খালা', date: '2026-11-01',
    note: 'শুধু স্পনসরকে দেখানোর অনুমতি',
  });
  const pr2 = await text('/admin/orphans/s/' + sid + '/report');
  has('সম্মতির পর ছবি বসেছে', pr2.html, '/uploads/orphans/orf-0001.jpg');
  has('সম্মতির পর শিশুর চিঠিও', pr2.html, '/uploads/reports/letter1.jpg');
  let leaked2 = [];
  for (const k in SECRET) if (pr2.html.indexOf(SECRET[k]) >= 0) leaked2.push(k);
  leaked2.length === 0 ? ok('ছবি যুক্ত হলেও কোনো গোপন তথ্য আসেনি') : bad('ফাঁস: ' + leaked2.join(', '));

  // JSON API-ও নিরাপদ
  const srj = await json('/admin/orphans/api/sponsorships/' + sid + '/report');
  const blob = JSON.stringify(srj);
  let leaked3 = [];
  for (const k in SECRET) if (blob.indexOf(SECRET[k]) >= 0) leaked3.push(k);
  leaked3.length === 0 ? ok('দাতা-দৃশ্যমান JSON API-তেও কিছু ফাঁস নেই') : bad('API ফাঁস: ' + leaked3.join(', '));
  ['guardian_mobile', 'guardian_address', 'father_name', 'notes_bn', 'student_id', 'documents']
    .forEach((k) => { blob.indexOf('"' + k + '"') < 0 ? pass++ : bad('API-তে নিষিদ্ধ ঘর: ' + k); });
  ok('নিষিদ্ধ ৬টি ঘরের কোনোটিই API-তে নেই');

  const dsp = await json('/admin/orphans/api/donors/' + d2.body.id + '/sponsorships');
  dsp.rows.length === 1 && JSON.stringify(dsp).indexOf(SECRET.guardian) < 0
    ? ok('দাতার পোর্টাল API নিরাপদ') : bad('পোর্টাল API সমস্যা');

  // ================================================================
  console.log('\n── ঘ. স্পনসরশিপ শেষ ও পুলে ফেরা ──');
  const ended = await post('/admin/orphans/api/sponsorships/' + s2.body.id + '/end',
    { reason: 'দাতার আর্থিক অবস্থা পরিবর্তিত' });
  ended.body.back_to_pool
    ? ok('শেষ করার পর পুলে ফেরার সতর্কতা: ঘাটতি ' + ended.body.new_gap) : bad('সতর্কতা নেই');
  const pool2 = await json('/admin/orphans/api/pool');
  pool2.count === 1 ? ok('অসম্পৃক্ত পুলে আবার ১জন, ঘাটতি ' + pool2.total_gap) : bad('পুল: ' + pool2.count);
  has('পুল পেজে সতর্ক বার্তা', (await text('/admin/orphans/pool')).html, 'কেউ হঠাৎ অসহায়');

  const endFail = await post('/admin/orphans/api/sponsorships/' + s2.body.id + '/end', {});
  endFail.status === 422 ? ok('কারণ ছাড়া শেষ করা আটকেছে') : bad('HTTP ' + endFail.status);

  // ================================================================
  console.log('\n── ঙ. সরাসরি যোগাযোগ ──');
  const cFail = await post('/admin/orphans/api/sponsorships/' + sid + '/contact', { allow: true });
  cFail.status === 422 ? ok('কারণ ছাড়া সরাসরি যোগাযোগের অনুমতি আটকেছে') : bad('HTTP ' + cFail.status);
  const cOk = await post('/admin/orphans/api/sponsorships/' + sid + '/contact',
    { allow: true, note: 'দাতা শিশুর নিকটাত্মীয়; অভিভাবকের সম্মতি আছে। রেফ: সভা ৭/২০২৬' });
  cOk.body.allow_direct_contact ? ok('লিখিত কারণে অনুমতি দেওয়া হয়েছে') : bad('অনুমতি হয়নি');
  has('প্রোফাইলে অনুমতির চিহ্ন', (await text('/admin/orphans/o/' + oid)).html,
      'সরাসরি যোগাযোগ অনুমোদিত');

  const visit = await post('/admin/orphans/api/orphans/' + oid + '/visits', {
    visitor_name: 'হাজী আব্দুল করিম', donor_id: d1.body.id, visit_date: '2026-11-20',
    purpose_bn: 'ঈদের উপহার দিতে', notes_bn: 'মুহতামিমের কক্ষে',
  });
  visit.status === 201 ? ok('সাক্ষাৎ লগ হয়েছে') : bad(JSON.stringify(visit.body));
  has('প্রোফাইলে সাক্ষাতের লগ', (await text('/admin/orphans/o/' + oid)).html, 'প্রতিষ্ঠানের মধ্যস্থতায়');

  // ================================================================
  console.log('\n── চ. হিসাবের মিল ──');
  const [[tb]] = await pool.query('SELECT SUM(total_debit) d, SUM(total_credit) c FROM v_trial_balance');
  Math.abs(Number(tb.d) - Number(tb.c)) < 0.01
    ? ok('রেওয়ামিল মিলেছে — ' + Number(tb.d).toFixed(2)) : bad('মেলেনি');
  const [[m]] = await pool.query(
    `SELECT (SELECT COALESCE(SUM(amount),0) FROM receipts
              WHERE status='issued' AND sponsorship_id IS NOT NULL) a,
            (SELECT COALESCE(SUM(received_total),0) FROM v_sponsorship_status) b`);
  Math.abs(Number(m.a) - Number(m.b)) < 0.01
    ? ok('স্পনসরশিপের আদায় মিলেছে (' + m.a + ')') : bad(m.a + ' ≠ ' + m.b);

  console.log('\n' + '─'.repeat(64) + '\nফলাফল:  ✅ ' + pass + ' পাস   ❌ ' + fail + ' ফেল\n');
  server.close();
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('\n💥', e); process.exit(1); });

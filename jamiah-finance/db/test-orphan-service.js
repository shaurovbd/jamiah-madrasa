'use strict';
/**
 * এতিম স্পনসর বিভাগের পরীক্ষা — আসল MySQL-এ।
 * বিশেষ গুরুত্ব: দাতার কাছে কোনো ব্যক্তিগত তথ্য ফাঁস হয় কি না।
 */
const mysql = require('mysql2/promise');
const OrphanService = require('./orphan-service');
const DonorService = require('./donor-service');
const ReceiptService = require('./receipt-service');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  ✅', m); };
const bad = (m) => { fail++; console.log('  ❌', m); };
const eq  = (l, got, want) =>
  (String(got) === String(want) ? ok(l) : bad(l + ' — পেলাম ' + got + ', চাই ' + want));

// ---- গোপন তথ্য: এগুলোর একটিও দাতার কাছে যাওয়া চলবে না ----
const SECRET = {
  father:   'পিতা-মোহাম্মদ-হাকিম-গোপন',
  mother:   'মাতা-আমেনা-খাতুন-গোপন',
  guardian: 'অভিভাবক-ফাতেমা-বেগম-গোপন',
  mobile:   '01999777555',
  address:  'গ্রাম-দক্ষিণপাড়া-বাড়ি-১২-গোপন',
  thana:    'লাকসাম-থানা-গোপন',
  notes:    'প্রাতিষ্ঠানিক-গোপন-নোট',
  lastName: 'আল-মামুন-পদবি',
  docName:  'death-certificate-গোপন.pdf',
};

async function main() {
  const pool = mysql.createPool({
    host: '127.0.0.1', user: 'jamiah', password: 'test_pw_local',
    database: 'jamiah', decimalNumbers: true, connectionLimit: 5,
  });
  const orphans = new OrphanService(pool);
  const donors = new DonorService(pool);
  const receipts = new ReceiptService(pool, { donorService: donors });

  const [accs] = await pool.query('SELECT id, code FROM accounts');
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  const [ccs] = await pool.query('SELECT id, code FROM cost_centers');
  const CC = Object.fromEntries(ccs.map((c) => [c.code, c.id]));

  const today = '2026-11-23';
  const clerk     = { userId: 2, role: 'accountant', ip: '127.0.0.1' };
  const principal = { userId: 1, role: 'principal', ip: '127.0.0.1' };
  const chief     = { userId: 3, role: 'chief_accountant', ip: '127.0.0.1' };

  const expectFail = async (label, fn, needle) => {
    try { await fn(); bad(label + ' — আটকায়নি!'); }
    catch (e) {
      const j = (e.errors || [e.message]).join(' | ');
      if (needle && j.indexOf(needle) < 0) bad(label + ' — অন্য কারণে: ' + j);
      else ok(label + ' → ' + (e.errors ? e.errors[0] : e.message));
    }
  };

  // ================================================================
  console.log('\n── ১. শিশুর নথি তৈরি ──');
  const o1 = await orphans.createOrphan({
    full_name: 'আব্দুল্লাহ ' + SECRET.lastName,
    date_of_birth: '2015-04-10', gender: 'male',
    orphan_status: 'both_deceased',
    father_name: SECRET.father, father_death_date: '2021-06-01',
    mother_name: SECRET.mother, mother_death_date: '2023-02-14',
    guardian_name: SECRET.guardian, guardian_relation: 'খালা',
    guardian_mobile: SECRET.mobile, guardian_address: SECRET.address,
    thana: SECRET.thana, district: 'কুমিল্লা', sibling_count: 2,
    enrolled_date: '2024-01-10', class_name: 'হিফজ ২য় বর্ষ',
    cost_center_id: CC['HIFZ'],
    need_food: 2500, need_lodging: 1200, need_clothing: 400,
    need_books: 300, need_medical: 200, need_other: 100,
    photo_path: '/uploads/orphans/orf-0001.jpg',
    health_note_bn: 'সুস্থ, চোখে সামান্য সমস্যা আছে',
    notes_bn: SECRET.notes,
    student_id: 1,
  }, clerk);
  eq('শিশুর কোড', o1.orphan_code, 'ORF-0001');

  const got1 = await orphans.getOrphan(o1.id);
  eq('মাসিক প্রয়োজন নিজে যোগ হয়েছে', got1.orphan.monthly_need, 4700);
  eq('বয়স হিসাব', got1.orphan.age_years, 11);
  eq('যাচাইয়ের অবস্থা', got1.orphan.verification_status, 'pending');
  eq('ছবির সম্মতি ডিফল্টে বন্ধ', got1.orphan.photo_consent, 'none');

  await expectFail('সম্মতির দাতা ছাড়া ছবির সম্মতি', () => orphans.createOrphan({
    full_name: 'পরীক্ষা', orphan_status: 'father_deceased', photo_consent: 'public',
  }, clerk), 'কে দিয়েছেন');

  // ================================================================
  console.log('\n── ২. যাচাই ──');
  await expectFail('কাগজ ছাড়া যাচাই',
    () => orphans.verifyOrphan(o1.id, principal), 'মৃত্যু সনদ');
  await orphans.addDocument(o1.id, {
    doc_type: 'death_certificate', file_path: '/secure/docs/' + SECRET.docName,
    file_name: SECRET.docName, note_bn: 'পিতার মৃত্যু সনদ',
  }, clerk);
  await expectFail('কারণিকের যাচাই',
    () => orphans.verifyOrphan(o1.id, clerk), 'শুধু মুহতামিম');
  const v1 = await orphans.verifyOrphan(o1.id, principal);
  eq('মুহতামিমের যাচাই', v1.verification_status, 'verified');

  // ================================================================
  console.log('\n── ৩. স্পনসরশিপ ──');
  const d1 = await donors.upsertDonor({
    name: 'হাজী আব্দুল করিম', mobile: '01711223344', district: 'ঢাকা',
  }, principal);
  const d2 = await donors.upsertDonor({
    name: 'প্রবাসী দাতা — আবু বকর', mobile: '+971501234567',
    country: 'সংযুক্ত আরব আমিরাত', is_expatriate: true,
  }, principal);

  const o2 = await orphans.createOrphan({
    full_name: 'ফাতেমা আক্তার', date_of_birth: '2017-08-20', gender: 'female',
    orphan_status: 'father_deceased', district: 'নোয়াখালী',
    class_name: 'নাজেরা', cost_center_id: CC['NAZERA'],
    need_food: 2500, need_lodging: 1200, need_books: 300,
  }, clerk);
  await orphans.addDocument(o2.id, {
    doc_type: 'chairman_certificate', file_path: '/secure/x.pdf', file_name: 'chairman.pdf',
  }, clerk);

  await expectFail('যাচাই ছাড়া স্পনসরশিপ', () => orphans.createSponsorship({
    orphan_id: o2.id, donor_id: d1.id, monthly_amount: 2000,
  }, principal), 'যাচাই সম্পন্ন না হওয়া');
  await orphans.verifyOrphan(o2.id, principal);

  const s1 = await orphans.createSponsorship({
    orphan_id: o1.id, donor_id: d1.id, monthly_amount: 3000,
    start_date: '2026-01-01', report_frequency: 'quarterly',
  }, principal);
  eq('স্পনসরশিপের কোড', s1.sponsorship_code, 'SPN-00001');
  eq('শেয়ারড নয়', s1.shared_with, false);

  // শেয়ারড স্পনসরশিপ — দুজন মিলে এক শিশু
  const s2 = await orphans.createSponsorship({
    orphan_id: o1.id, donor_id: d2.id, monthly_amount: 1700,
    start_date: '2026-03-01',
  }, principal);
  eq('দ্বিতীয় দাতা যোগ — শেয়ারড', s2.shared_with, true);
  eq('মোট কভারেজ', s2.covered_after, 4700);
  eq('অতিরিক্ত নেই', s2.over_by, 0);

  const sum1 = await orphans.getOrphan(o1.id);
  eq('স্পনসরের সংখ্যা', sum1.orphan.sponsor_count, 2);
  eq('কভারেজ শতকরা', sum1.orphan.coverage_pct, 100);
  eq('ঘাটতি শূন্য', sum1.orphan.gap_monthly, 0);

  await expectFail('একই দাতার দ্বিতীয় স্পনসরশিপ', () => orphans.createSponsorship({
    orphan_id: o1.id, donor_id: d1.id, monthly_amount: 500,
  }, principal), 'চলমান স্পনসরশিপ আছে');

  const s3 = await orphans.createSponsorship({
    orphan_id: o2.id, donor_id: d2.id, monthly_amount: 5000,
  }, principal);
  eq('প্রয়োজনের বেশি হলে জানানো হয়', s3.over_by, 1000);
  ok('প্রয়োজন ' + s3.monthly_need + ', কভারেজ ' + s3.covered_after + ' — আটকানো হয়নি, জানানো হয়েছে');

  // ================================================================
  console.log('\n── ৪. অসম্পৃক্ত পুল ──');
  const o3 = await orphans.createOrphan({
    full_name: 'ইব্রাহিম খলিল', orphan_status: 'both_deceased',
    district: 'চট্টগ্রাম', class_name: 'মক্তব', cost_center_id: CC['MAKTAB'],
    need_food: 2500, need_lodging: 1200,
  }, clerk);
  await orphans.addDocument(o3.id, {
    doc_type: 'death_certificate', file_path: '/s/y.pdf', file_name: 'y.pdf' }, clerk);
  await orphans.verifyOrphan(o3.id, principal);

  const pool1 = await orphans.unsponsoredPool();
  pool1.rows.length === 1 && pool1.rows[0].orphan_code === o3.orphan_code
    ? ok('অসম্পৃক্ত পুলে ' + pool1.count + 'জন, মোট ঘাটতি ' + pool1.total_gap)
    : bad('পুল ভুল: ' + JSON.stringify(pool1.rows.map((r) => r.orphan_code)));

  const o4 = await orphans.createOrphan({
    full_name: 'অযাচাইকৃত শিশু', orphan_status: 'father_deceased', need_food: 1000,
  }, clerk);
  (await orphans.unsponsoredPool()).rows.every((r) => r.orphan_code !== o4.orphan_code)
    ? ok('যাচাই না হওয়া শিশু পুলে আসে না (দাতাকে দেখানোর আগে যাচাই জরুরি)')
    : bad('অযাচাইকৃত শিশু পুলে এসেছে');

  // ================================================================
  console.log('\n── ৫. স্পনসরশিপের টাকা ও রশিদ ──');
  const r1 = await receipts.issue({
    receipt_type: 'ORP', receipt_date: '2026-11-05', amount: 3000,
    payer_name: 'হাজী আব্দুল করিম', donor_id: d1.id,
    sponsorship_id: s1.id, cash_account_id: A['1101'],
    purpose_bn: 'নভেম্বরের স্পনসরশিপ',
  }, clerk);
  eq('রশিদ স্পনসরশিপের সাথে যুক্ত', r1.sponsorship_id, s1.id);

  await expectFail('অন্য দাতার স্পনসরশিপে টাকা', () => receipts.issue({
    receipt_type: 'ORP', receipt_date: today, amount: 100,
    payer_name: 'প্রবাসী দাতা — আবু বকর', donor_id: d2.id,
    sponsorship_id: s1.id, cash_account_id: A['1101'],
  }, clerk), 'অন্য দাতার');

  const [[spRow]] = await pool.query(
    `SELECT received_total FROM v_sponsorship_status WHERE sponsorship_id = ?`, [s1.id]);
  eq('স্পনসরশিপে আদায়', spRow.received_total, 3000);

  const payDue = await orphans.paymentsDue('2026-11-23');
  const codes = payDue.rows.map((r) => r.sponsorship_code);
  codes.indexOf('SPN-00001') < 0 && codes.length === 2
    ? ok('নভেম্বরের টাকা যারা দেননি: ' + codes.join(', ') + ' (প্রত্যাশিত ' + payDue.expected_total + ')')
    : bad('বাকির তালিকা ভুল: ' + JSON.stringify(codes));

  // ================================================================
  console.log('\n── ৬. প্রগ্রেস রিপোর্ট ──');
  const rep = await orphans.createReport({
    orphan_id: o1.id, period_label: 'জুলাই–সেপ্টেম্বর ২০২৬',
    period_start: '2026-07-01', period_end: '2026-09-30',
    attendance_pct: 94.5, exam_result_bn: 'ত্রৈমাসিক পরীক্ষায় ২য় স্থান',
    hifz_progress_bn: '৭ পারা মুখস্থ সম্পন্ন',
    health_note_bn: 'সুস্থ আছে, ওজন বেড়েছে',
    teacher_comment_bn: 'মনোযোগী ও বিনয়ী। আরবি উচ্চারণে উন্নতি হয়েছে।',
    photo_path: '/uploads/reports/r1.jpg',
    child_letter_path: '/uploads/reports/letter1.jpg',
  }, clerk);
  eq('রিপোর্ট ড্রাফট অবস্থায়', rep.status, 'draft');
  await expectFail('একই সময়কালের দ্বিতীয় রিপোর্ট', () => orphans.createReport({
    orphan_id: o1.id, period_label: 'আবার', period_start: '2026-07-01', period_end: '2026-09-30',
  }, clerk), 'আগেই তৈরি');
  await expectFail('ভুল উপস্থিতির হার', () => orphans.createReport({
    orphan_id: o1.id, period_label: 'x', period_start: '2026-10-01',
    period_end: '2026-12-31', attendance_pct: 150,
  }, clerk), '০ থেকে ১০০');

  const pub = await orphans.publishReport(rep.id, principal);
  eq('প্রকাশিত', pub.status, 'published');
  eq('কত স্পনসরকে জানানো হলো', pub.sponsors_notified, 2);
  await expectFail('দ্বিতীয়বার প্রকাশ',
    () => orphans.publishReport(rep.id, principal), 'আগেই প্রকাশিত');

  // জানুয়ারিতে শুরু, এখনো কোনো রিপোর্ট যায়নি — ত্রৈমাসিক হিসেবে অনেক আগেই সময় হয়েছে।
  // আংশিক কভারেজ, তাই শিশুটি অসম্পৃক্ত পুলেই থাকবে।
  const sOld = await orphans.createSponsorship({
    orphan_id: o3.id, donor_id: d1.id, monthly_amount: 1000,
    start_date: '2026-01-01', report_frequency: 'quarterly',
  }, principal);
  const due = await orphans.reportsDue('2026-11-23');
  const dueCodes = due.rows.map((r) => r.sponsorship_code);
  dueCodes.indexOf(sOld.sponsorship_code) >= 0
    ? ok('রিপোর্ট পাঠানোর সময় হয়েছে: ' + dueCodes.join(', ') +
         ' (' + due.rows[0].months_elapsed + ' মাস পার)')
    : bad('রিপোর্ট বাকির তালিকা ভুল: ' + JSON.stringify(dueCodes));
  due.rows.every((r) => r.months_elapsed >= r.freq_months)
    ? ok('প্রতিটি সারিতেই সময় সত্যিই পেরিয়েছে') : bad('সময় না পেরোনোটিও এসেছে');
  due.rows.every((r) => r.sponsorship_code !== 'SPN-00001')
    ? ok('সদ্য রিপোর্ট পাঠানো স্পনসরশিপ তালিকায় নেই') : bad('সদ্য পাঠানোটিও দেখাচ্ছে');

  // ================================================================
  console.log('\n── ৭. গোপনীয়তা: দাতার কাছে কী যায় ──');
  const sr = await orphans.sponsorReport(s1.id);
  const blob = JSON.stringify(sr);

  let leaked = [];
  for (const k in SECRET) if (blob.indexOf(SECRET[k]) >= 0) leaked.push(k);
  leaked.length === 0
    ? ok('৯টি গোপন তথ্যের একটিও দাতার রিপোর্টে নেই')
    : bad('ফাঁস হয়েছে: ' + leaked.join(', '));

  ['guardian_mobile', 'guardian_address', 'guardian_name', 'father_name', 'mother_name',
   'thana', 'notes_bn', 'student_id', 'full_name', 'verification_status',
   'photo_path', 'documents'].forEach(function (k) {
    blob.indexOf('"' + k + '"') < 0 ? pass++ : bad('দাতার রিপোর্টে নিষিদ্ধ ঘর: ' + k);
  });
  ok('নিষিদ্ধ ১২টি ঘরের কোনোটিই JSON-এ নেই');

  eq('দাতা দেখেন শুধু প্রথম নাম', sr.child.name, 'আব্দুল্লাহ');
  eq('শিশুর কোড দেখানো হয়', sr.child.orphan_code, 'ORF-0001');
  eq('বয়স দেখানো হয়', sr.child.age_years, 11);
  eq('অবস্থা বাংলায়', sr.child.orphan_status, 'পিতা-মাতা উভয়হীন');
  eq('জেলা পর্যন্ত দেখানো হয়', sr.child.district, 'কুমিল্লা');
  eq('ক্লাস দেখানো হয়', sr.child.class_name, 'হিফজ ২য় বর্ষ');
  eq('বিভাগ দেখানো হয়', sr.child.department, 'হিফজুল কুরআন');
  eq('স্বাস্থ্যের সাধারণ তথ্য দেখানো হয়', sr.child.health_note, 'সুস্থ, চোখে সামান্য সমস্যা আছে');

  console.log('\n   ছবি ও সম্মতি:');
  sr.child.photo === null && sr.child.photo_available === false
    ? ok('সম্মতি নেই — ছবির পথ ফেরত যায়নি (যদিও ডেটাবেসে আছে)')
    : bad('সম্মতি ছাড়াই ছবি গেছে: ' + sr.child.photo);
  sr.reports[0].photo === null && sr.reports[0].child_letter === null
    ? ok('সম্মতি নেই — রিপোর্টের ছবি ও শিশুর চিঠিও যায়নি') : bad('রিপোর্টের ছবি ফাঁস');

  await expectFail('কারণিকের পাবলিক সম্মতি',
    () => orphans.setPhotoConsent(o1.id, { level: 'public', by: 'খালা' }, clerk),
    'শুধু মুহতামিম');
  await orphans.setPhotoConsent(o1.id, {
    level: 'sponsor_only', by: 'অভিভাবক — খালা', date: '2026-11-01',
    note: 'শুধু স্পনসরকে দেখানোর অনুমতি, ওয়েবসাইটে নয়',
  }, principal);
  const sr2 = await orphans.sponsorReport(s1.id);
  sr2.child.photo === '/uploads/orphans/orf-0001.jpg' && sr2.child.photo_available
    ? ok('sponsor_only সম্মতির পর স্পনসর ছবি দেখেন') : bad('সম্মতির পরেও ছবি নেই');
  sr2.reports[0].photo && sr2.reports[0].child_letter
    ? ok('রিপোর্টের ছবি ও শিশুর হাতে লেখা চিঠিও এখন যায়') : bad('রিপোর্টের ছবি আসেনি');

  await orphans.setPhotoConsent(o1.id, { level: 'none' }, principal);
  (await orphans.sponsorReport(s1.id)).child.photo === null
    ? ok('সম্মতি তুলে নিলে ছবি সাথে সাথেই অদৃশ্য') : bad('সম্মতি তোলার পরেও ছবি যাচ্ছে');

  console.log('\n   নাম দেখানোর নিয়ম:');
  await orphans.updateOrphan(o1.id, { name_display: 'code_only' }, principal);
  eq('code_only হলে শুধু কোড', (await orphans.sponsorReport(s1.id)).child.name, 'ORF-0001');
  await orphans.updateOrphan(o1.id, { name_display: 'full' }, principal);
  eq('full হলে পুরো নাম', (await orphans.sponsorReport(s1.id)).child.name,
     'আব্দুল্লাহ ' + SECRET.lastName);
  await orphans.updateOrphan(o1.id, { name_display: 'first_only' }, principal);
  await orphans.updateOrphan(o1.id, { display_name: 'আব্দুল্লাহ (হিফজ)' }, principal);
  eq('display_name দিলে সেটাই চলে', (await orphans.sponsorReport(s1.id)).child.name,
     'আব্দুল্লাহ (হিফজ)');

  console.log('\n   প্রকাশিত নয় এমন রিপোর্ট:');
  const draft = await orphans.createReport({
    orphan_id: o1.id, period_label: 'অক্টোবর–ডিসেম্বর ২০২৬',
    period_start: '2026-10-01', period_end: '2026-12-31',
    teacher_comment_bn: 'এখনো খসড়া — দাতার দেখা উচিত নয়',
  }, clerk);
  const sr3 = await orphans.sponsorReport(s1.id);
  sr3.reports.length === 1 &&
  JSON.stringify(sr3).indexOf('এখনো খসড়া') < 0
    ? ok('ড্রাফট রিপোর্ট দাতার কাছে যায় না') : bad('ড্রাফট ফাঁস হয়েছে');

  console.log('\n   দাতার পোর্টাল:');
  const portal = await orphans.donorSponsorships(d2.id);
  portal.length === 2 ? ok('প্রবাসী দাতার ২টি স্পনসরশিপ দেখা যাচ্ছে') : bad('পোর্টাল: ' + portal.length);
  const pblob = JSON.stringify(portal);
  let pleak = [];
  for (const k in SECRET) if (pblob.indexOf(SECRET[k]) >= 0) pleak.push(k);
  pleak.length === 0 ? ok('পোর্টালেও কোনো গোপন তথ্য নেই') : bad('পোর্টালে ফাঁস: ' + pleak.join(', '));

  // ================================================================
  console.log('\n── ৮. সরাসরি যোগাযোগ ও সাক্ষাৎ ──');
  eq('ডিফল্টে সরাসরি যোগাযোগ বন্ধ',
     (await pool.query(`SELECT allow_direct_contact a FROM sponsorships WHERE id=?`, [s1.id]))[0][0].a, 0);
  await expectFail('মুহতামিম ছাড়া অনুমতি',
    () => orphans.setDirectContact(s1.id, true, 'দাতা চেয়েছেন', chief), 'শুধু মুহতামিম');
  await expectFail('কারণ ছাড়া অনুমতি',
    () => orphans.setDirectContact(s1.id, true, '', principal), 'লিখিতভাবে');
  const dc = await orphans.setDirectContact(s1.id, true,
    'দাতা শিশুর নিকটাত্মীয়; অভিভাবকের সম্মতি আছে। রেফ: সভার সিদ্ধান্ত ৭/২০২৬', principal);
  dc.allow_direct_contact ? ok('লিখিত কারণে মুহতামিম অনুমতি দিয়েছেন') : bad('অনুমতি হয়নি');

  const visit = await orphans.logVisit({
    orphan_id: o1.id, donor_id: d1.id, visitor_name: 'হাজী আব্দুল করিম',
    visit_date: '2026-11-20', purpose_bn: 'ঈদের উপহার দিতে',
    notes_bn: 'মুহতামিমের কক্ষে, শিক্ষকের উপস্থিতিতে',
  }, principal);
  visit.id ? ok('সাক্ষাৎ লগ হয়েছে (মধ্যস্থতাকারীসহ)') : bad('সাক্ষাৎ লগ হয়নি');
  const [[vrow]] = await pool.query(`SELECT mediated_by FROM orphan_visits WHERE id=?`, [visit.id]);
  vrow.mediated_by === 1 ? ok('মধ্যস্থতাকারী কর্মচারী রেকর্ড হয়েছে') : bad('মধ্যস্থতাকারী নেই');
  await expectFail('নাম ছাড়া সাক্ষাৎ',
    () => orphans.logVisit({ orphan_id: o1.id }, principal), 'সাক্ষাৎকারীর নাম');

  // ================================================================
  console.log('\n── ৯. স্পনসরশিপ শেষ হলে শিশু আবার পুলে ──');
  const ended = await orphans.endSponsorship(s2.id, 'দাতার আর্থিক অবস্থা পরিবর্তিত', principal);
  eq('শেষ হয়েছে', ended.status, 'ended');
  eq('নতুন ঘাটতি', ended.new_gap, 1700);
  ended.back_to_pool ? ok('সতর্কতা: শিশুটি আবার পুলে ফিরেছে (' + ended.orphan_code + ')')
                     : bad('পুলে ফেরার সতর্কতা নেই');
  const pool2 = await orphans.unsponsoredPool();
  pool2.rows.some((r) => r.orphan_code === 'ORF-0001')
    ? ok('অসম্পৃক্ত পুলে এখন ' + pool2.count + 'জন, মোট ঘাটতি ' + pool2.total_gap)
    : bad('পুলে ফেরেনি');
  await expectFail('দ্বিতীয়বার শেষ',
    () => orphans.endSponsorship(s2.id, 'আবার', principal), 'আগেই শেষ');
  await expectFail("শেষ হওয়াটিকে 'active' করা",
    () => orphans.setSponsorshipStatus(s2.id, 'active'), 'আগেই শেষ');

  const paused = await orphans.setSponsorshipStatus(s1.id, 'paused', principal);
  eq('স্থগিত', paused.status, 'paused');
  const [[afterPause]] = await pool.query(
    `SELECT covered_monthly, gap_monthly FROM v_orphan_summary WHERE orphan_id=?`, [o1.id]);
  eq('স্থগিত স্পনসরশিপ কভারেজে গোনা হয় না', afterPause.covered_monthly, 0);
  await orphans.setSponsorshipStatus(s1.id, 'active', principal);

  // ================================================================
  console.log('\n── ১০. সামগ্রিক চিত্র ও হিসাবের মিল ──');
  const ov = await orphans.overview();
  ok('মোট ' + ov.total + 'জন · যাচাইকৃত ' + ov.verified + ' · অপেক্ষমাণ ' + ov.pending +
     ' · অসম্পৃক্ত ' + ov.unsponsored);
  ok('মাসিক প্রয়োজন ' + ov.need_total + ' · কভারেজ ' + ov.covered_total +
     ' · ঘাটতি ' + ov.gap_total);
  ok('প্রয়োজনের বেশি এসেছে ' + ov.over_covered_total + ' (অন্য শিশুর ঘাটতি পূরণ করে না)');
  Number(ov.gap_total) >= Number(ov.need_total) - Number(ov.covered_total)
    ? ok('মোট ঘাটতি (' + ov.gap_total + ') ≥ প্রয়োজন − কভারেজ (' +
         (Number(ov.need_total) - Number(ov.covered_total)) + ') — ' +
         'কারণ এক শিশুর অতিরিক্ত টাকা অন্য শিশুর ঘাটতি পূরণ করে না')
    : bad('ঘাটতির হিসাব গোলমাল');
  Math.abs((Number(ov.need_total) - Number(ov.covered_total) + Number(ov.over_covered_total))
           - Number(ov.gap_total)) < 0.01
    ? ok('সমীকরণ মেলে: (প্রয়োজন − কভারেজ) + অতিরিক্ত = মোট ঘাটতি')
    : bad('সমীকরণ মেলেনি');

  const [[tb]] = await pool.query('SELECT SUM(total_debit) d, SUM(total_credit) c FROM v_trial_balance');
  Math.abs(Number(tb.d) - Number(tb.c)) < 0.01
    ? ok('রেওয়ামিল মিলেছে — ' + Number(tb.d).toFixed(2)) : bad('মেলেনি');
  const [[chk]] = await pool.query(
    `SELECT (SELECT COALESCE(SUM(amount),0) FROM receipts
              WHERE status='issued' AND sponsorship_id IS NOT NULL) a,
            (SELECT COALESCE(SUM(received_total),0) FROM v_sponsorship_status) b`);
  Math.abs(Number(chk.a) - Number(chk.b)) < 0.01
    ? ok('স্পনসরশিপের আদায় = স্পনসরশিপ-ট্যাগ করা রশিদের মোট (' + chk.a + ')')
    : bad(chk.a + ' ≠ ' + chk.b);

  console.log('\n' + '─'.repeat(64) + '\nফলাফল:  ✅ ' + pass + ' পাস   ❌ ' + fail + ' ফেল\n');
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('\n💥', e); process.exit(1); });

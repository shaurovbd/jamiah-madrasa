'use strict';
/** এতিম স্পনসর বিভাগের ভিউ */
const { toBanglaDigits, formatTaka } = require('../lib/bangla-number');
const { ORPHAN_STATUS_BN, FREQ_BN } = require('../orphan-service');

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (v) => 'Tk ' + Number(v || 0).toLocaleString('en-US',
  { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** DB থেকে DATE কলাম JS Date হিসেবে আসতে পারে। String(date).slice(0,10) দিলে
 *  "Thu Jan 01" আসে, আর toISOString() টাইমজোনের কারণে একদিন পিছিয়ে দেয়।
 *  তাই স্থানীয় তারিখের অংশ থেকেই YYYY-MM-DD বানানো হয়।
 *  (পুলে dateStrings: true দিলে এখানে স্ট্রিংই আসবে — তখনও এটি নিরাপদ।) */
const ymd = (d) => {
  if (d == null || d === '') return '';
  if (d instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  return String(d).slice(0, 10);
};

const bnDate = (d) => d ? toBanglaDigits(ymd(d).split('-').reverse().join('/')) : '—';
const bn = (n) => n == null ? '—' : toBanglaDigits(n);

const ORG = {
  name_bn: 'জামিয়াহ স্কলার্স ইন্টারন্যাশনাল',
  name_en: 'Jamiah Scholars International',
  address_bn: '', mobile: '',
};

function page({ title, body, bare = false }) {
  return `<!DOCTYPE html>
<html lang="bn" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Jamiah Scholars</title>
<link rel="stylesheet" href="/css/theme-tokens.css">
<link rel="stylesheet" href="/css/admin.css">
<link rel="stylesheet" href="/css/ledger.css">
<link rel="stylesheet" href="/css/receipt.css">
<link rel="stylesheet" href="/css/donor.css">
<link rel="stylesheet" href="/css/orphan.css">
</head>
<body>${bare ? body : `<div class="shell"><main class="main"><div class="content">${body}</div></main></div>`}</body>
</html>`;
}

const nav = (active) => `
<div class="d-nav">
  ${[['', 'এতিম শিক্ষার্থী'], ['pool', 'অসম্পৃক্ত পুল'], ['sponsorships', 'স্পনসরশিপ']]
    .map(([p, l]) => `<a href="/admin/orphans/${p}"${active === p ? ' class="is-on"' : ''}>${l}</a>`)
    .join('')}
  <span class="spacer"></span>
  <a href="/admin/donors">দাতা বিভাগ</a>
</div>`;

const verifyBadge = (s) => ({
  verified: '<span class="badge badge-green">যাচাইকৃত</span>',
  pending: '<span class="badge badge-amber">যাচাই বাকি</span>',
  rejected: '<span class="badge badge-red">নাকচ</span>',
})[s] || esc(s);

const consentBadge = (c) => ({
  none: '<span class="badge badge-red">ছবির সম্মতি নেই</span>',
  sponsor_only: '<span class="badge badge-amber">শুধু স্পনসরকে</span>',
  public: '<span class="badge badge-green">প্রকাশ্যে অনুমোদিত</span>',
})[c] || esc(c);

const spnBadge = (s) => ({
  active: '<span class="badge badge-green">চলমান</span>',
  paused: '<span class="badge badge-amber">স্থগিত</span>',
  ended: '<span class="badge">শেষ</span>',
})[s] || esc(s);

// =====================================================================
// তালিকা
// =====================================================================
function orphanList() {
  return `
<div class="page-bar">
  <div><h1 class="page-title">এতিম শিক্ষার্থী</h1>
    <div class="sub">নথি, যাচাই ও স্পনসরশিপ</div></div>
  <div class="spacer"></div>
  <button class="btn btn-primary" id="newOrphan">+ নতুন নথি</button>
</div>
${nav('')}
<div class="grid g4" id="statRow"></div>
<div class="card">
  <div class="card-head"><strong>তালিকা</strong><span class="spacer"></span>
    <div class="filters">
      <div class="field"><select id="fVerify">
        <option value="">সব অবস্থা</option><option value="verified">যাচাইকৃত</option>
        <option value="pending">যাচাই বাকি</option><option value="rejected">নাকচ</option>
      </select></div>
      <div class="field"><select id="fDept"><option value="">সব বিভাগ</option></select></div>
      <div class="field"><label class="d-check"><input type="checkbox" id="fUnspon"> স্পনসর নেই</label></div>
      <div class="field"><select id="fSort">
        <option value="gap">ঘাটতি অনুযায়ী</option>
        <option value="report">রিপোর্ট বাকি অনুযায়ী</option>
        <option value="name">নাম অনুযায়ী</option>
      </select></div>
      <div class="field grow"><input type="search" id="fQ" placeholder="নাম, কোড বা শ্রেণি"></div>
    </div>
  </div>
  <div class="card-body flush"><div class="table-wrap">
    <table class="data compact">
      <thead><tr><th>কোড</th><th>নাম</th><th>বয়স</th><th>শ্রেণি</th><th>অবস্থা</th>
        <th class="num">মাসিক প্রয়োজন</th><th class="num">কভারেজ</th><th>স্পনসর</th>
        <th>যাচাই</th><th>রিপোর্ট</th><th></th></tr></thead>
      <tbody id="listBody"><tr><td colspan="11" class="empty">লোড হচ্ছে…</td></tr></tbody>
    </table>
  </div></div>
</div>
<script src="/js/bangla-number.js"></script>
<script src="/js/orphan-list.js" defer></script>`;
}

// =====================================================================
// অসম্পৃক্ত পুল
// =====================================================================
function unsponsoredPool() {
  return `
<div class="page-bar">
  <div><h1 class="page-title">অসম্পৃক্ত পুল</h1>
    <div class="sub">যাদের এখনো স্পনসর নেই বা ঘাটতি আছে</div></div>
</div>
${nav('pool')}
<div class="v-alert">এই তালিকা সবসময় সামনে রাখা দরকার। কোনো স্পনসরশিপ শেষ হলে
  শিশুটি আপনাআপনি এখানে ফিরে আসে, যাতে কেউ হঠাৎ অসহায় হয়ে না পড়ে।</div>
<div id="poolBox"><div class="empty">লোড হচ্ছে…</div></div>
<script src="/js/bangla-number.js"></script>
<script src="/js/orphan-pool.js" defer></script>`;
}

// =====================================================================
// স্পনসরশিপ ও ফলো-আপ
// =====================================================================
function sponsorshipList() {
  return `
<div class="page-bar">
  <div><h1 class="page-title">স্পনসরশিপ</h1>
    <div class="sub">চলমান স্পনসরশিপ, বাকি টাকা ও বাকি রিপোর্ট</div></div>
</div>
${nav('sponsorships')}
<div class="d-tabs" id="tabs">
  <button class="is-on" data-tab="active">চলমান</button>
  <button data-tab="payments">এ মাসের টাকা বাকি</button>
  <button data-tab="reports">রিপোর্ট পাঠানো বাকি</button>
  <button data-tab="ended">শেষ হয়েছে</button>
</div>
<div id="tabBox"><div class="empty">লোড হচ্ছে…</div></div>
<script src="/js/bangla-number.js"></script>
<script src="/js/sponsorships.js" defer></script>`;
}

// =====================================================================
// প্রোফাইল (প্রাতিষ্ঠানিক — সব তথ্য)
// =====================================================================
function orphanProfile({ orphan: o, sponsorships, documents, reports, visits }) {
  const row = (k, v) => v ? `<div><span class="label">${k}</span><span class="value">${esc(v)}</span></div>` : '';
  const need = (k, v) => Number(v) ? `<div class="v-sum-row"><span>${k}</span>
    <span class="v-amt">${money(v)}</span></div>` : '';

  return `
<div class="page-bar">
  <div><h1 class="page-title">${esc(o.full_name)}</h1>
    <div class="sub">${esc(o.orphan_code)} · ${esc(ORPHAN_STATUS_BN[o.orphan_status] || '')}
      ${o.class_name ? ' · ' + esc(o.class_name) : ''}
      ${o.age_years != null ? ' · ' + bn(o.age_years) + ' বছর' : ''}</div></div>
  <div class="spacer"></div>
  ${verifyBadge(o.verification_status)} ${consentBadge(o.photo_consent)}
  <button class="btn btn-light" id="editBtn">সম্পাদনা</button>
  ${o.verification_status !== 'verified'
    ? '<button class="btn btn-primary" id="verifyBtn">যাচাই অনুমোদন</button>' : ''}
</div>
${nav('')}

${o.verification_status === 'pending' ? `<div class="v-alert v-alert-warn">
  যাচাই সম্পন্ন হয়নি। যাচাই ছাড়া এই শিশুকে স্পনসরশিপে দেওয়া যাবে না এবং
  অসম্পৃক্ত পুলেও দেখানো হবে না। মৃত্যু সনদ বা চেয়ারম্যান সার্টিফিকেট আপলোড করে
  মুহতামিমের অনুমোদন নিন।</div>` : ''}
${o.verification_status === 'rejected' ? `<div class="v-alert v-alert-err">
  যাচাই নাকচ করা হয়েছে${o.reject_reason ? ' — ' + esc(o.reject_reason) : ''}।</div>` : ''}
${o.photo_consent === 'none' && o.photo_path ? `<div class="v-alert v-alert-warn">
  ডেটাবেসে ছবি আছে কিন্তু সম্মতি নেই, তাই ছবিটি দাতা বা ওয়েবসাইটে
  <strong>কোথাও দেখানো হচ্ছে না</strong>। অভিভাবকের সম্মতি নিয়ে নিচের বোতাম
  দিয়ে স্তর ঠিক করুন।</div>` : ''}

<div class="grid g4">
  <div class="stat-card"><div class="label">মাসিক প্রয়োজন</div>
    <div class="value">${money(o.monthly_need)}</div></div>
  <div class="stat-card blue"><div class="label">কভারেজ</div>
    <div class="value">${money(o.covered_monthly)}</div>
    <div class="foot">${bn(o.sponsor_count)} জন স্পনসর</div></div>
  <div class="stat-card ${Number(o.gap_monthly) ? 'red' : ''}"><div class="label">ঘাটতি</div>
    <div class="value">${money(o.gap_monthly)}</div>
    <div class="foot">${o.coverage_pct == null ? '' : bn(o.coverage_pct) + '% পূর্ণ'}</div></div>
  <div class="stat-card"><div class="label">মোট আদায়</div>
    <div class="value">${money(o.received_total)}</div>
    <div class="foot">${o.last_payment_date ? 'সর্বশেষ ' + bnDate(o.last_payment_date) : ''}</div></div>
</div>

<div class="grid g2">
  <div class="card"><div class="card-head"><strong>প্রাতিষ্ঠানিক তথ্য</strong>
    <span class="spacer"></span><span class="v-note">দাতার কাছে যায় না</span></div>
    <div class="card-body"><div class="v-kv">
      ${row('পুরো নাম', o.full_name)}
      ${row('দাতাকে দেখানো নাম', o.display_name ||
        ({ full: 'পুরো নাম', first_only: 'শুধু প্রথম নাম', code_only: 'শুধু কোড' })[o.name_display])}
      ${row('জন্ম তারিখ', bnDate(o.date_of_birth))}
      ${row('লিঙ্গ', o.gender === 'female' ? 'মেয়ে' : 'ছেলে')}
      ${row('পিতা', o.father_name)}
      ${row('পিতার মৃত্যু', bnDate(o.father_death_date))}
      ${row('মাতা', o.mother_name)}
      ${row('মাতার মৃত্যু', bnDate(o.mother_death_date))}
      ${row('অভিভাবক', (o.guardian_name || '') + (o.guardian_relation ? ' (' + o.guardian_relation + ')' : ''))}
      ${row('অভিভাবকের মোবাইল', o.guardian_mobile)}
      ${row('ঠিকানা', o.guardian_address)}
      ${row('থানা', o.thana)} ${row('জেলা', o.district)}
      ${row('ভাইবোন', o.sibling_count != null ? bn(o.sibling_count) + ' জন' : null)}
      ${row('শিক্ষার্থী আইডি', o.student_id)}
      ${row('ভর্তি', bnDate(o.enrolled_date))}
      ${row('বিভাগ', o.department_name)}
    </div>
    ${o.notes_bn ? `<div class="d-notes">${esc(o.notes_bn)}</div>` : ''}
    </div></div>

  <div class="card"><div class="card-head"><strong>মাসিক প্রয়োজনের ভাগ</strong></div>
    <div class="card-body">
      ${need('খাবার', o.need_food)}${need('থাকা', o.need_lodging)}
      ${need('পোশাক', o.need_clothing)}${need('কিতাব', o.need_books)}
      ${need('চিকিৎসা', o.need_medical)}${need('অন্যান্য', o.need_other)}
      <div class="v-sum-row v-total"><span>মোট</span>
        <span class="v-amt v-ok">${money(o.monthly_need)}</span></div>
      <div class="o-consent">
        <strong>ছবি ব্যবহারের সম্মতি</strong>
        <div class="v-note">${o.consent_by
          ? esc(o.consent_by) + (o.consent_date ? ' · ' + bnDate(o.consent_date) : '') +
            (o.consent_note ? '<br>' + esc(o.consent_note) : '')
          : 'কোনো সম্মতি রেকর্ড করা হয়নি।'}</div>
        <div class="o-consent-btns">
          <button class="btn btn-light btn-sm" data-consent="none">সম্মতি নেই</button>
          <button class="btn btn-light btn-sm" data-consent="sponsor_only">শুধু স্পনসরকে</button>
          <button class="btn btn-light btn-sm" data-consent="public">প্রকাশ্যে</button>
        </div>
      </div>
    </div></div>
</div>

<div class="card"><div class="card-head"><strong>স্পনসরশিপ</strong>
  <span class="spacer"></span>
  <button class="btn btn-light btn-sm" id="addSponsor">+ স্পনসর যোগ করুন</button></div>
  <div class="card-body flush"><div class="table-wrap"><table class="data compact">
    <thead><tr><th>কোড</th><th>দাতা</th><th class="num">মাসিক</th><th>শুরু</th>
      <th class="num">আদায়</th><th>রিপোর্ট</th><th>অবস্থা</th><th></th></tr></thead>
    <tbody>${sponsorships.length ? sponsorships.map((s) => `
      <tr><td>${esc(s.sponsorship_code)}</td>
        <td><a href="/admin/donors/d/${s.donor_id}">${esc(s.donor_name)}</a>
          ${Number(s.allow_direct_contact)
            ? ' <span class="badge badge-amber">সরাসরি যোগাযোগ অনুমোদিত</span>' : ''}</td>
        <td class="num">${money(s.monthly_amount)}</td>
        <td>${bnDate(s.start_date)}</td>
        <td class="num">${money(s.received_total)}</td>
        <td>${s.last_report_sent ? bnDate(s.last_report_sent) : '—'}
          <div class="v-note">${esc(FREQ_BN[s.report_frequency] || '')}</div></td>
        <td>${spnBadge(s.status)}</td>
        <td><a class="btn btn-light btn-sm" href="/admin/orphans/s/${s.sponsorship_id}/report">রিপোর্ট</a>
          ${s.status !== 'ended'
            ? `<button class="btn btn-light btn-sm" data-end="${s.sponsorship_id}">শেষ</button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="8" class="empty">এখনো কোনো স্পনসর নেই।</td></tr>'}</tbody>
  </table></div></div>
</div>

<div class="grid g2">
  <div class="card"><div class="card-head"><strong>প্রগ্রেস রিপোর্ট</strong>
    <span class="spacer"></span>
    <button class="btn btn-light btn-sm" id="addReport">+ নতুন রিপোর্ট</button></div>
    <div class="card-body flush"><div class="table-wrap"><table class="data compact">
      <thead><tr><th>সময়কাল</th><th class="num">উপস্থিতি</th><th>হিফজ</th>
        <th>অবস্থা</th><th></th></tr></thead>
      <tbody>${reports.length ? reports.map((r) => `
        <tr><td>${esc(r.period_label)}</td>
          <td class="num">${r.attendance_pct != null ? bn(r.attendance_pct) + '%' : '—'}</td>
          <td>${esc(r.hifz_progress_bn || '—')}</td>
          <td>${r.status === 'published'
            ? '<span class="badge badge-green">প্রকাশিত</span>'
            : '<span class="badge badge-amber">খসড়া</span>'}</td>
          <td>${r.status === 'draft'
            ? `<button class="btn btn-light btn-sm" data-publish="${r.id}">প্রকাশ করুন</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="5" class="empty">কোনো রিপোর্ট নেই।</td></tr>'}</tbody>
    </table></div></div></div>

  <div class="card"><div class="card-head"><strong>যাচাইয়ের কাগজ</strong>
    <span class="spacer"></span><span class="v-note">গোপনীয়</span></div>
    <div class="card-body">
      ${documents.length ? documents.map((d) => `
        <div class="v-sum-row"><span>${esc(({
          death_certificate: 'মৃত্যু সনদ', birth_certificate: 'জন্মনিবন্ধন',
          chairman_certificate: 'চেয়ারম্যান সার্টিফিকেট', guardian_nid: 'অভিভাবকের এনআইডি',
          photo: 'ছবি', consent_form: 'সম্মতিপত্র', other: 'অন্যান্য',
        })[d.doc_type] || d.doc_type)}</span>
        <span class="v-note">${esc(d.file_name)}</span></div>`).join('')
        : '<div class="empty">কোনো কাগজ আপলোড করা হয়নি।</div>'}
      <div style="margin-top:.7rem">
        <button class="btn btn-light btn-sm" id="addDoc">+ কাগজ যোগ করুন</button></div>
    </div></div>
</div>

<div class="card"><div class="card-head"><strong>সাক্ষাতের লগ</strong>
  <span class="spacer"></span>
  <button class="btn btn-light btn-sm" id="addVisit">+ সাক্ষাৎ লিখুন</button></div>
  <div class="card-body">
    <div class="v-note" style="margin-bottom:.6rem">দাতা-শিশুর সাক্ষাৎ সবসময়
      প্রতিষ্ঠানের মধ্যস্থতায় হয় এবং এখানে লিপিবদ্ধ থাকে।</div>
    ${visits.length ? visits.map((v) => `
      <div class="v-sum-row"><span>${bnDate(v.visit_date)} — ${esc(v.visitor_name)}
        ${v.donor_name ? '(' + esc(v.donor_name) + ')' : ''}
        ${v.purpose_bn ? '<div class="v-note">' + esc(v.purpose_bn) + '</div>' : ''}</span>
        <span class="v-note">মধ্যস্থতা: #${esc(v.mediated_by)}</span></div>`).join('')
      : '<div class="empty">কোনো সাক্ষাৎ লিপিবদ্ধ নেই।</div>'}
  </div>
</div>

<div id="orphanMsg" class="v-note"></div>
<script src="/js/bangla-number.js"></script>
<script>window.__ORPHAN_ID = ${o.orphan_id};</script>
<script src="/js/orphan-profile.js" defer></script>`;
}

// =====================================================================
// দাতাকে পাঠানোর প্রগ্রেস রিপোর্ট — শুধু নিরাপদ তথ্য
// =====================================================================
function sponsorReportPrint({ data, org = ORG }) {
  const c = data.child, s = data.sponsorship;
  const latest = data.reports[0];

  const kv = (k, v) => v ? `<tr><td class="k">${k}</td><td class="v">${esc(v)}</td></tr>` : '';

  const body = `
<div class="rcpt rcpt-a4 o-report">
  <header class="rcpt-head">
    <div class="rcpt-org">
      <div class="rcpt-name">${esc(org.name_bn)}</div>
      <div class="rcpt-name-en">${esc(org.name_en)}</div>
      ${org.address_bn ? `<div class="rcpt-addr">${esc(org.address_bn)}</div>` : ''}
    </div>
  </header>

  <div class="rcpt-title">এতিম স্পনসরশিপ — অগ্রগতি প্রতিবেদন</div>

  <div class="rcpt-meta">
    <div><span>স্পনসর</span><strong>${esc(data.donor.name)}</strong></div>
    <div><span>স্পনসরশিপ</span><strong>${esc(s.code)}</strong></div>
  </div>

  <div class="o-rep-grid">
    <div class="o-rep-child">
      ${c.photo ? `<div class="o-rep-photo"><img src="${esc(c.photo)}" alt=""></div>` : ''}
      <table class="rcpt-kv">
        ${kv('নাম', c.name)}
        ${kv('পরিচিতি নম্বর', c.orphan_code)}
        ${kv('বয়স', c.age_years != null ? bn(c.age_years) + ' বছর' : null)}
        ${kv('অবস্থা', c.orphan_status)}
        ${kv('শ্রেণি', c.class_name)}
        ${kv('বিভাগ', c.department)}
        ${kv('জেলা', c.district)}
        ${kv('ভর্তি', bnDate(c.enrolled_date))}
      </table>
    </div>

    <div class="o-rep-spn">
      <table class="rcpt-kv">
        ${kv('মাসিক অনুদান', money(s.monthly_amount))}
        ${kv('শুরু', bnDate(s.start_date))}
        ${kv('চলছে', s.months_running != null ? bn(s.months_running) + ' মাস' : null)}
        ${kv('প্রতিবেদনের ধরন', s.report_frequency)}
        ${kv('মাসিক প্রয়োজন', c.monthly_need != null ? money(c.monthly_need) : null)}
      </table>
      <div class="rcpt-amount">
        <div class="rcpt-amount-fig">${formatTaka(data.total_paid, { symbol: 'টাকা ', bangla: true })}</div>
        <div class="rcpt-amount-words">${esc(data.total_paid_in_words)}</div>
        <div class="v-note">আপনার মোট অনুদান</div>
      </div>
    </div>
  </div>

  ${latest ? `
  <div class="o-rep-progress">
    <h3>${esc(latest.period)} — অগ্রগতি</h3>
    <table class="rcpt-kv">
      ${kv('উপস্থিতির হার', latest.attendance_pct != null ? bn(latest.attendance_pct) + '%' : null)}
      ${kv('পরীক্ষার ফলাফল', latest.exam_result)}
      ${kv('হিফজের অগ্রগতি', latest.hifz_progress)}
      ${kv('স্বাস্থ্য', latest.health_note || c.health_note)}
    </table>
    ${latest.teacher_comment ? `<div class="o-rep-comment">
      <strong>শিক্ষকের মন্তব্য</strong><div>${esc(latest.teacher_comment)}</div></div>` : ''}
    ${latest.child_letter ? `<div class="o-rep-letter">
      <strong>শিশুর হাতে লেখা চিঠি</strong>
      <img src="${esc(latest.child_letter)}" alt=""></div>` : ''}
  </div>` : `<div class="o-rep-progress"><div class="empty">
    এখনো কোনো প্রকাশিত অগ্রগতি প্রতিবেদন নেই।</div></div>`}

  ${data.reports.length > 1 ? `<div class="o-rep-history">
    <strong>আগের প্রতিবেদনসমূহ</strong>
    ${data.reports.slice(1).map((r) => `<div class="v-sum-row">
      <span>${esc(r.period)}</span>
      <span class="v-note">${r.attendance_pct != null ? 'উপস্থিতি ' + bn(r.attendance_pct) + '%' : ''}
        ${r.hifz_progress ? ' · ' + esc(r.hifz_progress) : ''}</span></div>`).join('')}
  </div>` : ''}

  ${data.payments.length ? `<div class="o-rep-pay">
    <strong>আপনার অনুদানের হিসাব</strong>
    <table class="data compact" style="width:100%;margin-top:.4rem">
      <thead><tr><th>রশিদ</th><th>তারিখ</th><th class="num">পরিমাণ</th></tr></thead>
      <tbody>${data.payments.map((p) => `<tr><td>${esc(p.receipt_no)}</td>
        <td>${bnDate(p.date)}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}</tbody>
    </table>
  </div>` : ''}

  <div class="d-stmt-thanks">
    আপনার নিয়মিত সহযোগিতায় এই শিশুটি নির্বিঘ্নে পড়াশোনা চালিয়ে যেতে পারছে।
    আল্লাহ তাআলা আপনার সম্পদে বরকত দান করুন। জাযাকাল্লাহু খাইরান।
  </div>

  <div class="o-rep-note">
    শিশুর নিরাপত্তার জন্য তার পূর্ণ ঠিকানা, অভিভাবকের যোগাযোগ ও পারিবারিক কাগজপত্র
    এই প্রতিবেদনে দেওয়া হয় না। শিশুর সাথে দেখা করতে চাইলে প্রতিষ্ঠানের মাধ্যমে
    সময় নির্ধারণ করুন।
  </div>

  <footer class="rcpt-foot">
    <div class="rcpt-sign"><span></span>শিক্ষক / তত্ত্বাবধায়ক</div>
    <div class="rcpt-sign"><span></span>মুহতামিম</div>
  </footer>
</div>
<div class="rcpt-bar">
  <button class="btn btn-primary" onclick="window.print()">প্রিন্ট</button>
  <a class="btn btn-light" href="/admin/orphans/sponsorships">স্পনসরশিপ তালিকা</a>
</div>`;

  return page({ title: 'অগ্রগতি প্রতিবেদন — ' + c.name, body, bare: true });
}

function notFound(msg) {
  return page({ title: 'পাওয়া যায়নি', body:
    `<div class="card"><div class="card-body empty">${esc(msg || 'পাওয়া যায়নি।')}</div></div>` });
}

module.exports = {
  page, orphanList, unsponsoredPool, sponsorshipList, orphanProfile,
  sponsorReportPrint, notFound, ORG, esc, money, bnDate,
};

'use strict';
/** স্পনসর ও অনুদান বিভাগের ভিউ */
const { takaInWords, toBanglaDigits, formatTaka } = require('../lib/bangla-number');

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (v) => 'Tk ' + Number(v || 0).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

const bnDate = (d) => toBanglaDigits(ymd(d).split('-').reverse().join('/'));
const year = () => new Date().getFullYear();

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
</head>
<body>${bare ? body : `<div class="shell"><main class="main"><div class="content">${body}</div></main></div>`}</body>
</html>`;
}

const nav = (active) => `
<div class="d-nav">
  ${[['', 'দাতা'], ['campaigns', 'প্রচারাভিযান'], ['followups', 'ফলো-আপ'], ['reports', 'রিপোর্ট']]
    .map(([p, label]) => `<a href="/admin/donors/${p}"${active === p ? ' class="is-on"' : ''}>${label}</a>`)
    .join('')}
</div>`;

// =====================================================================
// দাতা তালিকা
// =====================================================================
function donorList() {
  return `
<div class="page-bar">
  <div><h1 class="page-title">দাতা ও স্পনসর</h1><div class="sub">অনুদান বিভাগ</div></div>
  <div class="spacer"></div>
  <button class="btn btn-light" id="mergeBtn" disabled>২টি নির্বাচন করে একীভূত করুন</button>
  <a class="btn btn-primary" href="/admin/receipts/new?type=DON">+ অনুদান নিন</a>
</div>
${nav('')}
<div class="grid g4" id="statRow"></div>
<div class="card">
  <div class="card-head">
    <strong>দাতার তালিকা</strong><span class="spacer"></span>
    <div class="filters">
      <div class="field"><select id="fSort">
        <option value="total">মোট দান অনুযায়ী</option>
        <option value="recent">সর্বশেষ দান অনুযায়ী</option>
        <option value="name">নাম অনুযায়ী</option>
      </select></div>
      <div class="field"><select id="fDistrict"><option value="">সব জেলা</option></select></div>
      <div class="field"><label class="d-check"><input type="checkbox" id="fExpat"> প্রবাসী</label></div>
      <div class="field grow"><input type="search" id="fQ" placeholder="নাম, মোবাইল বা কোড"></div>
    </div>
  </div>
  <div class="card-body flush"><div class="table-wrap">
    <table class="data compact">
      <thead><tr><th class="d-pick"></th><th>কোড</th><th>নাম</th><th>মোবাইল</th><th>এলাকা</th>
        <th class="num">দান</th><th class="num">মোট</th><th>সর্বশেষ</th><th></th></tr></thead>
      <tbody id="listBody"><tr><td colspan="9" class="empty">লোড হচ্ছে…</td></tr></tbody>
    </table>
  </div></div>
</div>
<script src="/js/bangla-number.js"></script>
<script src="/js/donor-list.js" defer></script>`;
}

// =====================================================================
// দাতার প্রোফাইল
// =====================================================================
function donorProfile({ donor: d, receipts, pledges, plans, byType }) {
  const row = (k, v) => v ? `<div><span class="label">${k}</span><span class="value">${esc(v)}</span></div>` : '';
  const tierBadge = d.recognition_tier
    ? `<span class="badge badge-green">${esc(d.recognition_tier)}</span>` : '';
  const lapsed = d.months_since_last != null && d.months_since_last >= 6;

  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">${esc(d.name)} ${tierBadge}</h1>
    <div class="sub">${esc(d.donor_code || '')}${d.mobile ? ' · ' + esc(d.mobile) : ''}
      ${Number(d.is_expatriate) ? ' · প্রবাসী (' + esc(d.country) + ')' : ''}</div>
  </div>
  <div class="spacer"></div>
  <a class="btn btn-light" href="/admin/donors/d/${d.donor_id}/statement?from=${year()}-01-01&to=${year()}-12-31">বার্ষিক বিবরণী</a>
  <a class="btn btn-light" href="/admin/receipts/new?type=DON&donor=${d.donor_id}">+ অনুদান নিন</a>
  <button class="btn btn-light" id="editBtn">তথ্য সম্পাদনা</button>
</div>
${nav('')}

${lapsed ? `<div class="v-alert v-alert-warn">এই দাতা
  <strong>${toBanglaDigits(d.months_since_last)} মাস</strong> ধরে কিছু দেননি —
  একবার যোগাযোগ করা যেতে পারে।</div>` : ''}
${!Number(d.allow_contact) ? `<div class="v-alert v-alert-warn">এই দাতা
  যোগাযোগ করতে নিষেধ করেছেন। রিমাইন্ডার বা ফলো-আপ তালিকায় তিনি আসবেন না।</div>` : ''}
${d.merged_into_id ? `<div class="v-alert v-alert-warn">এই রেকর্ডটি অন্য দাতার সাথে
  একীভূত করা হয়েছে। <a href="/admin/donors/d/${d.merged_into_id}">মূল রেকর্ড দেখুন</a></div>` : ''}

<div class="grid g4">
  <div class="stat-card"><div class="label">মোট দান</div>
    <div class="value">${money(d.total_given)}</div>
    <div class="foot">${toBanglaDigits(d.gift_count)} বার</div></div>
  <div class="stat-card"><div class="label">প্রথম দান</div>
    <div class="value">${d.first_gift_date ? bnDate(d.first_gift_date) : '—'}</div></div>
  <div class="stat-card"><div class="label">সর্বশেষ দান</div>
    <div class="value">${d.last_gift_date ? bnDate(d.last_gift_date) : '—'}</div>
    <div class="foot">${d.months_since_last != null ? toBanglaDigits(d.months_since_last) + ' মাস আগে' : ''}</div></div>
  <div class="stat-card ${Number(d.open_pledged) ? 'gold' : ''}"><div class="label">বাকি প্রতিশ্রুতি</div>
    <div class="value">${money(d.open_pledged)}</div></div>
</div>

<div class="grid g2">
  <div class="card"><div class="card-head"><strong>তথ্য</strong></div>
    <div class="card-body"><div class="v-kv">
      ${row('ধরন', d.donor_type === 'organization' ? 'প্রতিষ্ঠান' : 'ব্যক্তি')}
      ${row('মোবাইল', d.mobile)} ${row('ইমেইল', d.email)}
      ${row('ঠিকানা', d.address)} ${row('থানা', d.thana)} ${row('জেলা', d.district)}
      ${row('দেশ', d.country)} ${row('পরিচয়ের সূত্র', d.source_bn)}
      ${row('পছন্দের যোগাযোগ', ({ sms: 'এসএমএস', whatsapp: 'হোয়াটসঅ্যাপ', call: 'ফোন', email: 'ইমেইল', none: 'কিছু নয়' })[d.preferred_contact])}
      ${row('স্বীকৃতি', d.recognition_tier)}
    </div>
    ${d.notes_bn ? `<div class="d-notes">${esc(d.notes_bn)}</div>` : ''}
    </div></div>

  <div class="card"><div class="card-head"><strong>খাত অনুযায়ী</strong></div>
    <div class="card-body">${byType.length ? byType.map((t) => `
      <div class="v-sum-row"><span>${esc(t.type_name)} (${toBanglaDigits(t.n)})</span>
        <span class="v-amt">${money(t.total)}</span></div>`).join('')
      : '<div class="empty">এখনো কোনো দান নেই।</div>'}</div></div>
</div>

<div class="card"><div class="card-head"><strong>দানের ইতিহাস</strong>
  <span class="spacer"></span><span class="v-note">সর্বশেষ ৫০টি</span></div>
  <div class="card-body flush"><div class="table-wrap">
  <table class="data compact">
    <thead><tr><th>রশিদ</th><th>তারিখ</th><th>ধরন</th><th>ফান্ড</th>
      <th class="num">পরিমাণ</th><th>অবস্থা</th></tr></thead>
    <tbody>${receipts.length ? receipts.map((r) => `
      <tr class="${r.status === 'void' ? 'r-void-row' : ''}">
        <td><a href="/admin/receipts/r/${r.id}">${esc(r.receipt_no)}</a></td>
        <td>${bnDate(r.receipt_date)}</td>
        <td>${esc(r.type_name)}</td><td>${esc(r.fund_name)}</td>
        <td class="num">${money(r.amount)}</td>
        <td>${r.status === 'void' ? '<span class="badge badge-red">বাতিল</span>'
                                  : '<span class="badge badge-green">বৈধ</span>'}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">এখনো কোনো দান নেই।</td></tr>'}</tbody>
  </table></div></div>
</div>

<div class="grid g2">
  <div class="card"><div class="card-head"><strong>প্রতিশ্রুতি</strong>
    <span class="spacer"></span>
    <button class="btn btn-light btn-sm" id="addPledge">+ যোগ করুন</button></div>
    <div class="card-body flush"><div class="table-wrap">
    <table class="data compact">
      <thead><tr><th>তারিখ</th><th>খাত</th><th class="num">প্রতিশ্রুত</th>
        <th class="num">এসেছে</th><th class="num">বাকি</th><th>অবস্থা</th></tr></thead>
      <tbody>${pledges.length ? pledges.map((p) => `
        <tr><td>${bnDate(p.pledged_date)}</td>
          <td>${esc(p.purpose_bn || p.fund_name)}</td>
          <td class="num">${money(p.amount)}</td>
          <td class="num">${money(p.received)}</td>
          <td class="num">${money(p.outstanding)}</td>
          <td>${pledgeBadge(p.status)}</td></tr>`).join('')
        : '<tr><td colspan="6" class="empty">কোনো প্রতিশ্রুতি নেই।</td></tr>'}</tbody>
    </table></div></div></div>

  <div class="card"><div class="card-head"><strong>মাসিক নিয়মিত দান</strong>
    <span class="spacer"></span>
    <button class="btn btn-light btn-sm" id="addPlan">+ যোগ করুন</button></div>
    <div class="card-body flush"><div class="table-wrap">
    <table class="data compact">
      <thead><tr><th>ধরন</th><th>ফান্ড</th><th class="num">মাসিক</th>
        <th>তারিখ</th><th>অবস্থা</th><th></th></tr></thead>
      <tbody>${plans.length ? plans.map((p) => `
        <tr><td>${esc(p.type_name)}</td><td>${esc(p.fund_name)}</td>
          <td class="num">${money(p.amount)}</td>
          <td>প্রতি ${toBanglaDigits(p.day_of_month)} তারিখ</td>
          <td>${planBadge(p.status)}</td>
          <td>${p.status === 'active'
            ? `<button class="btn btn-light btn-sm" data-plan="${p.id}" data-status="paused">স্থগিত</button>`
            : p.status === 'paused'
              ? `<button class="btn btn-light btn-sm" data-plan="${p.id}" data-status="active">চালু</button>`
              : ''}</td></tr>`).join('')
        : '<tr><td colspan="6" class="empty">কোনো মাসিক পরিকল্পনা নেই।</td></tr>'}</tbody>
    </table></div></div></div>
</div>

<div id="donorMsg" class="v-note"></div>
<script src="/js/bangla-number.js"></script>
<script src="/js/donor-profile.js" defer></script>
<script>window.__DONOR_ID = ${d.donor_id};</script>`;
}

const pledgeBadge = (s) => ({
  open: '<span class="badge badge-amber">খোলা</span>',
  partial: '<span class="badge badge-amber">আংশিক</span>',
  fulfilled: '<span class="badge badge-green">পূর্ণ</span>',
  cancelled: '<span class="badge badge-red">বাতিল</span>',
})[s] || esc(s);

const planBadge = (s) => ({
  active: '<span class="badge badge-green">চালু</span>',
  paused: '<span class="badge badge-amber">স্থগিত</span>',
  ended: '<span class="badge">শেষ</span>',
})[s] || esc(s);

// =====================================================================
// প্রচারাভিযান
// =====================================================================
function campaignList() {
  return `
<div class="page-bar">
  <div><h1 class="page-title">প্রচারাভিযান</h1><div class="sub">লক্ষ্য বনাম সংগ্রহ</div></div>
  <div class="spacer"></div>
  <button class="btn btn-primary" id="newCampaign">+ নতুন প্রচারাভিযান</button>
</div>
${nav('campaigns')}
<div id="campaignBox"><div class="empty">লোড হচ্ছে…</div></div>
<script src="/js/bangla-number.js"></script>
<script src="/js/campaigns.js" defer></script>`;
}

function campaignDetail({ campaign: c, recent, pledges }) {
  const pct = c.pct == null ? 0 : Math.min(Number(c.pct), 100);
  return `
<div class="page-bar">
  <div><h1 class="page-title">${esc(c.title_bn)}</h1>
    <div class="sub">${esc(c.code)} · ${esc(c.fund_name)} ·
      ${c.status === 'active' ? 'সক্রিয়' : c.status === 'closed' ? 'বন্ধ' : 'খসড়া'}</div></div>
  <div class="spacer"></div>
  <a class="btn btn-primary" href="/admin/receipts/new?type=DON&campaign=${c.campaign_id}">+ অনুদান নিন</a>
</div>
${nav('campaigns')}
<div class="card"><div class="card-body">
  ${c.description_bn ? `<p class="d-desc">${esc(c.description_bn)}</p>` : ''}
  <div class="d-prog"><div class="d-prog-fill" style="width:${pct}%"></div>
    <span class="d-prog-label">${c.pct == null ? '—' : toBanglaDigits(c.pct) + '%'}</span></div>
  <div class="grid g4" style="margin-top:1rem">
    <div class="stat-card"><div class="label">লক্ষ্য</div><div class="value">${money(c.target_amount)}</div></div>
    <div class="stat-card blue"><div class="label">সংগৃহীত</div><div class="value">${money(c.raised)}</div>
      <div class="foot">${toBanglaDigits(c.donor_count)} জন দাতা</div></div>
    <div class="stat-card"><div class="label">বাকি</div><div class="value">${money(c.remaining)}</div></div>
    <div class="stat-card gold"><div class="label">প্রতিশ্রুত (অনাদায়ী)</div>
      <div class="value">${money(c.pledged_open)}</div>
      <div class="foot">${c.days_left == null ? '' :
        c.days_left >= 0 ? toBanglaDigits(c.days_left) + ' দিন বাকি' : 'মেয়াদ শেষ'}</div></div>
  </div>
</div></div>

<div class="grid g2">
  <div class="card"><div class="card-head"><strong>সাম্প্রতিক অনুদান</strong></div>
    <div class="card-body flush"><div class="table-wrap"><table class="data compact">
      <tbody>${recent.length ? recent.map((r) => `
        <tr><td><a href="/admin/receipts/r/${r.id}">${esc(r.receipt_no)}</a></td>
          <td>${bnDate(r.receipt_date)}</td>
          <td>${r.donor_id
            ? `<a href="/admin/donors/d/${r.donor_id}">${esc(r.donor_name)}</a>`
            : esc(r.payer_name || '—')}</td>
          <td class="num">${money(r.amount)}</td></tr>`).join('')
        : '<tr><td class="empty">এখনো কোনো অনুদান আসেনি।</td></tr>'}</tbody>
    </table></div></div></div>

  <div class="card"><div class="card-head"><strong>প্রতিশ্রুতি</strong></div>
    <div class="card-body flush"><div class="table-wrap"><table class="data compact">
      <thead><tr><th>দাতা</th><th class="num">প্রতিশ্রুত</th><th class="num">বাকি</th><th>অবস্থা</th></tr></thead>
      <tbody>${pledges.length ? pledges.map((p) => `
        <tr><td><a href="/admin/donors/d/${p.donor_id}">${esc(p.donor_name)}</a></td>
          <td class="num">${money(p.amount)}</td><td class="num">${money(p.outstanding)}</td>
          <td>${pledgeBadge(p.status)}</td></tr>`).join('')
        : '<tr><td colspan="4" class="empty">কোনো প্রতিশ্রুতি নেই।</td></tr>'}</tbody>
    </table></div></div></div>
</div>`;
}

// =====================================================================
// ফলো-আপ — প্রতিশ্রুতি, মাসিক বাকি, নিষ্ক্রিয় দাতা
// =====================================================================
function followUps() {
  return `
<div class="page-bar">
  <div><h1 class="page-title">ফলো-আপ</h1>
    <div class="sub">কার কাছে ফিরে যেতে হবে</div></div>
</div>
${nav('followups')}
<div class="d-tabs" id="tabs">
  <button class="is-on" data-tab="pledges">বাকি প্রতিশ্রুতি</button>
  <button data-tab="recurring">এ মাসের মাসিক দান</button>
  <button data-tab="lapsed">নিষ্ক্রিয় দাতা</button>
</div>
<div id="tabBox"><div class="empty">লোড হচ্ছে…</div></div>
<script src="/js/bangla-number.js"></script>
<script src="/js/followups.js" defer></script>`;
}

// =====================================================================
// রিপোর্ট
// =====================================================================
function reports() {
  return `
<div class="page-bar">
  <div><h1 class="page-title">অনুদানের রিপোর্ট</h1></div>
  <div class="spacer"></div>
  <div class="filters"><div class="field">
    <input type="number" id="rYear" value="${year()}" min="2000" max="2100" style="width:7rem">
  </div></div>
  <button class="btn btn-light" onclick="window.print()">প্রিন্ট</button>
</div>
${nav('reports')}
<div id="reportBox"><div class="empty">লোড হচ্ছে…</div></div>
<script src="/js/bangla-number.js"></script>
<script src="/js/donor-reports.js" defer></script>`;
}

// =====================================================================
// বার্ষিক বিবরণী — প্রিন্টযোগ্য, দাতাকে পাঠানোর জন্য
// =====================================================================
function statementPrint({ st, org = ORG }) {
  const d = st.donor;
  const body = `
<div class="rcpt rcpt-a4 d-stmt">
  <header class="rcpt-head">
    <div class="rcpt-org">
      <div class="rcpt-name">${esc(org.name_bn)}</div>
      <div class="rcpt-name-en">${esc(org.name_en)}</div>
      ${org.address_bn ? `<div class="rcpt-addr">${esc(org.address_bn)}</div>` : ''}
    </div>
  </header>

  <div class="rcpt-title">অনুদানের বার্ষিক বিবরণী</div>

  <div class="rcpt-meta">
    <div><span>দাতা</span><strong>${esc(d.name)}${d.donor_code ? ' (' + esc(d.donor_code) + ')' : ''}</strong></div>
    <div><span>সময়কাল</span><strong>${bnDate(st.from)} — ${bnDate(st.to)}</strong></div>
  </div>

  <table class="data compact" style="width:100%;margin-top:.6rem">
    <thead><tr><th>রশিদ</th><th>তারিখ</th><th>খাত</th><th>ফান্ড / প্রকল্প</th>
      <th class="num">পরিমাণ</th></tr></thead>
    <tbody>${st.rows.length ? st.rows.map((r) => `
      <tr><td>${esc(r.receipt_no)}</td><td>${bnDate(r.receipt_date)}</td>
        <td>${esc(r.type_name)}</td>
        <td>${esc(r.campaign_title || r.fund_name)}
          ${r.purpose_bn ? '<div class="v-note">' + esc(r.purpose_bn) + '</div>' : ''}</td>
        <td class="num">${money(r.amount)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">এই সময়কালে কোনো দান নেই।</td></tr>'}</tbody>
    <tfoot><tr><th colspan="4" class="num">সর্বমোট</th>
      <th class="num">${money(st.total)}</th></tr></tfoot>
  </table>

  <div class="rcpt-amount">
    <div class="rcpt-amount-fig">${formatTaka(st.total, { symbol: 'টাকা ', bangla: true })}</div>
    <div class="rcpt-amount-words">${esc(st.total_in_words)}</div>
  </div>

  ${st.byFund.length ? `<div class="d-stmt-funds">
    <strong>আপনার দান যে খাতে ব্যবহৃত হয়েছে</strong>
    ${st.byFund.map((b) => `<div class="v-sum-row"><span>${esc(b.fund_name)}</span>
      <span class="v-amt">${money(b.total)}</span></div>`).join('')}
  </div>` : ''}

  <div class="d-stmt-thanks">
    আপনার অনুদানে ${esc(org.name_bn)} এর শিক্ষার্থীরা নির্বিঘ্নে পড়াশোনা চালিয়ে যেতে পারছে।
    আল্লাহ তাআলা আপনার সম্পদে বরকত দান করুন এবং উত্তম প্রতিদান দিন। জাযাকাল্লাহু খাইরান।
  </div>

  <footer class="rcpt-foot">
    <div class="rcpt-sign"><span></span>হিসাবরক্ষক</div>
    <div class="rcpt-sign"><span></span>মুহতামিম</div>
  </footer>
</div>
<div class="rcpt-bar">
  <button class="btn btn-primary" onclick="window.print()">প্রিন্ট</button>
  <a class="btn btn-light" href="/admin/donors/d/${d.donor_id}">প্রোফাইলে ফিরুন</a>
</div>`;
  return page({ title: 'বিবরণী — ' + d.name, body, bare: true });
}

function notFound(msg) {
  return page({ title: 'পাওয়া যায়নি', body:
    `<div class="card"><div class="card-body empty">${esc(msg || 'পাওয়া যায়নি।')}</div></div>` });
}

module.exports = {
  page, donorList, donorProfile, campaignList, campaignDetail,
  followUps, reports, statementPrint, notFound, ORG, esc, money, bnDate,
};

'use strict';
/**
 * /admin/ledger এর ভিউ।
 *
 * HTML স্ট্রিং হিসেবে লেখা, তাই যেকোনো টেমপ্লেট ইঞ্জিনের সাথে চলে (বা ছাড়াই)।
 * আপনার নিজের লেআউট থাকলে ledgerRouter-এ `layout` দিন, তাহলে এখান থেকে
 * শুধু content অংশটুকু যাবে। না দিলে page() পূর্ণ ডকুমেন্ট বানিয়ে দেয়।
 *
 * ক্লাস ও টোকেন আপনার admin.css / theme-tokens.css থেকেই নেওয়া —
 * নতুন ডিজাইন ভাষা চাপানো হয়নি। শুধু লাইন-গ্রিডের জন্য ledger.css।
 */

const esc = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (v) =>
  'Tk ' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);

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


const TYPE_NAMES = {
  RV: 'জমা ভাউচার', PV: 'খরচ ভাউচার', JV: 'জার্নাল ভাউচার',
  CV: 'কন্ট্রা ভাউচার', FT: 'ফান্ড ট্রান্সফার',
};

const STATUS = {
  draft:    ['ড্রাফট', 'badge'],
  pending:  ['অপেক্ষমাণ', 'badge badge-amber'],
  approved: ['অনুমোদিত', 'badge badge-green'],
  posted:   ['পোস্টেড', 'badge badge-green'],
  rejected: ['বাতিল', 'badge badge-red'],
};

const statusBadge = (s, reversedAt) => {
  const [label, cls] = STATUS[s] || [s, 'badge'];
  const rev = reversedAt ? ' <span class="badge badge-red">রিভার্সড</span>' : '';
  return '<span class="' + cls + '">' + esc(label) + '</span>' + rev;
};

// =====================================================================
// পূর্ণ ডকুমেন্ট (নিজের লেআউট না থাকলে)
// =====================================================================
function page({ title, body }) {
  return `<!DOCTYPE html>
<html lang="bn" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ব্যবস্থাপনা | Jamiah Scholars</title>
<link rel="stylesheet" href="/css/theme-tokens.css">
<link rel="stylesheet" href="/css/admin.css">
<link rel="stylesheet" href="/css/ledger.css">
</head>
<body>
<div class="shell">
  <main class="main">
    <div class="content">${body}</div>
  </main>
</div>
</body>
</html>`;
}

// =====================================================================
// ভাউচার এন্ট্রি
// =====================================================================
function voucherForm({ type = 'PV' } = {}) {
  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">নতুন ভাউচার</h1>
    <div class="sub" id="typeHint">হিসাব ও অর্থ বিভাগ · খতিয়ানে সরাসরি বসবে</div>
  </div>
  <div class="spacer"></div>
  <a class="btn btn-light" href="/admin/ledger">ভাউচার তালিকা</a>
  <a class="btn btn-light" href="/admin/ledger/day-book">দিনের খতিয়ান</a>
</div>

<div id="vAlert" class="v-alert" hidden></div>

<form id="voucherForm" class="card" autocomplete="off" novalidate>
  <input type="hidden" name="voucher_type" id="voucherType" value="${esc(type)}">

  <div class="card-head v-types" id="typePills"></div>

  <div class="card-body">
    <div class="form-grid two">
      <div class="field">
        <label for="voucherDate">তারিখ <span class="req">*</span></label>
        <input type="date" id="voucherDate" name="voucher_date" value="${today()}" required>
        <div class="v-note" id="periodNote"></div>
      </div>

      <div class="field">
        <label for="paymentMethod">পরিশোধ মাধ্যম</label>
        <select id="paymentMethod" name="payment_method"></select>
      </div>

      <div class="field" id="cashAccountField">
        <label for="cashAccount" id="cashAccountLabel">নগদ / ব্যাংক হিসাব <span class="req">*</span></label>
        <select id="cashAccount"></select>
        <div class="v-note" id="cashNote"></div>
      </div>

      <div class="field" id="instrumentField" hidden>
        <label for="instrumentNo">চেক / ট্রানজ্যাকশন নম্বর</label>
        <input type="text" id="instrumentNo" name="instrument_no" placeholder="যেমন: TrxID 9F2K8LQ">
      </div>

      <div class="field">
        <label for="partyType">পক্ষের ধরন</label>
        <select id="partyType" name="party_type">
          <option value="">— প্রযোজ্য নয় —</option>
          <option value="student">শিক্ষার্থী</option>
          <option value="staff">শিক্ষক / কর্মচারী</option>
          <option value="donor">দাতা / স্পনসর</option>
          <option value="supplier">সরবরাহকারী</option>
          <option value="other">অন্যান্য</option>
        </select>
      </div>

      <div class="field">
        <label for="partyId">পক্ষের আইডি</label>
        <input type="number" id="partyId" name="party_id" min="1" placeholder="শিক্ষার্থী/স্টাফ/দাতার আইডি">
      </div>

      <div class="field full">
        <label for="narration">বিবরণ <span class="req">*</span></label>
        <input type="text" id="narration" name="narration_bn" required
               placeholder="যেমন: নভেম্বর মাসের চাল ও ডাল ক্রয় — মুদি দোকান">
      </div>
    </div>
  </div>

  <div class="card-body flush">
    <div class="table-wrap">
      <table class="data compact v-lines" id="lineTable">
        <thead>
          <tr>
            <th class="v-c-no">#</th>
            <th class="v-c-acc">হিসাব <span class="req">*</span></th>
            <th class="v-c-fund">ফান্ড <span class="req">*</span></th>
            <th class="v-c-cc">বিভাগ</th>
            <th class="v-c-amt v-simple-only">পরিমাণ <span class="req">*</span></th>
            <th class="v-c-amt v-journal-only">ডেবিট</th>
            <th class="v-c-amt v-journal-only">ক্রেডিট</th>
            <th class="v-c-act"></th>
          </tr>
        </thead>
        <tbody id="lineBody"></tbody>
        <tfoot id="lineFoot"></tfoot>
      </table>
    </div>
    <div class="v-line-actions">
      <button type="button" class="btn btn-light btn-sm" id="addLine">+ লাইন যোগ করুন</button>
      <span class="v-kbd">Enter — নতুন লাইন · Ctrl+Enter — সংরক্ষণ</span>
    </div>
  </div>

  <div class="card-body v-summary">
    <div class="v-sum-grid">
      <div class="v-sum-box" id="totalsBox"></div>
      <div class="v-sum-box" id="fundBox"></div>
    </div>

    <div class="field v-override" id="overrideBox" hidden>
      <label class="v-check">
        <input type="checkbox" id="fatwaOverride">
        ফান্ড বিধিনিষেধ অতিক্রম করতে চাই (মুহতামিম / কমিটি)
      </label>
      <textarea id="fatwaNote" rows="2"
        placeholder="লিখিত কারণ — যেমন: হীলায়ে তামলিকের পর এই ব্যয় অনুমোদিত। রেফ: ফতোয়া নং …"></textarea>
      <div class="v-note">কারণটি অডিট লগে স্থায়ীভাবে থাকবে।</div>
    </div>

    <div class="form-actions">
      <button type="submit" class="btn btn-primary" id="saveBtn">সংরক্ষণ করুন</button>
      <a class="btn btn-light" href="/admin/ledger">বাতিল</a>
      <span class="spacer"></span>
      <span class="v-note" id="approverNote"></span>
    </div>
  </div>
</form>

<template id="lineTpl">
  <tr class="v-line">
    <td class="v-c-no"><span class="v-lineno"></span></td>
    <td class="v-c-acc">
      <div class="v-combo">
        <input type="text" class="v-acc-input" placeholder="কোড বা নাম লিখুন — যেমন 5201 বা খাবার">
        <input type="hidden" class="v-acc-id">
        <div class="v-combo-list" hidden></div>
      </div>
      <div class="v-line-warn" hidden></div>
    </td>
    <td class="v-c-fund"><select class="v-fund"></select></td>
    <td class="v-c-cc"><select class="v-cc"></select></td>
    <td class="v-c-amt v-simple-only">
      <input type="number" class="v-amount" step="0.01" min="0" placeholder="0.00">
    </td>
    <td class="v-c-amt v-journal-only">
      <input type="number" class="v-debit" step="0.01" min="0" placeholder="0.00">
    </td>
    <td class="v-c-amt v-journal-only">
      <input type="number" class="v-credit" step="0.01" min="0" placeholder="0.00">
    </td>
    <td class="v-c-act">
      <button type="button" class="v-del" title="লাইন মুছুন">&times;</button>
    </td>
  </tr>
</template>

<script src="/js/voucher-entry.js" defer></script>`;
}

// =====================================================================
// ভাউচার তালিকা
// =====================================================================
function voucherList() {
  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">ভাউচার ও খতিয়ান</h1>
    <div class="sub">হিসাব ও অর্থ বিভাগ</div>
  </div>
  <div class="spacer"></div>
  <a class="btn btn-light" href="/admin/ledger/day-book">দিনের খতিয়ান</a>
  <a class="btn btn-light" href="/admin/ledger/new?type=RV">+ জমা</a>
  <a class="btn btn-primary" href="/admin/ledger/new?type=PV">+ খরচ</a>
</div>

<div class="grid g4" id="statRow"></div>

<div class="card" id="pendingCard" hidden>
  <div class="card-head">
    <strong>অনুমোদনের অপেক্ষায়</strong>
    <span class="spacer"></span>
    <span class="badge badge-amber" id="pendingCount"></span>
  </div>
  <div class="card-body flush">
    <div class="table-wrap"><table class="data compact"><tbody id="pendingBody"></tbody></table></div>
  </div>
</div>

<div class="card">
  <div class="card-head">
    <strong>সব ভাউচার</strong>
    <span class="spacer"></span>
    <div class="filters">
      <div class="field"><select id="fType">
        <option value="">সব ধরন</option>
        <option value="RV">জমা (RV)</option><option value="PV">খরচ (PV)</option>
        <option value="JV">জার্নাল (JV)</option><option value="CV">কন্ট্রা (CV)</option>
        <option value="FT">ফান্ড ট্রান্সফার (FT)</option>
      </select></div>
      <div class="field"><select id="fStatus">
        <option value="">সব অবস্থা</option>
        <option value="pending">অপেক্ষমাণ</option><option value="approved">অনুমোদিত</option>
        <option value="posted">পোস্টেড</option><option value="rejected">বাতিল</option>
      </select></div>
      <div class="field grow"><input type="search" id="fQ" placeholder="নম্বর বা বিবরণ খুঁজুন"></div>
    </div>
  </div>
  <div class="card-body flush">
    <div class="table-wrap">
      <table class="data compact">
        <thead><tr>
          <th>নম্বর</th><th>তারিখ</th><th>ধরন</th><th>বিবরণ</th>
          <th>ফান্ড</th><th class="num">পরিমাণ</th><th>অবস্থা</th><th></th>
        </tr></thead>
        <tbody id="listBody"><tr><td colspan="8" class="empty">লোড হচ্ছে…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>

<script src="/js/voucher-list.js" defer></script>`;
}

// =====================================================================
// দিনের খতিয়ান
// =====================================================================
function dayBook() {
  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">দিনের খতিয়ান</h1>
    <div class="sub">দিন শেষে ক্যাশ মিলানোর জন্য</div>
  </div>
  <div class="spacer"></div>
  <div class="filters">
    <div class="field"><input type="date" id="dbDate" value="${today()}"></div>
  </div>
  <button class="btn btn-light" onclick="window.print()">প্রিন্ট</button>
</div>
<div id="dayBookOut"><div class="empty">লোড হচ্ছে…</div></div>
<script src="/js/day-book.js" defer></script>`;
}

// =====================================================================
// একটি ভাউচার (প্রিন্টযোগ্য)
// =====================================================================
function voucherDetail({ voucher: v, lines, attachments }) {
  const isSimple = ['RV', 'PV'].includes(v.voucher_type);
  const totalD = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalC = lines.reduce((s, l) => s + Number(l.credit), 0);

  const rows = lines.map((l) => `
    <tr>
      <td>${l.line_no}</td>
      <td><strong>${esc(l.account_code)}</strong> ${esc(l.account_name)}
        ${l.line_narration ? '<div class="v-note">' + esc(l.line_narration) + '</div>' : ''}</td>
      <td>${esc(l.fund_name)}</td>
      <td>${esc(l.cost_center || '—')}</td>
      <td class="num">${Number(l.debit) ? money(l.debit) : '—'}</td>
      <td class="num">${Number(l.credit) ? money(l.credit) : '—'}</td>
    </tr>`).join('');

  const canApprove = v.status === 'pending';
  const canPost = v.status === 'approved';
  const canReverse = v.status === 'posted' && !v.reversed_at && !v.reversal_of_id;

  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">${esc(v.voucher_no)}</h1>
    <div class="sub">${esc(TYPE_NAMES[v.voucher_type] || v.voucher_type)} ·
      ${esc(ymd(v.voucher_date))} · ${esc(v.period_label)}</div>
  </div>
  <div class="spacer"></div>
  ${statusBadge(v.status, v.reversed_at)}
  <button class="btn btn-light" onclick="window.print()">প্রিন্ট</button>
  <a class="btn btn-light" href="/admin/ledger">তালিকা</a>
</div>

${v.reversed_at ? `<div class="v-alert v-alert-warn">এই ভাউচারটি
  ${esc(ymd(v.reversed_at))} তারিখে রিভার্স করা হয়েছে
  ${v.reversed_by_no ? '(' + esc(v.reversed_by_no) + ')' : ''} —
  খতিয়ানে দুটি এন্ট্রি পরস্পরকে কেটে দিয়েছে।</div>` : ''}
${v.reversal_of_no ? `<div class="v-alert v-alert-warn">এটি
  ${esc(v.reversal_of_no)} এর রিভার্সাল ভাউচার।</div>` : ''}
${v.fatwa_override ? `<div class="v-alert v-alert-warn"><strong>ফান্ড বিধিনিষেধ অতিক্রম করা হয়েছে।</strong>
  <div>${esc(v.fatwa_note)}</div></div>` : ''}

<div class="card">
  <div class="card-head"><strong>বিবরণ</strong></div>
  <div class="card-body">
    <div class="v-kv">
      <div><span class="label">বিবরণ</span><span class="value">${esc(v.narration_bn || '—')}</span></div>
      <div><span class="label">পরিশোধ মাধ্যম</span><span class="value">${esc(v.payment_method || '—')}</span></div>
      <div><span class="label">চেক / TrxID</span><span class="value">${esc(v.instrument_no || '—')}</span></div>
      <div><span class="label">পক্ষ</span><span class="value">${esc(v.party_type || '—')} ${esc(v.party_id || '')}</span></div>
      <div><span class="label">তৈরি</span><span class="value">#${esc(v.created_by)} · ${esc(String(v.created_at).slice(0, 16))}</span></div>
      <div><span class="label">অনুমোদন</span><span class="value">${v.approved_by ? '#' + esc(v.approved_by) + ' · ' + esc(String(v.approved_at).slice(0, 16)) : '—'}</span></div>
      <div><span class="label">পোস্ট</span><span class="value">${v.posted_by ? '#' + esc(v.posted_by) + ' · ' + esc(String(v.posted_at).slice(0, 16)) : '—'}</span></div>
      <div><span class="label">উৎস</span><span class="value">${esc(v.source_module)}</span></div>
    </div>
  </div>
  <div class="card-body flush">
    <div class="table-wrap">
      <table class="data compact">
        <thead><tr><th>#</th><th>হিসাব</th><th>ফান্ড</th><th>বিভাগ</th>
          <th class="num">ডেবিট</th><th class="num">ক্রেডিট</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <th colspan="4" class="num">মোট</th>
          <th class="num">${money(totalD)}</th>
          <th class="num">${money(totalC)}</th>
        </tr></tfoot>
      </table>
    </div>
  </div>
  ${attachments.length ? `<div class="card-body"><strong>সংযুক্তি</strong><ul>${
    attachments.map(a => '<li>' + esc(a.file_name) + '</li>').join('')}</ul></div>` : ''}
  ${(canApprove || canPost || canReverse) ? `
  <div class="card-body">
    <div class="form-actions" data-voucher-id="${esc(v.id)}">
      ${canApprove ? '<button class="btn btn-primary" data-act="approve">অনুমোদন</button>' +
                     '<button class="btn btn-light" data-act="reject">বাতিল</button>' : ''}
      ${canPost ? '<button class="btn btn-primary" data-act="post">খতিয়ানে পোস্ট করুন</button>' : ''}
      ${canReverse ? '<button class="btn btn-light" data-act="reverse">রিভার্স করুন</button>' : ''}
    </div>
    <div id="actionMsg" class="v-note"></div>
  </div>` : ''}
</div>

<div class="v-print-sign">
  <div><span></span>প্রস্তুতকারী</div>
  <div><span></span>হিসাবরক্ষক</div>
  <div><span></span>মুহতামিম</div>
</div>

<script src="/js/voucher-actions.js" defer></script>`;
}

function notFound() {
  return page({
    title: 'পাওয়া যায়নি',
    body: '<div class="card"><div class="card-body empty">ভাউচারটি পাওয়া যায়নি।</div></div>',
  });
}

module.exports = {
  page, voucherForm, voucherList, dayBook, voucherDetail, notFound,
  esc, money, statusBadge, TYPE_NAMES,
};

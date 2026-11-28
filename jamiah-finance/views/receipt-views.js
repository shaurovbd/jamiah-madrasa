'use strict';
/**
 * রশিদের ভিউ — তালিকা, রশিদ কাটার ফর্ম, প্রিন্ট (A4 / হাফ / থার্মাল), বই রেজিস্টার,
 * আর পাবলিক যাচাই পেজ।
 */
const { takaInWords, toBanglaDigits, formatTaka } = require('../lib/bangla-number');

const esc = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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

const bnDate = (d) => toBanglaDigits(ymd(d).split('-').reverse().join('/'));

const ORG = {
  name_bn: 'জামিয়াহ স্কলার্স ইন্টারন্যাশনাল',
  name_en: 'Jamiah Scholars International',
  address_bn: '',
  mobile: '',
};

function page({ title, body, bare = false }) {
  return `<!DOCTYPE html>
<html lang="bn" dir="ltr">
<head><meta charset="utf-8">

<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Jamiah Scholars</title>
<link rel="stylesheet" href="/css/theme-tokens.css">
<link rel="stylesheet" href="/css/admin.css">
<link rel="stylesheet" href="/css/ledger.css">
<link rel="stylesheet" href="/css/receipt.css">
</head>
<body>${bare ? body : `<div class="shell"><main class="main"><div class="content">${body}</div></main></div>`}</body>
</html>`;
}

// =====================================================================
// রশিদ কাটার ফর্ম
// =====================================================================
function receiptForm({ type = 'DON' } = {}) {
  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">রশিদ কাটুন</h1>
    <div class="sub" id="typeHint">প্রতিটি রশিদের সাথে খতিয়ানে জমা ভাউচার বসে যায়</div>
  </div>
  <div class="spacer"></div>
  <a class="btn btn-light" href="/admin/receipts">রশিদ তালিকা</a>
  <a class="btn btn-light" href="/admin/receipts/books">রশিদ বই</a>
</div>

<div id="rAlert" class="v-alert" hidden></div>
<div id="rContext" class="v-alert" hidden></div>

<form id="receiptForm" class="card" autocomplete="off" novalidate>
  <input type="hidden" id="receiptType" value="${esc(type)}">
  <div class="card-head r-types" id="typePills"></div>

  <div class="card-body">
    <div class="form-grid two">
      <div class="field">
        <label for="receiptDate">তারিখ <span class="req">*</span></label>
        <input type="date" id="receiptDate" value="${today()}" required>
        <div class="v-note" id="periodNote"></div>
      </div>

      <div class="field r-amount-field">
        <label for="amount">পরিমাণ (টাকা) <span class="req">*</span></label>
        <input type="number" id="amount" step="0.01" min="0.01" placeholder="0.00" required>
        <div class="v-note r-words" id="amountWords"></div>
      </div>

      <div class="field">
        <label for="payerName">যিনি দিচ্ছেন <span class="req" id="payerReq">*</span></label>
        <input type="text" id="payerName" placeholder="পূর্ণ নাম">
      </div>

      <div class="field">
        <label for="payerMobile">মোবাইল</label>
        <input type="tel" id="payerMobile" placeholder="01XXXXXXXXX">
      </div>

      <div class="field" id="studentField" hidden>
        <label for="studentId">শিক্ষার্থী আইডি <span class="req">*</span></label>
        <input type="number" id="studentId" min="1" placeholder="শিক্ষার্থীর আইডি">
        <div class="v-note">বাকি ফি হিসাব এই শিক্ষার্থীর নামে কমবে।</div>
      </div>

      <div class="field" id="partyField" hidden>
        <label for="partyId">স্টাফ / দাতা আইডি <span class="req">*</span></label>
        <input type="number" id="partyId" min="1">
      </div>

      <div class="field">
        <label for="paymentMethod">পরিশোধ মাধ্যম <span class="req">*</span></label>
        <select id="paymentMethod"></select>
      </div>

      <div class="field">
        <label for="cashAccount">টাকা জমা হলো <span class="req">*</span></label>
        <select id="cashAccount"></select>
      </div>

      <div class="field" id="instrumentField" hidden>
        <label for="instrumentNo">চেক / ট্রানজ্যাকশন নম্বর</label>
        <input type="text" id="instrumentNo" placeholder="TrxID 9F2K8LQ">
      </div>

      <div class="field" id="campaignField">
        <label for="campaignId">প্রচারাভিযান</label>
        <select id="campaignId"><option value="">— নির্দিষ্ট নয় —</option></select>
        <div class="v-note" id="campaignNote">নির্দিষ্ট প্রকল্পের অনুদান হলে বেছে নিন।</div>
      </div>

      <div class="field" id="fundField">
        <label for="fundId">ফান্ড</label>
        <select id="fundId"></select>
        <div class="v-note" id="fundNote"></div>
      </div>

      <div class="field full">
        <label for="purpose">উদ্দেশ্য / খাত</label>
        <input type="text" id="purpose" placeholder="যেমন: ১৪৪৭ হিজরির যাকাত · নভেম্বরের বেতন · ২৫ রমজানের ইফতার">
      </div>

      <div class="field" id="bookField">
        <label for="bookId">ম্যানুয়াল রশিদ বই</label>
        <select id="bookId"><option value="">— অনলাইন রশিদ —</option></select>
        <div class="v-note">মাঠ কলেক্টরের ছাপানো বই থেকে কাটা হলে বেছে নিন।</div>
      </div>

      <div class="field" id="manualNoField" hidden>
        <label for="manualNo">বইয়ের রশিদ নম্বর <span class="req">*</span></label>
        <input type="number" id="manualNo" placeholder="যেমন 1005">
        <div class="v-note" id="bookRange"></div>
      </div>
    </div>
  </div>

  <div class="card-body r-summary">
    <div class="r-preview" id="preview"></div>
    <div class="form-actions">
      <button type="submit" class="btn btn-primary" id="saveBtn">রশিদ কাটুন ও প্রিন্ট করুন</button>
      <button type="button" class="btn btn-light" id="saveOnly">শুধু সংরক্ষণ</button>
      <a class="btn btn-light" href="/admin/receipts">বাতিল</a>
      <span class="spacer"></span>
      <span class="v-kbd">Ctrl+Enter — সংরক্ষণ</span>
    </div>
  </div>
</form>

<script src="/js/bangla-number.js"></script>
<script src="/js/receipt-entry.js" defer></script>`;
}

// =====================================================================
// তালিকা
// =====================================================================
function receiptList() {
  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">রশিদ</h1>
    <div class="sub">হিসাব ও অর্থ বিভাগ</div>
  </div>
  <div class="spacer"></div>
  <a class="btn btn-light" href="/admin/receipts/books">রশিদ বই</a>
  <a class="btn btn-light" href="/admin/receipts/new?type=FEE">+ ফি</a>
  <a class="btn btn-light" href="/admin/receipts/new?type=ZAK">+ যাকাত</a>
  <a class="btn btn-primary" href="/admin/receipts/new?type=DON">+ অনুদান</a>
</div>

<div class="card">
  <div class="card-head">
    <strong>আজকের সংগ্রহ</strong>
    <span class="spacer"></span>
    <div class="filters"><div class="field"><input type="date" id="dDate" value="${today()}"></div></div>
  </div>
  <div class="card-body" id="dailyBox"><div class="empty">লোড হচ্ছে…</div></div>
</div>

<div class="card">
  <div class="card-head">
    <strong>সব রশিদ</strong>
    <span class="spacer"></span>
    <div class="filters">
      <div class="field"><select id="fType"><option value="">সব ধরন</option></select></div>
      <div class="field"><select id="fStatus">
        <option value="">সব</option><option value="issued">বৈধ</option><option value="void">বাতিল</option>
      </select></div>
      <div class="field grow"><input type="search" id="fQ" placeholder="রশিদ নম্বর, নাম বা মোবাইল"></div>
    </div>
  </div>
  <div class="card-body flush">
    <div class="table-wrap">
      <table class="data compact">
        <thead><tr>
          <th>রশিদ নম্বর</th><th>তারিখ</th><th>ধরন</th><th>যিনি দিয়েছেন</th>
          <th>ফান্ড</th><th>মাধ্যম</th><th class="num">পরিমাণ</th><th>অবস্থা</th><th></th>
        </tr></thead>
        <tbody id="listBody"><tr><td colspan="9" class="empty">লোড হচ্ছে…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>
<script src="/js/receipt-list.js" defer></script>`;
}

// =====================================================================
// রশিদ বই রেজিস্টার
// =====================================================================
function bookRegister() {
  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">ম্যানুয়াল রশিদ বই</h1>
    <div class="sub">কোন বই কার কাছে, কতটা ব্যবহার হয়েছে</div>
  </div>
  <div class="spacer"></div>
  <a class="btn btn-light" href="/admin/receipts">রশিদ তালিকা</a>
</div>
<div class="card"><div class="card-body flush">
  <div class="table-wrap"><table class="data compact">
    <thead><tr><th>বই</th><th>ধরন</th><th>নম্বরের পরিসর</th><th>কার কাছে</th>
      <th>দেওয়া হয়েছে</th><th class="num">ব্যবহৃত</th><th>অবস্থা</th><th></th></tr></thead>
    <tbody id="bookBody"><tr><td colspan="8" class="empty">লোড হচ্ছে…</td></tr></tbody>
  </table></div>
</div></div>
<script src="/js/receipt-books.js" defer></script>`;
}

// =====================================================================
// প্রিন্টযোগ্য রশিদ — size: a4 | half | thermal
// =====================================================================
function receiptPrint({ r, qrSvg, verifyUrl, size = 'a4', isDuplicate = false, org = ORG }) {
  const void_ = r.status === 'void';
  const thermal = size === 'thermal';

  const kv = (k, v) => v ? `<tr><td class="k">${k}</td><td class="v">${esc(v)}</td></tr>` : '';

  const body = `
<div class="rcpt rcpt-${esc(size)}${void_ ? ' rcpt-void' : ''}">
  ${isDuplicate ? '<div class="rcpt-dup">নকল কপি</div>' : ''}
  ${void_ ? '<div class="rcpt-cancel">বাতিল</div>' : ''}

  <header class="rcpt-head">
    <div class="rcpt-org">
      <div class="rcpt-name">${esc(org.name_bn)}</div>
      <div class="rcpt-name-en">${esc(org.name_en)}</div>
      ${org.address_bn ? `<div class="rcpt-addr">${esc(org.address_bn)}</div>` : ''}
      ${org.mobile ? `<div class="rcpt-addr">মোবাইল: ${esc(org.mobile)}</div>` : ''}
    </div>
    ${thermal ? '' : `<div class="rcpt-qr">${qrSvg}<div class="rcpt-qr-cap">যাচাই করুন</div></div>`}
  </header>

  <div class="rcpt-title">${esc(r.type_name)} গ্রহণের রশিদ</div>

  <div class="rcpt-meta">
    <div><span>রশিদ নম্বর</span><strong>${esc(r.receipt_no)}</strong></div>
    <div><span>তারিখ</span><strong>${bnDate(r.receipt_date)}</strong></div>
  </div>

  <table class="rcpt-kv">
    ${kv('যিনি দিয়েছেন', r.payer_name)}
    ${kv('মোবাইল', r.payer_mobile)}
    ${r.student_id ? kv('শিক্ষার্থী আইডি', r.student_id) : ''}
    ${kv('খাত', r.purpose_bn)}
    ${kv('ফান্ড', r.fund_name)}
    ${kv('মাধ্যম', methodBn(r.payment_method))}
    ${kv('চেক / TrxID', r.instrument_no)}
    ${r.manual_no ? kv('বইয়ের নম্বর', r.manual_no) : ''}
  </table>

  <div class="rcpt-amount">
    <div class="rcpt-amount-fig">${formatTaka(r.amount, { symbol: 'টাকা ', bangla: true })}</div>
    <div class="rcpt-amount-words">${esc(r.amount_in_words || takaInWords(r.amount))}</div>
  </div>

  ${void_ ? `<div class="rcpt-voidnote">এই রশিদ বাতিল করা হয়েছে${
    r.void_reason ? ' — ' + esc(r.void_reason) : ''}। হিসাবে এর কোনো প্রভাব নেই।</div>` : ''}

  ${thermal ? `<div class="rcpt-qr rcpt-qr-sm">${qrSvg}</div>` : ''}

  <footer class="rcpt-foot">
    <div class="rcpt-sign"><span></span>গ্রহণকারীর স্বাক্ষর</div>
    ${thermal ? '' : '<div class="rcpt-sign"><span></span>দাতার স্বাক্ষর</div>'}
  </footer>

  <div class="rcpt-verify">${esc(verifyUrl)}</div>
</div>

<div class="rcpt-bar">
  <button class="btn btn-primary" onclick="window.print()">প্রিন্ট</button>
  <a class="btn btn-light" href="?size=a4">A4</a>
  <a class="btn btn-light" href="?size=half">হাফ পেজ</a>
  <a class="btn btn-light" href="?size=thermal">থার্মাল</a>
  <a class="btn btn-light" href="/admin/receipts/r/${esc(r.id)}/voucher">ভাউচার দেখুন</a>
  <a class="btn btn-light" href="/admin/receipts">তালিকা</a>
  ${void_ ? '' : `<button class="btn btn-light" id="voidBtn" data-id="${esc(r.id)}">রশিদ বাতিল</button>`}
  <span id="voidMsg" class="v-note"></span>
</div>
<script src="/js/receipt-print.js" defer></script>`;

  return page({ title: r.receipt_no, body, bare: true });
}

function methodBn(m) {
  return {
    cash: 'নগদ', bank: 'ব্যাংক', bkash: 'বিকাশ',
    nagad: 'নগদ (MFS)', rocket: 'রকেট', cheque: 'চেক',
  }[m] || m;
}

// =====================================================================
// পাবলিক যাচাই পেজ (QR স্ক্যান করে যে কেউ আসতে পারে)
// =====================================================================
function verifyPage({ r, org = ORG }) {
  if (!r) {
    return page({
      bare: true, title: 'রশিদ যাচাই',
      body: `<div class="vfy vfy-bad">
        <div class="vfy-mark">✕</div>
        <h1>রশিদটি পাওয়া যায়নি</h1>
        <p>এই যাচাই লিংকটি সঠিক নয়। রশিদের QR কোডটি আবার স্ক্যান করুন,
           অথবা ${esc(org.name_bn)} এর অফিসে যোগাযোগ করুন।</p>
      </div>`,
    });
  }

  const void_ = r.status === 'void';
  return page({
    bare: true, title: 'রশিদ ' + r.receipt_no,
    body: `<div class="vfy ${void_ ? 'vfy-void' : 'vfy-ok'}">
      <div class="vfy-mark">${void_ ? '!' : '✓'}</div>
      <h1>${void_ ? 'এই রশিদ বাতিল করা হয়েছে' : 'রশিদটি সঠিক'}</h1>
      <div class="vfy-org">${esc(org.name_bn)}</div>
      <table class="vfy-kv">
        <tr><td>রশিদ নম্বর</td><td><strong>${esc(r.receipt_no)}</strong></td></tr>
        <tr><td>তারিখ</td><td>${bnDate(r.receipt_date)}</td></tr>
        <tr><td>ধরন</td><td>${esc(r.type_name)}</td></tr>
        ${r.payer_name ? `<tr><td>যিনি দিয়েছেন</td><td>${esc(r.payer_name)}</td></tr>` : ''}
        ${r.purpose_bn ? `<tr><td>খাত</td><td>${esc(r.purpose_bn)}</td></tr>` : ''}
        <tr><td>পরিমাণ</td><td><strong>${formatTaka(r.amount, { symbol: 'টাকা ', bangla: true })}</strong></td></tr>
      </table>
      <div class="vfy-words">${esc(r.amount_in_words)}</div>
      ${void_ ? `<div class="vfy-note">কারণ: ${esc(r.void_reason || '—')}<br>
        এই রশিদের টাকা প্রতিষ্ঠানের হিসাবে গণনা করা হয়নি।</div>`
              : `<div class="vfy-note">এই রশিদটি প্রতিষ্ঠানের হিসাবে লিপিবদ্ধ আছে।
                 জাযাকাল্লাহু খাইরান।</div>`}
    </div>`,
  });
}

function verifyLookup({ org = ORG, csrfToken = null, error = null, receiptNo = '' } = {}) {
  const msg = {
    input:    'রশিদ নম্বর আর মোবাইল — দুটোই লিখুন।',
    nomatch:  'এই রশিদ নম্বর ও মোবাইলের মিল পাওয়া যায়নি। দুটোই আবার দেখে লিখুন।',
    nomobile: 'এই রশিদে কোনো মোবাইল নম্বর রাখা হয়নি, তাই এভাবে যাচাই করা যাচ্ছে না। '
              + 'রশিদের QR কোডটি স্ক্যান করুন, অথবা অফিসে যোগাযোগ করুন।',
    toomany:  'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
  }[error];

  return page({
    bare: true, title: 'রশিদ যাচাই',
    body: `<div class="vfy vfy-ask">
      <h1>রশিদ যাচাই</h1>
      <div class="vfy-org">${esc(org.name_bn)}</div>
      <p class="vfy-lead">রশিদের QR কোড স্ক্যান করলে সরাসরি যাচাই হয়ে যায়।
         স্ক্যান করতে না পারলে নিচে রশিদ নম্বর ও যে মোবাইল নম্বর দিয়েছিলেন তা লিখুন।</p>
      ${msg ? `<div class="vfy-err">${esc(msg)}</div>` : ''}
      <form method="post" action="/verify" class="vfy-form" autocomplete="off">
        ${csrfToken ? `<input type="hidden" name="_csrf" value="${esc(csrfToken)}">` : ''}
        <label>রশিদ নম্বর
          <input name="receipt_no" value="${esc(receiptNo)}" placeholder="DON-2026-00042"
                 required maxlength="30" spellcheck="false">
        </label>
        <label>মোবাইল নম্বর
          <input name="mobile" type="tel" placeholder="01XXXXXXXXX"
                 required maxlength="20" inputmode="tel">
        </label>
        <button type="submit">যাচাই করুন</button>
      </form>
      <p class="vfy-foot">রশিদ নম্বর রশিদের উপরের ডানদিকে লেখা থাকে।
         সমস্যা হলে ${esc(org.name_bn)} এর অফিসে যোগাযোগ করুন${
           org.mobile ? ' — ' + esc(org.mobile) : ''}।</p>
    </div>`,
  });
}

function notFound(msg) {
  return page({ title: 'পাওয়া যায়নি', body:
    `<div class="card"><div class="card-body empty">${esc(msg || 'পাওয়া যায়নি।')}</div></div>` });
}

module.exports = {
  page, receiptForm, receiptList, bookRegister, receiptPrint, verifyPage,
  verifyLookup, notFound,
  esc, bnDate, methodBn, ORG,
};

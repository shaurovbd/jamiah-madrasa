'use strict';
/** ঋণ ও বাকি ব্যবস্থাপনার ভিউ */
const { toBanglaDigits } = require('../lib/bangla-number');

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
<link rel="stylesheet" href="/css/loan.css">
</head>
<body>${bare ? body : `<div class="shell"><main class="main"><div class="content">${body}</div></main></div>`}</body>
</html>`;
}

// =====================================================================
// তালিকা
// =====================================================================
function loanList() {
  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">ঋণ ও বাকি</h1>
    <div class="sub">কর্জে হাসানা — সুদমুক্ত। দেওয়া ও নেওয়া দুই দিকই এখানে।</div>
  </div>
  <div class="spacer"></div>
  <a class="btn btn-light" href="/admin/loans/overdue">মেয়াদ পেরোনো</a>
  <a class="btn btn-primary" href="/admin/loans/new">+ নতুন ঋণ</a>
</div>

<div id="lnAlert" class="v-alert" hidden></div>

<div class="ln-cards" id="lnSummary"></div>

<div class="card">
  <div class="card-head">
    <strong>ঋণের তালিকা</strong>
    <div class="spacer"></div>
    <div class="filters">
    <div class="field"><select id="fDir">
      <option value="">দুই দিকই</option>
      <option value="given">দেওয়া (স্টাফ ঋণ/অগ্রিম)</option>
      <option value="received">নেওয়া (কর্জে হাসানা)</option>
    </select></div>
    <div class="field"><select id="fStatus">
      <option value="active">চলমান</option>
      <option value="">সব অবস্থা</option>
      <option value="settled">শোধ হয়েছে</option>
      <option value="written_off">মওকুফ</option>
      <option value="cancelled">বাতিল</option>
    </select></div>
    <div class="field"><input id="fQ" placeholder="নাম, কোড বা মোবাইল"></div>
    </div>
  </div>
  <div class="table-wrap">
  <table class="data compact" id="lnTable">
    <thead><tr>
      <th>কোড</th><th>কার সাথে</th><th>দিক</th><th>তারিখ</th><th>ফেরতের তারিখ</th>
      <th class="num">আসল</th><th class="num">জমা</th><th class="num">বাকি</th><th>অবস্থা</th>
    </tr></thead>
    <tbody><tr><td colspan="9" class="empty">লোড হচ্ছে…</td></tr></tbody>
  </table>
  </div>
</div>
<script src="/js/loan-list.js"></script>`;
}

// =====================================================================
// নতুন ঋণ
// =====================================================================
function loanForm() {
  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">নতুন ঋণ</h1>
    <div class="sub">সুদের কোনো ঘর নেই — কর্জে হাসানা সুদমুক্ত।</div>
  </div>
  <div class="spacer"></div>
  <a class="btn btn-light" href="/admin/loans">তালিকা</a>
</div>

<div id="lnAlert" class="v-alert" hidden></div>

<form id="loanForm" class="card" autocomplete="off" novalidate>
  <div class="ln-dir">
    <label class="ln-pick">
      <input type="radio" name="direction" value="given" checked>
      <span><strong>প্রতিষ্ঠান দিচ্ছে</strong><small>স্টাফ ঋণ বা অগ্রিম — সম্পদ বাড়বে</small></span>
    </label>
    <label class="ln-pick">
      <input type="radio" name="direction" value="received">
      <span><strong>প্রতিষ্ঠান নিচ্ছে</strong><small>কর্জে হাসানা — দায় বাড়বে</small></span>
    </label>
  </div>

  <div class="card-body">
    <div class="form-grid two">
    <div class="field">
      <label>তারিখ <span class="req">*</span></label>
      <input type="date" name="issue_date" id="issueDate" required>
      <small id="periodHint"></small>
    </div>
    <div class="field">
      <label>পরিমাণ (টাকা) <span class="req">*</span></label>
      <input type="number" name="principal" id="principal" step="0.01" min="0.01" class="num" required>
      <small id="words"></small>
    </div>

    <div class="field">
      <label>কার সাথে <span class="req">*</span></label>
      <input name="party_name" id="partyName" placeholder="পূর্ণ নাম" required maxlength="150">
    </div>
    <div class="field">
      <label>মোবাইল</label>
      <input name="party_mobile" id="partyMobile" type="tel" placeholder="01XXXXXXXXX" maxlength="30">
    </div>

    <div class="field">
      <label>পক্ষের ধরন</label>
      <select name="party_type" id="partyType">
        <option value="staff">স্টাফ</option>
        <option value="donor">দাতা</option>
        <option value="student">শিক্ষার্থী</option>
        <option value="supplier">সরবরাহকারী</option>
        <option value="other">অন্যান্য</option>
      </select>
    </div>
    <div class="field" id="partyIdWrap">
      <label>পক্ষের আইডি <span class="req">*</span></label>
      <input name="party_id" id="partyId" type="number" min="1" placeholder="স্টাফ/শিক্ষার্থীর আইডি">
      <small>দাতা নির্বাচন করলে নাম-মোবাইল থেকে রেকর্ড আপনাআপনি তৈরি হবে।</small>
    </div>

    <div class="field">
      <label>ঋণের হিসাব <span class="req">*</span></label>
      <select name="account_id" id="accountId"></select>
    </div>
    <div class="field">
      <label>টাকা যাবে / আসবে <span class="req">*</span></label>
      <select name="cash_account_id" id="cashAccount" required></select>
    </div>

    <div class="field">
      <label>ফান্ড</label>
      <select name="fund_id" id="fundId"></select>
    </div>
    <div class="field">
      <label>পরিশোধের মাধ্যম</label>
      <select name="payment_method" id="method">
        <option value="cash">নগদ</option>
        <option value="bank">ব্যাংক</option>
        <option value="bkash">বিকাশ</option>
        <option value="nagad">নগদ (MFS)</option>
        <option value="rocket">রকেট</option>
        <option value="cheque">চেক</option>
      </select>
    </div>

    <div class="field">
      <label>ফেরতের তারিখ</label>
      <input type="date" name="due_date" id="dueDate">
      <small>খালি রাখলে মেয়াদের হিসাব হবে না।</small>
    </div>
    <div class="field">
      <label>চেক / ট্রানজেকশন নম্বর</label>
      <input name="instrument_no" maxlength="50" placeholder="TrxID 9F2K8LQ">
    </div>

    <div class="field">
      <label>মাসিক কিস্তি</label>
      <input type="number" name="installment_amount" step="0.01" min="0.01" class="num">
      <small>শুধু মনে করিয়ে দেওয়ার জন্য — স্বয়ংক্রিয় কাটা হয় না।</small>
    </div>
    <div class="field">
      <label>মাসের কত তারিখে</label>
      <input type="number" name="installment_day" min="1" max="28">
    </div>
  </div>

  <div class="field">
      <label>কারণ / উদ্দেশ্য</label>
      <input name="purpose_bn" maxlength="255" placeholder="যেমন: মেয়ের চিকিৎসা">
    </div>
  <div class="field">
      <label>নোট</label>
      <textarea name="note_bn" rows="2" maxlength="1000"></textarea>
    </div>

  <div class="form-actions">
    <div id="effectHint" class="ln-effect"></div>
    <div class="spacer"></div>
    <button type="submit" class="btn btn-primary" id="saveBtn">সংরক্ষণ করুন</button>
  </div>
</form>
<script src="/js/bangla-number.js"></script>
<script src="/js/loan-entry.js"></script>`;
}

// =====================================================================
// এক ঋণের বিস্তারিত
// =====================================================================
function loanDetail() {
  return `
<div class="page-bar">
  <div><h1 class="page-title" id="lnTitle">ঋণ</h1><div class="sub" id="lnSub"></div></div>
  <div class="spacer"></div>
  <a class="btn btn-light" href="/admin/loans">তালিকা</a>
</div>

<div id="lnAlert" class="v-alert" hidden></div>

<div class="ln-detail">
  <div class="card">
    <div class="card-head"><strong>বিবরণ</strong></div>
    <table class="vfy-kv" id="lnInfo"></table>
  </div>

  <div class="card">
    <div class="card-head"><strong>কিস্তির খতিয়ান</strong></div>
    <div class="table-wrap">
      <table class="data compact" id="payTable">
        <thead><tr><th>তারিখ</th><th>ভাউচার</th><th>নোট</th><th class="num">টাকা</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>
</div>

<div class="card" id="actionCard">
  <div class="card-head"><strong>কিস্তি নিন / দিন</strong></div>
  <form id="payForm" class="card-body form-grid two" autocomplete="off" novalidate>
    <div class="field">
      <label>তারিখ <span class="req">*</span></label>
      <input type="date" name="payment_date" id="payDate" required>
    </div>
    <div class="field">
      <label>পরিমাণ <span class="req">*</span></label>
      <input type="number" name="amount" id="payAmount" step="0.01" min="0.01" class="num" required>
    </div>
    <div class="field">
      <label>হিসাব <span class="req">*</span></label>
      <select name="cash_account_id" id="payCash" required></select>
    </div>
    <div class="field">
      <label>নোট</label>
      <input name="note_bn" maxlength="255">
    </div>
    <div class="form-actions">
      <div class="spacer"></div>
      <button type="submit" class="btn btn-primary">কিস্তি সংরক্ষণ</button>
    </div>
  </form>
  <div class="ln-danger">
    <button class="btn btn-light" id="remindBtn">মনে করানো হয়েছে</button>
    <button class="btn btn-warn" id="writeOffBtn">মওকুফ করুন</button>
    <button class="btn btn-warn" id="cancelBtn">বাতিল করুন</button>
  </div>
</div>
<script src="/js/bangla-number.js"></script>
<script src="/js/loan-detail.js"></script>`;
}

// =====================================================================
// মেয়াদ পেরোনো
// =====================================================================
function overdueList() {
  return `
<div class="page-bar">
  <div>
    <h1 class="page-title">মেয়াদ পেরোনো ঋণ</h1>
    <div class="sub">ফেরতের তারিখ পেরিয়ে গেছে, এখনো বাকি আছে</div>
  </div>
  <div class="spacer"></div>
  <div class="filters"><div class="field"><input type="date" id="asOf"></div></div>
  <a class="btn btn-light" href="/admin/loans">সব ঋণ</a>
</div>

<div id="lnAlert" class="v-alert" hidden></div>

<div class="card">
  <div class="card-head"><strong id="odHead">বকেয়া</strong></div>
  <div class="table-wrap">
  <table class="data compact" id="odTable">
    <thead><tr>
      <th>কোড</th><th>কার সাথে</th><th>মোবাইল</th><th>ফেরতের তারিখ</th>
      <th class="num">কত দিন পার</th><th class="num">বাকি</th><th>সর্বশেষ মনে করানো</th><th></th>
    </tr></thead>
    <tbody><tr><td colspan="8" class="empty">লোড হচ্ছে…</td></tr></tbody>
  </table>
  </div>
</div>
<script src="/js/loan-overdue.js"></script>`;
}

function notFound(msg) {
  return page({ title: 'পাওয়া যায়নি', body:
    `<div class="card"><div class="card-body empty">${esc(msg || 'পাওয়া যায়নি।')}</div></div>` });
}

module.exports = { page, loanList, loanForm, loanDetail, overdueList, notFound,
                   esc, bnDate, ymd, ORG };

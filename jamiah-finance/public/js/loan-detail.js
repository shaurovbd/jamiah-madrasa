/* এক ঋণের বিস্তারিত — /admin/loans/l/:id */
(function () {
  'use strict';
  var API = '/admin/loans/api';
  var $ = function (id) { return document.getElementById(id); };
  var BN = window.BanglaNumber || { takaInWords: function () { return ''; } };
  var money = function (v) { return 'Tk ' + Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ymd = function (d) {
    if (d == null || d === '') return '—';
    var s = String(d);
    if (s.indexOf('T') > 0 && s.indexOf('Z') > 0) {
      var t = new Date(s);
      if (!isNaN(t)) { var p = function (n) { return String(n).padStart(2, '0'); };
        return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()); }
    }
    return s.slice(0, 10);
  };
  var STATUS = { active: 'চলমান', settled: 'শোধ হয়েছে', written_off: 'মওকুফ', cancelled: 'বাতিল' };
  var ID = (location.pathname.match(/\/l\/(\d+)/) || [])[1];
  var LOAN = null;

  function alertBox(msg, kind) {
    var el = $('lnAlert'); if (!el) return;
    el.className = 'v-alert ' + (kind || 'err');
    el.innerHTML = msg; el.hidden = !msg;
    if (msg) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  var row = function (k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; };

  function paint(d) {
    var l = d.loan; LOAN = l;
    $('lnTitle').textContent = l.loan_code + ' — ' + l.party_name;
    $('lnSub').innerHTML = (l.direction === 'given'
        ? 'প্রতিষ্ঠান দিয়েছে — ফেরত পাওয়ার কথা'
        : 'প্রতিষ্ঠান নিয়েছে — ফেরত দেওয়ার কথা') +
      ' · <span class="ln-badge ln-' + l.status + '">' + (STATUS[l.status] || l.status) + '</span>' +
      (Number(l.is_overdue) ? ' <span class="ln-badge ln-overdue">মেয়াদ পেরিয়েছে</span>' : '');

    var pct = Math.min(100, Math.round(Number(l.paid_pct || 0)));
    $('lnInfo').innerHTML =
      row('আসল', '<strong>' + money(l.principal) + '</strong><br><small>' +
          esc(BN.takaInWords(Number(l.principal))) + '</small>') +
      row('জমা হয়েছে', money(l.paid) + '<div class="ln-bar"><i style="width:' + pct + '%"></i></div>') +
      row('বাকি', '<strong>' + money(l.outstanding) + '</strong>') +
      row('তারিখ', ymd(l.issue_date)) +
      row('ফেরতের তারিখ', ymd(l.due_date) +
        (l.days_to_due == null ? '' : ' <small>(' +
          (Number(l.days_to_due) < 0 ? Math.abs(l.days_to_due) + ' দিন পেরিয়েছে'
                                     : l.days_to_due + ' দিন বাকি') + ')</small>')) +
      row('হিসাব', esc(l.account_code + ' · ' + l.account_name)) +
      row('ফান্ড', esc(l.fund_name)) +
      (l.party_mobile ? row('মোবাইল', esc(l.party_mobile)) : '') +
      (l.installment_amount ? row('মাসিক কিস্তি', money(l.installment_amount) +
        (l.installment_day ? ' — প্রতি মাসের ' + l.installment_day + ' তারিখে' : '')) : '') +
      (l.purpose_bn ? row('উদ্দেশ্য', esc(l.purpose_bn)) : '') +
      (l.write_off_reason ? row('মওকুফের কারণ', esc(l.write_off_reason)) : '') +
      (l.cancel_reason ? row('বাতিলের কারণ', esc(l.cancel_reason)) : '');

    var tb = $('payTable').querySelector('tbody');
    tb.innerHTML = d.payments.length
      ? d.payments.map(function (p) {
          return '<tr><td>' + ymd(p.payment_date) + '</td>' +
            '<td>' + esc(p.voucher_no) + '</td>' +
            '<td>' + esc(p.note_bn || '—') + '</td>' +
            '<td class="r">' + money(p.amount) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="4" class="empty">এখনো কোনো কিস্তি জমা পড়েনি।</td></tr>';

    // চলমান না হলে কাজের অংশ লুকাই
    $('actionCard').hidden = (l.status !== 'active');
    if (l.status === 'active') {
      $('payAmount').max = l.outstanding;
      $('payAmount').placeholder = 'সর্বোচ্চ ' + Number(l.outstanding);
    }
  }

  function load() {
    fetch(API + '/loans/' + ID, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { alertBox((d.errors || ['পাওয়া যায়নি']).join(' ')); return; }
        alertBox(''); paint(d);
      })
      .catch(function () { alertBox('সার্ভারে পৌঁছানো গেল না।'); });
  }

  function post(url, body, okMsg) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
      .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (o) {
        if (o.s >= 400 || !o.j.ok) {
          alertBox((o.j.errors || ['কাজটি করা গেল না']).map(esc).join('<br>')); return false;
        }
        alertBox(okMsg, 'ok'); load(); return true;
      })
      .catch(function () { alertBox('সার্ভারে পৌঁছানো গেল না।'); return false; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;
        $('payDate').value = d.today; $('payDate').max = d.today;
        $('payCash').innerHTML = d.cash.map(function (a) {
          return '<option value="' + a.id + '">' + esc(a.code + ' · ' + a.name_bn) +
                 ' (' + money(a.balance) + ')</option>';
        }).join('');
      })
      .catch(function () {});
    load();

    $('payForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {
        payment_date: $('payDate').value,
        amount: $('payAmount').value,
        cash_account_id: $('payCash').value,
        note_bn: e.target.elements.note_bn.value || null,
      };
      post(API + '/loans/' + ID + '/payments', body, 'কিস্তি সংরক্ষিত হয়েছে।')
        .then(function (ok) { if (ok) e.target.reset();
          if (ok) { $('payDate').value = new Date().toISOString().slice(0, 10); } });
    });

    $('remindBtn').addEventListener('click', function () {
      post(API + '/loans/' + ID + '/remind', {}, 'মনে করানোর হিসাব রাখা হলো।');
    });

    $('writeOffBtn').addEventListener('click', function () {
      var reason = window.prompt('মওকুফের কারণ লিখুন (কমপক্ষে ৫ অক্ষর):');
      if (!reason) return;
      post(API + '/loans/' + ID + '/write-off', { reason: reason },
        'ঋণ মওকুফ করা হলো, খাতায় বসে গেছে।');
    });

    $('cancelBtn').addEventListener('click', function () {
      var reason = window.prompt('বাতিলের কারণ লিখুন (কমপক্ষে ৫ অক্ষর):');
      if (!reason) return;
      post(API + '/loans/' + ID + '/cancel', { reason: reason },
        'ঋণ বাতিল হলো, বিতরণ ভাউচার উল্টে গেছে।');
    });
  });
})();

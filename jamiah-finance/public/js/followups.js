/* ফলো-আপ — বাকি প্রতিশ্রুতি, এ মাসের মাসিক দান, নিষ্ক্রিয় দাতা */
(function () {
  'use strict';
  // DB থেকে DATE JSON-এ ISO টাইমস্ট্যাম্প হয়ে আসতে পারে ("2025-12-31T18:00:00.000Z"),
  // তখন slice(0,10) টাইমজোনের কারণে একদিন পিছিয়ে দেয়। তাই স্থানীয় তারিখ নিই।
  // (সার্ভারের পুলে dateStrings: true দিলে এখানে "2026-01-01" ই আসে।)
  var ymd = function (d) {
    if (d == null || d === '') return '—';
    var s = String(d);
    if (s.indexOf('T') > 0 && s.indexOf('Z') > 0) {
      var t = new Date(s);
      if (!isNaN(t)) {
        var p = function (n) { return String(n).padStart(2, '0'); };
        return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
      }
    }
    return s.slice(0, 10);
  };
  var API = '/admin/donors/api';
  var BN = window.BanglaNumber || { toBanglaDigits: function (x) { return x; } };
  var money = function (v) { return 'Tk ' + Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var CONTACT = { sms: 'এসএমএস', whatsapp: 'হোয়াটসঅ্যাপ', call: 'ফোন', email: 'ইমেইল', none: '—' };
  var tab = 'pledges';

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      tab = b.getAttribute('data-tab');
      Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      load();
    });
    document.getElementById('tabBox').addEventListener('click', onAction);
    load();
  });

  function box(title, inner, note) {
    return '<div class="card"><div class="card-head"><strong>' + title + '</strong>' +
      (note ? '<span class="spacer"></span><span class="v-note">' + note + '</span>' : '') +
      '</div><div class="card-body flush"><div class="table-wrap">' + inner +
      '</div></div></div>';
  }

  function load() {
    var el = document.getElementById('tabBox');
    el.innerHTML = '<div class="empty">লোড হচ্ছে…</div>';
    if (tab === 'pledges') return loadPledges(el);
    if (tab === 'recurring') return loadRecurring(el);
    return loadLapsed(el);
  }

  function loadPledges(el) {
    fetch(API + '/pledges', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.rows.length) {
          el.innerHTML = box('বাকি প্রতিশ্রুতি',
            '<div class="empty">কোনো অনাদায়ী প্রতিশ্রুতি নেই।</div>');
          return;
        }
        var total = d.rows.reduce(function (s, r) { return s + Number(r.outstanding); }, 0);
        el.innerHTML = box('বাকি প্রতিশ্রুতি',
          '<table class="data compact"><thead><tr><th>দাতা</th><th>মোবাইল</th><th>খাত</th>' +
          '<th class="num">প্রতিশ্রুত</th><th class="num">এসেছে</th><th class="num">বাকি</th>' +
          '<th>মেয়াদ</th><th>রিমাইন্ডার</th><th></th></tr></thead><tbody>' +
          d.rows.map(function (p) {
            var over = p.days_to_due != null && p.days_to_due < 0;
            return '<tr><td><a href="/admin/donors/d/' + p.donor_id + '">' +
              esc(p.donor_name) + '</a></td>' +
              '<td>' + esc(p.mobile || '—') + '<div class="v-note">' +
                (CONTACT[p.preferred_contact] || '') + '</div></td>' +
              '<td>' + esc(p.purpose_bn || p.fund_name) +
                (p.campaign_title ? '<div class="v-note">' + esc(p.campaign_title) + '</div>' : '') + '</td>' +
              '<td class="num">' + money(p.amount) + '</td>' +
              '<td class="num">' + money(p.received) + '</td>' +
              '<td class="num"><strong>' + money(p.outstanding) + '</strong></td>' +
              '<td>' + (p.due_date ? ymd(p.due_date) : '—') +
                (over ? ' <span class="badge badge-red">' +
                  BN.toBanglaDigits(Math.abs(p.days_to_due)) + ' দিন পার</span>' : '') + '</td>' +
              '<td>' + (Number(p.reminder_count)
                ? BN.toBanglaDigits(p.reminder_count) + ' বার' +
                  (p.last_reminded_at ? '<div class="v-note">' +
                    ymd(p.last_reminded_at) + '</div>' : '')
                : '—') + '</td>' +
              '<td><button class="btn btn-light btn-sm" data-act="remind" data-id="' + p.pledge_id +
                '">রিমাইন্ড করা হলো</button> ' +
                '<button class="btn btn-light btn-sm" data-act="cancel" data-id="' + p.pledge_id +
                '">বাতিল</button></td></tr>';
          }).join('') +
          '</tbody><tfoot><tr><th colspan="5" class="num">মোট বাকি</th>' +
          '<th class="num">' + money(total) + '</th><th colspan="3"></th></tr></tfoot></table>',
          d.rows.length + 'টি');
      });
  }

  function loadRecurring(el) {
    fetch(API + '/recurring/due', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.rows.length) {
          el.innerHTML = box('এ মাসের মাসিক দান',
            '<div class="empty">এ মাসের সব মাসিক দান এসে গেছে।</div>');
          return;
        }
        var total = d.rows.reduce(function (s, r) { return s + Number(r.amount); }, 0);
        el.innerHTML = box('এ মাসের মাসিক দান — এখনো আসেনি',
          '<table class="data compact"><thead><tr><th>দাতা</th><th>মোবাইল</th><th>ধরন</th>' +
          '<th>ফান্ড</th><th class="num">মাসিক</th><th>তারিখ ছিল</th><th></th></tr></thead><tbody>' +
          d.rows.map(function (p) {
            return '<tr><td><a href="/admin/donors/d/' + p.donor_id + '">' +
              esc(p.donor_name) + '</a></td>' +
              '<td>' + esc(p.mobile || '—') + '</td>' +
              '<td>' + esc(p.type_name) + '</td><td>' + esc(p.fund_name) + '</td>' +
              '<td class="num"><strong>' + money(p.amount) + '</strong></td>' +
              '<td>' + BN.toBanglaDigits(p.day_of_month) + ' তারিখ' +
                (Number(p.days_overdue) > 0 ? ' <span class="badge badge-amber">' +
                  BN.toBanglaDigits(p.days_overdue) + ' দিন দেরি</span>' : '') + '</td>' +
              '<td><a class="btn btn-light btn-sm" href="/admin/receipts/new?type=' +
                esc(p.type_code) + '&donor=' + p.donor_id + '&plan=' + p.plan_id +
                '">রশিদ কাটুন</a></td></tr>';
          }).join('') +
          '</tbody><tfoot><tr><th colspan="4" class="num">প্রত্যাশিত মোট</th>' +
          '<th class="num">' + money(total) + '</th><th colspan="2"></th></tr></tfoot></table>',
          d.date + ' তারিখ অনুযায়ী');
      });
  }

  function loadLapsed(el) {
    fetch(API + '/lapsed?months=6', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.rows.length) {
          el.innerHTML = box('নিষ্ক্রিয় দাতা', '<div class="empty">কেউ নেই।</div>');
          return;
        }
        el.innerHTML = box('নিষ্ক্রিয় দাতা — ৬ মাস বা তার বেশি কিছু দেননি',
          '<table class="data compact"><thead><tr><th>দাতা</th><th>মোবাইল</th><th>এলাকা</th>' +
          '<th class="num">আগে দিয়েছেন</th><th class="num">বার</th><th>সর্বশেষ</th>' +
          '<th>কত মাস</th><th></th></tr></thead><tbody>' +
          d.rows.map(function (r) {
            return '<tr><td><a href="/admin/donors/d/' + r.donor_id + '">' + esc(r.name) + '</a>' +
              (Number(r.is_expatriate) ? ' <span class="badge">প্রবাসী</span>' : '') + '</td>' +
              '<td>' + esc(r.mobile || '—') + '<div class="v-note">' +
                (CONTACT[r.preferred_contact] || '') + '</div></td>' +
              '<td>' + esc(r.district || r.country || '—') + '</td>' +
              '<td class="num"><strong>' + money(r.total_given) + '</strong></td>' +
              '<td class="num">' + BN.toBanglaDigits(r.gift_count) + '</td>' +
              '<td>' + ymd(r.last_gift_date) + '</td>' +
              '<td><span class="badge badge-amber">' +
                BN.toBanglaDigits(r.months_since_last) + ' মাস</span></td>' +
              '<td><a class="btn btn-light btn-sm" href="/admin/receipts/new?type=DON&donor=' +
                r.donor_id + '">অনুদান নিন</a></td></tr>';
          }).join('') + '</tbody></table>',
          d.rows.length + 'জন · নতুন দাতা খোঁজার চেয়ে এঁদের ফিরিয়ে আনা সহজ');
      });
  }

  function onAction(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    var id = b.getAttribute('data-id');
    var body = {};
    if (act === 'cancel') {
      var reason = window.prompt('প্রতিশ্রুতি বাতিলের কারণ:');
      if (!reason || !reason.trim()) return;
      body.reason = reason.trim();
    }
    b.disabled = true;
    fetch(API + '/pledges/' + id + '/' + act, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) return load();
        alert((d.errors || ['ত্রুটি']).join('\n'));
        b.disabled = false;
      });
  }
})();

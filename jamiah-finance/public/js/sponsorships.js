/* স্পনসরশিপ ও ফলো-আপ — /admin/orphans/sponsorships */
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
  var API = '/admin/orphans/api';
  var BN = window.BanglaNumber || { toBanglaDigits: function (x) { return x; } };
  var money = function (v) { return 'Tk ' + Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var FREQ = { monthly: 'মাসিক', quarterly: 'ত্রৈমাসিক', half_yearly: 'ষাণ্মাসিক', yearly: 'বার্ষিক' };
  var tab = 'active';

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
      '</div><div class="card-body flush"><div class="table-wrap">' + inner + '</div></div></div>';
  }

  function load() {
    var el = document.getElementById('tabBox');
    el.innerHTML = '<div class="empty">লোড হচ্ছে…</div>';
    if (tab === 'payments') return loadPayments(el);
    if (tab === 'reports') return loadReports(el);
    return loadList(el, tab === 'ended' ? 'ended' : 'active');
  }

  function loadList(el, status) {
    fetch(API + '/sponsorships?status=' + status, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.rows.length) {
          el.innerHTML = box(status === 'ended' ? 'শেষ হওয়া স্পনসরশিপ' : 'চলমান স্পনসরশিপ',
            '<div class="empty">কিছু নেই।</div>');
          return;
        }
        var total = d.rows.reduce(function (s, r) { return s + Number(r.monthly_amount); }, 0);
        el.innerHTML = box(status === 'ended' ? 'শেষ হওয়া স্পনসরশিপ' : 'চলমান স্পনসরশিপ',
          '<table class="data compact"><thead><tr><th>কোড</th><th>শিশু</th><th>দাতা</th>' +
          '<th class="num">মাসিক</th><th>শুরু</th>' + (status === 'ended' ? '<th>শেষ</th>' : '') +
          '<th class="num">মোট আদায়</th><th>শেষ রিপোর্ট</th><th></th></tr></thead><tbody>' +
          d.rows.map(function (s) {
            return '<tr><td>' + esc(s.sponsorship_code) + '</td>' +
              '<td><a href="/admin/orphans/o/' + s.orphan_id + '">' +
                esc(s.orphan_full_name) + '</a><div class="v-note">' +
                esc(s.orphan_code) + (s.class_name ? ' · ' + esc(s.class_name) : '') + '</div></td>' +
              '<td><a href="/admin/donors/d/' + s.donor_id + '">' + esc(s.donor_name) + '</a>' +
                (Number(s.allow_direct_contact)
                  ? '<div class="v-note">সরাসরি যোগাযোগ অনুমোদিত</div>' : '') + '</td>' +
              '<td class="num">' + money(s.monthly_amount) + '</td>' +
              '<td>' + ymd(s.start_date) + '</td>' +
              (status === 'ended'
                ? '<td>' + (s.end_date ? ymd(s.end_date) : '—') +
                  (s.end_reason ? '<div class="v-note">' + esc(s.end_reason) + '</div>' : '') + '</td>'
                : '') +
              '<td class="num">' + money(s.received_total) + '</td>' +
              '<td>' + (s.last_report_sent ? ymd(s.last_report_sent) : '—') +
                '<div class="v-note">' + (FREQ[s.report_frequency] || '') + '</div></td>' +
              '<td><a class="btn btn-light btn-sm" href="/admin/orphans/s/' + s.sponsorship_id +
                '/report">রিপোর্ট</a>' +
                (status !== 'ended'
                  ? ' <button class="btn btn-light btn-sm" data-act="end" data-id="' +
                    s.sponsorship_id + '">শেষ</button>' : '') + '</td></tr>';
          }).join('') +
          (status === 'ended' ? '' :
            '</tbody><tfoot><tr><th colspan="3" class="num">মোট মাসিক</th>' +
            '<th class="num">' + money(total) + '</th><th colspan="4"></th></tr></tfoot>') +
          '</table>', d.rows.length + 'টি');
      });
  }

  function loadPayments(el) {
    fetch(API + '/payments/due', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.rows.length) {
          el.innerHTML = box('এ মাসের টাকা', '<div class="empty">সব স্পনসরের টাকা এসে গেছে।</div>');
          return;
        }
        el.innerHTML = box('এ মাসের স্পনসরশিপের টাকা — এখনো আসেনি',
          '<table class="data compact"><thead><tr><th>কোড</th><th>শিশু</th><th>দাতা</th>' +
          '<th>মোবাইল</th><th class="num">মাসিক</th><th></th></tr></thead><tbody>' +
          d.rows.map(function (s) {
            return '<tr><td>' + esc(s.sponsorship_code) + '</td>' +
              '<td>' + esc(s.orphan_name) + '<div class="v-note">' + esc(s.orphan_code) + '</div></td>' +
              '<td><a href="/admin/donors/d/' + s.donor_id + '">' + esc(s.donor_name) + '</a>' +
                (Number(s.allow_contact) ? '' : '<div class="v-note">যোগাযোগে অসম্মত</div>') + '</td>' +
              '<td>' + esc(s.mobile || '—') + '</td>' +
              '<td class="num"><strong>' + money(s.monthly_amount) + '</strong></td>' +
              '<td><a class="btn btn-light btn-sm" href="/admin/receipts/new?type=ORP&donor=' +
                s.donor_id + '">রশিদ কাটুন</a></td></tr>';
          }).join('') +
          '</tbody><tfoot><tr><th colspan="4" class="num">প্রত্যাশিত মোট</th>' +
          '<th class="num">' + money(d.expected_total) + '</th><th></th></tr></tfoot></table>',
          d.date + ' তারিখ অনুযায়ী');
      });
  }

  function loadReports(el) {
    fetch(API + '/reports/due', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.rows.length) {
          el.innerHTML = box('রিপোর্ট পাঠানো বাকি',
            '<div class="empty">সব স্পনসরকে সময়মতো রিপোর্ট পাঠানো হয়েছে।</div>');
          return;
        }
        el.innerHTML = box('রিপোর্ট পাঠানো বাকি',
          '<table class="data compact"><thead><tr><th>কোড</th><th>শিশু</th><th>দাতা</th>' +
          '<th>ধরন</th><th>শেষ পাঠানো</th><th>কত মাস পার</th><th></th></tr></thead><tbody>' +
          d.rows.map(function (s) {
            return '<tr><td>' + esc(s.sponsorship_code) + '</td>' +
              '<td><a href="/admin/orphans/o/' + s.orphan_id + '">' + esc(s.orphan_name) + '</a>' +
                '<div class="v-note">' + esc(s.orphan_code) + '</div></td>' +
              '<td><a href="/admin/donors/d/' + s.donor_id + '">' + esc(s.donor_name) + '</a></td>' +
              '<td>' + (FREQ[s.report_frequency] || '') + '</td>' +
              '<td>' + (s.last_report_sent ? ymd(s.last_report_sent)
                                           : '<span class="v-note">কখনো নয়</span>') + '</td>' +
              '<td><span class="badge badge-amber">' + BN.toBanglaDigits(s.months_elapsed) +
                ' মাস</span></td>' +
              '<td><a class="btn btn-light btn-sm" href="/admin/orphans/o/' + s.orphan_id +
                '">রিপোর্ট তৈরি করুন</a></td></tr>';
          }).join('') + '</tbody></table>',
          d.rows.length + 'টি · নিয়মিত রিপোর্টই স্পনসর ধরে রাখার চাবি');
      });
  }

  function onAction(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var reason = window.prompt('স্পনসরশিপ শেষ করার কারণ:');
    if (!reason || !reason.trim()) return;
    b.disabled = true;
    fetch(API + '/sponsorships/' + b.getAttribute('data-id') + '/end', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          if (d.back_to_pool) {
            alert(d.orphan_name + ' (' + d.orphan_code + ') আবার অসম্পৃক্ত পুলে ফিরেছে। ' +
              'নতুন ঘাটতি: ' + money(d.new_gap) + '। দ্রুত নতুন স্পনসর খোঁজা দরকার।');
          }
          return load();
        }
        alert((d.errors || ['ত্রুটি']).join('\n'));
        b.disabled = false;
      });
  }
})();

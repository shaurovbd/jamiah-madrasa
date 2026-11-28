/* ভাউচার তালিকা — /admin/ledger */
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
  var API = '/admin/ledger/api';
  var $ = function (id) { return document.getElementById(id); };
  var money = function (v) {
    return 'Tk ' + Number(v || 0).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var TYPE = { RV: 'জমা', PV: 'খরচ', JV: 'জার্নাল', CV: 'কন্ট্রা', FT: 'ট্রান্সফার' };
  var ST = {
    draft: ['ড্রাফট', 'badge'], pending: ['অপেক্ষমাণ', 'badge badge-amber'],
    approved: ['অনুমোদিত', 'badge badge-green'], posted: ['পোস্টেড', 'badge badge-green'],
    rejected: ['বাতিল', 'badge badge-red'],
  };
  var badge = function (s, rev) {
    var x = ST[s] || [s, 'badge'];
    return '<span class="' + x[1] + '">' + esc(x[0]) + '</span>' +
      (rev ? ' <span class="badge badge-red">রিভার্সড</span>' : '');
  };
  var debounce = function (fn, ms) {
    var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  };

  document.addEventListener('DOMContentLoaded', function () {
    ['fType', 'fStatus'].forEach(function (id) { $(id).addEventListener('change', load); });
    $('fQ').addEventListener('input', debounce(load, 300));
    loadStats(); loadPending(); load();
  });

  function loadStats() {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;
        var cards = d.funds.map(function (f) {
          var b = d.fundBalance[f.id] || 0;
          return '<div class="stat-card"><div class="label">' + esc(f.name_bn) +
            '</div><div class="value">' + money(b) + '</div>' +
            '<div class="foot">' + esc(f.code) +
            (Number(f.corpus_protected) ? ' · কর্পাস সুরক্ষিত' : '') + '</div></div>';
        });
        $('statRow').innerHTML = cards.join('');
      });
  }

  function loadPending() {
    fetch(API + '/pending', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.rows.length) return;
        $('pendingCard').hidden = false;
        $('pendingCount').textContent = d.rows.length + 'টি';
        $('pendingBody').innerHTML = d.rows.map(function (r) {
          return '<tr><td><a href="/admin/ledger/v/' + r.id + '">' + esc(r.voucher_no) + '</a></td>' +
            '<td>' + esc(TYPE[r.voucher_type] || r.voucher_type) + '</td>' +
            '<td>' + esc(r.narration_bn || '—') + '</td>' +
            '<td>' + esc(r.fund_codes || '') + '</td>' +
            '<td class="num">' + money(r.total_debit) + '</td>' +
            '<td><a class="btn btn-light btn-sm" href="/admin/ledger/v/' + r.id + '">পর্যালোচনা</a></td></tr>';
        }).join('');
      });
  }

  function load() {
    var p = new URLSearchParams();
    if ($('fType').value) p.set('type', $('fType').value);
    if ($('fStatus').value) p.set('status', $('fStatus').value);
    if ($('fQ').value.trim()) p.set('q', $('fQ').value.trim());

    fetch(API + '/vouchers?' + p.toString(), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.rows.length) {
          $('listBody').innerHTML = '<tr><td colspan="8" class="empty">কোনো ভাউচার নেই।</td></tr>';
          return;
        }
        $('listBody').innerHTML = d.rows.map(function (r) {
          return '<tr><td><a href="/admin/ledger/v/' + r.id + '"><strong>' +
            esc(r.voucher_no) + '</strong></a></td>' +
            '<td>' + esc(ymd(r.voucher_date)) + '</td>' +
            '<td>' + esc(TYPE[r.voucher_type] || r.voucher_type) + '</td>' +
            '<td>' + esc(r.narration_bn || '—') + '</td>' +
            '<td>' + esc(r.fund_codes || '') + '</td>' +
            '<td class="num">' + money(r.total_debit) + '</td>' +
            '<td>' + badge(r.status, r.reversed_at) + '</td>' +
            '<td><a class="btn btn-light btn-sm" href="/admin/ledger/v/' + r.id + '">দেখুন</a></td></tr>';
        }).join('');
      });
  }
})();

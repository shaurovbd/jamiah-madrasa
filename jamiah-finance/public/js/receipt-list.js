/* রশিদ তালিকা — /admin/receipts */
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
  var API = '/admin/receipts/api';
  var $ = function (id) { return document.getElementById(id); };
  var money = function (v) {
    return 'Tk ' + Number(v || 0).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var METHOD = { cash: 'নগদ', bank: 'ব্যাংক', bkash: 'বিকাশ', nagad: 'নগদ', rocket: 'রকেট', cheque: 'চেক' };
  var deb = function (fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; };

  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          $('fType').innerHTML = '<option value="">সব ধরন</option>' + d.types.map(function (t) {
            return '<option value="' + t.code + '">' + t.name_bn + '</option>';
          }).join('');
        }
      });
    $('dDate').addEventListener('change', daily);
    ['fType', 'fStatus'].forEach(function (id) { $(id).addEventListener('change', list); });
    $('fQ').addEventListener('input', deb(list, 300));
    daily(); list();
  });

  function daily() {
    fetch(API + '/daily?date=' + encodeURIComponent($('dDate').value), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;
        var types = d.byType.length
          ? d.byType.map(function (t) {
              return '<div class="v-sum-row"><span>' + esc(t.type_name) + ' · ' +
                esc(t.fund_code) + ' (' + t.receipt_count + ')</span><span class="v-amt">' +
                money(t.total_amount) + '</span></div>';
            }).join('')
          : '<div class="v-note">এই দিনে কোনো রশিদ কাটা হয়নি।</div>';
        var methods = d.byMethod.map(function (m) {
          return '<div class="v-sum-row"><span>' + (METHOD[m.payment_method] || m.payment_method) +
            ' · ' + esc(m.cash_name) + '</span><span class="v-amt">' +
            money(m.total_amount) + '</span></div>';
        }).join('');
        $('dailyBox').innerHTML =
          '<div class="v-sum-grid">' +
            '<div class="v-sum-box"><h4>ধরন অনুযায়ী</h4>' + types +
              '<div class="v-sum-row v-total"><span>মোট ' + d.count + 'টি</span>' +
              '<span class="v-amt v-ok">' + money(d.total) + '</span></div></div>' +
            '<div class="v-sum-box"><h4>মাধ্যম অনুযায়ী (ক্যাশ মিলানো)</h4>' +
              (methods || '<div class="v-note">—</div>') + '</div>' +
          '</div>';
      });
  }

  function list() {
    var p = new URLSearchParams();
    if ($('fType').value) p.set('type', $('fType').value);
    if ($('fStatus').value) p.set('status', $('fStatus').value);
    if ($('fQ').value.trim()) p.set('q', $('fQ').value.trim());
    fetch(API + '/receipts?' + p, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.rows.length) {
          $('listBody').innerHTML = '<tr><td colspan="9" class="empty">কোনো রশিদ নেই।</td></tr>';
          return;
        }
        $('listBody').innerHTML = d.rows.map(function (r) {
          return '<tr class="' + (r.status === 'void' ? 'r-void-row' : '') + '">' +
            '<td><a href="/admin/receipts/r/' + r.id + '"><strong>' + esc(r.receipt_no) + '</strong></a></td>' +
            '<td>' + esc(ymd(r.receipt_date)) + '</td>' +
            '<td>' + esc(r.type_name) + '</td>' +
            '<td>' + esc(r.payer_name || '—') +
              (r.payer_mobile ? '<div class="v-note">' + esc(r.payer_mobile) + '</div>' : '') + '</td>' +
            '<td>' + esc(r.fund_code) + '</td>' +
            '<td>' + (METHOD[r.payment_method] || r.payment_method) + '</td>' +
            '<td class="num">' + money(r.amount) + '</td>' +
            '<td>' + (r.status === 'void'
              ? '<span class="badge badge-red">বাতিল</span>'
              : '<span class="badge badge-green">বৈধ</span>') + '</td>' +
            '<td><a class="btn btn-light btn-sm" href="/admin/receipts/r/' + r.id + '">প্রিন্ট</a></td></tr>';
        }).join('');
      });
  }
})();

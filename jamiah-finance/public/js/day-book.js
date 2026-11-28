/* দিনের খতিয়ান — /admin/ledger/day-book */
(function () {
  'use strict';
  var API = '/admin/ledger/api';
  var money = function (v) {
    return 'Tk ' + Number(v || 0).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  document.addEventListener('DOMContentLoaded', function () {
    var inp = document.getElementById('dbDate');
    inp.addEventListener('change', load);
    load();

    function load() {
      fetch(API + '/day-book?date=' + encodeURIComponent(inp.value), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(render);
    }

    function render(d) {
      var out = document.getElementById('dayBookOut');
      if (!d.ok) { out.innerHTML = '<div class="empty">লোড করা যায়নি।</div>'; return; }

      var totD = 0, totC = 0;
      d.rows.forEach(function (r) { totD += Number(r.debit); totC += Number(r.credit); });

      var entries = d.rows.length
        ? d.rows.map(function (r) {
            return '<tr><td>' + esc(r.voucher_no) + '</td>' +
              '<td><strong>' + esc(r.account_code) + '</strong> ' + esc(r.account_name) + '</td>' +
              '<td>' + esc(r.fund_code) + '</td>' +
              '<td>' + esc(r.cost_center || '—') + '</td>' +
              '<td>' + esc(r.narration_bn || r.line_narration || '—') + '</td>' +
              '<td class="num">' + (Number(r.debit) ? money(r.debit) : '—') + '</td>' +
              '<td class="num">' + (Number(r.credit) ? money(r.credit) : '—') + '</td></tr>';
          }).join('')
        : '<tr><td colspan="7" class="empty">এই দিনে কোনো পোস্টেড লেনদেন নেই।</td></tr>';

      out.innerHTML =
        '<div class="card"><div class="card-head"><strong>' + esc(d.date) +
          ' — লেনদেন</strong></div><div class="card-body flush"><div class="table-wrap">' +
          '<table class="data compact"><thead><tr><th>ভাউচার</th><th>হিসাব</th><th>ফান্ড</th>' +
          '<th>বিভাগ</th><th>বিবরণ</th><th class="num">ডেবিট</th><th class="num">ক্রেডিট</th>' +
          '</tr></thead><tbody>' + entries + '</tbody><tfoot><tr><th colspan="5" class="num">মোট</th>' +
          '<th class="num">' + money(totD) + '</th><th class="num">' + money(totC) +
          '</th></tr></tfoot></table></div></div></div>' +

        '<div class="grid g2">' +
          box('দিন শেষে নগদ ও ব্যাংক', d.cash.map(function (c) {
            return row(c.name_bn, money(c.balance));
          }).join('')) +
          box('ফান্ডের জের', d.funds.map(function (f) {
            return row(f.name_bn, money(f.available_balance));
          }).join('')) +
        '</div>' +

        '<div class="v-print-sign"><div><span></span>হিসাবরক্ষক</div>' +
        '<div><span></span>মুহতামিম</div></div>';
    }

    function box(title, inner) {
      return '<div class="card"><div class="card-head"><strong>' + title +
        '</strong></div><div class="card-body">' + (inner || '<div class="empty">—</div>') + '</div></div>';
    }
    function row(k, v) {
      return '<div class="v-sum-row"><span>' + esc(k) + '</span><span class="v-amt">' + v + '</span></div>';
    }
  });
})();

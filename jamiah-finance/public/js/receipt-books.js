/* রশিদ বই রেজিস্টার — /admin/receipts/books */
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
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ST = {
    in_store: ['ভাণ্ডারে', 'badge'], issued: ['কলেক্টরের কাছে', 'badge badge-amber'],
    returned: ['ফেরত এসেছে', 'badge badge-green'], lost: ['হারানো', 'badge badge-red'],
  };

  document.addEventListener('DOMContentLoaded', function () {
    load();
    document.getElementById('bookBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var id = b.getAttribute('data-id');
      var act = b.getAttribute('data-act');
      var body = {};
      if (act === 'assign') {
        var name = window.prompt('কোন কর্মচারীকে দেওয়া হচ্ছে? (নাম)');
        if (!name || !name.trim()) return;
        body.staff_name = name.trim();
        var sid = window.prompt('তাঁর স্টাফ আইডি (জানা থাকলে):');
        if (sid && /^\d+$/.test(sid)) body.staff_id = Number(sid);
      } else if (!window.confirm('বইটি ফেরত নেওয়া হলো?')) return;

      b.disabled = true;
      fetch(API + '/books/' + id + '/' + act, {
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
    });
  });

  function load() {
    fetch(API + '/books', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var tb = document.getElementById('bookBody');
        if (!d.ok || !d.rows.length) {
          tb.innerHTML = '<tr><td colspan="8" class="empty">কোনো বই নিবন্ধিত নেই।</td></tr>';
          return;
        }
        tb.innerHTML = d.rows.map(function (b) {
          var st = ST[b.status] || [b.status, 'badge'];
          var total = Number(b.to_no) - Number(b.from_no) + 1;
          return '<tr><td><strong>' + esc(b.book_no) + '</strong></td>' +
            '<td>' + esc(b.type_name || '—') + '</td>' +
            '<td>' + b.from_no + '–' + b.to_no + '</td>' +
            '<td>' + esc(b.issued_to_name || '—') +
              (b.issued_to ? '<div class="v-note">আইডি ' + b.issued_to + '</div>' : '') + '</td>' +
            '<td>' + esc(b.issued_at ? ymd(b.issued_at) : '—') + '</td>' +
            '<td class="num">' + b.used_count + ' / ' + total + '</td>' +
            '<td><span class="' + st[1] + '">' + st[0] + '</span></td>' +
            '<td>' + (b.status === 'issued'
              ? '<button class="btn btn-light btn-sm" data-act="return" data-id="' + b.id + '">ফেরত নিন</button>'
              : b.status === 'in_store' || b.status === 'returned'
                ? '<button class="btn btn-light btn-sm" data-act="assign" data-id="' + b.id + '">দিন</button>'
                : '') + '</td></tr>';
        }).join('');
      });
  }
})();

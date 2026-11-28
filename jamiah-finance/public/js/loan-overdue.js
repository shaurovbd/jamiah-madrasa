/* মেয়াদ পেরোনো ঋণ — /admin/loans/overdue */
(function () {
  'use strict';
  var API = '/admin/loans/api';
  var $ = function (id) { return document.getElementById(id); };
  var money = function (v) { return 'Tk ' + Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
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
  function alertBox(msg, kind) {
    var el = $('lnAlert'); if (!el) return;
    el.className = 'v-alert ' + (kind || 'err'); el.textContent = msg; el.hidden = !msg;
  }

  function load() {
    var d = $('asOf').value;
    fetch(API + '/overdue' + (d ? '?date=' + encodeURIComponent(d) : ''),
      { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var tb = $('odTable').querySelector('tbody');
        if (!data.ok) { alertBox('লোড করা গেল না।'); return; }
        alertBox('');
        $('odHead').textContent = ymd(data.date) + ' পর্যন্ত বকেয়া — ' +
          data.rows.length + 'টি, মোট ' + money(data.total_outstanding);
        if (!data.rows.length) {
          tb.innerHTML = '<tr><td colspan="8" class="empty">কোনো বকেয়া নেই। আলহামদুলিল্লাহ।</td></tr>';
          return;
        }
        tb.innerHTML = data.rows.map(function (r) {
          var late = r.days_to_due == null ? '—' : Math.abs(Number(r.days_to_due));
          return '<tr>' +
            '<td><a href="/admin/loans/l/' + r.loan_id + '">' + esc(r.loan_code) + '</a></td>' +
            '<td>' + esc(r.party_name) + '</td>' +
            '<td>' + esc(r.party_mobile || '—') + '</td>' +
            '<td>' + ymd(r.due_date) + '</td>' +
            '<td class="r">' + late + ' দিন</td>' +
            '<td class="r"><strong>' + money(r.outstanding) + '</strong></td>' +
            '<td>' + (r.last_reminded_at ? ymd(r.last_reminded_at) +
              ' (' + Number(r.reminder_count) + ' বার)' : '—') + '</td>' +
            '<td><button class="btn btn-light btn-xs" data-remind="' + r.loan_id +
              '">মনে করানো হলো</button></td>' +
            '</tr>';
        }).join('');
      })
      .catch(function () { alertBox('সার্ভারে পৌঁছানো গেল না।'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    load();
    $('asOf').addEventListener('change', load);
    $('odTable').addEventListener('click', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-remind');
      if (!id) return;
      e.target.disabled = true;
      fetch(API + '/loans/' + id + '/remind', { method: 'POST', credentials: 'same-origin' })
        .then(function () { load(); })
        .catch(function () { e.target.disabled = false; });
    });
  });
})();

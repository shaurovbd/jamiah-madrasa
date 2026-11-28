/* ঋণের তালিকা — /admin/loans */
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
  var deb = function (fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; };
  var STATUS = { active: 'চলমান', settled: 'শোধ হয়েছে', written_off: 'মওকুফ', cancelled: 'বাতিল' };

  function alertBox(msg, kind) {
    var el = $('lnAlert'); if (!el) return;
    el.className = 'v-alert ' + (kind || 'err'); el.textContent = msg; el.hidden = !msg;
  }

  function summary() {
    fetch(API + '/summary', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;
        var s = d.summary || {};
        var card = function (title, row, owed) {
          if (!row) return '<div class="ln-card"><h3>' + title + '</h3>' +
            '<div class="amt">Tk 0</div><div class="meta">কিছু নেই</div></div>';
          return '<div class="ln-card' + (owed ? ' is-owed' : '') + '">' +
            '<h3>' + title + '</h3>' +
            '<div class="amt">' + money(row.total_outstanding) + '</div>' +
            '<div class="meta">' + Number(row.active_count || 0) + 'টি চলমান · আসল ' +
            money(row.total_principal) +
            (Number(row.overdue_outstanding) > 0
              ? ' · <span class="over">মেয়াদ পেরোনো ' + money(row.overdue_outstanding) + '</span>'
              : '') +
            (Number(row.written_off) > 0 ? ' · মওকুফ ' + money(row.written_off) : '') +
            '</div></div>';
        };
        $('lnSummary').innerHTML =
          card('প্রতিষ্ঠান পাবে (দেওয়া ঋণ)', s.given, false) +
          card('প্রতিষ্ঠান দেবে (নেওয়া ঋণ)', s.received, true);
      })
      .catch(function () {});
  }

  function load() {
    var q = [];
    if ($('fDir').value) q.push('direction=' + encodeURIComponent($('fDir').value));
    if ($('fStatus').value) q.push('status=' + encodeURIComponent($('fStatus').value));
    if ($('fQ').value.trim()) q.push('q=' + encodeURIComponent($('fQ').value.trim()));
    fetch(API + '/loans' + (q.length ? '?' + q.join('&') : ''), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var tb = $('lnTable').querySelector('tbody');
        if (!d.ok) { alertBox((d.errors || ['লোড করা গেল না']).join(' ')); return; }
        alertBox('');
        if (!d.rows.length) {
          tb.innerHTML = '<tr><td colspan="9" class="empty">কোনো ঋণ নেই।</td></tr>'; return;
        }
        tb.innerHTML = d.rows.map(function (r) {
          var pct = Math.min(100, Math.round(Number(r.paid_pct || 0)));
          return '<tr>' +
            '<td><a href="/admin/loans/l/' + r.loan_id + '">' + esc(r.loan_code) + '</a></td>' +
            '<td>' + esc(r.party_name) +
              (r.party_mobile ? '<br><small>' + esc(r.party_mobile) + '</small>' : '') + '</td>' +
            '<td>' + (r.direction === 'given' ? 'দেওয়া' : 'নেওয়া') + '</td>' +
            '<td>' + ymd(r.issue_date) + '</td>' +
            '<td>' + ymd(r.due_date) +
              (Number(r.is_overdue) ? ' <span class="ln-badge ln-overdue">পেরিয়েছে</span>' : '') + '</td>' +
            '<td class="r">' + money(r.principal) + '</td>' +
            '<td class="r">' + money(r.paid) +
              '<div class="ln-bar"><i style="width:' + pct + '%"></i></div></td>' +
            '<td class="r"><strong>' + money(r.outstanding) + '</strong></td>' +
            '<td><span class="ln-badge ln-' + r.status + '">' +
              (STATUS[r.status] || r.status) + '</span></td>' +
            '</tr>';
        }).join('');
      })
      .catch(function () { alertBox('সার্ভারে পৌঁছানো গেল না।'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    summary(); load();
    $('fDir').addEventListener('change', load);
    $('fStatus').addEventListener('change', load);
    $('fQ').addEventListener('input', deb(load, 300));
  });
})();

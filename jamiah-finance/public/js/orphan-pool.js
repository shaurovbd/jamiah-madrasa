/* অসম্পৃক্ত পুল — /admin/orphans/pool */
(function () {
  'use strict';
  var API = '/admin/orphans/api';
  var BN = window.BanglaNumber || { toBanglaDigits: function (x) { return x; } };
  var money = function (v) { return 'Tk ' + Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/pool', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var box = document.getElementById('poolBox');
        if (!d.ok || !d.rows.length) {
          box.innerHTML = '<div class="card"><div class="card-body empty">' +
            'সব শিশুর স্পনসরশিপ পূর্ণ। আলহামদুলিল্লাহ।</div></div>';
          return;
        }
        box.innerHTML =
          '<div class="grid g2"><div class="stat-card red"><div class="label">স্পনসর দরকার</div>' +
            '<div class="value">' + BN.toBanglaDigits(d.count) + ' জন</div></div>' +
          '<div class="stat-card gold"><div class="label">মোট মাসিক ঘাটতি</div>' +
            '<div class="value">' + money(d.total_gap) + '</div></div></div>' +
          d.rows.map(function (r) {
            var pct = r.coverage_pct == null ? 0 : Math.min(Number(r.coverage_pct), 100);
            return '<div class="o-card"><div class="o-card-top">' +
              '<div><div class="o-card-name">' +
                '<a href="/admin/orphans/o/' + r.orphan_id + '">' + esc(r.full_name) + '</a>' +
                ' <span class="v-note">' + esc(r.orphan_code) + '</span></div>' +
              '<div class="o-card-meta">' +
                (r.age_years != null ? BN.toBanglaDigits(r.age_years) + ' বছর · ' : '') +
                esc(r.class_name || '') +
                (r.department_name ? ' · ' + esc(r.department_name) : '') +
                (r.district ? ' · ' + esc(r.district) : '') + '</div></div>' +
              '<div style="text-align:right"><div class="o-gap">ঘাটতি ' + money(r.gap_monthly) + '</div>' +
                '<div class="o-card-meta">প্রয়োজন ' + money(r.monthly_need) +
                (Number(r.sponsor_count) ? ' · ' + BN.toBanglaDigits(r.sponsor_count) +
                  ' জন স্পনসর আছেন' : ' · কোনো স্পনসর নেই') + '</div></div>' +
              '</div>' +
              '<div class="d-prog d-prog-sm"><div class="d-prog-fill" style="width:' + pct + '%"></div></div>' +
              '<div style="margin-top:.6rem"><a class="btn btn-light btn-sm" href="/admin/orphans/o/' +
                r.orphan_id + '">নথি দেখুন ও স্পনসর যোগ করুন</a></div>' +
              '</div>';
          }).join('');
      });
  });
})();

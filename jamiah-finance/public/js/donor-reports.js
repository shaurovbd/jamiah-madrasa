/* অনুদানের রিপোর্ট — টপ দাতা, এলাকা, মাস-ওয়ারি তুলনা */
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
  var MONTHS = ['জানু', 'ফেব', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
                'জুলাই', 'আগস্ট', 'সেপ্ট', 'অক্টো', 'নভে', 'ডিসে'];

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('rYear').addEventListener('change', load);
    load();
  });

  function bars(rows, nameKey, valKey, altKey) {
    var max = rows.reduce(function (m, r) {
      return Math.max(m, Number(r[valKey]) || 0, altKey ? Number(r[altKey]) || 0 : 0);
    }, 0) || 1;
    return '<div class="d-bars">' + rows.map(function (r) {
      var w = Math.round(100 * (Number(r[valKey]) || 0) / max);
      var aw = altKey ? Math.round(100 * (Number(r[altKey]) || 0) / max) : null;
      return '<div class="d-bar-row">' +
        '<div class="d-bar-name" title="' + esc(r[nameKey]) + '">' + esc(r[nameKey]) + '</div>' +
        '<div class="d-bar-track"><div class="d-bar-fill" style="width:' + w + '%"></div>' +
          (altKey ? '<div class="d-bar-fill alt" style="width:' + aw + '%;height:35%"></div>' : '') +
        '</div>' +
        '<div class="d-bar-val">' + money(r[valKey]) + '</div></div>';
    }).join('') + '</div>';
  }

  function card(title, inner, note) {
    return '<div class="card"><div class="card-head"><strong>' + title + '</strong>' +
      (note ? '<span class="spacer"></span><span class="v-note">' + note + '</span>' : '') +
      '</div><div class="card-body">' + inner + '</div></div>';
  }

  function load() {
    var yr = document.getElementById('rYear').value;
    var box = document.getElementById('reportBox');
    box.innerHTML = '<div class="empty">লোড হচ্ছে…</div>';

    Promise.all([
      fetch(API + '/reports/top?limit=10', { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
      fetch(API + '/reports/area', { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
      fetch(API + '/reports/monthly?year=' + yr, { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
    ]).then(function (res) {
      var top = res[0].rows || [], area = res[1].rows || [], mon = res[2].rows || [];

      var topHtml = top.length
        ? '<table class="data compact"><thead><tr><th>#</th><th>দাতা</th><th>এলাকা</th>' +
          '<th class="num">বার</th><th class="num">মোট</th><th>সর্বশেষ</th></tr></thead><tbody>' +
          top.map(function (t, i) {
            return '<tr><td>' + BN.toBanglaDigits(i + 1) + '</td>' +
              '<td><a href="/admin/donors/d/' + t.donor_id + '">' + esc(t.name) + '</a>' +
              (Number(t.is_expatriate) ? ' <span class="badge">প্রবাসী</span>' : '') + '</td>' +
              '<td>' + esc(t.district || t.country || '—') + '</td>' +
              '<td class="num">' + BN.toBanglaDigits(t.gift_count) + '</td>' +
              '<td class="num"><strong>' + money(t.total_given) + '</strong></td>' +
              '<td>' + ymd(t.last_gift_date) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="empty">কোনো দাতা নেই।</div>';

      var areaRows = area.map(function (a) {
        return {
          name: (a.district === 'অজানা' && a.country !== 'বাংলাদেশ' ? a.country : a.district) +
            (Number(a.is_expatriate) ? ' (প্রবাসী)' : ''),
          total: a.total_amount, donors: a.donor_count,
        };
      });

      var monRows = mon.map(function (m) {
        return { name: MONTHS[Number(m.mn) - 1] || m.mn, now: m.this_year, prev: m.last_year };
      });
      var sumNow = mon.reduce(function (s, m) { return s + Number(m.this_year); }, 0);
      var sumPrev = mon.reduce(function (s, m) { return s + Number(m.last_year); }, 0);
      var change = sumPrev > 0 ? Math.round(100 * (sumNow - sumPrev) / sumPrev) : null;

      box.innerHTML =
        card('মাস-ওয়ারি সংগ্রহ — ' + BN.toBanglaDigits(yr) +
             (change == null ? '' : ' (গত বছরের চেয়ে ' +
               (change >= 0 ? '+' : '') + BN.toBanglaDigits(change) + '%)'),
          '<div class="d-legend"><span><i class="now"></i>' + BN.toBanglaDigits(yr) + '</span>' +
          '<span><i class="prev"></i>' + BN.toBanglaDigits(Number(yr) - 1) + '</span></div>' +
          (monRows.length ? bars(monRows, 'name', 'now', 'prev')
                          : '<div class="empty">কোনো তথ্য নেই।</div>'),
          'মোট ' + money(sumNow)) +
        card('টপ ১০ দাতা', topHtml) +
        card('এলাকাভিত্তিক সংগ্রহ',
          areaRows.length ? bars(areaRows, 'name', 'total')
                          : '<div class="empty">কোনো তথ্য নেই।</div>');
    });
  }
})();

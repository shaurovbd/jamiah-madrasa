/* দাতার তালিকা — /admin/donors */
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
  var $ = function (id) { return document.getElementById(id); };
  var BN = window.BanglaNumber || { toBanglaDigits: function (x) { return x; } };
  var money = function (v) { return 'Tk ' + Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var deb = function (fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; };
  var picked = [];

  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;
        var t = d.totals || {};
        $('statRow').innerHTML =
          card('মোট দাতা', BN.toBanglaDigits(t.donors || 0), '') +
          card('মোট সংগ্রহ', money(t.total), '', 'blue') +
          card('প্রবাসী দাতা', BN.toBanglaDigits(t.expats || 0), '') +
          card('নিষ্ক্রিয় (৬ মাস+)', BN.toBanglaDigits(t.lapsed || 0),
               '<a href="/admin/donors/followups">তালিকা দেখুন</a>', 'gold');
        $('fDistrict').innerHTML = '<option value="">সব জেলা</option>' +
          d.districts.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
      });

    ['fSort', 'fDistrict', 'fExpat'].forEach(function (id) {
      $(id).addEventListener('change', load);
    });
    $('fQ').addEventListener('input', deb(load, 300));
    $('mergeBtn').addEventListener('click', doMerge);
    load();
  });

  function card(label, value, foot, cls) {
    return '<div class="stat-card ' + (cls || '') + '"><div class="label">' + label +
      '</div><div class="value">' + value + '</div>' +
      (foot ? '<div class="foot">' + foot + '</div>' : '') + '</div>';
  }

  function load() {
    var p = new URLSearchParams();
    p.set('sort', $('fSort').value);
    if ($('fDistrict').value) p.set('district', $('fDistrict').value);
    if ($('fExpat').checked) p.set('expat', 'true');
    if ($('fQ').value.trim()) p.set('q', $('fQ').value.trim());

    fetch(API + '/donors?' + p, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        picked = []; syncMerge();
        if (!d.ok || !d.rows.length) {
          $('listBody').innerHTML = '<tr><td colspan="9" class="empty">কোনো দাতা পাওয়া যায়নি।</td></tr>';
          return;
        }
        $('listBody').innerHTML = d.rows.map(function (r) {
          var lapsed = r.months_since_last != null && r.months_since_last >= 6;
          return '<tr><td class="d-pick"><input type="checkbox" data-id="' + r.donor_id + '"></td>' +
            '<td>' + esc(r.donor_code || '—') + '</td>' +
            '<td><a href="/admin/donors/d/' + r.donor_id + '">' + esc(r.name) + '</a>' +
              (r.recognition_tier ? ' <span class="badge badge-green">' +
                esc(r.recognition_tier) + '</span>' : '') +
              (Number(r.is_expatriate) ? ' <span class="badge">প্রবাসী</span>' : '') + '</td>' +
            '<td>' + esc(r.mobile || '—') + '</td>' +
            '<td>' + esc(r.district || r.country || '—') + '</td>' +
            '<td class="num">' + BN.toBanglaDigits(r.gift_count) + '</td>' +
            '<td class="num">' + money(r.total_given) + '</td>' +
            '<td>' + (r.last_gift_date ? ymd(r.last_gift_date) : '—') +
              (lapsed ? ' <span class="badge badge-amber">' +
                BN.toBanglaDigits(r.months_since_last) + ' মাস</span>' : '') + '</td>' +
            '<td><a class="btn btn-light btn-sm" href="/admin/donors/d/' + r.donor_id + '">দেখুন</a></td></tr>';
        }).join('');

        Array.prototype.forEach.call($('listBody').querySelectorAll('input[type=checkbox]'),
          function (cb) {
            cb.addEventListener('change', function () {
              var id = Number(cb.getAttribute('data-id'));
              if (cb.checked) picked.push(id);
              else picked = picked.filter(function (x) { return x !== id; });
              syncMerge();
            });
          });
      });
  }

  function syncMerge() {
    $('mergeBtn').disabled = picked.length !== 2;
    $('mergeBtn').textContent = picked.length === 2
      ? 'এই ২টি রেকর্ড একীভূত করুন'
      : '২টি নির্বাচন করে একীভূত করুন';
  }

  function doMerge() {
    if (picked.length !== 2) return;
    var keep = window.prompt(
      'কোন রেকর্ডটি রাখতে চান? আইডি লিখুন (' + picked.join(' বা ') + ')', String(picked[0]));
    if (!keep) return;
    var keepId = Number(keep);
    var mergeId = picked.filter(function (x) { return x !== keepId; })[0];
    if (!mergeId) return alert('আইডি দুটির একটি হতে হবে।');
    if (!window.confirm('রেকর্ড ' + mergeId + ' এর সব রশিদ, প্রতিশ্রুতি ও মাসিক পরিকল্পনা ' +
      keepId + ' এ চলে যাবে। পুরনো রেকর্ড মুছে যাবে না, চিহ্নিত হবে। চালিয়ে যাবেন?')) return;

    fetch(API + '/donors/merge', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep_id: keepId, merge_id: mergeId }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          alert(d.moved_receipts + 'টি রশিদ (মোট ' + money(d.moved_amount) + ') সরানো হয়েছে।');
          window.location.href = '/admin/donors/d/' + d.keep_id;
          return;
        }
        alert((d.errors || ['ত্রুটি']).join('\n'));
      });
  }
})();

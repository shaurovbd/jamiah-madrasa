/* এতিম তালিকা — /admin/orphans */
(function () {
  'use strict';
  var API = '/admin/orphans/api';
  var $ = function (id) { return document.getElementById(id); };
  var BN = window.BanglaNumber || { toBanglaDigits: function (x) { return x; } };
  var money = function (v) { return 'Tk ' + Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var deb = function (fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; };
  var meta = null;

  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        meta = d;
        var o = d.overview || {};
        $('statRow').innerHTML =
          card('সক্রিয় শিশু', BN.toBanglaDigits(o.total || 0),
               'যাচাইকৃত ' + BN.toBanglaDigits(o.verified || 0) +
               ' · বাকি ' + BN.toBanglaDigits(o.pending || 0)) +
          card('মাসিক প্রয়োজন', money(o.need_total), '', 'blue') +
          card('কভারেজ', money(o.covered_total),
               BN.toBanglaDigits(o.active_sponsorships || 0) + 'টি স্পনসরশিপ · ' +
               BN.toBanglaDigits(o.sponsors || 0) + ' জন দাতা') +
          card('ঘাটতি', money(o.gap_total),
               '<a href="/admin/orphans/pool">' + BN.toBanglaDigits(o.unsponsored || 0) +
               ' জনের স্পনসর নেই</a>', Number(o.gap_total) ? 'red' : '');
        $('fDept').innerHTML = '<option value="">সব বিভাগ</option>' +
          d.costCenters.map(function (c) {
            return '<option value="' + c.code + '">' + esc(c.name_bn) + '</option>';
          }).join('');
      });

    ['fVerify', 'fDept', 'fUnspon', 'fSort'].forEach(function (id) {
      $(id).addEventListener('change', load);
    });
    $('fQ').addEventListener('input', deb(load, 300));
    $('newOrphan').addEventListener('click', create);
    load();
  });

  function card(label, value, foot, cls) {
    return '<div class="stat-card ' + (cls || '') + '"><div class="label">' + label +
      '</div><div class="value">' + value + '</div>' +
      (foot ? '<div class="foot">' + foot + '</div>' : '') + '</div>';
  }

  function load() {
    var p = new URLSearchParams();
    if ($('fVerify').value) p.set('verification', $('fVerify').value);
    if ($('fDept').value) p.set('department', $('fDept').value);
    if ($('fUnspon').checked) p.set('unsponsored', 'true');
    p.set('sort', $('fSort').value);
    if ($('fQ').value.trim()) p.set('q', $('fQ').value.trim());

    fetch(API + '/orphans?' + p, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.rows.length) {
          $('listBody').innerHTML = '<tr><td colspan="11" class="empty">কোনো নথি নেই।</td></tr>';
          return;
        }
        $('listBody').innerHTML = d.rows.map(function (r) {
          var pct = r.coverage_pct == null ? 0 : Math.min(Number(r.coverage_pct), 100);
          return '<tr><td>' + esc(r.orphan_code) + '</td>' +
            '<td><a href="/admin/orphans/o/' + r.orphan_id + '">' + esc(r.full_name) + '</a></td>' +
            '<td>' + (r.age_years != null ? BN.toBanglaDigits(r.age_years) : '—') + '</td>' +
            '<td>' + esc(r.class_name || '—') + '</td>' +
            '<td>' + esc(({ father_deceased: 'পিতৃহীন', mother_deceased: 'মাতৃহীন',
              both_deceased: 'উভয়হীন', abandoned: 'পরিত্যক্ত',
              extreme_poverty: 'অতিদরিদ্র' })[r.orphan_status] || r.orphan_status) + '</td>' +
            '<td class="num">' + money(r.monthly_need) + '</td>' +
            '<td class="num"><div class="o-cov">' +
              '<div class="d-prog d-prog-sm"><div class="d-prog-fill" style="width:' + pct + '%"></div></div>' +
              '<span class="o-cov-pct">' + (r.coverage_pct == null ? '—' :
                BN.toBanglaDigits(r.coverage_pct) + '%') + '</span></div></td>' +
            '<td>' + (Number(r.sponsor_count)
              ? BN.toBanglaDigits(r.sponsor_count) + ' জন'
              : '<span class="badge badge-red">নেই</span>') + '</td>' +
            '<td>' + ({ verified: '<span class="badge badge-green">যাচাইকৃত</span>',
              pending: '<span class="badge badge-amber">বাকি</span>',
              rejected: '<span class="badge badge-red">নাকচ</span>' }[r.verification_status] || '') + '</td>' +
            '<td>' + (r.months_since_report == null
              ? '<span class="v-note">নেই</span>'
              : BN.toBanglaDigits(r.months_since_report) + ' মাস আগে') + '</td>' +
            '<td><a class="btn btn-light btn-sm" href="/admin/orphans/o/' + r.orphan_id + '">দেখুন</a></td></tr>';
        }).join('');
      });
  }

  function ask(l, d) { var v = window.prompt(l, d || ''); return v === null ? null : v.trim(); }

  function create() {
    if (!meta) return alert('তথ্য লোড হচ্ছে।');
    var name = ask('শিশুর পুরো নাম:');
    if (!name) return;
    var sl = meta.orphanStatuses.map(function (s, i) { return (i + 1) + '. ' + s.name; }).join('\n');
    var si = ask('অবস্থা?\n' + sl + '\n\nনম্বর লিখুন:', '1');
    var st = meta.orphanStatuses[Number(si) - 1];
    if (!st) return alert('অবস্থা নির্বাচন হয়নি।');
    var dob = ask('জন্ম তারিখ (YYYY-MM-DD, খালি রাখা যায়):');
    var cls = ask('শ্রেণি:');
    var cl = meta.costCenters.map(function (c, i) { return (i + 1) + '. ' + c.name_bn; }).join('\n');
    var ci = ask('বিভাগ?\n' + cl + '\n\nনম্বর লিখুন (খালি রাখা যায়):');
    var cc = meta.costCenters[Number(ci) - 1];
    var food = ask('মাসিক খাবার খরচ (টাকা):', '2500');
    var lodge = ask('মাসিক থাকার খরচ:', '1200');
    var books = ask('কিতাব ও উপকরণ:', '300');

    fetch(API + '/orphans', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: name, orphan_status: st.code,
        date_of_birth: dob || null, class_name: cls || null,
        cost_center_id: cc ? cc.id : null,
        need_food: Number(food) || 0, need_lodging: Number(lodge) || 0,
        need_books: Number(books) || 0,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { window.location.href = '/admin/orphans/o/' + d.id; return; }
        alert((d.errors || ['ত্রুটি']).join('\n'));
      });
  }
})();

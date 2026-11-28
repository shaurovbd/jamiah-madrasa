/* প্রচারাভিযান — /admin/donors/campaigns */
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
  var meta = null;

  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); }).then(function (d) { meta = d; });
    document.getElementById('newCampaign').addEventListener('click', create);
    load();
  });

  function load() {
    fetch(API + '/campaigns', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var box = document.getElementById('campaignBox');
        if (!d.ok || !d.rows.length) {
          box.innerHTML = '<div class="card"><div class="card-body empty">' +
            'কোনো প্রচারাভিযান নেই। উপরের বোতাম দিয়ে একটি তৈরি করুন।</div></div>';
          return;
        }
        box.innerHTML = d.rows.map(function (c) {
          var pct = c.pct == null ? 0 : Math.min(Number(c.pct), 100);
          var over = Number(c.raised) >= Number(c.target_amount) && Number(c.target_amount) > 0;
          return '<div class="card d-camp"><div class="card-body">' +
            '<div class="d-camp-top">' +
              '<div><div class="d-camp-title">' +
                '<a href="/admin/donors/campaigns/' + c.campaign_id + '">' + esc(c.title_bn) + '</a>' +
                (c.status !== 'active' ? ' <span class="badge">' +
                  (c.status === 'closed' ? 'বন্ধ' : 'খসড়া') + '</span>' : '') +
                (over ? ' <span class="badge badge-green">লক্ষ্য পূর্ণ</span>' : '') +
              '</div>' +
              '<div class="v-note">' + esc(c.code) + ' · ' + esc(c.fund_name) +
                (c.end_date ? ' · শেষ ' + ymd(c.end_date) : '') +
                (c.days_left != null && c.days_left >= 0 && c.status === 'active'
                  ? ' (' + BN.toBanglaDigits(c.days_left) + ' দিন বাকি)' : '') + '</div></div>' +
              '<div class="d-camp-nums"><strong>' + money(c.raised) + '</strong> / ' +
                money(c.target_amount) + ' · ' + BN.toBanglaDigits(c.donor_count) + ' জন' +
                (Number(c.pledged_open) ? ' · প্রতিশ্রুত ' + money(c.pledged_open) : '') + '</div>' +
            '</div>' +
            '<div class="d-prog"><div class="d-prog-fill" style="width:' + pct + '%"></div>' +
              '<span class="d-prog-label">' +
              (c.pct == null ? '—' : BN.toBanglaDigits(c.pct) + '%') + '</span></div>' +
            '</div></div>';
        }).join('');
      });
  }

  function create() {
    if (!meta) return alert('তথ্য লোড হচ্ছে।');
    var title = window.prompt('প্রচারাভিযানের শিরোনাম:');
    if (!title || !title.trim()) return;
    var code = window.prompt('সংক্ষিপ্ত কোড (ইংরেজিতে, যেমন BUILD-2027):');
    if (!code || !code.trim()) return;
    var target = window.prompt('লক্ষ্য (টাকা):', '0');
    var fundList = meta.funds.map(function (f, i) { return (i + 1) + '. ' + f.name_bn; }).join('\n');
    var fi = window.prompt('কোন ফান্ডে?\n' + fundList + '\n\nনম্বর লিখুন:', '1');
    var fund = meta.funds[Number(fi) - 1];
    if (!fund) return alert('ফান্ড নির্বাচন হয়নি।');
    var end = window.prompt('শেষ তারিখ (YYYY-MM-DD, খালি রাখা যায়):');
    var desc = window.prompt('সংক্ষিপ্ত বিবরণ:');

    fetch(API + '/campaigns', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.trim(), title_bn: title.trim(), fund_id: fund.id,
        target_amount: Number(target) || 0, end_date: end || null,
        description_bn: desc || null, is_public: true,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) return load();
        alert((d.errors || ['ত্রুটি']).join('\n'));
      });
  }
})();

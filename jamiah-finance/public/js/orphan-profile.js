/* এতিমের প্রোফাইল — সম্পাদনা, যাচাই, সম্মতি, স্পনসর, রিপোর্ট, কাগজ, সাক্ষাৎ */
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
  var API = '/admin/orphans/api';
  var ID = window.__ORPHAN_ID;
  var meta = null;
  var msg = function (t, isBad) {
    var el = document.getElementById('orphanMsg');
    el.innerHTML = isBad ? '<span class="v-bad">' + t + '</span>' : t;
  };
  var money = function (v) { return 'Tk ' + Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };

  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); }).then(function (d) { meta = d; });

    on('editBtn', edit);
    on('verifyBtn', verify);
    on('addSponsor', addSponsor);
    on('addReport', addReport);
    on('addDoc', addDoc);
    on('addVisit', addVisit);

    document.addEventListener('click', function (e) {
      var c = e.target.closest('[data-consent]');
      if (c) return consent(c.getAttribute('data-consent'));
      var p = e.target.closest('[data-publish]');
      if (p) return publish(p.getAttribute('data-publish'));
      var en = e.target.closest('[data-end]');
      if (en) return endSponsor(en.getAttribute('data-end'));
    });
  });

  function on(id, fn) { var e = document.getElementById(id); if (e) e.addEventListener('click', fn); }
  function ask(l, d) { var v = window.prompt(l, d || ''); return v === null ? null : v.trim(); }

  function send(path, body, method) {
    return fetch(API + path, {
      method: method || 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
      .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
      .then(function (res) {
        if (res.d.ok) { window.location.reload(); return res.d; }
        msg((res.d.errors || ['ত্রুটি']).join(' · '), true);
        return null;
      })
      .catch(function () { msg('সংযোগ সমস্যা।', true); return null; });
  }

  function verify() {
    if (!window.confirm('যাচাই অনুমোদন করলে এই শিশুকে স্পনসরশিপে দেওয়া যাবে। ' +
      'কাগজপত্র দেখে নিশ্চিত হয়েছেন?')) return;
    send('/orphans/' + ID + '/verify', {});
  }

  function consent(level) {
    if (level === 'none') {
      if (!window.confirm('সম্মতি তুলে নিলে ছবিটি দাতা ও ওয়েবসাইট — সব জায়গা থেকে ' +
        'সাথে সাথেই অদৃশ্য হবে। চালিয়ে যাবেন?')) return;
      return send('/orphans/' + ID + '/consent', { level: 'none' });
    }
    var by = ask('কে সম্মতি দিয়েছেন? (অভিভাবকের নাম ও সম্পর্ক)');
    if (!by) return;
    var date = ask('সম্মতির তারিখ (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    var note = ask('সম্মতির শর্ত বা নোট (ঐচ্ছিক):');
    if (level === 'public' && !window.confirm(
      'ওয়েবসাইটে ছবি দেখানো মানে যে কেউ দেখতে পাবে। অভিভাবক এতে স্পষ্টভাবে ' +
      'সম্মত হয়েছেন? সন্দেহ থাকলে "শুধু স্পনসরকে" বেছে নিন।')) return;
    send('/orphans/' + ID + '/consent', { level: level, by: by, date: date, note: note || null });
  }

  function edit() {
    var patch = {};
    var fields = [
      ['full_name', 'পুরো নাম'], ['display_name', 'দাতাকে দেখানো নাম (খালি = নিয়ম অনুযায়ী)'],
      ['date_of_birth', 'জন্ম তারিখ (YYYY-MM-DD)'], ['class_name', 'শ্রেণি'],
      ['guardian_name', 'অভিভাবকের নাম'], ['guardian_relation', 'অভিভাবকের সম্পর্ক'],
      ['guardian_mobile', 'অভিভাবকের মোবাইল'], ['guardian_address', 'ঠিকানা'],
      ['thana', 'থানা'], ['district', 'জেলা'],
      ['father_name', 'পিতার নাম'], ['mother_name', 'মাতার নাম'],
      ['health_note_bn', 'স্বাস্থ্যের সাধারণ তথ্য (দাতা দেখবেন)'],
      ['notes_bn', 'প্রাতিষ্ঠানিক নোট (দাতা দেখবেন না)'],
    ];
    for (var i = 0; i < fields.length; i++) {
      var v = ask(fields[i][1] + ' — খালি রাখলে অপরিবর্তিত:');
      if (v === null) return msg('সম্পাদনা বাতিল।');
      if (v !== '') patch[fields[i][0]] = v;
    }
    var nd = ask('দাতাকে নাম কীভাবে দেখানো হবে?\n1. শুধু প্রথম নাম\n2. পুরো নাম\n3. শুধু কোড\n\nনম্বর (খালি = অপরিবর্তিত):');
    if (nd === '1') patch.name_display = 'first_only';
    if (nd === '2') patch.name_display = 'full';
    if (nd === '3') patch.name_display = 'code_only';

    var needs = [['need_food', 'খাবার'], ['need_lodging', 'থাকা'], ['need_clothing', 'পোশাক'],
      ['need_books', 'কিতাব'], ['need_medical', 'চিকিৎসা'], ['need_other', 'অন্যান্য']];
    for (var j = 0; j < needs.length; j++) {
      var n = ask('মাসিক ' + needs[j][1] + ' খরচ — খালি রাখলে অপরিবর্তিত:');
      if (n === null) return msg('সম্পাদনা বাতিল।');
      if (n !== '') patch[needs[j][0]] = Number(n) || 0;
    }
    if (!Object.keys(patch).length) return msg('বদলানোর কিছু নেই।');
    send('/orphans/' + ID, patch, 'PATCH');
  }

  function addSponsor() {
    if (!meta) return msg('তথ্য লোড হচ্ছে।', true);
    var q = ask('দাতার নাম বা মোবাইলের অংশ লিখুন:');
    if (!q) return;
    var found = meta.donors.filter(function (d) {
      return (d.name || '').indexOf(q) >= 0 || (d.mobile || '').indexOf(q) >= 0 ||
             (d.donor_code || '').indexOf(q) >= 0;
    }).slice(0, 15);
    if (!found.length) {
      return msg('এই নামে দাতা পাওয়া যায়নি। আগে দাতা বিভাগে রেকর্ড তৈরি করুন।', true);
    }
    var list = found.map(function (d, i) {
      return (i + 1) + '. ' + d.name + (d.mobile ? ' — ' + d.mobile : '') + ' (' + d.donor_code + ')';
    }).join('\n');
    var pick = ask('কোন দাতা?\n' + list + '\n\nনম্বর লিখুন:', '1');
    var donor = found[Number(pick) - 1];
    if (!donor) return msg('দাতা নির্বাচন হয়নি।', true);

    var amount = ask('মাসিক পরিমাণ (টাকা):');
    if (!amount) return;
    var start = ask('শুরুর তারিখ (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    var fl = meta.frequencies.map(function (f, i) { return (i + 1) + '. ' + f.name; }).join('\n');
    var fi = ask('কত দিন পর পর রিপোর্ট?\n' + fl + '\n\nনম্বর:', '2');
    var freq = meta.frequencies[Number(fi) - 1];

    fetch(API + '/sponsorships', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orphan_id: ID, donor_id: donor.id, monthly_amount: Number(amount),
        start_date: start || null, report_frequency: freq ? freq.code : 'quarterly',
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return msg((d.errors || ['ত্রুটি']).join(' · '), true);
        var m = d.shared_with ? 'শেয়ারড স্পনসরশিপ যোগ হলো। ' : 'স্পনসরশিপ যোগ হলো। ';
        m += 'মোট কভারেজ ' + money(d.covered_after) + ' / প্রয়োজন ' + money(d.monthly_need) + '।';
        if (d.over_by > 0) m += '\n\nসতর্কতা: প্রয়োজনের চেয়ে ' + money(d.over_by) +
          ' বেশি। এই অতিরিক্ত টাকা অন্য শিশুর ঘাটতি পূরণ করে না — চাইলে ' +
          'অন্য কোনো শিশুর স্পনসরশিপে ভাগ করে দিতে পারেন।';
        alert(m);
        window.location.reload();
      });
  }

  function endSponsor(id) {
    var reason = ask('স্পনসরশিপ শেষ করার কারণ:');
    if (!reason) return;
    fetch(API + '/sponsorships/' + id + '/end', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return msg((d.errors || ['ত্রুটি']).join(' · '), true);
        if (d.back_to_pool) {
          alert('এই শিশু আবার অসম্পৃক্ত পুলে ফিরেছে। নতুন ঘাটতি ' + money(d.new_gap) +
            '। দ্রুত নতুন স্পনসর খোঁজা দরকার।');
        }
        window.location.reload();
      });
  }

  function addReport() {
    var label = ask('সময়কালের নাম (যেমন জুলাই–সেপ্টেম্বর ২০২৬):');
    if (!label) return;
    var start = ask('শুরুর তারিখ (YYYY-MM-DD):');
    if (!start) return;
    var end = ask('শেষ তারিখ (YYYY-MM-DD):');
    if (!end) return;
    var att = ask('উপস্থিতির হার (%):');
    var exam = ask('পরীক্ষার ফলাফল:');
    var hifz = ask('হিফজের অগ্রগতি (কত পারা):');
    var health = ask('স্বাস্থ্যের অবস্থা:');
    var comment = ask('শিক্ষকের মন্তব্য:');
    msg('মনে রাখবেন: এখানে যা লেখা হবে তার সবই দাতা দেখবেন। ব্যক্তিগত বা ' +
        'পারিবারিক তথ্য লিখবেন না।');
    send('/orphans/' + ID + '/reports', {
      period_label: label, period_start: start, period_end: end,
      attendance_pct: att ? Number(att) : null,
      exam_result_bn: exam || null, hifz_progress_bn: hifz || null,
      health_note_bn: health || null, teacher_comment_bn: comment || null,
    });
  }

  function publish(id) {
    if (!window.confirm('প্রকাশ করলে এই রিপোর্ট স্পনসরদের কাছে দৃশ্যমান হবে। ' +
      'ব্যক্তিগত তথ্য নেই — নিশ্চিত?')) return;
    send('/progress-reports/' + id + '/publish', {});
  }

  function addDoc() {
    var types = [['death_certificate', 'মৃত্যু সনদ'], ['birth_certificate', 'জন্মনিবন্ধন'],
      ['chairman_certificate', 'চেয়ারম্যান সার্টিফিকেট'], ['guardian_nid', 'অভিভাবকের এনআইডি'],
      ['consent_form', 'সম্মতিপত্র'], ['other', 'অন্যান্য']];
    var tl = types.map(function (t, i) { return (i + 1) + '. ' + t[1]; }).join('\n');
    var ti = ask('কাগজের ধরন?\n' + tl + '\n\nনম্বর:', '1');
    var type = types[Number(ti) - 1];
    if (!type) return;
    var name = ask('ফাইলের নাম:');
    if (!name) return;
    var path = ask('ফাইলের পথ (আপলোড হ্যান্ডলার বসানোর পর এটি আপনাআপনি আসবে):',
      '/secure/orphan-docs/' + name);
    if (!path) return;
    send('/orphans/' + ID + '/documents', {
      doc_type: type[0], file_name: name, file_path: path, is_sensitive: true,
    });
  }

  function addVisit() {
    var who = ask('সাক্ষাৎকারীর নাম:');
    if (!who) return;
    var date = ask('তারিখ (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    var purpose = ask('উদ্দেশ্য:');
    var notes = ask('নোট (কোথায়, কার উপস্থিতিতে):');
    send('/orphans/' + ID + '/visits', {
      visitor_name: who, visit_date: date, purpose_bn: purpose || null, notes_bn: notes || null,
    });
  }
})();

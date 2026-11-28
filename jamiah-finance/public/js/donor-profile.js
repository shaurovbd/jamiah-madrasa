/* দাতার প্রোফাইল — সম্পাদনা, প্রতিশ্রুতি, মাসিক পরিকল্পনা */
(function () {
  'use strict';
  var API = '/admin/donors/api';
  var ID = window.__DONOR_ID;
  var msg = function (t, bad) {
    var el = document.getElementById('donorMsg');
    el.innerHTML = bad ? '<span class="v-bad">' + t + '</span>' : t;
  };
  var meta = null;

  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); }).then(function (d) { meta = d; });

    var e = document.getElementById('editBtn');
    if (e) e.addEventListener('click', edit);
    var ap = document.getElementById('addPledge');
    if (ap) ap.addEventListener('click', addPledge);
    var apl = document.getElementById('addPlan');
    if (apl) apl.addEventListener('click', addPlan);

    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-plan]');
      if (!b) return;
      send('/recurring/' + b.getAttribute('data-plan') + '/status',
        { status: b.getAttribute('data-status') });
    });
  });

  function send(path, body, method) {
    return fetch(API + path, {
      method: method || 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { window.location.reload(); return; }
        msg((d.errors || ['ত্রুটি']).join(' · '), true);
      })
      .catch(function () { msg('সংযোগ সমস্যা।', true); });
  }

  function ask(label, dflt) {
    var v = window.prompt(label, dflt || '');
    return v === null ? null : v.trim();
  }

  function edit() {
    var patch = {};
    var fields = [
      ['name', 'নাম'], ['mobile', 'মোবাইল'], ['email', 'ইমেইল'],
      ['address', 'ঠিকানা'], ['thana', 'থানা'], ['district', 'জেলা'],
      ['country', 'দেশ'], ['source_bn', 'পরিচয়ের সূত্র'],
      ['recognition_tier', 'স্বীকৃতি (জীবনসদস্য / পৃষ্ঠপোষক)'],
      ['notes_bn', 'নোট'],
    ];
    for (var i = 0; i < fields.length; i++) {
      var v = ask(fields[i][1] + ' (খালি রাখলে অপরিবর্তিত):');
      if (v === null) return msg('সম্পাদনা বাতিল।');
      if (v !== '') patch[fields[i][0]] = v;
    }
    var c = window.confirm('এই দাতাকে যোগাযোগ করা যাবে? (OK = হ্যাঁ, Cancel = না)');
    patch.allow_contact = c;
    if (!Object.keys(patch).length) return msg('বদলানোর কিছু নেই।');
    send('/donors/' + ID, patch, 'PATCH');
  }

  function addPledge() {
    if (!meta) return msg('তথ্য লোড হচ্ছে, একটু পরে চেষ্টা করুন।', true);
    var amount = ask('প্রতিশ্রুত পরিমাণ (টাকা):');
    if (!amount) return;
    var fundList = meta.funds.map(function (f, i) { return (i + 1) + '. ' + f.name_bn; }).join('\n');
    var fi = ask('কোন ফান্ডে?\n' + fundList + '\n\nনম্বর লিখুন:', '1');
    var fund = meta.funds[Number(fi) - 1];
    if (!fund) return msg('ফান্ড নির্বাচন হয়নি।', true);
    var due = ask('কবে দেওয়ার কথা? (YYYY-MM-DD, খালি রাখা যায়):');
    var purpose = ask('উদ্দেশ্য:');
    send('/pledges', {
      donor_id: ID, fund_id: fund.id, amount: Number(amount),
      due_date: due || null, purpose_bn: purpose || null,
    });
  }

  function addPlan() {
    if (!meta) return msg('তথ্য লোড হচ্ছে, একটু পরে চেষ্টা করুন।', true);
    var amount = ask('মাসিক পরিমাণ (টাকা):');
    if (!amount) return;
    var types = meta.receiptTypes.filter(function (t) { return Number(t.links_donor); });
    var tl = types.map(function (t, i) { return (i + 1) + '. ' + t.name_bn; }).join('\n');
    var ti = ask('রশিদের ধরন?\n' + tl + '\n\nনম্বর লিখুন:', '1');
    var type = types[Number(ti) - 1];
    if (!type) return msg('ধরন নির্বাচন হয়নি।', true);
    var fundList = meta.funds.map(function (f, i) { return (i + 1) + '. ' + f.name_bn; }).join('\n');
    var fi = ask('কোন ফান্ডে?\n' + fundList + '\n\nনম্বর লিখুন:', '1');
    var fund = meta.funds[Number(fi) - 1];
    if (!fund) return msg('ফান্ড নির্বাচন হয়নি।', true);
    var day = ask('মাসের কোন তারিখে? (১–২৮)', '1');
    send('/recurring', {
      donor_id: ID, receipt_type_id: type.id, fund_id: fund.id,
      amount: Number(amount), day_of_month: Number(day) || 1,
    });
  }
})();

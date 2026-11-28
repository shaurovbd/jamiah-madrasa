/* রশিদ কাটার ফর্ম — /admin/receipts/new   (দরকার: /js/bangla-number.js) */
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
  var $ = function (id) { return document.getElementById(id); };
  var BN = window.BanglaNumber || { takaInWords: function () { return ''; } };
  var money = function (v) {
    return 'Tk ' + Number(v || 0).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  var meta = null, type = null;
  var ctxDonorId = null, ctxPlanId = null;
  var qs = new URLSearchParams(window.location.search);

  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw 0;
        meta = d;
        fillStatics();
        renderPills();
        applyType($('receiptType').value);
        bind();
        applyContext();
      })
      .catch(function () { alert('তথ্য লোড করা যায়নি। পেজটি আবার লোড করুন।'); });
  });

  function fillStatics() {
    $('paymentMethod').innerHTML = meta.paymentMethods.map(function (m) {
      return '<option value="' + m.code + '">' + m.name + '</option>';
    }).join('');

    $('cashAccount').innerHTML = meta.cashAccounts.map(function (a) {
      return '<option value="' + a.id + '">' + a.code + ' · ' + a.name_bn +
        '  (' + money(a.balance) + ')</option>';
    }).join('');

    $('fundId').innerHTML = meta.funds.map(function (f) {
      return '<option value="' + f.id + '">' + f.name_bn + '</option>';
    }).join('');

    $('campaignId').innerHTML = '<option value="">— নির্দিষ্ট নয় —</option>' +
      (meta.campaigns || []).map(function (c) {
        return '<option value="' + c.id + '" data-fund="' + c.fund_name + '">' +
          c.title_bn + ' (' + c.fund_code + ')</option>';
      }).join('');

    $('bookId').innerHTML = '<option value="">— অনলাইন রশিদ —</option>' +
      meta.books.map(function (b) {
        return '<option value="' + b.id + '" data-from="' + b.from_no + '" data-to="' + b.to_no +
          '">' + b.book_no + ' · ' + (b.issued_to_name || '') +
          ' (' + b.from_no + '–' + b.to_no + ')</option>';
      }).join('');
    if (!meta.books.length) $('bookField').hidden = true;
  }

  function renderPills() {
    $('typePills').innerHTML = meta.types.map(function (t) {
      return '<button type="button" class="r-type" data-code="' + t.code + '">' +
        t.name_bn + '<small>' + t.fund_name + '</small></button>';
    }).join('');
    $('typePills').addEventListener('click', function (e) {
      var b = e.target.closest('.r-type');
      if (b) applyType(b.getAttribute('data-code'));
    });
  }

  function applyType(code) {
    type = meta.types.filter(function (t) { return t.code === code; })[0] || meta.types[0];
    $('receiptType').value = type.code;

    Array.prototype.forEach.call($('typePills').children, function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-code') === type.code);
    });

    $('typeHint').textContent = type.note_bn || '';
    $('studentField').hidden = !Number(type.requires_student);
    $('payerReq').hidden = !Number(type.requires_payer);

    // পক্ষ লাগে এমন খাত — যেমন ঋণ ফেরত (১২০৩)
    var needsParty = /^1/.test(type.credit_code) && !Number(type.requires_student);
    $('partyField').hidden = !needsParty;

    $('fundId').value = String(type.default_fund_id);
    $('fundId').disabled = !Number(type.allow_fund_change);
    $('fundNote').textContent = Number(type.allow_fund_change)
      ? 'দাতা নির্দিষ্ট খাত বললে বদলে দিন।'
      : type.fund_name + ' — এই ধরনে ফান্ড বদলানো যায় না।';

    refresh();
  }

  function bind() {
    ['amount', 'payerName', 'purpose'].forEach(function (id) {
      $(id).addEventListener('input', refresh);
    });
    ['paymentMethod', 'cashAccount', 'fundId', 'receiptDate', 'campaignId'].forEach(function (id) {
      $(id).addEventListener('change', refresh);
    });
    $('campaignId').addEventListener('change', function () {
      var o = $('campaignId').selectedOptions[0];
      $('campaignNote').textContent = $('campaignId').value
        ? 'এই প্রচারাভিযানের ফান্ড: ' + o.getAttribute('data-fund') +
          ' — ধরনে অনুমতি থাকলে ফান্ড এটাই বসবে।'
        : 'নির্দিষ্ট প্রকল্পের অনুদান হলে বেছে নিন।';
    });
    $('paymentMethod').addEventListener('change', function () {
      $('instrumentField').hidden = $('paymentMethod').value === 'cash';
    });
    $('bookId').addEventListener('change', function () {
      var o = $('bookId').selectedOptions[0];
      var has = !!$('bookId').value;
      $('manualNoField').hidden = !has;
      $('bookRange').textContent = has
        ? 'এই বইয়ের পরিসর: ' + o.getAttribute('data-from') + '–' + o.getAttribute('data-to') : '';
    });

    $('receiptForm').addEventListener('submit', function (e) { e.preventDefault(); submit(true); });
    $('saveOnly').addEventListener('click', function () { submit(false); });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(true); }
    });
    refresh();
  }

  /** ?donor= / ?campaign= / ?plan= দিয়ে এলে ঘরগুলো আগেই ভরে দিই */
  function applyContext() {
    if (qs.get('campaign')) $('campaignId').value = qs.get('campaign');
    ctxPlanId = qs.get('plan') ? Number(qs.get('plan')) : null;
    var dId = qs.get('donor');
    if (!dId) { noteContext(); return; }
    fetch(API + '/donor/' + encodeURIComponent(dId), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;
        ctxDonorId = d.donor.id;
        $('payerName').value = d.donor.name || '';
        $('payerMobile').value = d.donor.mobile || '';
        noteContext(d.donor);
        refresh();
      })
      .catch(function () {});
  }

  function noteContext(donor) {
    var bits = [];
    if (donor) bits.push('দাতা: <strong>' + esc(donor.name) + '</strong>' +
      (donor.donor_code ? ' (' + esc(donor.donor_code) + ')' : ''));
    if (ctxPlanId) bits.push('মাসিক পরিকল্পনার বিপরীতে');
    if (qs.get('campaign') && $('campaignId').selectedOptions[0]) {
      bits.push('প্রচারাভিযান: <strong>' +
        esc($('campaignId').selectedOptions[0].textContent) + '</strong>');
    }
    var box = $('rContext');
    if (!bits.length) { box.hidden = true; return; }
    box.className = 'v-alert';
    box.innerHTML = bits.join(' · ');
    box.hidden = false;
  }

  function periodFor(d) {
    return (meta.periods || []).filter(function (p) {
      return d >= ymd(p.start_date) && d <= ymd(p.end_date);
    })[0];
  }

  function refresh() {
    var amt = parseFloat($('amount').value) || 0;
    $('amountWords').textContent = amt > 0 ? BN.takaInWords(amt) : '';

    var p = periodFor($('receiptDate').value);
    $('periodNote').innerHTML = !p
      ? '<span class="v-bad">এই তারিখের জন্য পিরিয়ড খোলা নেই।</span>'
      : p.status === 'locked'
        ? '<span class="v-bad">' + p.label + ' পিরিয়ড বন্ধ — রশিদ কাটা যাবে না।</span>'
        : p.label;

    var fundName = ($('fundId').selectedOptions[0] || {}).text || '';
    var cashName = ($('cashAccount').selectedOptions[0] || {}).text || '';
    $('preview').innerHTML = amt > 0
      ? '<div class="r-prev-row"><span>খতিয়ানে বসবে</span><strong>' +
          esc(cashName.split('(')[0].trim()) + ' ডেবিট → ' + esc(type.credit_name) +
          ' ক্রেডিট</strong></div>' +
        '<div class="r-prev-row"><span>ফান্ড</span><strong>' + esc(fundName) + '</strong></div>' +
        '<div class="r-prev-row"><span>পরিমাণ</span><strong>' + money(amt) + '</strong></div>' +
        '<div class="r-prev-words">' + esc(BN.takaInWords(amt)) + '</div>'
      : '<div class="v-note">পরিমাণ লিখলে এখানে দেখা যাবে খতিয়ানে কী বসবে।</div>';
  }

  function showAlert(items) {
    var box = $('rAlert');
    box.className = 'v-alert v-alert-err';
    box.innerHTML = '<strong>রশিদ কাটা যায়নি:</strong><ul>' +
      items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function submit(thenPrint) {
    var errs = [];
    var amt = parseFloat($('amount').value) || 0;
    if (amt <= 0) errs.push('পরিমাণ লিখুন।');
    if (Number(type.requires_payer) && !$('payerName').value.trim()) {
      errs.push('যিনি দিচ্ছেন তাঁর নাম লিখুন।');
    }
    if (Number(type.requires_student) && !$('studentId').value) errs.push('শিক্ষার্থী আইডি দিন।');
    if (!$('partyField').hidden && !$('partyId').value) errs.push('স্টাফ / দাতার আইডি দিন।');
    if ($('bookId').value && !$('manualNo').value) errs.push('বইয়ের রশিদ নম্বর লিখুন।');
    if (!$('cashAccount').value) errs.push('টাকা কোথায় জমা হলো, তা বাছুন।');
    if (errs.length) return showAlert(errs);

    var payload = {
      receipt_type: type.code,
      receipt_date: $('receiptDate').value,
      amount: amt,
      payer_name: $('payerName').value.trim() || null,
      payer_mobile: $('payerMobile').value.trim() || null,
      student_id: $('studentId').value ? Number($('studentId').value) : null,
      party_id: (!$('partyField').hidden && $('partyId').value) ? Number($('partyId').value) : null,
      party_type: (!$('partyField').hidden && $('partyId').value) ? 'staff' : null,
      payment_method: $('paymentMethod').value,
      instrument_no: $('instrumentNo').value.trim() || null,
      cash_account_id: Number($('cashAccount').value),
      fund_id: Number($('fundId').value),
      purpose_bn: $('purpose').value.trim() || null,
      book_id: $('bookId').value ? Number($('bookId').value) : null,
      manual_no: $('manualNo').value || null,
      donor_id: ctxDonorId,
      campaign_id: $('campaignId').value ? Number($('campaignId').value) : null,
      recurring_plan_id: ctxPlanId,
    };

    $('saveBtn').disabled = $('saveOnly').disabled = true;
    $('saveBtn').textContent = 'সংরক্ষণ হচ্ছে…';

    fetch(API + '/receipts', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
      .then(function (res) {
        if (res.s === 201 && res.d.ok) {
          window.location.href = thenPrint
            ? '/admin/receipts/r/' + res.d.id + '?size=a4'
            : '/admin/receipts';
          return;
        }
        showAlert(res.d.errors || ['অজানা ত্রুটি।']);
      })
      .catch(function () { showAlert(['সংযোগ সমস্যা — আবার চেষ্টা করুন।']); })
      .finally(function () {
        $('saveBtn').disabled = $('saveOnly').disabled = false;
        $('saveBtn').textContent = 'রশিদ কাটুন ও প্রিন্ট করুন';
      });
  }
})();

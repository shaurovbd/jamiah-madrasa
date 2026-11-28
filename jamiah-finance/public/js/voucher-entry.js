/* ------------------------------------------------------------------
   ভাউচার এন্ট্রি — /admin/ledger/new
   নির্ভরতা নেই। সার্ভারই চূড়ান্ত বিচারক; এখানকার যাচাই শুধু আগেভাগে সতর্ক করার জন্য।
   ------------------------------------------------------------------ */
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

  var API = '/admin/ledger/api';
  var SIMPLE = ['RV', 'PV'];           // নগদের লাইন নিজে বসে যায়
  var ROLE_RANK = { accountant: 1, chief_accountant: 2, principal: 3, committee: 4 };
  var ROLE_BN = {
    accountant: 'হিসাবরক্ষক', chief_accountant: 'প্রধান হিসাবরক্ষক',
    principal: 'মুহতামিম', committee: 'পরিচালনা কমিটি',
  };
  var TIERS = [
    { max: 2000, role: 'accountant' },
    { max: 20000, role: 'chief_accountant' },
    { max: 100000, role: 'principal' },
    { max: Infinity, role: 'committee' },
  ];
  // টাকা বেরিয়ে যাওয়ার খাত — ডেবিট হলে ফান্ড থেকে খরচ
  var SPEND_SUBTYPES = { fixed_asset: 1, inventory: 1 };

  var meta = null;
  var mode = 'simple';
  var $ = function (id) { return document.getElementById(id); };

  var paisa = function (v) { return Math.round((parseFloat(v) || 0) * 100); };
  var taka = function (p) { return p / 100; };
  var money = function (p) {
    return 'Tk ' + taka(p).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // =================================================================
  // শুরু
  // =================================================================
  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error('meta');
        meta = d;
        fillStatics();
        renderTypePills();
        applyType($('voucherType').value);
        addLine(); addLine();
        bindGlobal();
        recompute();
      })
      .catch(function () {
        alert('হিসাবের তালিকা লোড করা যায়নি। পেজটি আবার লোড করুন।');
      });
  });

  function fillStatics() {
    var pm = $('paymentMethod');
    pm.innerHTML = meta.paymentMethods.map(function (m) {
      return '<option value="' + m.code + '">' + m.name + '</option>';
    }).join('');

    var cashOpts = meta.accounts.filter(function (a) { return a.is_cash_like; });
    $('cashAccount').innerHTML =
      '<option value="">— নির্বাচন করুন —</option>' +
      cashOpts.map(function (a) {
        return '<option value="' + a.id + '">' + a.code + ' · ' + a.name_bn +
               '  (' + money(paisa(meta.cashBalance[a.id] || 0)) + ')</option>';
      }).join('');

    pm.addEventListener('change', onPaymentMethod);
    $('cashAccount').addEventListener('change', recompute);
    $('voucherDate').addEventListener('change', onDateChange);
    $('fatwaOverride').addEventListener('change', recompute);
    onPaymentMethod();
    onDateChange();
  }

  function renderTypePills() {
    $('typePills').innerHTML = meta.voucherTypes.map(function (t) {
      return '<button type="button" class="v-type" data-type="' + t.code + '">' +
        t.name + '<small>' + t.hint + '</small></button>';
    }).join('');
    $('typePills').addEventListener('click', function (e) {
      var b = e.target.closest('.v-type');
      if (b) applyType(b.getAttribute('data-type'));
    });
  }

  function applyType(type) {
    $('voucherType').value = type;
    mode = SIMPLE.indexOf(type) >= 0 ? 'simple' : 'journal';
    document.body.setAttribute('data-vmode', mode);

    Array.prototype.forEach.call($('typePills').children, function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-type') === type);
    });

    var simpleOnly = document.querySelectorAll('.v-simple-only');
    var journalOnly = document.querySelectorAll('.v-journal-only');
    Array.prototype.forEach.call(simpleOnly, function (el) { el.hidden = mode !== 'simple'; });
    Array.prototype.forEach.call(journalOnly, function (el) { el.hidden = mode !== 'journal'; });

    $('cashAccountField').hidden = mode !== 'simple';
    $('cashAccount').required = mode === 'simple';
    $('cashAccountLabel').innerHTML = (type === 'RV' ? 'জমা হবে কোথায়' : 'পরিশোধ হবে কোথা থেকে') +
      ' <span class="req">*</span>';

    var t = meta.voucherTypes.filter(function (x) { return x.code === type; })[0];
    $('typeHint').textContent = t ? t.name + ' — ' + t.hint : '';
    recompute();
  }

  function onPaymentMethod() {
    var m = $('paymentMethod').value;
    $('instrumentField').hidden = ['cash', 'adjustment'].indexOf(m) >= 0;
  }

  function onDateChange() {
    var d = $('voucherDate').value;
    var p = (meta.periods || []).filter(function (x) {
      return d >= ymd(x.start_date) && d <= ymd(x.end_date);
    })[0];
    var note = $('periodNote');
    if (!p) {
      note.innerHTML = '<span class="v-bad">এই তারিখের জন্য কোনো পিরিয়ড খোলা নেই।</span>';
    } else if (p.status === 'locked') {
      note.innerHTML = '<span class="v-bad">' + p.label + ' পিরিয়ড বন্ধ — এন্ট্রি দেওয়া যাবে না।</span>';
    } else {
      note.textContent = p.label;
    }
  }

  // =================================================================
  // লাইন
  // =================================================================
  function addLine(after) {
    var tr = $('lineTpl').content.firstElementChild.cloneNode(true);

    tr.querySelector('.v-fund').innerHTML =
      '<option value="">— ফান্ড —</option>' +
      meta.funds.map(function (f) {
        return '<option value="' + f.id + '">' + f.name_bn + '</option>';
      }).join('');

    tr.querySelector('.v-cc').innerHTML =
      '<option value="">—</option>' +
      meta.costCenters.map(function (c) {
        return '<option value="' + c.id + '">' + c.name_bn + '</option>';
      }).join('');

    // আগের লাইনের ফান্ড ধরে রাখি — পরপর এন্ট্রিতে বারবার বাছতে হয় না
    var rows = lineRows();
    if (rows.length) {
      var prev = rows[rows.length - 1].querySelector('.v-fund').value;
      if (prev) tr.querySelector('.v-fund').value = prev;
    }

    if (after && after.nextSibling) $('lineBody').insertBefore(tr, after.nextSibling);
    else $('lineBody').appendChild(tr);

    wireLine(tr);
    renumber();
    return tr;
  }

  function lineRows() {
    return Array.prototype.slice.call($('lineBody').querySelectorAll('tr.v-line'));
  }

  function renumber() {
    lineRows().forEach(function (tr, i) {
      tr.querySelector('.v-lineno').textContent = i + 1;
    });
  }

  function wireLine(tr) {
    setupCombo(tr);

    tr.querySelector('.v-del').addEventListener('click', function () {
      if (lineRows().length <= 1) { clearLine(tr); }
      else { tr.remove(); renumber(); }
      recompute();
    });

    ['.v-fund', '.v-cc'].forEach(function (sel) {
      tr.querySelector(sel).addEventListener('change', recompute);
    });

    ['.v-amount', '.v-debit', '.v-credit'].forEach(function (sel) {
      var el = tr.querySelector(sel);
      el.addEventListener('input', function () {
        // জার্নাল মোডে একদিকে লিখলে অন্যদিক খালি হয়ে যাবে
        if (sel === '.v-debit' && el.value) tr.querySelector('.v-credit').value = '';
        if (sel === '.v-credit' && el.value) tr.querySelector('.v-debit').value = '';
        recompute();
      });
    });

    tr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        var list = tr.querySelector('.v-combo-list');
        if (list && !list.hidden) return;        // combo নিজেই সামলাবে
        e.preventDefault();
        var isLast = lineRows().indexOf(tr) === lineRows().length - 1;
        var next = isLast ? addLine() : lineRows()[lineRows().indexOf(tr) + 1];
        next.querySelector('.v-acc-input').focus();
      }
    });
  }

  function clearLine(tr) {
    tr.querySelector('.v-acc-input').value = '';
    tr.querySelector('.v-acc-id').value = '';
    tr.querySelector('.v-amount').value = '';
    tr.querySelector('.v-debit').value = '';
    tr.querySelector('.v-credit').value = '';
  }

  // =================================================================
  // হিসাব সার্চ
  // =================================================================
  function setupCombo(tr) {
    var input = tr.querySelector('.v-acc-input');
    var hidden = tr.querySelector('.v-acc-id');
    var list = tr.querySelector('.v-combo-list');
    var cur = -1;
    var shown = [];

    function search(q) {
      q = (q || '').trim().toLowerCase();
      if (!q) return meta.accounts.slice(0, 40);
      return meta.accounts.filter(function (a) {
        return a.code.indexOf(q) === 0 ||
               a.name_bn.toLowerCase().indexOf(q) >= 0 ||
               (a.name_en || '').toLowerCase().indexOf(q) >= 0;
      }).slice(0, 40);
    }

    function open(q) {
      shown = search(q); cur = -1;
      if (!shown.length) {
        list.innerHTML = '<div class="v-combo-empty">কোনো হিসাব মেলেনি</div>';
      } else {
        list.innerHTML = shown.map(function (a, i) {
          return '<div class="v-opt" data-i="' + i + '"><code>' + a.code + '</code> ' +
            a.name_bn + '<span class="v-opt-cls">' + classBn(a.account_class) + '</span></div>';
        }).join('');
      }
      list.hidden = false;
    }

    function pick(a) {
      hidden.value = a.id;
      input.value = a.code + ' · ' + a.name_bn;
      list.hidden = true;
      // পার্টি লাগবে এমন হিসাব হলে জানিয়ে দিই
      if (a.requires_party && !$('partyId').value) {
        $('partyType').focus();
      } else {
        (mode === 'simple' ? tr.querySelector('.v-amount') : tr.querySelector('.v-debit')).focus();
      }
      recompute();
    }

    function highlight() {
      Array.prototype.forEach.call(list.querySelectorAll('.v-opt'), function (el, i) {
        el.classList.toggle('is-cur', i === cur);
      });
      var el = list.querySelector('.v-opt.is-cur');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', function () { hidden.value = ''; open(input.value); recompute(); });
    input.addEventListener('focus', function () { open(input.value); });
    input.addEventListener('blur', function () {
      setTimeout(function () { list.hidden = true; }, 150);
    });

    input.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, shown.length - 1); highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); highlight(); }
      else if (e.key === 'Enter') {
        if (cur >= 0 && shown[cur]) { e.preventDefault(); pick(shown[cur]); }
        else if (shown.length === 1) { e.preventDefault(); pick(shown[0]); }
      } else if (e.key === 'Escape') { list.hidden = true; }
    });

    list.addEventListener('mousedown', function (e) {
      var el = e.target.closest('.v-opt');
      if (el) { e.preventDefault(); pick(shown[Number(el.getAttribute('data-i'))]); }
    });
  }

  function classBn(c) {
    return { asset: 'সম্পদ', liability: 'দায়', fund: 'ফান্ড', income: 'আয়', expense: 'ব্যয়' }[c] || c;
  }

  // =================================================================
  // হিসাব কষা — এটাই মূল যুক্তি
  // =================================================================
  function accountById(id) {
    for (var i = 0; i < meta.accounts.length; i++) {
      if (String(meta.accounts[i].id) === String(id)) return meta.accounts[i];
    }
    return null;
  }
  function fundById(id) {
    for (var i = 0; i < meta.funds.length; i++) {
      if (String(meta.funds[i].id) === String(id)) return meta.funds[i];
    }
    return null;
  }

  /** ফর্ম থেকে পাঠানোর মতো লাইন তৈরি। simple মোডে নগদের লাইন ফান্ড অনুযায়ী ভাগ হয়ে যোগ হয়। */
  function buildLines() {
    var type = $('voucherType').value;
    var manual = [];

    lineRows().forEach(function (tr) {
      var accId = tr.querySelector('.v-acc-id').value;
      var fundId = tr.querySelector('.v-fund').value;
      var cc = tr.querySelector('.v-cc').value;
      var d, c;
      if (mode === 'simple') {
        var amt = paisa(tr.querySelector('.v-amount').value);
        if (!amt) return;
        // খরচে ব্যয় ডেবিট, জমায় আয় ক্রেডিট
        d = type === 'PV' ? amt : 0;
        c = type === 'RV' ? amt : 0;
      } else {
        d = paisa(tr.querySelector('.v-debit').value);
        c = paisa(tr.querySelector('.v-credit').value);
        if (!d && !c) return;
      }
      manual.push({
        _tr: tr, account_id: accId ? Number(accId) : null,
        fund_id: fundId ? Number(fundId) : null,
        cost_center_id: cc ? Number(cc) : null,
        debit: d, credit: c,
      });
    });

    var auto = [];
    if (mode === 'simple') {
      var cashId = $('cashAccount').value;
      // ফান্ড অনুযায়ী উপমোট — এক ব্যয় দুই ফান্ডে ভাগ হলে নগদের দিকও ভাগ হবে
      var byFund = {};
      manual.forEach(function (l) {
        if (!l.fund_id) return;
        byFund[l.fund_id] = (byFund[l.fund_id] || 0) + l.debit + l.credit;
      });
      Object.keys(byFund).forEach(function (fid) {
        auto.push({
          account_id: cashId ? Number(cashId) : null,
          fund_id: Number(fid),
          cost_center_id: null,
          debit: type === 'RV' ? byFund[fid] : 0,
          credit: type === 'PV' ? byFund[fid] : 0,
          _auto: true,
        });
      });
    }

    return { manual: manual, auto: auto, all: manual.concat(auto) };
  }

  /** একটি লাইন ফান্ড থেকে টাকা বের করছে কি না */
  function isSpending(line, acc) {
    if (!acc) return false;
    return (acc.account_class === 'expense' || SPEND_SUBTYPES[acc.account_subtype]) && line.debit > 0;
  }

  function recompute() {
    var built = buildLines();
    var all = built.all;

    var totalD = 0, totalC = 0;
    all.forEach(function (l) { totalD += l.debit; totalC += l.credit; });

    // ---- ফান্ড-ভিত্তিক প্রভাব (আয়/ব্যয়/ফান্ড শ্রেণির লাইনেই) ----
    var delta = {};
    all.forEach(function (l) {
      var a = accountById(l.account_id);
      if (!a) return;
      if (['income', 'expense', 'fund'].indexOf(a.account_class) < 0) return;
      delta[l.fund_id] = (delta[l.fund_id] || 0) + (l.credit - l.debit);
    });

    // ---- লাইন-পর্যায়ের সতর্কতা ----
    var softBlock = false, hardBlock = false, shortage = false;
    lineRows().forEach(function (tr) { tr.querySelector('.v-line-warn').hidden = true; });

    built.manual.forEach(function (l) {
      var warn = l._tr.querySelector('.v-line-warn');
      var a = accountById(l.account_id);
      var f = fundById(l.fund_id);
      if (!a || !f || !isSpending(l, a)) return;

      if (Number(f.corpus_protected)) {
        warn.textContent = f.name_bn + ' এর মূল টাকা (কর্পাস) ব্যয় করা যাবে না।';
        warn.hidden = false; hardBlock = true; return;
      }
      var rules = meta.fundRules[l.fund_id];
      if (!rules) return;
      var blocked = rules.block.indexOf(l.account_id) >= 0;
      var notAllowed = rules.allow.length > 0 && rules.allow.indexOf(l.account_id) < 0;
      if (blocked || notAllowed) {
        warn.textContent = f.name_bn + ' থেকে ' + a.code + ' ' + a.name_bn + ' খাতে ব্যয় করা যাবে না।';
        warn.hidden = false; softBlock = true;
      }
    });

    // ---- override বাক্স ----
    var canOverride = ROLE_RANK[meta.actor.role] >= ROLE_RANK.principal;
    $('overrideBox').hidden = !(softBlock && canOverride);
    if (!softBlock) $('fatwaOverride').checked = false;

    // ---- মোট ----
    var balanced = totalD === totalC && totalD > 0;
    var diff = Math.abs(totalD - totalC);
    var autoNote = built.auto.length
      ? '<div class="v-sum-row"><span>' +
        ($('voucherType').value === 'RV' ? 'জমার' : 'পরিশোধের') + ' লাইন (' +
        built.auto.length + 'টি, ফান্ড অনুযায়ী)</span><span class="v-amt">' +
        money(built.auto.reduce(function (s, l) { return s + l.debit + l.credit; }, 0)) +
        '</span></div>' : '';

    $('totalsBox').innerHTML =
      '<h4>মোট</h4>' + autoNote +
      '<div class="v-sum-row"><span>ডেবিট</span><span class="v-amt">' + money(totalD) + '</span></div>' +
      '<div class="v-sum-row"><span>ক্রেডিট</span><span class="v-amt">' + money(totalC) + '</span></div>' +
      '<div class="v-sum-row v-total"><span>' +
        (balanced ? '<span class="v-ok">✓ সমান</span>'
                  : '<span class="v-bad">পার্থক্য</span>') + '</span>' +
      '<span class="v-amt ' + (balanced ? 'v-ok' : 'v-bad') + '">' +
        (balanced ? money(totalD) : money(diff)) + '</span></div>';

    // ---- ফান্ড জের প্রিভিউ ----
    var fundRows = Object.keys(delta).filter(function (fid) { return delta[fid] !== 0; });
    if (!fundRows.length) {
      $('fundBox').innerHTML = '<h4>ফান্ডের জের</h4><div class="v-note">লাইন পূরণ করলে এখানে দেখা যাবে।</div>';
    } else {
      $('fundBox').innerHTML = '<h4>ফান্ডের জের (এই ভাউচারের পর)</h4>' +
        fundRows.map(function (fid) {
          var f = fundById(fid);
          var now = paisa(meta.fundBalance[fid] || 0);
          var after = now + delta[fid];
          var short = after < 0 && !Number(f && f.allow_negative);
          if (short) shortage = true;
          return '<div class="v-sum-row' + (short ? ' v-warnrow' : '') + '"><span>' +
            (f ? f.name_bn : '?') + '</span><span class="v-amt">' +
            money(now) + ' → ' + money(after) +
            (short ? ' ⚠' : '') + '</span></div>';
        }).join('') +
        '<div class="v-note">' +
        (shortage
          ? '⚠ এই জের পেজ লোডের সময়ের। সংরক্ষণের সময় সার্ভার আবার যাচাই করবে — ফান্ডে সত্যিই টাকা না থাকলে আটকে দেবে।'
          : 'জের পেজ লোডের সময়ের।') + '</div>';
    }

    // ---- অনুমোদন স্তর ----
    var needed = requiredApprover(totalD, fundRows.map(fundById).filter(Boolean));
    var mine = ROLE_RANK[meta.actor.role] || 0;
    $('approverNote').innerHTML = !balanced ? '' :
      (mine >= ROLE_RANK[needed]
        ? 'আপনার অধিকারে সরাসরি খতিয়ানে পোস্ট হবে।'
        : '<strong>' + ROLE_BN[needed] + '</strong> এর অনুমোদনে যাবে।');

    // শুধু অপরিবর্তনীয় বাধায় বোতাম বন্ধ (ওয়াকফ কর্পাস)।
    // ফান্ড ঘাটতির জের বাসি হতে পারে, তাই সেখানে সার্ভারকেই সিদ্ধান্ত নিতে দিই।
    $('saveBtn').disabled = hardBlock;
    $('saveBtn').title = hardBlock ? 'অপরিবর্তনীয় বিধিনিষেধ — এই ভাউচার সংরক্ষণ করা যাবে না।' : '';
  }

  function requiredApprover(amountPaisa, funds) {
    var amount = taka(amountPaisa);
    var tier = TIERS.filter(function (t) { return amount <= t.max; })[0] || TIERS[TIERS.length - 1];
    var rank = ROLE_RANK[tier.role];
    funds.forEach(function (f) {
      var r = ROLE_RANK[f.requires_approval_by];
      if (r && r > rank) rank = r;
    });
    for (var k in ROLE_RANK) if (ROLE_RANK[k] === rank) return k;
    return 'committee';
  }

  // =================================================================
  // সংরক্ষণ
  // =================================================================
  function bindGlobal() {
    $('addLine').addEventListener('click', function () {
      addLine().querySelector('.v-acc-input').focus();
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault(); submit();
      }
    });

    $('voucherForm').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  }

  function showAlert(kind, title, items) {
    var box = $('vAlert');
    box.className = 'v-alert ' + (kind === 'err' ? 'v-alert-err' : 'v-alert-warn');
    box.innerHTML = '<strong>' + title + '</strong>' +
      (items && items.length ? '<ul>' + items.map(function (x) {
        return '<li>' + String(x).replace(/</g, '&lt;') + '</li>';
      }).join('') + '</ul>' : '');
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function submit() {
    var built = buildLines();
    var errs = [];

    if (!$('narration').value.trim()) errs.push('বিবরণ লিখুন।');
    if (!built.manual.length) errs.push('অন্তত একটি লাইনে হিসাব ও পরিমাণ দিন।');
    if (mode === 'simple' && !$('cashAccount').value) {
      errs.push(($('voucherType').value === 'RV' ? 'জমা' : 'পরিশোধ') + ' হবে কোন হিসাবে, তা নির্বাচন করুন।');
    }
    built.manual.forEach(function (l, i) {
      if (!l.account_id) errs.push('লাইন ' + (i + 1) + ': হিসাব নির্বাচন করুন।');
      if (!l.fund_id) errs.push('লাইন ' + (i + 1) + ': ফান্ড নির্বাচন করুন।');
    });
    var tD = 0, tC = 0;
    built.all.forEach(function (l) { tD += l.debit; tC += l.credit; });
    if (tD !== tC) errs.push('ডেবিট ও ক্রেডিট সমান হয়নি — পার্থক্য ' + money(Math.abs(tD - tC)) + '।');
    if ($('fatwaOverride').checked && !$('fatwaNote').value.trim()) {
      errs.push('বিধিনিষেধ অতিক্রম করতে লিখিত কারণ দিতে হবে।');
    }
    if (errs.length) return showAlert('err', 'সংরক্ষণ করা যায়নি:', errs);

    var payload = {
      voucher_type: $('voucherType').value,
      voucher_date: $('voucherDate').value,
      payment_method: $('paymentMethod').value || null,
      instrument_no: $('instrumentNo').value.trim() || null,
      party_type: $('partyType').value || null,
      party_id: $('partyId').value ? Number($('partyId').value) : null,
      narration_bn: $('narration').value.trim(),
      fatwa_override: $('fatwaOverride').checked,
      fatwa_note: $('fatwaNote').value.trim() || null,
      source_module: 'manual',
      lines: built.all.map(function (l) {
        return {
          account_id: l.account_id, fund_id: l.fund_id,
          cost_center_id: l.cost_center_id,
          debit: taka(l.debit), credit: taka(l.credit),
          party_type: $('partyType').value || null,
          party_id: $('partyId').value ? Number($('partyId').value) : null,
        };
      }),
    };

    $('saveBtn').disabled = true;
    $('saveBtn').textContent = 'সংরক্ষণ হচ্ছে…';

    fetch(API + '/vouchers', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
      .then(function (res) {
        if (res.s === 201 && res.d.ok) {
          window.location.href = '/admin/ledger/v/' + res.d.id;
          return;
        }
        showAlert('err', 'সার্ভার গ্রহণ করেনি:', res.d.errors || ['অজানা ত্রুটি।']);
      })
      .catch(function () { showAlert('err', 'সংযোগ সমস্যা', ['আবার চেষ্টা করুন।']); })
      .finally(function () {
        $('saveBtn').disabled = false;
        $('saveBtn').textContent = 'সংরক্ষণ করুন';
      });
  }

  // পরীক্ষার জন্য খোলা রাখা
  window.__voucherEntry = {
    buildLines: function () { return buildLines(); },
    recompute: recompute,
    addLine: addLine,
    lineRows: lineRows,
    requiredApprover: requiredApprover,
    applyType: applyType,
    setMeta: function (m) { meta = m; },
    getMode: function () { return mode; },
  };
})();

/* নতুন ঋণ — /admin/loans/new */
(function () {
  'use strict';
  var API = '/admin/loans/api';
  var $ = function (id) { return document.getElementById(id); };
  var BN = window.BanglaNumber || { takaInWords: function () { return ''; } };
  var money = function (v) { return 'Tk ' + Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var META = null;

  function alertBox(msg, kind) {
    var el = $('lnAlert'); if (!el) return;
    el.className = 'v-alert ' + (kind || 'err');
    el.innerHTML = msg; el.hidden = !msg;
    if (msg) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  var dir = function () {
    var r = document.querySelector('input[name="direction"]:checked');
    return r ? r.value : 'given';
  };

  function fillAccounts() {
    if (!META) return;
    var given = dir() === 'given';
    var want = given ? 'asset' : 'liability';
    var opts = META.loan_accounts.filter(function (a) { return a.account_class === want; });
    $('accountId').innerHTML = opts.map(function (a) {
      return '<option value="' + a.id + '">' + esc(a.code + ' · ' + a.name_bn) + '</option>';
    }).join('');
    // ডিফল্ট: দেওয়া হলে 1203, নেওয়া হলে 2201
    var def = opts.filter(function (a) { return a.code === (given ? '1203' : '2201'); })[0];
    if (def) $('accountId').value = def.id;
    effect();
  }

  function effect() {
    var given = dir() === 'given';
    var acc = $('accountId').selectedOptions[0];
    var cash = $('cashAccount').selectedOptions[0];
    var amt = Number($('principal').value || 0);
    if (!acc || !cash) { $('effectHint').textContent = ''; return; }
    var a = acc.textContent.trim(), c = cash.textContent.trim().split(' (')[0];
    $('effectHint').innerHTML = given
      ? 'খাতায় বসবে: <b>ডেবিট</b> ' + esc(a) + ' · <b>ক্রেডিট</b> ' + esc(c) +
        (amt ? ' · ' + money(amt) : '')
      : 'খাতায় বসবে: <b>ডেবিট</b> ' + esc(c) + ' · <b>ক্রেডিট</b> ' + esc(a) +
        (amt ? ' · ' + money(amt) : '');
  }

  function partyToggle() {
    var t = $('partyType').value;
    var need = (t !== 'donor');
    $('partyIdWrap').style.opacity = need ? '1' : '.55';
    $('partyId').required = need;
    $('partyId').placeholder = need ? 'স্টাফ/শিক্ষার্থীর আইডি' : 'লাগবে না';
  }

  document.addEventListener('DOMContentLoaded', function () {
    fetch(API + '/meta', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { alertBox('তথ্য লোড করা গেল না।'); return; }
        META = d;
        $('issueDate').value = d.today;
        $('issueDate').max = d.today;
        $('cashAccount').innerHTML = d.cash.map(function (a) {
          return '<option value="' + a.id + '">' + esc(a.code + ' · ' + a.name_bn) +
                 ' (' + money(a.balance) + ')</option>';
        }).join('');
        $('fundId').innerHTML = d.funds.map(function (f) {
          return '<option value="' + f.id + '">' + esc(f.name_bn) + '</option>';
        }).join('');
        fillAccounts(); partyToggle();
      })
      .catch(function () { alertBox('সার্ভারে পৌঁছানো গেল না।'); });

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="direction"]'),
      function (r) { r.addEventListener('change', fillAccounts); });
    $('accountId').addEventListener('change', effect);
    $('cashAccount').addEventListener('change', effect);
    $('partyType').addEventListener('change', partyToggle);
    $('principal').addEventListener('input', function () {
      var v = Number($('principal').value || 0);
      $('words').textContent = v > 0 ? BN.takaInWords(v) : '';
      effect();
    });

    $('loanForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, body = {};
      Array.prototype.forEach.call(f.elements, function (el) {
        if (!el.name || el.type === 'radio') return;
        var v = (el.value || '').trim();
        if (v !== '') body[el.name] = v;
      });
      body.direction = dir();
      if (body.party_type === 'donor') delete body.party_id;

      $('saveBtn').disabled = true;
      fetch(API + '/loans', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
        .then(function (o) {
          $('saveBtn').disabled = false;
          if (o.s >= 400 || !o.j.ok) {
            alertBox((o.j.errors || ['সংরক্ষণ করা গেল না']).map(esc).join('<br>')); return;
          }
          window.location.href = '/admin/loans/l/' + o.j.id;
        })
        .catch(function () { $('saveBtn').disabled = false; alertBox('সার্ভারে পৌঁছানো গেল না।'); });
    });
  });
})();

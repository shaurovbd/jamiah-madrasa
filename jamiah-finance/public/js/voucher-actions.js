/* ভাউচারে অনুমোদন / পোস্ট / রিভার্স — /admin/ledger/v/:id */
(function () {
  'use strict';
  var API = '/admin/ledger/api';

  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.querySelector('.form-actions[data-voucher-id]');
    if (!bar) return;
    var id = bar.getAttribute('data-voucher-id');
    var msg = document.getElementById('actionMsg');

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var body = {};

      if (act === 'reject' || act === 'reverse') {
        var reason = window.prompt(act === 'reject' ? 'বাতিলের কারণ লিখুন:' : 'রিভার্সালের কারণ লিখুন:');
        if (!reason || !reason.trim()) return;
        body.reason = reason.trim();
      }
      if (act === 'post' && !window.confirm(
        'খতিয়ানে পোস্ট করার পর এই ভাউচার আর সংশোধন করা যাবে না — শুধু রিভার্স করা যাবে। চালিয়ে যাবেন?')) return;

      Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) { b.disabled = true; });
      msg.textContent = 'প্রক্রিয়া চলছে…';

      fetch(API + '/vouchers/' + id + '/' + act, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok) {
            if (d.reversal_id) { window.location.href = '/admin/ledger/v/' + d.reversal_id; return; }
            window.location.reload(); return;
          }
          msg.innerHTML = '<span class="v-bad">' +
            (d.errors || ['ত্রুটি']).map(function (x) {
              return String(x).replace(/</g, '&lt;');
            }).join('<br>') + '</span>';
          Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) { b.disabled = false; });
        })
        .catch(function () {
          msg.textContent = 'সংযোগ সমস্যা — আবার চেষ্টা করুন।';
          Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) { b.disabled = false; });
        });
    });
  });
})();

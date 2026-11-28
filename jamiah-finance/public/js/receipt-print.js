/* রশিদ প্রিন্ট পেজ — বাতিল করার বোতাম */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('voidBtn');
    if (!btn) return;
    var msg = document.getElementById('voidMsg');
    btn.addEventListener('click', function () {
      var reason = window.prompt('রশিদ বাতিলের কারণ লিখুন:');
      if (!reason || !reason.trim()) return;
      if (!window.confirm('বাতিল করলে এর জমা ভাউচার রিভার্স হবে এবং হিসাব থেকে টাকা বাদ যাবে। চালিয়ে যাবেন?')) return;
      btn.disabled = true; msg.textContent = 'বাতিল হচ্ছে…';
      fetch('/admin/receipts/api/receipts/' + btn.getAttribute('data-id') + '/void', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok) { window.location.reload(); return; }
          msg.innerHTML = '<span class="v-bad">' +
            (d.errors || ['ত্রুটি']).join('<br>') + '</span>';
          btn.disabled = false;
        })
        .catch(function () { msg.textContent = 'সংযোগ সমস্যা।'; btn.disabled = false; });
    });
  });
})();

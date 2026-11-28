/*
 * Jamiah Scholars — date picker for the management panel.
 *
 * Replaces the browser's own date box on every <input type="date"> with one
 * calendar that looks the same in every browser, follows the Appearance colours
 * and speaks Bangla when the panel is in Bangla.
 *
 * Nothing changes for the server or for other scripts: the original input keeps
 * its name, its id and a YYYY-MM-DD value. It only becomes type="hidden", and a
 * button shows the date in a readable form beside it. Setting input.value from
 * code still works and updates the button. Inputs added later (the in-panel
 * navigation swaps page content) are picked up automatically.
 *
 * Opt out on one field with data-native-date.
 */
(function () {
  'use strict';
  if (window.__datePicker) return;
  window.__datePicker = true;

  var bn = (document.documentElement.lang || '').toLowerCase().indexOf('bn') === 0;
  var MONTHS = bn
    ? ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = bn ? MONTHS : MONTHS.map(function (m) { return m.slice(0, 3); });
  var DAYS = bn ? ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var TXT = bn
    ? { today: 'আজ', clear: 'মুছুন', pick: 'তারিখ বাছাই করুন', prev: 'আগের মাস', next: 'পরের মাস', need: 'একটি তারিখ বাছাই করুন' }
    : { today: 'Today', clear: 'Clear', pick: 'Pick a date', prev: 'Previous month', next: 'Next month', need: 'Please pick a date' };
  var BN_DIGITS = '০১২৩৪৫৬৭৮৯';
  function num(n) { var s = String(n); return bn ? s.replace(/\d/g, function (d) { return BN_DIGITS[d]; }) : s; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function parse(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }
  function todayIso() { var t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); }
  function label(v) { var p = parse(v); return p ? num(pad(p.d)) + ' ' + MON[p.m] + ' ' + num(p.y) : ''; }

  var nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  var pop = null;      // the open calendar, one at a time
  var current = null;  // { input, button, y, m, focus }

  /* ------------------------------------------------------------ enhance */
  function enhance(input) {
    if (input.__dp || input.hasAttribute('data-native-date')) return;
    input.__dp = true;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dp-field';
    btn.setAttribute('aria-haspopup', 'dialog');
    if (input.id) {
      // Keep <label for="..."> working: the label now points at the button.
      btn.id = input.id + '__dp';
      var lab = document.querySelector('label[for="' + input.id + '"]');
      if (lab) lab.setAttribute('for', btn.id);
    }
    btn.innerHTML = '<span class="dp-text"></span><span class="dp-ic" aria-hidden="true">' +
      '<svg viewBox="0 0 20 20" width="16" height="16"><rect x="2.5" y="4" width="15" height="13.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M2.5 8.5h15M6.5 2.5v3M13.5 2.5v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>';
    if (input.style.cssText) btn.style.cssText = input.style.cssText;

    input.__dpRequired = input.required;
    input.__dpMin = input.getAttribute('min');
    input.__dpMax = input.getAttribute('max');
    input.required = false;
    input.type = 'hidden';
    input.parentNode.insertBefore(btn, input.nextSibling);
    input.__dpButton = btn;

    // Code that sets .value directly (the finance pages do) updates the button too.
    try {
      Object.defineProperty(input, 'value', {
        configurable: true,
        get: function () { return nativeValue.get.call(this); },
        set: function (v) { nativeValue.set.call(this, v); paint(this); }
      });
    } catch (e) { /* very old browser: the button just will not follow code changes */ }

    btn.disabled = input.disabled;
    btn.addEventListener('click', function () { open(input); });
    paint(input);

    var form = input.form;
    if (form && input.__dpRequired && !form.__dpGuard) {
      form.__dpGuard = true;
      form.addEventListener('submit', function (e) {
        var missing = Array.prototype.filter.call(form.querySelectorAll('input'), function (i) {
          return i.__dp && i.__dpRequired && !i.disabled && !nativeValue.get.call(i);
        })[0];
        if (missing) {
          e.preventDefault();
          e.stopImmediatePropagation();
          missing.__dpButton.classList.add('dp-invalid');
          missing.__dpButton.title = TXT.need;
          open(missing);
        }
      }, true);
    }
  }

  function paint(input) {
    var btn = input.__dpButton;
    if (!btn) return;
    var v = nativeValue.get.call(input);
    var t = btn.querySelector('.dp-text');
    t.textContent = v ? label(v) : (input.getAttribute('placeholder') || TXT.pick);
    btn.classList.toggle('dp-empty', !v);
    if (v) btn.classList.remove('dp-invalid');
    btn.setAttribute('aria-label', (v ? label(v) : TXT.pick));
  }

  function set(input, v) {
    nativeValue.set.call(input, v);
    paint(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* --------------------------------------------------------------- popup */
  function inRange(input, v) {
    return (!input.__dpMin || v >= input.__dpMin) && (!input.__dpMax || v <= input.__dpMax);
  }

  function open(input) {
    if (current && current.input === input) return close();
    close();
    var p = parse(nativeValue.get.call(input)) || parse(todayIso());
    current = { input: input, button: input.__dpButton, y: p.y, m: p.m, focus: iso(p.y, p.m, p.d) };
    pop = document.createElement('div');
    pop.className = 'dp-pop';
    pop.setAttribute('role', 'dialog');
    document.body.appendChild(pop);
    render();
    place();
    current.button.setAttribute('aria-expanded', 'true');
    var f = pop.querySelector('.dp-day[tabindex="0"]');
    if (f) f.focus();
  }

  function close(refocus) {
    if (!pop) return;
    pop.remove();
    pop = null;
    if (current) {
      current.button.setAttribute('aria-expanded', 'false');
      if (refocus) current.button.focus();
    }
    current = null;
  }

  function place() {
    if (!pop || !current) return;
    var r = current.button.getBoundingClientRect();
    var w = pop.offsetWidth, hgt = pop.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var top = r.bottom + 6;
    if (top + hgt > window.innerHeight - 8 && r.top - hgt - 6 > 8) top = r.top - hgt - 6;
    pop.style.left = (left + window.scrollX) + 'px';
    pop.style.top = (top + window.scrollY) + 'px';
  }

  function yearRange(input, y) {
    var lo = Math.min(y, new Date().getFullYear()) - 80, hi = Math.max(y, new Date().getFullYear()) + 10;
    if (input.__dpMin) lo = Math.max(lo, +input.__dpMin.slice(0, 4));
    if (input.__dpMax) hi = Math.min(hi, +input.__dpMax.slice(0, 4));
    return [lo, Math.max(lo, hi)];
  }

  function render() {
    var c = current, input = c.input;
    var val = nativeValue.get.call(input), today = todayIso();
    var first = new Date(c.y, c.m, 1).getDay();
    var days = new Date(c.y, c.m + 1, 0).getDate();
    var yr = yearRange(input, c.y);

    var h = '<div class="dp-head">' +
      '<button type="button" class="dp-nav" data-nav="-1" aria-label="' + TXT.prev + '">‹</button>' +
      '<select class="dp-sel dp-month" aria-label="month">' +
      MONTHS.map(function (n, i) { return '<option value="' + i + '"' + (i === c.m ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
      '</select><select class="dp-sel dp-year" aria-label="year">';
    for (var y = yr[1]; y >= yr[0]; y--) h += '<option value="' + y + '"' + (y === c.y ? ' selected' : '') + '>' + num(y) + '</option>';
    h += '</select><button type="button" class="dp-nav" data-nav="1" aria-label="' + TXT.next + '">›</button></div>';

    h += '<div class="dp-grid" role="grid">';
    DAYS.forEach(function (d, i) { h += '<span class="dp-dow' + (i === 5 ? ' dp-fri' : '') + '">' + d + '</span>'; });
    for (var b = 0; b < first; b++) h += '<span class="dp-blank"></span>';
    for (var d = 1; d <= days; d++) {
      var v = iso(c.y, c.m, d);
      var cls = 'dp-day';
      if (v === today) cls += ' dp-today';
      if (v === val) cls += ' dp-sel-day';
      if ((first + d - 1) % 7 === 5) cls += ' dp-fri';
      var ok = inRange(input, v);
      h += '<button type="button" class="' + cls + '" data-v="' + v + '"' + (ok ? '' : ' disabled') +
        ' tabindex="' + (v === c.focus ? '0' : '-1') + '"' + (v === val ? ' aria-selected="true"' : '') + '>' + num(d) + '</button>';
    }
    h += '</div><div class="dp-foot">' +
      '<button type="button" class="dp-link" data-act="today"' + (inRange(input, today) ? '' : ' disabled') + '>' + TXT.today + '</button>' +
      '<button type="button" class="dp-link dp-clear" data-act="clear">' + TXT.clear + '</button></div>';
    pop.innerHTML = h;
  }

  function show(y, m, focus) {
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    current.y = y; current.m = m;
    var last = new Date(y, m + 1, 0).getDate();
    var fd = focus ? parse(focus) : parse(current.focus);
    current.focus = focus || iso(y, m, Math.min(fd ? fd.d : 1, last));
    render();
    var f = pop.querySelector('.dp-day[tabindex="0"]');
    if (f && pop.contains(document.activeElement) && document.activeElement.classList.contains('dp-day')) f.focus();
  }

  /* -------------------------------------------------------------- events */
  document.addEventListener('click', function (e) {
    if (!pop) return;
    var t = e.target;
    if (!pop.contains(t)) { if (!current.button.contains(t)) close(); return; }
    var nav = t.closest('[data-nav]');
    if (nav) return show(current.y, current.m + Number(nav.getAttribute('data-nav')));
    var day = t.closest('.dp-day');
    if (day && !day.disabled) { set(current.input, day.getAttribute('data-v')); return close(true); }
    var act = t.closest('[data-act]');
    if (act) {
      if (act.getAttribute('data-act') === 'today') set(current.input, todayIso());
      else set(current.input, '');
      close(true);
    }
  });

  document.addEventListener('change', function (e) {
    if (!pop || !pop.contains(e.target)) return;
    var y = +pop.querySelector('.dp-year').value, m = +pop.querySelector('.dp-month').value;
    show(y, m);
  });

  document.addEventListener('keydown', function (e) {
    if (!pop) return;
    if (e.key === 'Escape') { e.preventDefault(); return close(true); }
    var a = document.activeElement;
    if (!a || !a.classList || !a.classList.contains('dp-day')) return;
    var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      return show(current.y, current.m + (e.key === 'PageUp' ? -1 : 1), null);
    }
    if (!step) return;
    e.preventDefault();
    var p = parse(a.getAttribute('data-v'));
    var n = new Date(p.y, p.m, p.d + step);
    show(n.getFullYear(), n.getMonth(), iso(n.getFullYear(), n.getMonth(), n.getDate()));
    var f = pop.querySelector('.dp-day[tabindex="0"]'); if (f) f.focus();
  });

  window.addEventListener('resize', function () { place(); });
  window.addEventListener('scroll', function () { place(); }, true);

  /* ---------------------------------------------------------------- scan */
  function scan(root) {
    (root || document).querySelectorAll('input[type="date"]').forEach(enhance);
  }
  window.__datePickerInit = function () { close(); scan(document); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(document); });
  else scan(document);

  // Page content swapped in by the in-panel navigation, or drawn by a script.
  new MutationObserver(function (list) {
    var hit = false;
    list.forEach(function (m) { if (m.addedNodes.length) hit = true; });
    if (hit) { if (pop && !document.body.contains(current.button)) close(); scan(document); }
  }).observe(document.body, { childList: true, subtree: true });
})();

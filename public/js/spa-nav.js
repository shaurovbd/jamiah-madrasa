(function () {
  'use strict';
  if (!window.history || !window.fetch || !window.DOMParser) return;
  var REGION = '.content';
  var region = document.querySelector(REGION);
  if (!region) return;

  function abs(u){ try { return new URL(u, location.href); } catch (e) { return null; } }
  function internal(u){ var x = abs(u); return !!x && x.origin === location.origin && x.pathname.indexOf('/admin') === 0; }
  function linkOk(a){
    if (!a || a.target || a.hasAttribute('download') || a.hasAttribute('data-no-spa')) return false;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return false;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;
    return internal(a.href);
  }
  var busy = false;
  function fade(on){ region.style.transition = 'opacity .12s'; region.style.opacity = on ? '0.55' : ''; }

  function runScripts(){
    var list = region.querySelectorAll('script');
    for (var i = 0; i < list.length; i++){
      var old = list[i], s = document.createElement('script');
      if (old.src) { s.src = old.src; } else { s.textContent = old.textContent; }
      old.parentNode.replaceChild(s, old);
    }
    ['__themePickerInit', '__studentFormInit'].forEach(function (k) { if (typeof window[k] === 'function') { window[k](); } });
  }

  function syncChrome(doc){
    var t = document.querySelector('.topbar .page-title'), nt = doc.querySelector('.topbar .page-title');
    if (t && nt) { t.textContent = nt.textContent; }
    var nav = document.querySelector('.side-nav'), nnav = doc.querySelector('.side-nav');
    if (nav && nnav) { nav.innerHTML = nnav.innerHTML; }
    var nb = doc.body;
    if (nb) {
      var st = nb.getAttribute('style');
      if (st) { document.body.setAttribute('style', st); }
      ['sidebar','surface','glow'].forEach(function (k) {
        var v = nb.getAttribute('data-' + k);
        if (v !== null) { document.body.setAttribute('data-' + k, v); }
      });
    }
  }

  function go(url, push, init){
    if (busy) return;
    busy = true; fade(true);
    fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'X-Requested-With': 'spa' } }, init || {}))
      .then(function (res) {
        var ct = res.headers.get('content-type') || '';
        if (ct.indexOf('text/html') === -1 || !internal(res.url)) { location.href = res.url || url; return null; }
        return res.text().then(function (html) { return { html: html, url: res.url || url }; });
      })
      .then(function (r) {
        if (!r) return;
        var doc = new DOMParser().parseFromString(r.html, 'text/html');
        var next = doc.querySelector(REGION);
        if (!next) { location.href = r.url; return; }
        region.parentNode.replaceChild(next, region);
        region = next;
        document.title = doc.title;
        syncChrome(doc);
        if (push) { history.pushState({ spa: 1 }, '', r.url); }
        window.scrollTo(0, 0);
        runScripts();
      })
      .catch(function () { location.href = url; })
      .then(function () { busy = false; fade(false); });
  }

  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if (!linkOk(a)) return;
    ev.preventDefault();
    go(a.href, true);
  });

  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (!f || f.tagName !== 'FORM' || f.target || f.hasAttribute('data-no-spa')) return;
    var u = abs(f.getAttribute('action') || location.href);
    if (!u || !internal(u.href)) return;
    ev.preventDefault();
    if ((f.getAttribute('method') || 'get').toLowerCase() === 'get') {
      var qs = new URLSearchParams(new FormData(f)).toString();
      go(u.pathname + (qs ? '?' + qs : ''), true);
    } else {
      var hasFile = !!f.querySelector('input[type=file]');
      var body = hasFile ? new FormData(f) : new URLSearchParams(new FormData(f));
      // The server checks the security token before it reads the form, and it
      // cannot read a file-upload form that early. Sending the token as a
      // header as well lets forms with a file (student photo, notices, Excel
      // import) through; without it every one of them was refused.
      var tok = f.querySelector('input[name="_csrf"]');
      var headers = { 'X-Requested-With': 'spa' };
      if (tok && tok.value) headers['X-CSRF-Token'] = tok.value;
      go(u.href, true, { method: 'POST', body: body, headers: headers });
    }
  });

  window.addEventListener('popstate', function () { go(location.href, false); });
  history.replaceState({ spa: 1 }, '', location.href);
}());
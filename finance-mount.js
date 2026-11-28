'use strict';
/**
 * হিসাব ও অর্থ মডিউল — app.js এর সাথে সংযোগ।
 *
 * app.js এ শুধু একটি লাইন:
 *     require('./finance-mount')(app);
 * রাউট মাউন্টের পরে, 404 হ্যান্ডলারের আগে।
 */
const path = require('path');
const express = require('express');

const { pool: financePool } = require('./config/finance-db');
const { pool: mainPool }    = require('./config/db');
const settings              = require('./lib/settings');
const { financeRoleFor }    = require('./lib/roles');

const FIN_DIR = path.join(__dirname, 'jamiah-finance');

const ledgerRouter = require('./jamiah-finance/routes/ledger');
const receipts     = require('./jamiah-finance/routes/receipts');
const donorRouter  = require('./jamiah-finance/routes/donors');
const orphanRouter = require('./jamiah-finance/routes/orphans');
const loanRouter   = require('./jamiah-finance/routes/loans');

// ---------------------------------------------------------------- প্রতিষ্ঠান
// নাম, ঠিকানা ও ফোন আপনার settings টেবিল থেকেই আসে (lib/settings.js)।
// .env এ কিছু যোগ করতে হয় না — সেটিংস পেজে বদলালে রশিদেও বদলে যায়।
// নিচের মানগুলো কেবল ফলব্যাক, যদি সেটিংস পড়া না যায়।
const ORG = {
  name_bn: 'জামিয়াহ স্কলার্স ইন্টারন্যাশনাল',
  name_en: 'Jamiah Scholars International',
  address_bn: '',
  mobile: '',
};

// settings.all() নিজেই ক্যাশ করে, তাই প্রতি রিকোয়েস্টে ডাকা সস্তা।
async function refreshOrg() {
  try {
    const s = await settings.all();
    if (s.site_name_bn) ORG.name_bn    = s.site_name_bn;
    if (s.site_name)    ORG.name_en    = s.site_name;
    if (s.address)      ORG.address_bn = s.address;
    if (s.phone)        ORG.mobile     = s.phone;
  } catch (err) {
    // সেটিংস পড়া না গেলে উপরের ফলব্যাক মানগুলোই থাকবে
  }
}

function withOrg(req, res, next) {
  refreshOrg().then(() => next(), () => next());
}

// ---------------------------------------------------------------- লেআউট
// হিসাবের পাতাগুলো আপনার অ্যাডমিন লেআউটের ভেতরেই দেখায় — সাইডবার,
// টপবার, ভাষা বদল সব থাকে। res.locals এর বাকি সব (t, user, currentPath…)
// app.js এ বিশ্বব্যাপী বসানো, তাই আলাদা করে দেওয়ার দরকার নেই।
function withLayout(req, res, next) {
  res.locals.layout = 'layouts/admin';
  next();
}

const layout = ({ title, body, res }) =>
  res.render('admin/finance-shell', { title, financeHtml: body });

const PUBLIC_BASE = 'https://jamiahscholarsinternational.com';

// ---------------------------------------------------------------- ভূমিকা
// হিসাবের পেজে ঢোকার অধিকার
const FINANCE_ROLES = ['clerk', 'accountant', 'chief_accountant', 'principal', 'auditor'];
// এতিম বিভাগে শিশুর পারিবারিক তথ্য আছে — আরও সীমিত
const CHILD_ROLES   = ['principal'];

/** users.finance_role — সেশনে না থাকলে একবার ডেটাবেস থেকে এনে রেখে দেয়। */
async function financeRole(req) {
  const u = req.session && req.session.user;
  if (!u) return null;
  if (u.finance_role) return u.finance_role;
  const [rows] = await mainPool.query(
    'SELECT finance_role FROM users WHERE id = ? LIMIT 1', [u.id]);
  // হাতে বসানো finance_role থাকলে সেটাই; না থাকলে মূল রোল থেকে আসে
  // (হিসাবরক্ষক → accountant, মুহতামিম/অ্যাডমিন → principal)। lib/roles.js
  u.finance_role = financeRoleFor(u.role, rows.length ? rows[0].finance_role : 'none');
  return u.finance_role;
}

function requireFinance(allowed) {
  return async function (req, res, next) {
    try {
      const u = req.session && req.session.user;
      if (!u) {
        if (req.session) req.session.returnTo = req.originalUrl;
        return res.redirect('/login');
      }
      const role = await financeRole(req);
      if (!allowed.includes(role)) {
        res.status(403);
        return res.render('admin/forbidden', {}, (err, html) => {
          if (err) return res.type('html').send('<h1>অনুমতি নেই</h1>');
          res.type('html').send(html);
        });
      }
      next();
    } catch (err) { next(err); }
  };
}

const getActor = (req) => ({
  userId: req.session.user.id,
  role:   req.session.user.finance_role || 'none',
  ip:     req.ip,
});

// ---------------------------------------------------------------- CSRF
// app.js রাউট মাউন্টের আগেই req.body._csrf যাচাই করে। হিসাবের পেজগুলো
// সব POST করে fetch দিয়ে, JSON বডিতে — তাই টোকেনটা স্বয়ংক্রিয়ভাবে
// বডিতে ঢুকিয়ে দেওয়ার জন্য একটি ছোট স্ক্রিপ্ট পেজে বসানো হয়।
const CSRF_PATCH = `(function(){
var m=document.querySelector('meta[name="csrf-token"]'); if(!m) return;
var t=m.getAttribute('content'), of=window.fetch;
window.fetch=function(input,init){
  init=init||{};
  var method=(init.method||(input&&input.method)||'GET').toUpperCase();
  if(method!=='GET'&&method!=='HEAD'&&method!=='OPTIONS'){
    var h=new Headers(init.headers||{});
    h.set('x-csrf-token',t);
    var ct=h.get('Content-Type')||'';
    if(init.body instanceof FormData){ init.body.append('_csrf',t); }
    else if(typeof init.body==='string'&&ct.indexOf('application/json')!==-1){
      try{var o=JSON.parse(init.body);
          if(o&&typeof o==='object'&&!Array.isArray(o)&&o._csrf===undefined){
            o._csrf=t; init.body=JSON.stringify(o);} }catch(e){}
    } else if(init.body===undefined||init.body===null){
      h.set('Content-Type','application/json');
      init.body=JSON.stringify({_csrf:t});
    }
    init.headers=h;
  }
  return of(input,init);
};
})();`;

function injectCsrf(req, res, next) {
  const token = res.locals && res.locals.csrfToken;
  if (!token) return next();
  const send = res.send.bind(res);
  res.send = function (body) {
    if (typeof body === 'string' && body.indexOf('</head>') !== -1) {
      const esc = String(token).replace(/"/g, '&quot;');
      body = body.replace('</head>',
        '<meta name="csrf-token" content="' + esc + '">\n' +
        '<script>' + CSRF_PATCH + '</script>\n</head>');
    }
    return send(body);
  };
  next();
}

// ---------------------------------------------------------------- মাউন্ট
module.exports = function mountFinance(app) {
  const common = { pool: financePool, getActor, org: ORG, layout };

  // হিসাবের নিজের css ও js — মূল public/ এর পরে, তাই নামের সংঘর্ষে
  // আপনার ফাইলই আগে থাকে
  app.use(express.static(path.join(FIN_DIR, 'public')));

  app.get('/js/bangla-number.js', (req, res) =>
    res.type('application/javascript')
       .sendFile(path.join(FIN_DIR, 'lib/bangla-number.js')));

  app.use('/admin/ledger',
    withLayout, withOrg, injectCsrf, requireFinance(FINANCE_ROLES), ledgerRouter(common));

  app.use('/admin/receipts',
    withLayout, withOrg, injectCsrf, requireFinance(FINANCE_ROLES),
    receipts.admin(Object.assign({}, common, { publicBaseUrl: PUBLIC_BASE })));

  app.use('/admin/donors',
    withLayout, withOrg, injectCsrf, requireFinance(FINANCE_ROLES), donorRouter(common));

  app.use('/admin/orphans',
    withLayout, withOrg, injectCsrf, requireFinance(CHILD_ROLES), orphanRouter(common));

  app.use('/admin/loans',
    withLayout, withOrg, injectCsrf, requireFinance(FINANCE_ROLES), loanRouter(common));

  // রশিদ যাচাই — দাতা QR স্ক্যান করে আসেন, তাই লগইন ছাড়া
  app.use('/verify', withOrg, receipts.publicVerify({ pool: financePool, org: ORG }));
};

'use strict';
/**
 * app.js এ যা যোগ করতে হবে — এই ফাইলটি নকল করার জন্য, সরাসরি চালানোর জন্য নয়।
 * আপনার নিজের requireAuth ও লেআউট ফাংশনের নাম বসিয়ে নিন।
 */
const path = require('path');
const mysql = require('mysql2/promise');

const ledgerRouter = require('./routes/ledger');
const receipts     = require('./routes/receipts');
const donorRouter  = require('./routes/donors');
const orphanRouter = require('./routes/orphans');

// ---------------------------------------------------------------- ১. পুল
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || 'jamiah',
  decimalNumbers: true,              // ← অবশ্যক, নইলে টাকার হিসাব ভাঙবে

  dateStrings: true,              // ← DATE কলাম স্ট্রিং হিসেবে আসে, টাইমজোনে একদিন পিছিয়ে যায় না
  charset: 'utf8mb4_unicode_ci',
  connectionLimit: 10,
  waitForConnections: true,
});

// ---------------------------------------------------------------- ২. প্রতিষ্ঠান
const ORG = {
  name_bn: 'জামিয়াহ স্কলার্স ইন্টারন্যাশনাল',
  name_en: 'Jamiah Scholars International',
  address_bn: '',                    // ← পূর্ণ ঠিকানা বসান
  mobile: '',                        // ← অফিসের মোবাইল
};

// ---------------------------------------------------------------- ৩. কে কাজ করছে
// req.user.finance_role আসবে users টেবিলের নতুন কলাম থেকে:
//   ALTER TABLE users ADD COLUMN finance_role
//     ENUM('none','accountant','chief_accountant','principal','committee')
//     NOT NULL DEFAULT 'none';
const getActor = (req) => ({
  userId: req.user.id,
  role: req.user.finance_role,
  ip: req.ip,
});

// হিসাবের পেজে ঢোকার অধিকার
const requireFinance = (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.finance_role === 'none') return res.sendStatus(403);
  next();
};

// এতিম বিভাগে শিশুর পারিবারিক তথ্য আছে — আরও সীমিত
const requireChildData = (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (!['principal', 'committee'].includes(req.user.finance_role)) return res.sendStatus(403);
  next();
};

// ---------------------------------------------------------------- ৪. লেআউট
// আপনার সাইডবার-টপবারওয়ালা পেজ যেভাবে তৈরি হয়, সেই ফাংশনটি এখানে দিন।
// না দিলে পেজগুলো নিজেই পূর্ণ HTML বানাবে (সাইডবার ছাড়া) — তাতেও সব কাজ করে।
const layout = ({ title, body }) => renderAdminPage({
  title,
  content: body,
  extraCss: ['/css/ledger.css', '/css/receipt.css', '/css/donor.css', '/css/orphan.css'],
});

// ---------------------------------------------------------------- ৫. মাউন্ট
const common = { pool, getActor, layout, org: ORG, requireAuth: requireFinance };

app.use('/admin/ledger', ledgerRouter(common));

app.use('/admin/receipts', receipts.admin(Object.assign({}, common, {
  publicBaseUrl: 'https://jamiahscholarsinternational.com',   // QR কোডের লিংক
})));

app.use('/admin/donors', donorRouter(common));

app.use('/admin/orphans', orphanRouter(Object.assign({}, common, {
  requireAuth: requireChildData,
})));

// পাবলিক রশিদ যাচাই — auth ছাড়া, দাতা QR স্ক্যান করে আসেন
app.use('/verify', receipts.publicVerify({ pool, org: ORG }));

// সংখ্যা-লাইব্রেরি ব্রাউজারেও একই ফাইল থেকে
app.get('/js/bangla-number.js', (req, res) =>
  res.type('application/javascript')
     .sendFile(path.join(__dirname, 'lib/bangla-number.js')));

// এতিমদের কাগজ — public/ এর বাইরে রাখুন, রোল যাচাই করে পরিবেশন করুন
app.get('/secure/orphan-docs/:file', requireChildData, (req, res) => {
  res.sendFile(path.join('/var/secure/orphan-docs', path.basename(req.params.file)));
});

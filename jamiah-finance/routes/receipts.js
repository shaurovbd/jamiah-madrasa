'use strict';
/**
 * /admin/receipts — রশিদ ব্যবস্থাপনা
 * আর /verify/:token — পাবলিক যাচাই (লগইন ছাড়া)
 *
 *   const receipts = require('./routes/receipts');
 *   app.use('/admin/receipts', receipts.admin({ pool, requireAuth, getActor, layout }));
 *   app.use('/verify', receipts.publicVerify({ pool }));        // auth ছাড়া
 */
const express = require('express');
// qrcode ঐচ্ছিক — না থাকলে রশিদে QR এর বদলে যাচাইয়ের লিংক ছাপে
let QRCode = null;
try { QRCode = require('qrcode'); } catch (err) { QRCode = null; }
const ReceiptService = require('../receipt-service');
const views = require('../views/receipt-views');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    if (e.name === 'VoucherError') return res.status(422).json({ ok: false, errors: e.errors });
    next(e);
  }
};

const baseUrl = (req, configured) =>
  configured || (req.protocol + '://' + req.get('host'));

// =====================================================================
// অ্যাডমিন
// =====================================================================
function admin(opts) {
  const { pool, requireAuth = (q, s, n) => n(), getActor, layout = null, publicBaseUrl = null } = opts;
  if (!pool) throw new Error('receipts.admin: pool প্রয়োজন');
  if (!getActor) throw new Error('receipts.admin: getActor প্রয়োজন');

  const svc = new ReceiptService(pool, opts.serviceOptions || {});
  const router = express.Router();
  router.use(express.json({ limit: '128kb' }));
  router.use(requireAuth);

  const render = (res, html, title) =>
    (layout
      // লেআউট থাকলে সে-ই সাড়া পাঠায় (res.render দিয়ে)
      ? layout({ title, body: html, res })
      : res.type('html').send(views.page({ title, body: html })));

  // ---------------- পেজ ----------------
  router.get('/', wrap(async (req, res) => render(res, views.receiptList(), 'রশিদ')));

  router.get('/new', wrap(async (req, res) => {
    const [[t]] = await pool.query(
      `SELECT code FROM receipt_types WHERE code = ? AND is_active = 1`, [req.query.type]);
    render(res, views.receiptForm({ type: t ? t.code : 'DON' }), 'রশিদ কাটুন');
  }));

  router.get('/books', wrap(async (req, res) => render(res, views.bookRegister(), 'রশিদ বই')));

  // প্রিন্টযোগ্য রশিদ
  router.get('/r/:id', wrap(async (req, res) => {
    const [[r]] = await pool.query(`SELECT * FROM v_receipt_list WHERE id = ?`, [req.params.id]);
    if (!r) return res.status(404).type('html').send(views.notFound('রশিদটি পাওয়া যায়নি।'));

    const [[extra]] = await pool.query(
      `SELECT amount_in_words, manual_no, student_id, instrument_no, payer_mobile
         FROM receipts WHERE id = ?`, [req.params.id]);
    Object.assign(r, extra);

    const size = ['a4', 'half', 'thermal'].includes(req.query.size) ? req.query.size : 'a4';
    const verifyUrl = baseUrl(req, publicBaseUrl) + '/verify/' + r.verify_token;
    let qrSvg = '';
    if (QRCode) {
      qrSvg = await QRCode.toString(verifyUrl, {
        type: 'svg', margin: 0, errorCorrectionLevel: 'M',
        width: size === 'thermal' ? 90 : 110,
      });
    }

    // প্রথমটি মূল কপি; এরপর 'নকল কপি' জলছাপ
    const printNo = await svc.markPrinted(r.id);
    res.type('html').send(views.receiptPrint({
      r, qrSvg, verifyUrl, size, isDuplicate: printNo > 1,
      org: opts.org || views.ORG,
    }));
  }));

  // রশিদের ভাউচারে চলে যাওয়া
  router.get('/r/:id/voucher', wrap(async (req, res) => {
    const [[r]] = await pool.query(`SELECT voucher_id FROM receipts WHERE id = ?`, [req.params.id]);
    if (!r) return res.status(404).type('html').send(views.notFound('রশিদটি পাওয়া যায়নি।'));
    res.redirect('/admin/ledger/v/' + r.voucher_id);
  }));

  // ---------------- API ----------------
  router.get('/api/meta', wrap(async (req, res) => {
    const [[types], [cash], [funds], [books], [periods], [camps]] = await Promise.all([
      pool.query(
        `SELECT rt.id, rt.code, rt.name_bn, rt.prefix, rt.default_fund_id,
                rt.default_credit_account_id, rt.requires_student, rt.requires_payer,
                rt.allow_fund_change, rt.note_bn,
                f.code AS fund_code, f.name_bn AS fund_name,
                a.code AS credit_code, a.name_bn AS credit_name
           FROM receipt_types rt
           JOIN funds f ON f.id = rt.default_fund_id
           JOIN accounts a ON a.id = rt.default_credit_account_id
          WHERE rt.is_active = 1 ORDER BY rt.sort_order`),
      pool.query(
        `SELECT a.id, a.code, a.name_bn, a.account_subtype,
                COALESCE(c.balance, 0) AS balance
           FROM accounts a
           LEFT JOIN v_cash_position c ON c.account_id = a.id
          WHERE a.is_cash_like = 1 AND a.is_active = 1 ORDER BY a.code`),
      pool.query(`SELECT id, code, name_bn FROM funds WHERE is_active = 1 ORDER BY sort_order`),
      pool.query(
        `SELECT b.id, b.book_no, b.from_no, b.to_no, b.issued_to_name, b.used_count,
                rt.code AS type_code
           FROM receipt_books b
           LEFT JOIN receipt_types rt ON rt.id = b.receipt_type_id
          WHERE b.status = 'issued' ORDER BY b.book_no`),
      pool.query(
        `SELECT fp.id, fp.label, fp.start_date, fp.end_date, fp.status
           FROM fiscal_periods fp JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
          WHERE fy.status = 'open' ORDER BY fp.period_no`),
      pool.query(
        `SELECT campaign_id AS id, code, title_bn, fund_code, fund_name,
                target_amount, raised, pct
           FROM v_campaign_progress WHERE status = 'active' ORDER BY code`),
    ]);
    res.json({
      ok: true, types, cashAccounts: cash, funds, books, periods, campaigns: camps,
      actor: getActor(req),
      paymentMethods: [
        { code: 'cash', name: 'নগদ' }, { code: 'bkash', name: 'বিকাশ' },
        { code: 'nagad', name: 'নগদ (MFS)' }, { code: 'rocket', name: 'রকেট' },
        { code: 'bank', name: 'ব্যাংক' }, { code: 'cheque', name: 'চেক' },
      ],
    });
  }));

  // ফলো-আপ পেজ থেকে ?donor= দিয়ে এলে নাম-মোবাইল আগেই বসানোর জন্য
  router.get('/api/donor/:id', wrap(async (req, res) => {
    const [[d]] = await pool.query(
      `SELECT id, donor_code, name, mobile, address, district, country
         FROM donors WHERE id = ?`, [req.params.id]);
    if (!d) return res.status(404).json({ ok: false, errors: ['দাতা পাওয়া যায়নি।'] });
    res.json({ ok: true, donor: d });
  }));

  router.get('/api/receipts', wrap(async (req, res) => {
    const where = [], args = [];
    if (req.query.type)   { where.push('type_code = ?'); args.push(req.query.type); }
    if (req.query.status) { where.push('status = ?'); args.push(req.query.status); }
    if (req.query.from)   { where.push('receipt_date >= ?'); args.push(req.query.from); }
    if (req.query.to)     { where.push('receipt_date <= ?'); args.push(req.query.to); }
    if (req.query.q) {
      where.push('(receipt_no LIKE ? OR payer_name LIKE ? OR payer_mobile LIKE ?)');
      const q = '%' + req.query.q + '%';
      args.push(q, q, q);
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const [rows] = await pool.query(
      `SELECT * FROM v_receipt_list
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY receipt_date DESC, id DESC LIMIT ?`, [...args, limit]);
    res.json({ ok: true, rows });
  }));

  router.get('/api/daily', wrap(async (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [[byType], [byMethod], [[tot]]] = await Promise.all([
      pool.query(
        `SELECT type_code, type_name, fund_code, SUM(receipt_count) receipt_count,
                SUM(total_amount) total_amount
           FROM v_receipt_daily WHERE receipt_date = ?
          GROUP BY type_code, type_name, fund_code ORDER BY type_code`, [date]),
      pool.query(
        `SELECT payment_method, cash_code, cash_name, receipt_count, total_amount
           FROM v_receipt_by_method WHERE receipt_date = ? ORDER BY payment_method`, [date]),
      pool.query(
        `SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM receipts
          WHERE receipt_date = ? AND status = 'issued'`, [date]),
    ]);
    res.json({ ok: true, date, byType, byMethod, count: Number(tot.n), total: Number(tot.s) });
  }));

  router.post('/api/receipts', wrap(async (req, res) => {
    const out = await svc.issue(req.body, getActor(req));
    res.status(201).json({ ok: true, ...out });
  }));

  router.post('/api/receipts/:id/void', wrap(async (req, res) => {
    res.json({ ok: true, ...(await svc.void(req.params.id, req.body.reason, getActor(req))) });
  }));

  // ---------------- রশিদ বই ----------------
  router.get('/api/books', wrap(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT b.*, rt.code AS type_code, rt.name_bn AS type_name
         FROM receipt_books b LEFT JOIN receipt_types rt ON rt.id = b.receipt_type_id
        ORDER BY b.book_no`);
    res.json({ ok: true, rows });
  }));

  router.post('/api/books/:id/assign', wrap(async (req, res) => {
    res.json({ ok: true, ...(await svc.assignBook(req.params.id, {
      staffId: req.body.staff_id, staffName: req.body.staff_name, date: req.body.date,
    }, getActor(req))) });
  }));

  router.post('/api/books/:id/return', wrap(async (req, res) => {
    res.json({ ok: true, ...(await svc.returnBook(req.params.id, getActor(req))) });
  }));

  return router;
}

// =====================================================================
// পাবলিক যাচাই — কোনো auth নেই, কোনো ব্যক্তিগত তথ্যও নেই
// =====================================================================
function publicVerify(opts) {
  const { pool } = opts;
  const svc = new ReceiptService(pool, opts.serviceOptions || {});
  const router = express.Router();

  router.get('/:token', wrap(async (req, res) => {
    const r = await svc.verify(req.params.token);
    res.status(r ? 200 : 404).type('html')
      .send(views.verifyPage({ r, org: opts.org || views.ORG }));
  }));

  // ---- বারবার চেষ্টা আটকানো -------------------------------------
  // শুধু ব্যর্থ চেষ্টা গোনা হয়। একই আইপি থেকে ১৫ মিনিটে ৮ বারের বেশি
  // ব্যর্থ হলে কিছুক্ষণ অপেক্ষা করতে হয় — যাতে কেউ যন্ত্র দিয়ে একের পর
  // এক নম্বর মিলিয়ে দেখার চেষ্টা করতে না পারে।
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX_FAILS = 8;
  const fails = new Map();

  const prune = (now) => {
    if (fails.size < 500) return;
    for (const [k, v] of fails) if (now - v.first > WINDOW_MS) fails.delete(k);
  };
  const tooMany = (ip) => {
    const now = Date.now();
    const e = fails.get(ip);
    if (!e || now - e.first > WINDOW_MS) return false;
    return e.n >= MAX_FAILS;
  };
  const noteFail = (ip) => {
    const now = Date.now();
    prune(now);
    const e = fails.get(ip);
    if (!e || now - e.first > WINDOW_MS) fails.set(ip, { n: 1, first: now });
    else e.n += 1;
  };

  const askPage = (req, res, error, receiptNo) =>
    res.type('html').send(views.verifyLookup({
      org: opts.org || views.ORG,
      csrfToken: res.locals && res.locals.csrfToken,
      error, receiptNo,
    }));

  router.get('/', (req, res) => askPage(req, res, null, ''));

  router.post('/', wrap(async (req, res) => {
    const ip = req.ip || 'unknown';
    if (tooMany(ip)) return res.status(429), askPage(req, res, 'toomany', '');

    const no = (req.body && req.body.receipt_no) || '';
    const mobile = (req.body && req.body.mobile) || '';
    const out = await svc.verifyByNumber(no, mobile);

    if (!out.ok) {
      if (out.reason !== 'input') noteFail(ip);
      return res.status(out.reason === 'input' ? 400 : 404),
             askPage(req, res, out.reason, no);
    }
    res.type('html').send(views.verifyPage({ r: out.receipt, org: opts.org || views.ORG }));
  }));

  return router;
}

module.exports = { admin, publicVerify };

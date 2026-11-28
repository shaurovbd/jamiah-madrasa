'use strict';
/**
 * /admin/ledger — ভাউচার ও খতিয়ান রাউটার
 *
 * মাউন্ট করা:
 *   const ledger = require('./routes/ledger');
 *   app.use('/admin/ledger', ledger({
 *     pool,                                  // mysql2/promise pool
 *     requireAuth,                           // আপনার মিডলওয়্যার
 *     getActor: (req) => ({                  // ভাউচার সার্ভিসের জন্য ব্যবহারকারী
 *       userId: req.user.id,
 *       role:   req.user.finance_role,       // accountant | chief_accountant | principal | committee
 *       ip:     req.ip,
 *     }),
 *     layout: myLayoutFunction,              // ঐচ্ছিক — আপনার সাইডবার/টপবার মোড়ক
 *   }));
 */
const express = require('express');
const VoucherService = require('../voucher-service');
const views = require('../views/ledger-views');

module.exports = function ledgerRouter(opts) {
  const { pool, requireAuth = (req, res, next) => next(), getActor, layout = null } = opts;
  if (!pool) throw new Error('ledgerRouter: pool প্রয়োজন');
  if (!getActor) throw new Error('ledgerRouter: getActor প্রয়োজন');

  const svc = new VoucherService(pool, opts.serviceOptions || {});
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(requireAuth);

  const render = (res, html, title) =>
    (layout
      // লেআউট থাকলে সে-ই সাড়া পাঠায় (res.render দিয়ে)
      ? layout({ title, body: html, res })
      : res.type('html').send(views.page({ title, body: html })));

  // ত্রুটি একই আকারে ফেরত যায়, যাতে ফ্রন্টএন্ড এক নিয়মে দেখাতে পারে
  const wrap = (fn) => async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (e) {
      if (e.name === 'VoucherError') return res.status(422).json({ ok: false, errors: e.errors });
      next(e);
    }
  };

  // ===================================================================
  // পেজ
  // ===================================================================

  // ভাউচার তালিকা
  router.get('/', wrap(async (req, res) => {
    render(res, views.voucherList(), 'ভাউচার ও খতিয়ান');
  }));

  // নতুন ভাউচার
  router.get('/new', wrap(async (req, res) => {
    const type = ['RV', 'PV', 'JV', 'CV', 'FT'].includes(req.query.type) ? req.query.type : 'PV';
    render(res, views.voucherForm({ type }), 'নতুন ভাউচার');
  }));

  // দিনের খতিয়ান
  router.get('/day-book', wrap(async (req, res) => {
    render(res, views.dayBook(), 'দিনের খতিয়ান');
  }));

  // একটি ভাউচার (প্রিন্টযোগ্য)
  router.get('/v/:id', wrap(async (req, res) => {
    const data = await loadVoucher(pool, req.params.id);
    if (!data) return res.status(404).type('html').send(views.notFound());
    render(res, views.voucherDetail(data), data.voucher.voucher_no);
  }));

  // ===================================================================
  // API — ড্রপডাউনের সব তথ্য একবারে
  // ===================================================================
  router.get('/api/meta', wrap(async (req, res) => {
    const [[accounts], [funds], [costCenters], [fundBal], [cashBal], [periods], [rules]] =
      await Promise.all([
        pool.query(
          `SELECT id, code, name_bn, name_en, account_class, account_subtype,
                  is_cash_like, requires_party, requires_fund
             FROM accounts
            WHERE is_active = 1 AND is_group = 0 AND is_postable = 1
            ORDER BY code`),
        pool.query(
          `SELECT id, code, name_bn, fund_type, allow_negative, corpus_protected,
                  requires_approval_by, expiry_date
             FROM funds WHERE is_active = 1 ORDER BY sort_order, code`),
        pool.query(`SELECT id, code, name_bn FROM cost_centers WHERE is_active = 1 ORDER BY sort_order`),
        pool.query(`SELECT fund_id, code, available_balance FROM v_fund_available`),
        pool.query(`SELECT account_id, code, balance FROM v_cash_position`),
        pool.query(
          `SELECT fp.id, fp.label, fp.start_date, fp.end_date, fp.status
             FROM fiscal_periods fp JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
            WHERE fy.status = 'open' ORDER BY fp.period_no`),
        pool.query(`SELECT fund_id, account_id, rule FROM fund_account_rules`),
      ]);

    const fundBalance = Object.fromEntries(fundBal.map((f) => [f.fund_id, Number(f.available_balance)]));
    const cashBalance = Object.fromEntries(cashBal.map((c) => [c.account_id, Number(c.balance)]));

    // ফান্ড → অনুমোদিত/নিষিদ্ধ হিসাব, যাতে UI আগেই সতর্ক করতে পারে
    const fundRules = {};
    for (const r of rules) {
      fundRules[r.fund_id] = fundRules[r.fund_id] || { allow: [], block: [] };
      fundRules[r.fund_id][r.rule].push(r.account_id);
    }

    res.json({
      ok: true, accounts, funds, costCenters, periods,
      fundBalance, cashBalance, fundRules,
      actor: getActor(req),
      voucherTypes: [
        { code: 'RV', name: 'জমা ভাউচার', hint: 'ফি আদায়, অনুদান, ঋণ ফেরত' },
        { code: 'PV', name: 'খরচ ভাউচার', hint: 'বেতন, বাজার, বিল' },
        { code: 'JV', name: 'জার্নাল ভাউচার', hint: 'ইনভয়েস, অবচয়, সমন্বয়' },
        { code: 'CV', name: 'কন্ট্রা ভাউচার', hint: 'ক্যাশ ↔ ব্যাংক ↔ বিকাশ' },
        { code: 'FT', name: 'ফান্ড ট্রান্সফার', hint: 'এক ফান্ড থেকে অন্য ফান্ডে' },
      ],
      paymentMethods: [
        { code: 'cash', name: 'নগদ' }, { code: 'bank', name: 'ব্যাংক' },
        { code: 'bkash', name: 'বিকাশ' }, { code: 'nagad', name: 'নগদ (MFS)' },
        { code: 'rocket', name: 'রকেট' }, { code: 'cheque', name: 'চেক' },
        { code: 'adjustment', name: 'সমন্বয় (টাকা নড়েনি)' },
      ],
    });
  }));

  // ===================================================================
  // API — ভাউচার
  // ===================================================================

  // তালিকা
  router.get('/api/vouchers', wrap(async (req, res) => {
    const where = [];
    const args = [];
    if (req.query.status) { where.push('v.status = ?'); args.push(req.query.status); }
    if (req.query.type)   { where.push('v.voucher_type = ?'); args.push(req.query.type); }
    if (req.query.from)   { where.push('v.voucher_date >= ?'); args.push(req.query.from); }
    if (req.query.to)     { where.push('v.voucher_date <= ?'); args.push(req.query.to); }
    if (req.query.q) {
      where.push('(v.voucher_no LIKE ? OR v.narration_bn LIKE ?)');
      args.push('%' + req.query.q + '%', '%' + req.query.q + '%');
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const [rows] = await pool.query(
      `SELECT v.id, v.voucher_no, v.voucher_type, v.voucher_date, v.narration_bn,
              v.total_debit, v.status, v.payment_method, v.reversed_at,
              v.created_by, v.created_at,
              GROUP_CONCAT(DISTINCT f.code ORDER BY f.code) AS fund_codes
         FROM vouchers v
         LEFT JOIN voucher_lines vl ON vl.voucher_id = v.id
         LEFT JOIN funds f ON f.id = vl.fund_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        GROUP BY v.id
        ORDER BY v.voucher_date DESC, v.id DESC
        LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[cnt]] = await pool.query(
      `SELECT COUNT(DISTINCT v.id) n FROM vouchers v
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, args);
    res.json({ ok: true, rows, total: Number(cnt.n), limit, offset });
  }));

  // অনুমোদনের অপেক্ষায়
  router.get('/api/pending', wrap(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT v.id, v.voucher_no, v.voucher_type, v.voucher_date, v.narration_bn,
              v.total_debit, v.created_by, v.created_at,
              GROUP_CONCAT(DISTINCT f.code ORDER BY f.code) AS fund_codes,
              MAX(f.requires_approval_by) AS fund_approval
         FROM vouchers v
         JOIN voucher_lines vl ON vl.voucher_id = v.id
         JOIN funds f ON f.id = vl.fund_id
        WHERE v.status = 'pending'
        GROUP BY v.id
        ORDER BY v.created_at`);
    res.json({ ok: true, rows });
  }));

  // একটি ভাউচার
  router.get('/api/vouchers/:id', wrap(async (req, res) => {
    const data = await loadVoucher(pool, req.params.id);
    if (!data) return res.status(404).json({ ok: false, errors: ['ভাউচার পাওয়া যায়নি।'] });
    res.json({ ok: true, ...data });
  }));

  // তৈরি
  router.post('/api/vouchers', wrap(async (req, res) => {
    const out = await svc.create(req.body, getActor(req));
    res.status(201).json({ ok: true, ...out });
  }));

  router.post('/api/vouchers/:id/approve', wrap(async (req, res) => {
    res.json({ ok: true, ...(await svc.approve(req.params.id, getActor(req))) });
  }));

  router.post('/api/vouchers/:id/post', wrap(async (req, res) => {
    res.json({ ok: true, ...(await svc.post(req.params.id, getActor(req))) });
  }));

  router.post('/api/vouchers/:id/reject', wrap(async (req, res) => {
    res.json({ ok: true, ...(await svc.reject(req.params.id, req.body.reason, getActor(req))) });
  }));

  router.post('/api/vouchers/:id/reverse', wrap(async (req, res) => {
    res.json({ ok: true, ...(await svc.reverse(req.params.id, req.body.reason, getActor(req))) });
  }));

  // ===================================================================
  // API — রিপোর্ট
  // ===================================================================

  // দিনের খতিয়ান
  router.get('/api/day-book', wrap(async (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [rows] = await pool.query(
      `SELECT v.voucher_no, v.voucher_type, v.narration_bn, v.payment_method,
              a.code AS account_code, a.name_bn AS account_name,
              f.code AS fund_code, cc.code AS cost_center,
              vl.debit, vl.credit, vl.line_narration
         FROM voucher_lines vl
         JOIN vouchers v ON v.id = vl.voucher_id AND v.status = 'posted'
         JOIN accounts a ON a.id = vl.account_id
         JOIN funds f ON f.id = vl.fund_id
         LEFT JOIN cost_centers cc ON cc.id = vl.cost_center_id
        WHERE v.voucher_date = ?
        ORDER BY v.voucher_no, vl.line_no`, [date]);
    const [cash] = await pool.query(`SELECT code, name_bn, balance FROM v_cash_position ORDER BY code`);
    const [fundsNow] = await pool.query(
      `SELECT code, name_bn, available_balance FROM v_fund_available ORDER BY code`);
    res.json({ ok: true, date, rows, cash, funds: fundsNow });
  }));

  // ফান্ড-ওয়ারি বিবরণী
  router.get('/api/fund-statement', wrap(async (req, res) => {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const [rows] = await pool.query(
      `SELECT f.code AS fund_code, f.name_bn AS fund_name,
              a.code AS account_code, a.name_bn AS account_name, a.account_class,
              SUM(vl.debit) AS debit, SUM(vl.credit) AS credit
         FROM voucher_lines vl
         JOIN vouchers v ON v.id = vl.voucher_id AND v.status = 'posted'
         JOIN accounts a ON a.id = vl.account_id
         JOIN funds f ON f.id = vl.fund_id
        WHERE a.account_class IN ('income','expense')
          AND (? IS NULL OR v.voucher_date >= ?)
          AND (? IS NULL OR v.voucher_date <= ?)
        GROUP BY f.code, f.name_bn, a.code, a.name_bn, a.account_class
        ORDER BY f.code, a.code`, [from, from, to, to]);
    const [totals] = await pool.query(
      `SELECT code, name_bn, total_received, total_spent, available_balance
         FROM v_fund_available ORDER BY code`);
    res.json({ ok: true, rows, totals });
  }));

  // রেওয়ামিল
  router.get('/api/trial-balance', wrap(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT code, name_bn, account_class, total_debit, total_credit,
              balance_debit, balance_credit
         FROM v_trial_balance
        WHERE total_debit <> 0 OR total_credit <> 0
        ORDER BY code`);
    const sum = rows.reduce((s, r) => ({
      debit: s.debit + Number(r.balance_debit),
      credit: s.credit + Number(r.balance_credit),
    }), { debit: 0, credit: 0 });
    res.json({ ok: true, rows, sum, balanced: Math.abs(sum.debit - sum.credit) < 0.005 });
  }));

  return router;
};

// =====================================================================
async function loadVoucher(pool, id) {
  const [[voucher]] = await pool.query(
    `SELECT v.*, fp.label AS period_label,
            rv.voucher_no AS reversed_by_no, ov.voucher_no AS reversal_of_no
       FROM vouchers v
       JOIN fiscal_periods fp ON fp.id = v.fiscal_period_id
       LEFT JOIN vouchers rv ON rv.id = v.reversed_by_voucher_id
       LEFT JOIN vouchers ov ON ov.id = v.reversal_of_id
      WHERE v.id = ?`, [id]);
  if (!voucher) return null;
  const [lines] = await pool.query(
    `SELECT vl.*, a.code AS account_code, a.name_bn AS account_name,
            f.code AS fund_code, f.name_bn AS fund_name, cc.code AS cost_center
       FROM voucher_lines vl
       JOIN accounts a ON a.id = vl.account_id
       JOIN funds f ON f.id = vl.fund_id
       LEFT JOIN cost_centers cc ON cc.id = vl.cost_center_id
      WHERE vl.voucher_id = ? ORDER BY vl.line_no`, [id]);
  const [attachments] = await pool.query(
    `SELECT id, file_name, mime_type, file_size FROM voucher_attachments WHERE voucher_id = ?`, [id]);
  return { voucher, lines, attachments };
}

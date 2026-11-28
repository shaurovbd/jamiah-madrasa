'use strict';
/**
 * /admin/loans — ঋণ ও বাকি ব্যবস্থাপনা
 *
 *   app.use('/admin/loans', require('./routes/loans')({ pool, requireAuth, getActor, layout }));
 */
const express = require('express');
const LoanService = require('../loan-service');
const views = require('../views/loan-views');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    if (e.name === 'VoucherError') return res.status(422).json({ ok: false, errors: e.errors });
    next(e);
  }
};

module.exports = function loanRouter(opts) {
  const { pool, requireAuth = (q, s, n) => n(), getActor, layout = null } = opts;
  if (!pool) throw new Error('loanRouter: pool প্রয়োজন');
  if (!getActor) throw new Error('loanRouter: getActor প্রয়োজন');

  const svc = new LoanService(pool, opts.serviceOptions || {});
  const router = express.Router();
  router.use(express.json({ limit: '128kb' }));
  router.use(requireAuth);

  const render = (res, html, title) =>
    (layout
      ? layout({ title, body: html, res })
      : res.type('html').send(views.page({ title, body: html })));

  // ---------------- পেজ ----------------
  router.get('/', wrap(async (req, res) => render(res, views.loanList(), 'ঋণ ও বাকি')));
  router.get('/new', wrap(async (req, res) => render(res, views.loanForm(), 'নতুন ঋণ')));
  router.get('/overdue', wrap(async (req, res) => render(res, views.overdueList(), 'মেয়াদ পেরোনো')));
  router.get('/l/:id', wrap(async (req, res) => {
    const data = await svc.get(req.params.id);
    if (!data) return res.status(404).type('html').send(views.notFound('ঋণটি পাওয়া যায়নি।'));
    render(res, views.loanDetail(), 'ঋণ ' + data.loan.loan_code);
  }));

  // ---------------- API ----------------
  router.get('/api/meta', wrap(async (req, res) => {
    const [cash] = await pool.query(
      `SELECT account_id AS id, code, name_bn, balance FROM v_cash_position ORDER BY code`);
    const [loanAccounts] = await pool.query(
      `SELECT id, code, name_bn, account_class FROM accounts
        WHERE code IN ('1203','1204','1302','2101','2102','2201','2202')
          AND is_active = 1 ORDER BY code`);
    const [funds] = await pool.query(
      `SELECT id, code, name_bn FROM funds WHERE is_active = 1 ORDER BY sort_order`);
    const [centers] = await pool.query(
      `SELECT id, code, name_bn FROM cost_centers WHERE is_active = 1 ORDER BY sort_order`);
    res.json({ ok: true, cash, loan_accounts: loanAccounts, funds, cost_centers: centers,
               today: new Date().toISOString().slice(0, 10) });
  }));

  router.get('/api/summary', wrap(async (req, res) =>
    res.json({ ok: true, summary: await svc.summary() })));

  router.get('/api/loans', wrap(async (req, res) =>
    res.json({ ok: true, rows: await svc.list(req.query) })));

  router.get('/api/loans/:id', wrap(async (req, res) => {
    const data = await svc.get(req.params.id);
    if (!data) return res.status(404).json({ ok: false, errors: ['ঋণটি পাওয়া যায়নি।'] });
    res.json(Object.assign({ ok: true }, data));
  }));

  router.get('/api/overdue', wrap(async (req, res) =>
    res.json(Object.assign({ ok: true }, await svc.overdue(req.query.date)))));

  router.post('/api/loans', wrap(async (req, res) => {
    const out = await svc.create(req.body, getActor(req));
    res.status(201).json({ ok: true, ...out });
  }));

  router.post('/api/loans/:id/payments', wrap(async (req, res) => {
    const out = await svc.repay(req.params.id, req.body, getActor(req));
    res.status(201).json({ ok: true, ...out });
  }));

  router.post('/api/loans/:id/write-off', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.writeOff(req.params.id, req.body, getActor(req))) })));

  router.post('/api/loans/:id/cancel', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.cancel(req.params.id, req.body, getActor(req))) })));

  router.post('/api/loans/:id/remind', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.markReminded(req.params.id)) })));

  return router;
};

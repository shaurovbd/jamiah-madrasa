'use strict';
/**
 * /admin/donors — স্পনসর ও অনুদান বিভাগ
 *
 *   app.use('/admin/donors', require('./routes/donors')({ pool, requireAuth, getActor, layout }));
 */
const express = require('express');
const DonorService = require('../donor-service');
const views = require('../views/donor-views');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    if (e.name === 'VoucherError') return res.status(422).json({ ok: false, errors: e.errors });
    next(e);
  }
};

module.exports = function donorRouter(opts) {
  const { pool, requireAuth = (q, s, n) => n(), getActor, layout = null } = opts;
  if (!pool) throw new Error('donorRouter: pool প্রয়োজন');
  if (!getActor) throw new Error('donorRouter: getActor প্রয়োজন');

  const svc = new DonorService(pool, opts.serviceOptions || {});
  const router = express.Router();
  router.use(express.json({ limit: '128kb' }));
  router.use(requireAuth);

  const render = (res, html, title) =>
    (layout
      // লেআউট থাকলে সে-ই সাড়া পাঠায় (res.render দিয়ে)
      ? layout({ title, body: html, res })
      : res.type('html').send(views.page({ title, body: html })));

  // ---------------- পেজ ----------------
  router.get('/', wrap(async (req, res) => render(res, views.donorList(), 'দাতা ও স্পনসর')));
  router.get('/campaigns', wrap(async (req, res) => render(res, views.campaignList(), 'প্রচারাভিযান')));
  router.get('/followups', wrap(async (req, res) => render(res, views.followUps(), 'ফলো-আপ')));
  router.get('/reports', wrap(async (req, res) => render(res, views.reports(), 'অনুদানের রিপোর্ট')));

  router.get('/d/:id', wrap(async (req, res) => {
    const d = await svc.getDonor(req.params.id);
    if (!d) return res.status(404).type('html').send(views.notFound('দাতা পাওয়া যায়নি।'));
    render(res, views.donorProfile(d), d.donor.name);
  }));

  // বার্ষিক বিবরণী — দাতাকে পাঠানোর জন্য, প্রিন্টযোগ্য
  router.get('/d/:id/statement', wrap(async (req, res) => {
    const st = await svc.statement(req.params.id, { from: req.query.from, to: req.query.to });
    if (!st) return res.status(404).type('html').send(views.notFound('দাতা পাওয়া যায়নি।'));
    res.type('html').send(views.statementPrint({ st, org: opts.org || views.ORG }));
  }));

  router.get('/campaigns/:id', wrap(async (req, res) => {
    const c = await svc.getCampaign(req.params.id);
    if (!c) return res.status(404).type('html').send(views.notFound('প্রচারাভিযান পাওয়া যায়নি।'));
    render(res, views.campaignDetail(c), c.campaign.title_bn);
  }));

  // ---------------- API: সাধারণ ----------------
  router.get('/api/meta', wrap(async (req, res) => {
    const [[funds], [types], [camps], [districts], [tiers]] = await Promise.all([
      pool.query(`SELECT id, code, name_bn FROM funds WHERE is_active=1 ORDER BY sort_order`),
      pool.query(`SELECT id, code, name_bn, links_donor FROM receipt_types WHERE is_active=1 ORDER BY sort_order`),
      pool.query(`SELECT campaign_id AS id, code, title_bn, status FROM v_campaign_progress ORDER BY code`),
      pool.query(`SELECT DISTINCT district FROM donors WHERE district IS NOT NULL ORDER BY district`),
      pool.query(`SELECT DISTINCT recognition_tier t FROM donors WHERE recognition_tier IS NOT NULL ORDER BY t`),
    ]);
    const [[tot]] = await pool.query(
      `SELECT COUNT(*) donors, COALESCE(SUM(total_given),0) total,
              SUM(CASE WHEN is_expatriate=1 THEN 1 ELSE 0 END) expats,
              SUM(CASE WHEN months_since_last >= 6 THEN 1 ELSE 0 END) lapsed
         FROM v_donor_summary WHERE merged_into_id IS NULL`);
    res.json({
      ok: true, funds, receiptTypes: types, campaigns: camps,
      districts: districts.map((d) => d.district), tiers: tiers.map((t) => t.t),
      totals: tot, actor: getActor(req),
    });
  }));

  // ---------------- API: দাতা ----------------
  router.get('/api/donors', wrap(async (req, res) =>
    res.json({ ok: true, rows: await svc.searchDonors(req.query) })));

  router.get('/api/donors/:id', wrap(async (req, res) => {
    const d = await svc.getDonor(req.params.id);
    if (!d) return res.status(404).json({ ok: false, errors: ['দাতা পাওয়া যায়নি।'] });
    res.json({ ok: true, ...d });
  }));

  router.post('/api/donors', wrap(async (req, res) =>
    res.status(201).json({ ok: true, ...(await svc.upsertDonor(req.body, getActor(req))) })));

  router.patch('/api/donors/:id', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.updateDonor(req.params.id, req.body, getActor(req))) })));

  router.post('/api/donors/merge', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.mergeDonors(
      req.body.keep_id, req.body.merge_id, getActor(req))) })));

  router.get('/api/donors/:id/statement', wrap(async (req, res) => {
    const st = await svc.statement(req.params.id, req.query);
    if (!st) return res.status(404).json({ ok: false, errors: ['দাতা পাওয়া যায়নি।'] });
    res.json({ ok: true, ...st });
  }));

  // ---------------- API: প্রচারাভিযান ----------------
  router.get('/api/campaigns', wrap(async (req, res) =>
    res.json({ ok: true, rows: await svc.listCampaigns(req.query) })));

  router.get('/api/campaigns/:id', wrap(async (req, res) => {
    const c = await svc.getCampaign(req.params.id);
    if (!c) return res.status(404).json({ ok: false, errors: ['পাওয়া যায়নি।'] });
    res.json({ ok: true, ...c });
  }));

  router.post('/api/campaigns', wrap(async (req, res) =>
    res.status(201).json({ ok: true, ...(await svc.createCampaign(req.body, getActor(req))) })));

  router.patch('/api/campaigns/:id', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.updateCampaign(req.params.id, req.body, getActor(req))) })));

  // ---------------- API: প্রতিশ্রুতি ----------------
  router.get('/api/pledges', wrap(async (req, res) =>
    res.json({ ok: true, rows: await svc.pledgeFollowUps(req.query) })));

  router.post('/api/pledges', wrap(async (req, res) =>
    res.status(201).json({ ok: true, ...(await svc.createPledge(req.body, getActor(req))) })));

  router.post('/api/pledges/:id/remind', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.markReminded(req.params.id, getActor(req))) })));

  router.post('/api/pledges/:id/cancel', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.cancelPledge(req.params.id, req.body.reason, getActor(req))) })));

  // ---------------- API: মাসিক পরিকল্পনা ----------------
  router.get('/api/recurring/due', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.recurringDue(req.query.date)) })));

  router.post('/api/recurring', wrap(async (req, res) =>
    res.status(201).json({ ok: true, ...(await svc.createRecurring(req.body, getActor(req))) })));

  router.post('/api/recurring/:id/status', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.setRecurringStatus(
      req.params.id, req.body.status, getActor(req))) })));

  // ---------------- API: রিপোর্ট ----------------
  router.get('/api/lapsed', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.lapsedDonors(req.query)) })));

  router.get('/api/reports/top', wrap(async (req, res) =>
    res.json({ ok: true, rows: await svc.topDonors(req.query) })));

  router.get('/api/reports/area', wrap(async (req, res) =>
    res.json({ ok: true, rows: await svc.areaReport() })));

  router.get('/api/reports/monthly', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.monthlyTrend(req.query.year)) })));

  return router;
};

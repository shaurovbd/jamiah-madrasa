'use strict';
/**
 * /admin/orphans — এতিম স্পনসর বিভাগ
 *
 *   app.use('/admin/orphans', require('./routes/orphans')({ pool, requireAuth, getActor, layout }));
 *
 * দ্রষ্টব্য: `/api/orphans/:id` প্রাতিষ্ঠানিক পূর্ণ নথি ফেরত দেয় (অভিভাবকের মোবাইল,
 * ঠিকানা, কাগজের তালিকা) — তাই এই রাউটার অবশ্যই requireAuth এর পিছনে থাকবে।
 * দাতাকে দেখানোর পথ আলাদা: `/api/sponsorships/:id/report` ও `/s/:id/report`,
 * যেগুলো শুধু OrphanService এর হোয়াইটলিস্ট প্রক্ষেপণ ব্যবহার করে।
 */
const express = require('express');
const OrphanService = require('../orphan-service');
const views = require('../views/orphan-views');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    if (e.name === 'VoucherError') return res.status(422).json({ ok: false, errors: e.errors });
    next(e);
  }
};

module.exports = function orphanRouter(opts) {
  const { pool, requireAuth = (q, s, n) => n(), getActor, layout = null } = opts;
  if (!pool) throw new Error('orphanRouter: pool প্রয়োজন');
  if (!getActor) throw new Error('orphanRouter: getActor প্রয়োজন');

  const svc = new OrphanService(pool, opts.serviceOptions || {});
  const router = express.Router();
  router.use(express.json({ limit: '128kb' }));
  router.use(requireAuth);

  const render = (res, html, title) =>
    (layout
      // লেআউট থাকলে সে-ই সাড়া পাঠায় (res.render দিয়ে)
      ? layout({ title, body: html, res })
      : res.type('html').send(views.page({ title, body: html })));

  // ---------------- পেজ ----------------
  router.get('/', wrap(async (req, res) => render(res, views.orphanList(), 'এতিম শিক্ষার্থী')));
  router.get('/pool', wrap(async (req, res) => render(res, views.unsponsoredPool(), 'অসম্পৃক্ত পুল')));
  router.get('/sponsorships', wrap(async (req, res) =>
    render(res, views.sponsorshipList(), 'স্পনসরশিপ')));

  router.get('/o/:id', wrap(async (req, res) => {
    const d = await svc.getOrphan(req.params.id);
    if (!d) return res.status(404).type('html').send(views.notFound('শিশুর নথি পাওয়া যায়নি।'));
    render(res, views.orphanProfile(d), d.orphan.full_name);
  }));

  // দাতাকে পাঠানোর প্রগ্রেস রিপোর্ট — শুধু নিরাপদ প্রক্ষেপণ
  router.get('/s/:id/report', wrap(async (req, res) => {
    const data = await svc.sponsorReport(req.params.id);
    if (!data) return res.status(404).type('html').send(views.notFound('স্পনসরশিপ পাওয়া যায়নি।'));
    res.type('html').send(views.sponsorReportPrint({ data, org: opts.org || views.ORG }));
  }));

  // ---------------- API ----------------
  router.get('/api/meta', wrap(async (req, res) => {
    const [[ccs], [donors]] = await Promise.all([
      pool.query(`SELECT id, code, name_bn FROM cost_centers WHERE is_active=1 ORDER BY sort_order`),
      pool.query(
        `SELECT id, donor_code, name, mobile FROM donors
          WHERE is_active = 1 AND merged_into_id IS NULL ORDER BY name LIMIT 500`),
    ]);
    res.json({
      ok: true, costCenters: ccs, donors,
      overview: await svc.overview(), actor: getActor(req),
      orphanStatuses: Object.entries(OrphanService.ORPHAN_STATUS_BN)
        .map(([code, name]) => ({ code, name })),
      frequencies: Object.entries(OrphanService.FREQ_BN).map(([code, name]) => ({ code, name })),
    });
  }));

  router.get('/api/overview', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.overview()) })));

  router.get('/api/orphans', wrap(async (req, res) =>
    res.json({ ok: true, rows: await svc.searchOrphans(req.query) })));

  router.get('/api/orphans/:id', wrap(async (req, res) => {
    const d = await svc.getOrphan(req.params.id);
    if (!d) return res.status(404).json({ ok: false, errors: ['পাওয়া যায়নি।'] });
    res.json({ ok: true, ...d });
  }));

  router.post('/api/orphans', wrap(async (req, res) =>
    res.status(201).json({ ok: true, ...(await svc.createOrphan(req.body, getActor(req))) })));

  router.patch('/api/orphans/:id', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.updateOrphan(req.params.id, req.body, getActor(req))) })));

  router.post('/api/orphans/:id/verify', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.verifyOrphan(req.params.id, getActor(req))) })));

  router.post('/api/orphans/:id/reject', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.rejectOrphan(req.params.id, req.body.reason, getActor(req))) })));

  router.post('/api/orphans/:id/consent', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.setPhotoConsent(req.params.id, req.body, getActor(req))) })));

  router.post('/api/orphans/:id/documents', wrap(async (req, res) =>
    res.status(201).json({ ok: true, ...(await svc.addDocument(req.params.id, req.body, getActor(req))) })));

  router.post('/api/orphans/:id/visits', wrap(async (req, res) =>
    res.status(201).json({ ok: true, ...(await svc.logVisit(
      Object.assign({}, req.body, { orphan_id: req.params.id }), getActor(req))) })));

  router.post('/api/orphans/:id/reports', wrap(async (req, res) =>
    res.status(201).json({ ok: true, ...(await svc.createReport(
      Object.assign({}, req.body, { orphan_id: req.params.id }), getActor(req))) })));

  router.post('/api/progress-reports/:id/publish', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.publishReport(req.params.id, getActor(req))) })));

  router.get('/api/pool', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.unsponsoredPool()) })));

  // ---------------- স্পনসরশিপ ----------------
  router.get('/api/sponsorships', wrap(async (req, res) => {
    const where = [], args = [];
    if (req.query.status) { where.push('status = ?'); args.push(req.query.status); }
    if (req.query.donor_id) { where.push('donor_id = ?'); args.push(req.query.donor_id); }
    if (req.query.orphan_id) { where.push('orphan_id = ?'); args.push(req.query.orphan_id); }
    const [rows] = await pool.query(
      `SELECT * FROM v_sponsorship_status
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY FIELD(status,'active','paused','ended'), start_date DESC`, args);
    res.json({ ok: true, rows });
  }));

  router.post('/api/sponsorships', wrap(async (req, res) =>
    res.status(201).json({ ok: true, ...(await svc.createSponsorship(req.body, getActor(req))) })));

  router.post('/api/sponsorships/:id/end', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.endSponsorship(req.params.id, req.body.reason, getActor(req))) })));

  router.post('/api/sponsorships/:id/status', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.setSponsorshipStatus(
      req.params.id, req.body.status, getActor(req))) })));

  router.post('/api/sponsorships/:id/contact', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.setDirectContact(
      req.params.id, !!req.body.allow, req.body.note, getActor(req))) })));

  /** দাতা-দৃশ্যমান JSON — হোয়াইটলিস্ট প্রক্ষেপণ, ব্যক্তিগত তথ্য থাকে না */
  router.get('/api/sponsorships/:id/report', wrap(async (req, res) => {
    const d = await svc.sponsorReport(req.params.id);
    if (!d) return res.status(404).json({ ok: false, errors: ['পাওয়া যায়নি।'] });
    res.json({ ok: true, ...d });
  }));

  router.get('/api/donors/:id/sponsorships', wrap(async (req, res) =>
    res.json({ ok: true, rows: await svc.donorSponsorships(req.params.id) })));

  router.get('/api/reports/due', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.reportsDue(req.query.date)) })));

  router.get('/api/payments/due', wrap(async (req, res) =>
    res.json({ ok: true, ...(await svc.paymentsDue(req.query.date)) })));

  return router;
};

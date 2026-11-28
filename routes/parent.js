'use strict';
/**
 * Guardian portal (/parent) — public site, its own sign-in.
 *
 *   GET  /parent/login, POST /parent/login   mobile number + 6-digit PIN
 *   GET  /parent                             the guardian's children
 *   GET  /parent/child/:id                   attendance, results, Hifz, fees
 *   GET  /parent/logout
 *
 * A guardian sees only active students whose guardian phone is the number
 * they signed in with; every child page checks that again. Results show only
 * for exams the office has published. Nothing here can change any data.
 */
const express = require('express');
const db = require('../config/db');
const h = require('../lib/helpers');
const g = require('../lib/guardians');
const { logLogin } = require('../lib/activity-log');
const { buildMarksheet } = require('../lib/results');

const router = express.Router();

// Per-address brake on top of the per-number lock: 20 failures in 15 minutes.
const ipFails = new Map();
function ipBlocked(ip) {
  const e = ipFails.get(ip);
  if (!e) return false;
  if (Date.now() - e.first > 15 * 60e3) { ipFails.delete(ip); return false; }
  return e.count >= 20;
}
function ipFail(ip) {
  const e = ipFails.get(ip);
  if (!e || Date.now() - e.first > 15 * 60e3) ipFails.set(ip, { first: Date.now(), count: 1 });
  else e.count++;
  if (ipFails.size > 5000) ipFails.clear();
}

router.use((req, res, next) => {
  res.locals.layout = 'layouts/portal';
  res.locals.parent = req.session.parent || null;
  next();
});

function requireParent(req, res, next) {
  if (req.session.parent && req.session.parent.phone) return next();
  return res.redirect('/parent/login');
}

/* --------------------------------------------------------------- sign in */
router.get('/login', (req, res) => {
  if (req.session.parent) return res.redirect('/parent');
  res.render('parent/login', { title: res.locals.t('portal.title'), phone: '' });
});

router.post('/login', async (req, res, next) => {
  try {
    const phone = g.normalizePhone(req.body.phone);
    const pin = String(req.body.pin || '').replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c))).trim();
    const fail = (key) => {
      req.flash('error', key);
      return res.redirect('/parent/login');
    };
    if (ipBlocked(req.ip)) return fail('portal.err.locked');
    if (!phone || !pin) return fail('portal.err.enter_both');

    const r = await g.verify(phone, pin);
    if (!r.ok) {
      ipFail(req.ip);
      logLogin(req, { event: 'failed', username: 'guardian:' + phone, reason: r.reason === 'unknown' ? 'unknown_user' : (r.reason === 'locked' ? 'locked' : 'wrong_password') });
      return fail(r.reason === 'locked' ? 'portal.err.locked' : 'portal.err.invalid');
    }
    const children = await g.childrenOf(phone);
    if (!children.length) return fail('portal.err.no_children');

    // New session id at sign-in, keeping the chosen language.
    const lang = req.session.lang;
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.lang = lang;
      req.session.parent = { phone };
      logLogin(req, { event: 'login', username: 'guardian:' + phone });
      req.session.save(() => res.redirect('/parent'));
    });
  } catch (err) { next(err); }
});

router.get('/logout', (req, res) => {
  const p = req.session.parent;
  if (p) logLogin(req, { event: 'logout', username: 'guardian:' + p.phone });
  delete req.session.parent;
  res.redirect('/parent/login');
});

/* ----------------------------------------------------------------- home */
router.get('/', requireParent, async (req, res, next) => {
  try {
    const children = await g.childrenOf(req.session.parent.phone);
    if (!children.length) { delete req.session.parent; return res.redirect('/parent/login'); }
    const period = h.currentPeriod();
    for (const c of children) {
      const [att, due] = await Promise.all([
        db.one(`SELECT COUNT(*) AS total, SUM(status IN ('present','late')) AS present FROM attendance
                 WHERE student_id = ? AND DATE_FORMAT(adate, '%Y-%m') = ?`, [c.id, period]),
        db.scalar(`SELECT COALESCE(SUM(total_amount - discount - paid_amount),0) AS c FROM fee_invoices
                    WHERE student_id = ? AND status <> 'paid'`, [c.id])
      ]);
      c.attPct = att && Number(att.total) ? Math.round((Number(att.present) / Number(att.total)) * 100) : null;
      c.due = Number(due);
    }
    const notices = await db.query(
      `SELECT title, slug, published_at, created_at FROM notices WHERE is_published = 1
        ORDER BY COALESCE(published_at, DATE(created_at)) DESC, id DESC LIMIT 4`);
    res.render('parent/home', { title: res.locals.t('portal.title'), children, notices });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------- child */
router.get('/child/:id', requireParent, async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const children = await g.childrenOf(req.session.parent.phone);
    const child = children.find((c) => c.id === id);
    if (!child) return res.redirect('/parent');

    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : h.currentPeriod();
    const [y, m] = month.split('-').map(Number);
    const prev = new Date(y, m - 2, 1), next_ = new Date(y, m, 1);
    const fmtP = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    const [attRows, overall, invoices, payments, exams, hifz] = await Promise.all([
      db.query(`SELECT DAY(adate) AS d, status FROM attendance WHERE student_id = ? AND DATE_FORMAT(adate, '%Y-%m') = ?`, [id, month]),
      db.one(`SELECT COUNT(*) AS total, SUM(status IN ('present','late')) AS present, SUM(status = 'absent') AS absent
                FROM attendance WHERE student_id = ?`, [id]),
      db.query(`SELECT invoice_no, period, total_amount, discount, paid_amount, status FROM fee_invoices
                 WHERE student_id = ? ORDER BY period DESC LIMIT 12`, [id]),
      db.query('SELECT receipt_no, amount, paid_on FROM fee_payments WHERE student_id = ? ORDER BY paid_on DESC, id DESC LIMIT 6', [id]),
      db.query(`SELECT DISTINCT e.id, e.name FROM exams e JOIN exam_marks mk ON mk.exam_id = e.id AND mk.student_id = ?
                 WHERE e.is_published = 1 ORDER BY e.id DESC LIMIT 5`, [id]),
      db.query(`SELECT pdate, sabak_surah, sabak_from, sabak_to, sabak_lines, sabqi_para, manzil_para, rating, remarks
                  FROM hifz_progress WHERE student_id = ? ORDER BY pdate DESC LIMIT 15`, [id])
    ]);

    const days = new Date(y, m, 0).getDate();
    const firstDow = new Date(y, m - 1, 1).getDay();
    const att = {};
    attRows.forEach((r) => { att[r.d] = r.status; });
    const counts = { present: 0, absent: 0, late: 0, leave: 0 };
    attRows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });

    const results = [];
    for (const e of exams) {
      const sheet = await buildMarksheet(e.id, id);
      if (sheet) results.push({ exam: e, sheet });
    }
    const due = invoices.reduce((s, i) => s + (i.status === 'paid' ? 0 : Number(i.total_amount) - Number(i.discount) - Number(i.paid_amount)), 0);

    res.render('parent/child', {
      title: child.name, child, children, month, prevMonth: fmtP(prev), nextMonth: month < h.currentPeriod() ? fmtP(next_) : null,
      cal: { days, firstDow, att, counts }, overall: overall || {}, invoices, payments, due, results, hifz
    });
  } catch (err) { next(err); }
});

module.exports = router;

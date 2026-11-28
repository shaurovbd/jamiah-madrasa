'use strict';
/**
 * SMS → guardians and staff (/admin/sms).
 *
 *   GET  /              write a message and pick who gets it
 *   POST /preview       count the recipients and show sample messages
 *   POST /send          queue it (recipients are rebuilt, never taken from the preview)
 *   GET  /history       every batch; /history/:id the messages in one
 *   GET  /settings      gateway, key, automatic absence SMS   (admin only)
 *   POST /settings, POST /settings/test
 *
 * Messages can carry {name} {class} {roll} {school} {date}, plus {due} for
 * the dues audience and {exam} {total} {gpa} {grade} {position} {result} for
 * exam results. Each guardian gets their own child's values.
 */
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');
const sms = require('../../lib/sms');
const settingsLib = require('../../lib/settings');
const roles = require('../../lib/roles');
const { buildMarksheet, classRanking } = require('../../lib/results');

const router = express.Router();

const AUDIENCES = ['all', 'department', 'class', 'section', 'dues', 'result', 'staff', 'custom'];

function tabs(user) {
  const t = [['/admin/sms', 'a.sms.tab.send'], ['/admin/sms/history', 'a.sms.tab.history']];
  if (roles.can(user.role, 'sms_config')) t.push(['/admin/sms/settings', 'a.sms.tab.settings']);
  return t;
}

function onlyConfig(req, res, next) {
  if (roles.can(req.session.user.role, 'sms_config')) return next();
  res.status(403);
  return res.render('admin/forbidden', { title: res.locals.t('error.forbidden.title'), needed: [] });
}

async function lookups() {
  const [departments, classes, sections, exams] = await Promise.all([
    db.query('SELECT id, name FROM departments ORDER BY sort_order, id'),
    db.query('SELECT id, name, department_id FROM classes ORDER BY department_id, level, id'),
    db.query('SELECT s.id, s.name, s.class_id, c.name AS class_name FROM sections s JOIN classes c ON c.id = s.class_id ORDER BY c.level, s.name'),
    db.query('SELECT id, name FROM exams ORDER BY id DESC LIMIT 30')
  ]);
  return { departments, classes, sections, exams };
}

function readForm(b) {
  return {
    audience: AUDIENCES.includes(b.audience) ? b.audience : 'all',
    department_id: h.toInt(b.department_id) || '',
    class_id: h.toInt(b.class_id) || '',
    section_id: h.toInt(b.section_id) || '',
    exam_id: h.toInt(b.exam_id) || '',
    min_due: Math.max(0, h.toNum(b.min_due, 1)),
    numbers: String(b.numbers || '').slice(0, 20000),
    message: String(b.message || '').slice(0, 1000),
    title: String(b.title || '').trim().slice(0, 190)
  };
}

/**
 * Who gets the message, each with their own text.
 * -> { recipients: [{ phone, name, message, student_id|staff_id }], missingPhone }
 */
async function buildRecipients(f, lang) {
  const settings = await settingsLib.all();
  const school = settings.site_short || settings.site_name || '';
  const date = h.fmtDate(h.today(), lang);
  const base = { school, date };
  const studentSql = `SELECT s.id, s.name, s.roll_no, s.guardian_phone, c.name AS class_name
                        FROM students s LEFT JOIN classes c ON c.id = s.class_id
                       WHERE s.status = 'active'`;
  let rows = [];
  let extra = {};

  switch (f.audience) {
    case 'all': rows = await db.query(studentSql); break;
    case 'department': rows = await db.query(`${studentSql} AND s.department_id = ?`, [f.department_id || 0]); break;
    case 'class': rows = await db.query(`${studentSql} AND s.class_id = ?`, [f.class_id || 0]); break;
    case 'section': rows = await db.query(`${studentSql} AND s.section_id = ?`, [f.section_id || 0]); break;
    case 'dues': {
      rows = await db.query(
        `SELECT s.id, s.name, s.roll_no, s.guardian_phone, c.name AS class_name,
                SUM(i.total_amount - i.discount - i.paid_amount) AS due
           FROM students s
           JOIN fee_invoices i ON i.student_id = s.id AND i.status <> 'paid'
           LEFT JOIN classes c ON c.id = s.class_id
          WHERE s.status = 'active'
          GROUP BY s.id, s.name, s.roll_no, s.guardian_phone, c.name
         HAVING due >= ?`, [f.min_due || 1]);
      rows.forEach((r) => { extra[r.id] = { due: h.money(r.due, settings.currency_symbol || 'Tk') }; });
      break;
    }
    case 'result': {
      if (!f.exam_id || !f.class_id) break;
      const exam = await db.one('SELECT name FROM exams WHERE id = ?', [f.exam_id]);
      const ranking = await classRanking(f.exam_id, f.class_id);
      const ids = ranking.map((r) => r.student_id);
      if (!ids.length) break;
      rows = await db.query(`${studentSql} AND s.id IN (${ids.map(() => '?').join(',')})`, ids);
      for (const r of ranking) {
        const sheet = await buildMarksheet(f.exam_id, r.student_id);
        const sum = sheet ? sheet.summary : {};
        extra[r.student_id] = {
          exam: exam ? exam.name : '',
          total: `${r.total}/${r.full}`,
          gpa: sum.gpa !== undefined ? sum.gpa : '',
          grade: sum.grade || '',
          position: r.position,
          result: i18n.t(r.failed ? 'a.sms.failed' : 'a.sms.passed', lang)
        };
      }
      break;
    }
    case 'staff': {
      const staff = await db.query("SELECT id, name, phone, designation FROM staff WHERE status = 'active'");
      return {
        recipients: staff.map((s) => ({ phone: s.phone, name: s.name, staff_id: s.id,
          message: sms.fill(f.message, { ...base, name: s.name, class: s.designation || '', roll: '' }) })),
        missingPhone: staff.filter((s) => !sms.normalizePhone(s.phone)).length
      };
    }
    case 'custom': {
      const nums = f.numbers.split(/[\s,;]+/).filter(Boolean);
      return {
        recipients: nums.map((n) => ({ phone: n, message: sms.fill(f.message, { ...base, name: '', class: '', roll: '' }) })),
        missingPhone: nums.filter((n) => !sms.normalizePhone(n)).length
      };
    }
    default: break;
  }

  return {
    recipients: rows.map((s) => ({
      phone: s.guardian_phone, name: s.name, student_id: s.id,
      message: sms.fill(f.message, { ...base, name: s.name, class: s.class_name || '', roll: s.roll_no || '', ...(extra[s.id] || {}) })
    })),
    missingPhone: rows.filter((s) => !sms.normalizePhone(s.guardian_phone)).length
  };
}

/* ---------------------------------------------------------------- write */
router.get('/', async (req, res, next) => {
  try {
    const cfg = await sms.config();
    res.render('admin/sms/compose', {
      title: res.locals.t('admin.nav.sms'), TABS: tabs(req.session.user), cfg,
      form: readForm(req.query), AUDIENCES, ...(await lookups())
    });
  } catch (err) { next(err); }
});

router.post('/preview', async (req, res, next) => {
  try {
    const f = readForm(req.body);
    if (!f.message.trim()) { req.flash('error', 'f.sms.message_required'); return res.redirect('/admin/sms'); }
    const { recipients, missingPhone } = await buildRecipients(f, res.locals.lang);
    const valid = recipients.filter((r) => sms.normalizePhone(r.phone));
    const totalParts = valid.reduce((n, r) => n + sms.parts(r.message).parts, 0);
    res.render('admin/sms/preview', {
      title: res.locals.t('admin.nav.sms'), TABS: tabs(req.session.user), cfg: await sms.config(),
      form: f, count: valid.length, missingPhone, totalParts, samples: valid.slice(0, 3)
    });
  } catch (err) { next(err); }
});

router.post('/send', async (req, res, next) => {
  try {
    const f = readForm(req.body);
    if (!f.message.trim()) { req.flash('error', 'f.sms.message_required'); return res.redirect('/admin/sms'); }
    const { recipients } = await buildRecipients(f, res.locals.lang);
    const title = f.title || res.locals.t('a.sms.aud.' + f.audience);
    const r = await sms.queue({ kind: f.audience, title, recipients, userId: req.session.user.id });
    if (!r.batchId) { req.flash('error', 'f.sms.no_recipients'); return res.redirect('/admin/sms'); }
    req.flash('success', i18n.pack('f.sms.queued', { count: r.queued }));
    res.redirect(`/admin/sms/history/${r.batchId}`);
  } catch (err) { next(err); }
});

/* -------------------------------------------------------------- history */
router.get('/history', async (req, res, next) => {
  try {
    const total = await db.scalar('SELECT COUNT(*) AS c FROM sms_batches');
    const p = h.paginate(total, req.query.page, 30);
    const [batches, month] = await Promise.all([
      db.query(`SELECT b.*, u.name AS user_name FROM sms_batches b LEFT JOIN users u ON u.id = b.created_by
                 ORDER BY b.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`),
      db.one(`SELECT COUNT(*) AS msgs, COALESCE(SUM(parts),0) AS parts FROM sms_logs
               WHERE status = 'sent' AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`)
    ]);
    res.render('admin/sms/history', {
      title: res.locals.t('admin.nav.sms'), TABS: tabs(req.session.user), batches, p, month: month || {}, batch: null
    });
  } catch (err) { next(err); }
});

router.get('/history/:id', async (req, res, next) => {
  try {
    const batch = await db.one(
      'SELECT b.*, u.name AS user_name FROM sms_batches b LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ?',
      [h.toInt(req.params.id)]);
    if (!batch) return next();
    const logs = await db.query('SELECT * FROM sms_logs WHERE batch_id = ? ORDER BY id LIMIT 2000', [batch.id]);
    const counts = { queued: 0, sent: 0, failed: 0, test: 0 };
    logs.forEach((l) => { counts[l.status] = (counts[l.status] || 0) + 1; });
    res.render('admin/sms/history', {
      title: res.locals.t('admin.nav.sms'), TABS: tabs(req.session.user), batch, logs, counts, batches: [], p: null, month: {}
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- settings */
router.get('/settings', onlyConfig, async (req, res, next) => {
  try {
    const cfg = await sms.config();
    res.render('admin/sms/settings', {
      title: res.locals.t('admin.nav.sms'), TABS: tabs(req.session.user), cfg,
      PROVIDERS: sms.PROVIDERS, keyFromEnv: Boolean(process.env.SMS_API_KEY),
      hasKey: Boolean(cfg.apiKey), defaultTemplate: sms.DEFAULT_ABSENT_TEMPLATE
    });
  } catch (err) { next(err); }
});

router.post('/settings', onlyConfig, async (req, res, next) => {
  try {
    const b = req.body;
    const update = {
      sms_provider: sms.PROVIDERS.includes(b.sms_provider) ? b.sms_provider : 'test',
      sms_sender_id: String(b.sms_sender_id || '').trim().slice(0, 40),
      sms_custom_url: String(b.sms_custom_url || '').trim().slice(0, 1000),
      sms_absent_auto: b.sms_absent_auto ? '1' : '0',
      sms_absent_template: String(b.sms_absent_template || '').trim().slice(0, 600) || sms.DEFAULT_ABSENT_TEMPLATE
    };
    // The key is never shown back; an empty box keeps the one already saved.
    const key = String(b.sms_api_key || '').trim();
    if (key) update.sms_api_key = key.slice(0, 300);
    if (b.clear_key) update.sms_api_key = '';
    await settingsLib.setMany(update);
    req.flash('success', 'common.saved');
    res.redirect('/admin/sms/settings');
  } catch (err) { next(err); }
});

router.post('/settings/test', onlyConfig, async (req, res, next) => {
  try {
    const phone = sms.normalizePhone(req.body.test_number);
    if (!phone) { req.flash('error', 'f.sms.bad_number'); return res.redirect('/admin/sms/settings'); }
    const cfg = await sms.config();
    const text = res.locals.t('a.sms.test_text', { school: cfg.school });
    const r = await sms.queue({ kind: 'test', title: res.locals.t('a.sms.test_title'),
      recipients: [{ phone, message: text }], userId: req.session.user.id });
    req.flash('success', i18n.pack('f.sms.queued', { count: r.queued }));
    res.redirect(`/admin/sms/history/${r.batchId}`);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.buildRecipients = buildRecipients;

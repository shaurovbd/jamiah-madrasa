'use strict';
const express = require('express');
const db = require('../config/db');
const h = require('../lib/helpers');
const { buildMarksheet } = require('../lib/results');
const statsLib = require('../lib/stats');

const router = express.Router();

/* ------------------------------------------------------------------ home */
router.get('/', async (req, res, next) => {
  try {
    const [departments, notices, events, siteStats] = await Promise.all([
      db.query('SELECT * FROM departments ORDER BY sort_order, id LIMIT 6'),
      db.query(`SELECT title, slug, category, body, published_at, created_at FROM notices
                 WHERE is_published = 1 ORDER BY COALESCE(published_at, DATE(created_at)) DESC, id DESC LIMIT 5`),
      db.query(`SELECT title, slug, event_date, location FROM events
                 WHERE is_published = 1 AND event_date >= CURDATE() ORDER BY event_date ASC LIMIT 3`),
      // Numbers typed in Settings win; a box left empty is counted from the records.
      statsLib.forHome(res.locals.settings)
    ]);
    res.render('public/home', {
      title: '', metaDescription: res.locals.settings.about_intro || '',
      departments, notices, events, siteStats
    });
  } catch (err) { next(err); }
});

/* ----------------------------------------------------------------- about */
router.get('/about', async (req, res, next) => {
  try {
    const [about, mission, facilities, leaders] = await Promise.all([
      db.one("SELECT * FROM pages WHERE slug = 'about' AND is_published = 1"),
      db.one("SELECT * FROM pages WHERE slug = 'mission' AND is_published = 1"),
      db.one("SELECT * FROM pages WHERE slug = 'facilities' AND is_published = 1"),
      db.query("SELECT name, designation, qualification, photo FROM staff WHERE status = 'active' ORDER BY id LIMIT 6")
    ]);
    res.render('public/about', { title: 'About Us', about, mission, facilities, leaders });
  } catch (err) { next(err); }
});

/* ----------------------------------------------------------- departments */
router.get('/departments', async (req, res, next) => {
  try {
    const departments = await db.query('SELECT * FROM departments ORDER BY sort_order, id');
    for (const d of departments) {
      d.classes = await db.query('SELECT name FROM classes WHERE department_id = ? ORDER BY level, id', [d.id]);
      d.student_count = await db.scalar(
        "SELECT COUNT(*) AS c FROM students WHERE department_id = ? AND status = 'active'", [d.id]
      );
    }
    res.render('public/departments', { title: 'Departments', departments });
  } catch (err) { next(err); }
});

router.get('/departments/:slug', async (req, res, next) => {
  try {
    const dept = await db.one('SELECT * FROM departments WHERE slug = ?', [req.params.slug]);
    if (!dept) return next();
    const classes = await db.query('SELECT * FROM classes WHERE department_id = ? ORDER BY level, id', [dept.id]);
    for (const c of classes) {
      c.subjects = await db.query('SELECT name FROM subjects WHERE class_id = ? ORDER BY sort_order, id', [c.id]);
    }
    const teachers = await db.query(
      "SELECT name, designation, qualification FROM staff WHERE department_id = ? AND status = 'active' ORDER BY id", [dept.id]
    );
    res.render('public/department', { title: dept.name, dept, classes, teachers });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- notices */
router.get('/notices', async (req, res, next) => {
  try {
    const total = await db.scalar('SELECT COUNT(*) AS c FROM notices WHERE is_published = 1');
    const p = h.paginate(total, req.query.page, 10);
    const notices = await db.query(
      `SELECT title, slug, category, body, published_at, created_at FROM notices
        WHERE is_published = 1 ORDER BY COALESCE(published_at, DATE(created_at)) DESC, id DESC
        LIMIT ${p.perPage} OFFSET ${p.offset}`
    );
    res.render('public/notices', { title: 'Notices', notices, p });
  } catch (err) { next(err); }
});

router.get('/notices/:slug', async (req, res, next) => {
  try {
    const notice = await db.one('SELECT * FROM notices WHERE slug = ? AND is_published = 1', [req.params.slug]);
    if (!notice) return next();
    const others = await db.query(
      'SELECT title, slug FROM notices WHERE is_published = 1 AND slug <> ? ORDER BY id DESC LIMIT 5', [req.params.slug]
    );
    res.render('public/notice', { title: notice.title, notice, others });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------- events */
router.get('/events', async (req, res, next) => {
  try {
    const upcoming = await db.query(
      'SELECT * FROM events WHERE is_published = 1 AND event_date >= CURDATE() ORDER BY event_date ASC'
    );
    const past = await db.query(
      'SELECT * FROM events WHERE is_published = 1 AND event_date < CURDATE() ORDER BY event_date DESC LIMIT 12'
    );
    res.render('public/events', { title: 'Events', upcoming, past });
  } catch (err) { next(err); }
});

router.get('/events/:slug', async (req, res, next) => {
  try {
    const ev = await db.one('SELECT * FROM events WHERE slug = ? AND is_published = 1', [req.params.slug]);
    if (!ev) return next();
    res.render('public/event', { title: ev.title, ev });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- gallery */
router.get('/gallery', async (req, res, next) => {
  try {
    const images = await db.query('SELECT * FROM gallery ORDER BY sort_order, id DESC');
    const albums = [...new Set(images.map((i) => i.album || 'Campus'))];
    res.render('public/gallery', { title: 'Gallery', images, albums });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- admission */
router.get('/admission', async (req, res, next) => {
  try {
    const departments = await db.query('SELECT * FROM departments ORDER BY sort_order, id');
    const classes = await db.query('SELECT id, name, department_id FROM classes ORDER BY department_id, level');
    const feeHeads = await db.query("SELECT name, ftype, amount FROM fee_heads WHERE is_active = 1 ORDER BY ftype, id");
    res.render('public/admission', { title: 'Admission', departments, classes, feeHeads, submitted: null, form: {} });
  } catch (err) { next(err); }
});

router.post('/admission', async (req, res, next) => {
  try {
    const b = req.body;
    const name = String(b.name || '').trim();
    const phone = String(b.guardian_phone || '').trim();
    const departments = await db.query('SELECT * FROM departments ORDER BY sort_order, id');
    const classes = await db.query('SELECT id, name, department_id FROM classes ORDER BY department_id, level');
    const feeHeads = await db.query("SELECT name, ftype, amount FROM fee_heads WHERE is_active = 1 ORDER BY ftype, id");

    if (!name || !phone) {
      req.flash('error', 'Applicant name and guardian phone number are required.');
      return res.render('public/admission', {
        title: 'Admission', departments, classes, feeHeads, submitted: null, form: b,
        flash: { ...res.locals.flash, error: ['Applicant name and guardian phone number are required.'] }
      });
    }

    const last = await db.one('SELECT MAX(id) AS id FROM admissions');
    const applicationNo = h.nextNo('APP', last ? last.id : 0);

    await db.run(
      `INSERT INTO admissions
        (application_no, name, father_name, mother_name, guardian_phone, email, dob, gender,
         address, previous_institution, department_id, class_id, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [applicationNo, name, h.orNull(b.father_name), h.orNull(b.mother_name), phone, h.orNull(b.email),
       h.orNull(b.dob), b.gender === 'female' ? 'female' : 'male', h.orNull(b.address),
       h.orNull(b.previous_institution), h.toInt(b.department_id), h.toInt(b.class_id), h.orNull(b.note)]
    );

    res.render('public/admission', {
      title: 'Application received', departments, classes, feeHeads,
      submitted: { applicationNo, name }, form: {}
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- results */
router.get('/results', async (req, res, next) => {
  try {
    const exams = await db.query('SELECT id, name FROM exams WHERE is_published = 1 ORDER BY id DESC');
    const classes = await db.query('SELECT id, name FROM classes ORDER BY department_id, level');
    res.render('public/results', { title: 'Check Result', exams, classes, sheet: null, notFound: false, form: {} });
  } catch (err) { next(err); }
});

router.post('/results', async (req, res, next) => {
  try {
    const exams = await db.query('SELECT id, name FROM exams WHERE is_published = 1 ORDER BY id DESC');
    const classes = await db.query('SELECT id, name FROM classes ORDER BY department_id, level');
    const examId = h.toInt(req.body.exam_id);
    const classId = h.toInt(req.body.class_id);
    const roll = String(req.body.roll_no || '').trim();

    let sheet = null, notFound = false;
    if (examId && classId && roll) {
      const exam = await db.one('SELECT id FROM exams WHERE id = ? AND is_published = 1', [examId]);
      const student = await db.one(
        'SELECT id FROM students WHERE roll_no = ? AND class_id = ? LIMIT 1', [roll, classId]
      );
      if (exam && student) sheet = await buildMarksheet(examId, student.id);
      notFound = !sheet;
    } else {
      notFound = true;
    }
    res.render('public/results', {
      title: 'Check Result', exams, classes, sheet, notFound, form: req.body
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- contact */
router.get('/contact', (req, res) => {
  res.render('public/contact', { title: 'Contact Us', sent: false, form: {} });
});

router.post('/contact', async (req, res, next) => {
  try {
    const b = req.body;
    const name = String(b.name || '').trim();
    const message = String(b.message || '').trim();
    if (!name || !message) {
      return res.render('public/contact', {
        title: 'Contact Us', sent: false, form: b,
        flash: { ...res.locals.flash, error: ['Please give your name and a message.'] }
      });
    }
    await db.run(
      'INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?,?,?,?,?)',
      [name, h.orNull(b.email), h.orNull(b.phone), h.orNull(b.subject), message]
    );
    res.render('public/contact', { title: 'Contact Us', sent: true, form: {} });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------ cms pages */
router.get('/page/:slug', async (req, res, next) => {
  try {
    const page = await db.one('SELECT * FROM pages WHERE slug = ? AND is_published = 1', [req.params.slug]);
    if (!page) return next();
    res.render('public/page', { title: page.title, page });
  } catch (err) { next(err); }
});

module.exports = router;

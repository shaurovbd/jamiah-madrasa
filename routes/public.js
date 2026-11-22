'use strict';
const express = require('express');
const db = require('../config/db');
const h = require('../lib/helpers');
const { buildMarksheet } = require('../lib/results');
const af = require('../lib/admission-form');

const mailer = require('../lib/mailer');
const routineLib = require('../lib/routine');

const router = express.Router();

/* ------------------------------------------------------------------ home */
router.get('/', async (req, res, next) => {
  try {
    const [departments, notices, events, studentCount, staffCount, huffaz] = await Promise.all([
      db.query('SELECT * FROM departments ORDER BY sort_order, id LIMIT 6'),
      db.query(`SELECT title, slug, category, body, published_at, created_at FROM notices
                 WHERE is_published = 1 ORDER BY COALESCE(published_at, DATE(created_at)) DESC, id DESC LIMIT 5`),
      db.query(`SELECT title, slug, event_date, location FROM events
                 WHERE is_published = 1 AND event_date >= CURDATE() ORDER BY event_date ASC LIMIT 3`),
      db.scalar("SELECT COUNT(*) AS c FROM students WHERE status = 'active'"),
      db.scalar("SELECT COUNT(*) AS c FROM staff WHERE status = 'active'"),
      db.scalar('SELECT COALESCE(SUM(hifz_para_completed >= 30), 0) AS c FROM students')
    ]);
    res.render('public/home', {
      title: '', metaDescription: res.locals.settings.about_intro || '',
      departments, notices, events,
      stats: { students: studentCount, staff: staffCount, huffaz, years: Math.max(1, new Date().getFullYear() - Number(res.locals.settings.established || new Date().getFullYear())) }
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
    res.render('public/about', { title: res.locals.t('about.title'), about, mission, facilities, leaders });
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
    res.render('public/departments', { title: res.locals.t('nav.departments'), departments });
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
    res.render('public/notices', { title: res.locals.t('nav.notices'), notices, p });
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
    res.render('public/events', { title: res.locals.t('nav.events'), upcoming, past });
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
    res.render('public/gallery', { title: res.locals.t('nav.gallery'), images, albums });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- admission */
/** Looks up the departments row a department card points at, if any. */
async function resolveDepartmentId(key) {
  const card = af.DEPARTMENTS.find((d) => d.key === key);
  if (!card || !card.deptSlug) return null;
  const row = await db.one('SELECT id FROM departments WHERE slug = ?', [card.deptSlug]);
  return row ? row.id : null;
}

function admissionPageData(extra, t) {
  return Object.assign({
    title: t ? t('admission.form_title') : 'ভর্তি আবেদন ফরম',
    af,
    submitted: null,
    errors: [],
    form: {}
  }, extra);
}

router.get('/admission', async (req, res, next) => {
  try {
    const feeHeads = await db.query("SELECT name, ftype, amount FROM fee_heads WHERE is_active = 1 ORDER BY ftype, id");
    res.render('public/admission', admissionPageData({ feeHeads }, res.locals.t));
  } catch (err) { next(err); }
});

router.post('/admission', async (req, res, next) => {
  try {
    const b = req.body || {};

    /* Spam trap: the hidden "website" field is invisible to people and
       irresistible to bots. Pretend it worked, save nothing. */
    if (String(b.website || '').trim()) {
      return res.render('public/admission', admissionPageData({
        feeHeads: [],
        title: res.locals.t('admission.received_title'),
        submitted: { applicationNo: '—', name: String(b.full_name_bn || '').trim() }
      }, res.locals.t));
    }

    const errors = af.validate(b);
    if (errors.length) {
      const feeHeads = await db.query("SELECT name, ftype, amount FROM fee_heads WHERE is_active = 1 ORDER BY ftype, id");
      return res.status(422).render('public/admission', admissionPageData({ feeHeads, errors, form: b }, res.locals.t));
    }

    const name = String(b.full_name_bn).trim();
    const phone = String(b.guardian_mobile || b.father_mobile || '').trim();
    const gender = ['male', 'female', 'other'].includes(b.gender) ? b.gender : 'male';
    const departmentId = await resolveDepartmentId(b.department);

    const last = await db.one('SELECT MAX(id) AS id FROM admissions');
    const applicationNo = h.nextNo('APP', last ? last.id : 0);

    await db.run(
      `INSERT INTO admissions
        (application_no, name, name_en,
         father_name, father_mobile, father_profession, father_income,
         mother_name, mother_mobile,
         guardian_phone, guardian_name, guardian_relation, guardian_address,
         email, dob, nationality, student_mobile, gender,
         address, present_house, present_moholla, present_thana, present_district,
         permanent_village, permanent_post, permanent_thana, permanent_district,
         previous_institution, prev_class, target_class,
         department_id, department_key, campus)
       VALUES (?,?,?, ?,?,?,?, ?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?)`,
      [
        applicationNo, name, h.orNull(b.full_name_en),
        h.orNull(b.father_name), h.orNull(b.father_mobile), h.orNull(b.father_profession), h.orNull(b.father_income),
        h.orNull(b.mother_name), h.orNull(b.mother_mobile),
        phone, h.orNull(b.guardian_name), h.orNull(b.guardian_relation), h.orNull(b.guardian_address),
        h.orNull(b.email), h.orNull(b.dob), h.orNull(b.nationality), h.orNull(b.student_mobile), gender,
        af.presentAddress(b), h.orNull(b.present_house), h.orNull(b.present_moholla),
        h.orNull(b.present_thana), h.orNull(b.present_district),
        h.orNull(b.permanent_village), h.orNull(b.permanent_post),
        h.orNull(b.permanent_thana), h.orNull(b.permanent_district),
        h.orNull(b.prev_inst_name), h.orNull(b.prev_class), h.orNull(b.target_class),
        departmentId, h.orNull(b.department), h.orNull(b.campus)
      ]
    );

    /* Tell the admission office a new application arrived. Fire-and-forget:
       a mail problem must never block the applicant's confirmation page. */
    mailer.notifyNewApplication({
      applicationNo: applicationNo,
      name: name,
      nameEn: b.full_name_en,
      fatherName: b.father_name,
      phone: phone,
      email: b.email,
      targetClass: b.target_class,
      department: b.department,
      campus: b.campus
    }).catch(function () {});

    const feeHeads = await db.query("SELECT name, ftype, amount FROM fee_heads WHERE is_active = 1 ORDER BY ftype, id");
    res.render('public/admission', admissionPageData({
      feeHeads,
      title: res.locals.t('admission.received_title'),
      submitted: { applicationNo, name }
    }, res.locals.t));
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- results */
router.get('/results', async (req, res, next) => {
  try {
    const exams = await db.query('SELECT id, name FROM exams WHERE is_published = 1 ORDER BY id DESC');
    const classes = await db.query('SELECT id, name FROM classes ORDER BY department_id, level');
    res.render('public/results', { title: res.locals.t('results.title'), exams, classes, sheet: null, notFound: false, form: {} });
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
      title: res.locals.t('results.title'), exams, classes, sheet, notFound, form: req.body
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- contact */
router.get('/contact', (req, res) => {
  res.render('public/contact', { title: res.locals.t('contact.title'), sent: false, form: {} });
});

router.post('/contact', async (req, res, next) => {
  try {
    const b = req.body;
    const name = String(b.name || '').trim();
    const message = String(b.message || '').trim();
    if (!name || !message) {
      return res.render('public/contact', {
        title: res.locals.t('contact.title'), sent: false, form: b,
        flash: { ...res.locals.flash, error: ['contact.need_name_message'] }
      });
    }
    await db.run(
      'INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?,?,?,?,?)',
      [name, h.orNull(b.email), h.orNull(b.phone), h.orNull(b.subject), message]
    );
    res.render('public/contact', { title: res.locals.t('contact.title'), sent: true, form: {} });
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


/* ------------------------------------------------------------- routine */
router.get('/routine', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const sectionId = h.toInt(req.query.section_id) || null;

    const [classes, periods] = await Promise.all([
      db.query('SELECT c.id, c.name, d.name AS dept_name' +
               '  FROM classes c LEFT JOIN departments d ON d.id = c.department_id' +
               ' ORDER BY d.sort_order, c.level, c.name'),
      db.query('SELECT * FROM routine_periods ORDER BY sort_order, start_time, id')
    ]);

    const sections = classId
      ? await db.query('SELECT id, name FROM sections WHERE class_id = ? ORDER BY name', [classId])
      : [];

    const grid = {};
    let found = 0;
    let className = '';
    let sectionName = '';

    if (classId) {
      const cls = await db.one('SELECT name FROM classes WHERE id = ?', [classId]);
      className = cls ? cls.name : '';
      if (sectionId) {
        const sec = sections.find(function (s) { return s.id === sectionId; });
        sectionName = sec ? sec.name : '';
      }

      /* A routine saved for the whole class has section_id NULL; one saved per
         section has it set. Never mix the two, or the grid shows two classes
         stacked in the same cell. */
      const where = ['re.class_id = ?'];
      const params = [classId];
      if (sectionId) { where.push('re.section_id = ?'); params.push(sectionId); }
      else { where.push('re.section_id IS NULL'); }

      const rows = await db.query(
        'SELECT re.*, s.name AS subject_name, st.name AS teacher_name' +
        '  FROM routine_entries re' +
        '  LEFT JOIN subjects s ON s.id = re.subject_id' +
        '  LEFT JOIN staff st ON st.id = re.teacher_id' +
        ' WHERE ' + where.join(' AND '), params);

      rows.forEach(function (r) { grid[r.day_of_week + '_' + r.period_id] = r; });
      found = rows.length;
    }

    res.render('public/routine', {
      title: res.locals.t('routine.title'),
      DAYS: routineLib.DAYS,
      hhmm: routineLib.hhmm,
      classes: classes,
      sections: sections,
      periods: periods,
      classId: classId,
      sectionId: sectionId,
      className: className,
      sectionName: sectionName,
      grid: grid,
      found: found
    });
  } catch (err) { next(err); }
});

module.exports = router;

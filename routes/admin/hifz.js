'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');
const sc = require('../../lib/scope');

const router = express.Router();

const TABS = [
  ['/admin/hifz', 'a.tab.daily_entry'],
  ['/admin/hifz/overview', 'a.tab.progress_overview']
];

/* --------------------------------------------------------- daily entry */
router.get('/', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const date = String(req.query.date || h.today()).slice(0, 10);

    const scope = await sc.loadScope(req);
    let [classes, teachers] = await Promise.all([
      db.query(`SELECT c.id, c.name FROM classes c LEFT JOIN departments d ON d.id = c.department_id
                 ORDER BY d.sort_order, c.level`),
      db.query("SELECT id, name FROM staff WHERE status = 'active' ORDER BY name")
    ]);
    classes = sc.filterClasses(scope, classes);

    let students = [];
    if (classId) {
      students = await db.query(
        `SELECT s.id, s.name, s.roll_no, s.hifz_para_completed,
                p.sabak_surah, p.sabak_from, p.sabak_to, p.sabak_lines, p.sabqi_para, p.manzil_para, p.rating, p.teacher_id, p.remarks
           FROM students s
           LEFT JOIN hifz_progress p ON p.student_id = s.id AND p.pdate = ?
          WHERE s.class_id = ? AND s.status = 'active'
          ORDER BY s.roll_no + 0, s.name`,
        [date, classId]
      );
    }

    res.render('admin/hifz/daily', {
      title: res.locals.t('admin.nav.hifz'), TABS, classes, teachers, students,
      filters: { class_id: classId, date }
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const date = String(req.body.date || h.today()).slice(0, 10);
    const classId = h.toInt(req.body.class_id);
    const rows = req.body.row || {};
    const allowed = await sc.allowedStudentIds(await sc.loadScope(req), Object.keys(rows).map(h.idFromKey));
    const ids = Object.keys(rows).filter((k) => allowed.has(h.idFromKey(k)));
    let saved = 0;

    await db.transaction(async (conn) => {
      for (const sid of ids) {
        const studentId = h.idFromKey(sid);
        if (!studentId) continue;
        const r = rows[sid] || {};
        const hasContent = ['sabak_surah', 'sabak_from', 'sabak_to', 'sabqi_para', 'manzil_para', 'remarks']
          .some((k) => String(r[k] || '').trim() !== '') || h.toNum(r.sabak_lines, 0) > 0;
        if (!hasContent) {
          await conn.execute('DELETE FROM hifz_progress WHERE student_id = ? AND pdate = ?', [studentId, date]);
          continue;
        }
        await conn.execute(
          `INSERT INTO hifz_progress (student_id, pdate, sabak_surah, sabak_from, sabak_to, sabak_lines,
             sabqi_para, manzil_para, rating, teacher_id, remarks)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE sabak_surah=VALUES(sabak_surah), sabak_from=VALUES(sabak_from),
             sabak_to=VALUES(sabak_to), sabak_lines=VALUES(sabak_lines), sabqi_para=VALUES(sabqi_para),
             manzil_para=VALUES(manzil_para), rating=VALUES(rating), teacher_id=VALUES(teacher_id), remarks=VALUES(remarks)`,
          [studentId, date, h.orNull(r.sabak_surah), h.orNull(r.sabak_from), h.orNull(r.sabak_to),
           h.toNum(r.sabak_lines, 0), h.orNull(r.sabqi_para), h.orNull(r.manzil_para),
           ['excellent', 'good', 'average', 'weak'].includes(r.rating) ? r.rating : 'good',
           h.toInt(r.teacher_id), h.orNull(r.remarks)]
        );
        saved++;
      }
    });

    req.flash('success', i18n.pack('f.hifz.saved', { count: saved, date: h.fmtDate(date, res.locals.lang) }));
    res.redirect(`/admin/hifz?class_id=${classId || ''}&date=${date}`);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------ overview */
router.get('/overview', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const scope = await sc.loadScope(req);
    const classes = sc.filterClasses(scope, await db.query(`SELECT c.id, c.name FROM classes c LEFT JOIN departments d ON d.id = c.department_id
                                     ORDER BY d.sort_order, c.level`));
    const lim = sc.classSql(scope, 's');
    const where = (classId ? 'AND s.class_id = ?' : '') + lim.sql;
    const params = (classId ? [classId] : []).concat(lim.params);
    const students = await db.query(
      `SELECT s.id, s.name, s.roll_no, s.hifz_para_completed, c.name AS class_name,
              (SELECT COUNT(*) FROM hifz_progress p WHERE p.student_id = s.id) AS entries,
              (SELECT MAX(p.pdate) FROM hifz_progress p WHERE p.student_id = s.id) AS last_entry
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.status = 'active' ${where}
        ORDER BY s.hifz_para_completed DESC, s.name`, params
    );
    res.render('admin/hifz/overview', { title: res.locals.t('a.hifz.overview_title'), TABS, classes, students, filters: { class_id: classId } });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------ single student */
router.get('/student/:id', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    if (!(await sc.studentAllowed(await sc.loadScope(req), id))) return sc.deny(req, res);
    const student = await db.one(
      'SELECT s.*, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ?', [id]
    );
    if (!student) return next();
    const entries = await db.query(
      `SELECT p.*, st.name AS teacher_name FROM hifz_progress p
         LEFT JOIN staff st ON st.id = p.teacher_id
        WHERE p.student_id = ? ORDER BY p.pdate DESC LIMIT 120`, [id]
    );
    const summary = await db.one(
      `SELECT COUNT(*) AS days, COALESCE(SUM(sabak_lines),0) AS total_lines,
              SUM(rating='excellent') AS excellent, SUM(rating='weak') AS weak
         FROM hifz_progress WHERE student_id = ?`, [id]
    );
    res.render('admin/hifz/student', { title: res.locals.t('a.title.hifz_student', { name: student.name }), student, entries, summary: summary || {} });
  } catch (err) { next(err); }
});

router.post('/student/:id/para', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    if (!(await sc.studentAllowed(await sc.loadScope(req), id))) return sc.deny(req, res);
    let para = h.toNum(req.body.hifz_para_completed, 0);
    if (para < 0) para = 0;
    if (para > 30) para = 30;
    await db.run('UPDATE students SET hifz_para_completed = ? WHERE id = ?', [para, id]);
    req.flash('success', i18n.pack('f.hifz.progress_updated', { para: para }));
    res.redirect(`/admin/hifz/student/${id}`);
  } catch (err) { next(err); }
});

module.exports = router;

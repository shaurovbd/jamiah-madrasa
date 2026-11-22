'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const { buildMarksheet, classRanking } = require('../../lib/results');
const i18n = require('../../lib/i18n');

const router = express.Router();

/* ----------------------------------------------------------------- list */
router.get('/', async (req, res, next) => {
  try {
    const [exams, years] = await Promise.all([
      db.query(`SELECT e.*, y.name AS year_name,
                       (SELECT COUNT(DISTINCT student_id) FROM exam_marks m WHERE m.exam_id = e.id) AS student_count
                  FROM exams e LEFT JOIN academic_years y ON y.id = e.academic_year_id
                 ORDER BY e.id DESC`),
      db.query('SELECT id, name, is_current FROM academic_years ORDER BY name DESC')
    ]);
    const edit = h.toInt(req.query.edit) ? await db.one('SELECT * FROM exams WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/exams/list', { title: res.locals.t('admin.nav.exams'), exams, years, edit });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) { req.flash('error', 'f.exam.name_required'); return res.redirect('/admin/exams'); }
    const id = h.toInt(req.body.id);
    const vals = [name, h.toInt(req.body.academic_year_id), h.orNull(req.body.start_date), h.orNull(req.body.end_date)];
    if (id) {
      await db.run('UPDATE exams SET name=?, academic_year_id=?, start_date=?, end_date=? WHERE id=?', [...vals, id]);
      req.flash('success', 'f.exam.updated');
    } else {
      await db.run('INSERT INTO exams (name, academic_year_id, start_date, end_date) VALUES (?,?,?,?)', vals);
      req.flash('success', 'f.exam.created');
    }
    res.redirect('/admin/exams');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM exams WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'f.exam.deleted');
    res.redirect('/admin/exams');
  } catch (err) { next(err); }
});

router.post('/:id/publish', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const publish = req.body.publish === '1' ? 1 : 0;
    await db.run('UPDATE exams SET is_published = ? WHERE id = ?', [publish, id]);
    req.flash('success', publish ? 'f.exam.published' : 'f.exam.unpublished');
    res.redirect(`/admin/exams/${id}`);
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- detail */
router.get('/:id', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const exam = await db.one(
      'SELECT e.*, y.name AS year_name FROM exams e LEFT JOIN academic_years y ON y.id = e.academic_year_id WHERE e.id = ?', [id]
    );
    if (!exam) return next();
    const classes = await db.query(
      `SELECT c.id, c.name, d.name AS dept_name,
              (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active') AS student_count,
              (SELECT COUNT(*) FROM subjects su WHERE su.class_id = c.id) AS subject_count,
              (SELECT COUNT(DISTINCT m.student_id) FROM exam_marks m
                 JOIN subjects su2 ON su2.id = m.subject_id
                WHERE m.exam_id = ? AND su2.class_id = c.id) AS marked_count
         FROM classes c LEFT JOIN departments d ON d.id = c.department_id
        ORDER BY d.sort_order, c.level`, [id]
    );
    res.render('admin/exams/detail', { title: exam.name, exam, classes });
  } catch (err) { next(err); }
});

/* ----------------------------------------------------------- marks entry */
router.get('/:id/marks', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const exam = await db.one('SELECT * FROM exams WHERE id = ?', [id]);
    if (!exam) return next();

    const classId = h.toInt(req.query.class_id);
    const subjectId = h.toInt(req.query.subject_id);
    const classes = await db.query('SELECT id, name FROM classes ORDER BY department_id, level');
    const subjects = classId
      ? await db.query('SELECT id, name, full_marks, pass_marks FROM subjects WHERE class_id = ? ORDER BY sort_order, id', [classId])
      : [];
    const subject = subjectId ? subjects.find((s) => s.id === subjectId) : null;

    let students = [];
    if (classId && subject) {
      students = await db.query(
        `SELECT s.id, s.name, s.roll_no, m.marks, m.is_absent
           FROM students s
           LEFT JOIN exam_marks m ON m.student_id = s.id AND m.exam_id = ? AND m.subject_id = ?
          WHERE s.class_id = ? AND s.status = 'active'
          ORDER BY s.roll_no + 0, s.name`,
        [id, subject.id, classId]
      );
    }

    res.render('admin/exams/marks', {
      title: res.locals.t('a.title.marks', { name: exam.name }), exam, classes, subjects, subject, students,
      filters: { class_id: classId, subject_id: subjectId }
    });
  } catch (err) { next(err); }
});

router.post('/:id/marks', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const classId = h.toInt(req.body.class_id);
    const subjectId = h.toInt(req.body.subject_id);
    const subject = await db.one('SELECT id, full_marks, name FROM subjects WHERE id = ?', [subjectId]);
    if (!subject) { req.flash('error', 'f.exam.subject_not_found'); return res.redirect(`/admin/exams/${id}/marks`); }

    const marks = req.body.marks || {};
    const absents = req.body.absent || {};
    const userId = req.session.user.id;
    const ids = Object.keys(marks);
    let saved = 0, clamped = 0;

    await db.transaction(async (conn) => {
      for (const sid of ids) {
        const studentId = h.idFromKey(sid);
        if (!studentId) continue;
        const isAbsent = absents[sid] ? 1 : 0;
        const raw = String(marks[sid] || '').trim();
        if (!isAbsent && raw === '') {
          await conn.execute('DELETE FROM exam_marks WHERE exam_id = ? AND student_id = ? AND subject_id = ?',
            [id, studentId, subjectId]);
          continue;
        }
        let value = isAbsent ? 0 : h.toNum(raw, 0);
        if (value > Number(subject.full_marks)) { value = Number(subject.full_marks); clamped++; }
        if (value < 0) value = 0;
        await conn.execute(
          `INSERT INTO exam_marks (exam_id, student_id, subject_id, marks, is_absent, entered_by)
           VALUES (?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE marks = VALUES(marks), is_absent = VALUES(is_absent), entered_by = VALUES(entered_by)`,
          [id, studentId, subjectId, value, isAbsent, userId]
        );
        saved++;
      }
    });

    // Two separate messages rather than one sentence: Bangla and English
    // order these clauses differently.
    req.flash('success', i18n.pack('f.exam.marks_saved', { count: saved, subject: subject.name }));
    if (clamped) {
      req.flash('info', i18n.pack('f.exam.marks_clamped', { count: clamped, full: subject.full_marks }));
    }
    res.redirect(`/admin/exams/${id}/marks?class_id=${classId}&subject_id=${subjectId}`);
  } catch (err) { next(err); }
});

/* -------------------------------------------------------------- results */
router.get('/:id/results', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const exam = await db.one('SELECT * FROM exams WHERE id = ?', [id]);
    if (!exam) return next();
    const classId = h.toInt(req.query.class_id);
    const classes = await db.query('SELECT id, name FROM classes ORDER BY department_id, level');
    const ranking = classId ? await classRanking(id, classId) : [];
    const klass = classId ? classes.find((c) => c.id === classId) : null;
    res.render('admin/exams/results', { title: res.locals.t('a.title.results', { name: exam.name }), exam, classes, ranking, klass, filters: { class_id: classId } });
  } catch (err) { next(err); }
});

router.get('/:id/marksheet/:studentId', async (req, res, next) => {
  try {
    const sheet = await buildMarksheet(h.toInt(req.params.id), h.toInt(req.params.studentId));
    if (!sheet) { req.flash('error', 'f.exam.no_marks_student'); return res.redirect(`/admin/exams/${req.params.id}`); }
    res.render('admin/exams/marksheet', { title: res.locals.t('a.title.marksheet', { name: sheet.student.name }), sheet });
  } catch (err) { next(err); }
});

module.exports = router;

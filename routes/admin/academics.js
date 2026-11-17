'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');

const router = express.Router();

const TABS = [
  ['/admin/academics/departments', 'Departments'],
  ['/admin/academics/classes', 'Classes'],
  ['/admin/academics/sections', 'Sections'],
  ['/admin/academics/subjects', 'Subjects'],
  ['/admin/academics/years', 'Academic Years']
];

router.get('/', (req, res) => res.redirect('/admin/academics/departments'));

/* --------------------------------------------------------- departments */
router.get('/departments', async (req, res, next) => {
  try {
    const departments = await db.query(
      `SELECT d.*, (SELECT COUNT(*) FROM classes c WHERE c.department_id = d.id) AS class_count,
              (SELECT COUNT(*) FROM students s WHERE s.department_id = d.id AND s.status = 'active') AS student_count
         FROM departments d ORDER BY d.sort_order, d.id`
    );
    const edit = h.toInt(req.query.edit)
      ? await db.one('SELECT * FROM departments WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/academics/departments', { title: 'Departments', TABS, departments, edit });
  } catch (err) { next(err); }
});

router.post('/departments', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) { req.flash('error', 'Department name is required.'); return res.redirect('/admin/academics/departments'); }
    const id = h.toInt(req.body.id);
    if (id) {
      await db.run('UPDATE departments SET name=?, slug=?, description=?, sort_order=? WHERE id=?',
        [name, h.slugify(name), h.orNull(req.body.description), h.toNum(req.body.sort_order, 0), id]);
      req.flash('success', 'Department updated.');
    } else {
      const exists = await db.one('SELECT id FROM departments WHERE slug = ?', [h.slugify(name)]);
      if (exists) { req.flash('error', 'A department with that name already exists.'); return res.redirect('/admin/academics/departments'); }
      await db.run('INSERT INTO departments (name, slug, description, sort_order) VALUES (?,?,?,?)',
        [name, h.slugify(name), h.orNull(req.body.description), h.toNum(req.body.sort_order, 0)]);
      req.flash('success', 'Department added.');
    }
    res.redirect('/admin/academics/departments');
  } catch (err) { next(err); }
});

router.delete('/departments/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM departments WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'Department deleted.');
    res.redirect('/admin/academics/departments');
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- classes */
router.get('/classes', async (req, res, next) => {
  try {
    const [classes, departments] = await Promise.all([
      db.query(`SELECT c.*, d.name AS dept_name,
                       (SELECT COUNT(*) FROM sections s WHERE s.class_id = c.id) AS section_count,
                       (SELECT COUNT(*) FROM subjects s WHERE s.class_id = c.id) AS subject_count,
                       (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.status = 'active') AS student_count
                  FROM classes c LEFT JOIN departments d ON d.id = c.department_id
                 ORDER BY d.sort_order, c.level, c.id`),
      db.query('SELECT id, name FROM departments ORDER BY sort_order, id')
    ]);
    const edit = h.toInt(req.query.edit)
      ? await db.one('SELECT * FROM classes WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/academics/classes', { title: 'Classes', TABS, classes, departments, edit });
  } catch (err) { next(err); }
});

router.post('/classes', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) { req.flash('error', 'Class name is required.'); return res.redirect('/admin/academics/classes'); }
    const id = h.toInt(req.body.id);
    const vals = [h.toInt(req.body.department_id), name, h.toNum(req.body.level, 0), h.toNum(req.body.level, 0)];
    if (id) {
      await db.run('UPDATE classes SET department_id=?, name=?, level=?, sort_order=? WHERE id=?', [...vals, id]);
      req.flash('success', 'Class updated.');
    } else {
      const r = await db.run('INSERT INTO classes (department_id, name, level, sort_order) VALUES (?,?,?,?)', vals);
      await db.run('INSERT INTO sections (class_id, name, capacity) VALUES (?,?,?)', [r.insertId, 'A', 40]);
      req.flash('success', 'Class added, with a default section A.');
    }
    res.redirect('/admin/academics/classes');
  } catch (err) { next(err); }
});

router.delete('/classes/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM classes WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'Class deleted together with its sections and subjects.');
    res.redirect('/admin/academics/classes');
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------ sections */
router.get('/sections', async (req, res, next) => {
  try {
    const [sections, classes, teachers] = await Promise.all([
      db.query(`SELECT s.*, c.name AS class_name, st.name AS teacher_name,
                       (SELECT COUNT(*) FROM students x WHERE x.section_id = s.id AND x.status = 'active') AS student_count
                  FROM sections s
                  LEFT JOIN classes c ON c.id = s.class_id
                  LEFT JOIN staff st ON st.id = s.teacher_id
                 ORDER BY c.level, s.name`),
      db.query('SELECT id, name FROM classes ORDER BY department_id, level'),
      db.query("SELECT id, name FROM staff WHERE status = 'active' ORDER BY name")
    ]);
    const edit = h.toInt(req.query.edit)
      ? await db.one('SELECT * FROM sections WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/academics/sections', { title: 'Sections', TABS, sections, classes, teachers, edit });
  } catch (err) { next(err); }
});

router.post('/sections', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const classId = h.toInt(req.body.class_id);
    if (!name || !classId) { req.flash('error', 'Class and section name are required.'); return res.redirect('/admin/academics/sections'); }
    const id = h.toInt(req.body.id);
    const vals = [classId, name, h.toNum(req.body.capacity, 40), h.toInt(req.body.teacher_id)];
    if (id) {
      await db.run('UPDATE sections SET class_id=?, name=?, capacity=?, teacher_id=? WHERE id=?', [...vals, id]);
      req.flash('success', 'Section updated.');
    } else {
      await db.run('INSERT INTO sections (class_id, name, capacity, teacher_id) VALUES (?,?,?,?)', vals);
      req.flash('success', 'Section added.');
    }
    res.redirect('/admin/academics/sections');
  } catch (err) { next(err); }
});

router.delete('/sections/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM sections WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'Section deleted.');
    res.redirect('/admin/academics/sections');
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------ subjects */
router.get('/subjects', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const classes = await db.query('SELECT id, name FROM classes ORDER BY department_id, level');
    const teachers = await db.query("SELECT id, name FROM staff WHERE status = 'active' ORDER BY name");
    const where = classId ? 'WHERE s.class_id = ?' : '';
    const params = classId ? [classId] : [];
    const subjects = await db.query(
      `SELECT s.*, c.name AS class_name, st.name AS teacher_name
         FROM subjects s LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN staff st ON st.id = s.teacher_id
         ${where} ORDER BY c.level, s.sort_order, s.id`, params
    );
    const edit = h.toInt(req.query.edit)
      ? await db.one('SELECT * FROM subjects WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/academics/subjects', { title: 'Subjects', TABS, subjects, classes, teachers, edit, classId });
  } catch (err) { next(err); }
});

router.post('/subjects', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const classId = h.toInt(req.body.class_id);
    if (!name || !classId) { req.flash('error', 'Class and subject name are required.'); return res.redirect('/admin/academics/subjects'); }
    const id = h.toInt(req.body.id);
    const vals = [classId, name, h.orNull(req.body.code), h.toNum(req.body.full_marks, 100),
                  h.toNum(req.body.pass_marks, 33), h.toInt(req.body.teacher_id), h.toNum(req.body.sort_order, 0)];
    if (id) {
      await db.run('UPDATE subjects SET class_id=?, name=?, code=?, full_marks=?, pass_marks=?, teacher_id=?, sort_order=? WHERE id=?', [...vals, id]);
      req.flash('success', 'Subject updated.');
    } else {
      await db.run('INSERT INTO subjects (class_id, name, code, full_marks, pass_marks, teacher_id, sort_order) VALUES (?,?,?,?,?,?,?)', vals);
      req.flash('success', 'Subject added.');
    }
    res.redirect(`/admin/academics/subjects?class_id=${classId}`);
  } catch (err) { next(err); }
});

router.delete('/subjects/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM subjects WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'Subject deleted.');
    res.redirect('/admin/academics/subjects');
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- years */
router.get('/years', async (req, res, next) => {
  try {
    const years = await db.query('SELECT * FROM academic_years ORDER BY name DESC');
    const edit = h.toInt(req.query.edit)
      ? await db.one('SELECT * FROM academic_years WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/academics/years', { title: 'Academic Years', TABS, years, edit });
  } catch (err) { next(err); }
});

router.post('/years', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) { req.flash('error', 'Year name is required.'); return res.redirect('/admin/academics/years'); }
    const id = h.toInt(req.body.id);
    const isCurrent = req.body.is_current ? 1 : 0;
    if (isCurrent) await db.run('UPDATE academic_years SET is_current = 0');
    if (id) {
      await db.run('UPDATE academic_years SET name=?, start_date=?, end_date=?, is_current=? WHERE id=?',
        [name, h.orNull(req.body.start_date), h.orNull(req.body.end_date), isCurrent, id]);
      req.flash('success', 'Academic year updated.');
    } else {
      await db.run('INSERT INTO academic_years (name, start_date, end_date, is_current) VALUES (?,?,?,?)',
        [name, h.orNull(req.body.start_date), h.orNull(req.body.end_date), isCurrent]);
      req.flash('success', 'Academic year added.');
    }
    res.redirect('/admin/academics/years');
  } catch (err) { next(err); }
});

router.delete('/years/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM academic_years WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'Academic year deleted.');
    res.redirect('/admin/academics/years');
  } catch (err) { next(err); }
});

module.exports = router;

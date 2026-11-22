'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const upload = require('../../lib/upload');
const { buildMarksheet } = require('../../lib/results');
const i18n = require('../../lib/i18n');

const router = express.Router();

async function lookups() {
  const [departments, classes, sections, years] = await Promise.all([
    db.query('SELECT id, name FROM departments ORDER BY sort_order, id'),
    db.query('SELECT id, name, department_id FROM classes ORDER BY department_id, level, id'),
    db.query('SELECT id, name, class_id FROM sections ORDER BY class_id, name'),
    db.query('SELECT id, name, is_current FROM academic_years ORDER BY name DESC')
  ]);
  return { departments, classes, sections, years };
}

/* ------------------------------------------------------------------ list */
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const classId = h.toInt(req.query.class_id);
    const sectionId = h.toInt(req.query.section_id);
    const deptId = h.toInt(req.query.department_id);
    const status = ['active', 'passed', 'left'].includes(req.query.status) ? req.query.status : 'active';

    const where = ['s.status = ?'];
    const params = [status];
    if (q) {
      where.push('(s.name LIKE ? OR s.admission_no LIKE ? OR s.roll_no LIKE ? OR s.guardian_phone LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (classId) { where.push('s.class_id = ?'); params.push(classId); }
    if (sectionId) { where.push('s.section_id = ?'); params.push(sectionId); }
    if (deptId) { where.push('s.department_id = ?'); params.push(deptId); }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const total = await db.scalar(`SELECT COUNT(*) AS c FROM students s ${whereSql}`, params);
    const p = h.paginate(total, req.query.page, 25);
    const students = await db.query(
      `SELECT s.*, c.name AS class_name, sec.name AS section_name, d.name AS dept_name
         FROM students s
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN departments d ON d.id = s.department_id
         ${whereSql}
        ORDER BY c.level, s.roll_no + 0, s.name
        LIMIT ${p.perPage} OFFSET ${p.offset}`,
      params
    );

    res.render('admin/students/list', {
      title: res.locals.t('admin.nav.students'), students, p, ...(await lookups()),
      filters: { q, class_id: classId, section_id: sectionId, department_id: deptId, status }
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------- new */
router.get('/new', async (req, res, next) => {
  try {
    const last = await db.one('SELECT MAX(id) AS id FROM students');
    res.render('admin/students/form', {
      title: res.locals.t('a.stu.add_first'), student: { admission_no: h.nextNo('ADM', last ? last.id : 0), gender: 'male', status: 'active' },
      isNew: true, ...(await lookups())
    });
  } catch (err) { next(err); }
});

router.post('/', upload.image.single('photo'), async (req, res, next) => {
  try {
    const b = req.body;
    if (!String(b.name || '').trim() || !String(b.admission_no || '').trim()) {
      req.flash('error', 'f.stu.required');
      return res.redirect('/admin/students/new');
    }
    const dup = await db.one('SELECT id FROM students WHERE admission_no = ?', [b.admission_no.trim()]);
    if (dup) {
      req.flash('error', i18n.pack('f.stu.no_in_use', { no: b.admission_no }));
      return res.redirect('/admin/students/new');
    }
    const r = await db.run(
      `INSERT INTO students (admission_no, roll_no, name, father_name, mother_name, guardian_name,
         guardian_phone, dob, gender, blood_group, address, photo, department_id, class_id, section_id,
         academic_year_id, admission_date, is_resident, hifz_para_completed, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.admission_no.trim(), h.orNull(b.roll_no), b.name.trim(), h.orNull(b.father_name), h.orNull(b.mother_name),
       h.orNull(b.guardian_name), h.orNull(b.guardian_phone), h.orNull(b.dob), b.gender === 'female' ? 'female' : 'male',
       h.orNull(b.blood_group), h.orNull(b.address), req.file ? req.file.filename : null,
       h.toInt(b.department_id), h.toInt(b.class_id), h.toInt(b.section_id), h.toInt(b.academic_year_id),
       h.orNull(b.admission_date), b.is_resident ? 1 : 0, h.toNum(b.hifz_para_completed, 0),
       ['active', 'passed', 'left'].includes(b.status) ? b.status : 'active']
    );
    req.flash('success', i18n.pack('f.stu.added', { name: b.name.trim() }));
    res.redirect(`/admin/students/${r.insertId}`);
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- profile */
router.get('/:id', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const student = await db.one(
      `SELECT s.*, c.name AS class_name, sec.name AS section_name, d.name AS dept_name, y.name AS year_name
         FROM students s
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN departments d ON d.id = s.department_id
         LEFT JOIN academic_years y ON y.id = s.academic_year_id
        WHERE s.id = ?`, [id]
    );
    if (!student) return next();

    const [att, invoices, hifz, exams, issues, hostel] = await Promise.all([
      db.one(`SELECT COUNT(*) AS total,
                     SUM(status IN ('present','late')) AS present,
                     SUM(status = 'absent') AS absent,
                     SUM(status = 'leave') AS onleave
                FROM attendance WHERE student_id = ?`, [id]),
      db.query(`SELECT * FROM fee_invoices WHERE student_id = ? ORDER BY period DESC LIMIT 12`, [id]),
      db.query('SELECT * FROM hifz_progress WHERE student_id = ? ORDER BY pdate DESC LIMIT 10', [id]),
      db.query(`SELECT DISTINCT e.id, e.name, e.is_published FROM exams e
                  JOIN exam_marks m ON m.exam_id = e.id AND m.student_id = ?
                 ORDER BY e.id DESC`, [id]),
      db.query(`SELECT bi.*, b.title FROM book_issues bi JOIN books b ON b.id = bi.book_id
                 WHERE bi.student_id = ? ORDER BY bi.id DESC LIMIT 5`, [id]),
      db.one(`SELECT ha.*, hr.room_no, hr.block FROM hostel_allocations ha
                JOIN hostel_rooms hr ON hr.id = ha.room_id
               WHERE ha.student_id = ? AND ha.status = 'active' LIMIT 1`, [id])
    ]);

    const dues = invoices.reduce((s, i) => s + (Number(i.total_amount) - Number(i.discount) - Number(i.paid_amount)), 0);
    const results = [];
    for (const e of exams.slice(0, 4)) {
      const sheet = await buildMarksheet(e.id, id);
      if (sheet) results.push({ exam: e, summary: sheet.summary });
    }

    res.render('admin/students/profile', {
      title: student.name, student, att: att || {}, invoices, dues, hifz, results, issues, hostel
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ edit */
router.get('/:id/edit', async (req, res, next) => {
  try {
    const student = await db.one('SELECT * FROM students WHERE id = ?', [h.toInt(req.params.id)]);
    if (!student) return next();
    res.render('admin/students/form', { title: res.locals.t('a.title.edit', { name: student.name }), student, isNew: false, ...(await lookups()) });
  } catch (err) { next(err); }
});

router.put('/:id', upload.image.single('photo'), async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const b = req.body;
    const existing = await db.one('SELECT photo FROM students WHERE id = ?', [id]);
    if (!existing) return next();
    if (req.file && existing.photo) upload.remove(existing.photo);

    await db.run(
      `UPDATE students SET admission_no=?, roll_no=?, name=?, father_name=?, mother_name=?, guardian_name=?,
         guardian_phone=?, dob=?, gender=?, blood_group=?, address=?, photo=?, department_id=?, class_id=?,
         section_id=?, academic_year_id=?, admission_date=?, is_resident=?, hifz_para_completed=?, status=?
       WHERE id = ?`,
      [b.admission_no.trim(), h.orNull(b.roll_no), b.name.trim(), h.orNull(b.father_name), h.orNull(b.mother_name),
       h.orNull(b.guardian_name), h.orNull(b.guardian_phone), h.orNull(b.dob), b.gender === 'female' ? 'female' : 'male',
       h.orNull(b.blood_group), h.orNull(b.address), req.file ? req.file.filename : existing.photo,
       h.toInt(b.department_id), h.toInt(b.class_id), h.toInt(b.section_id), h.toInt(b.academic_year_id),
       h.orNull(b.admission_date), b.is_resident ? 1 : 0, h.toNum(b.hifz_para_completed, 0),
       ['active', 'passed', 'left'].includes(b.status) ? b.status : 'active', id]
    );
    req.flash('success', 'f.stu.updated');
    res.redirect(`/admin/students/${id}`);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const student = await db.one('SELECT name, photo FROM students WHERE id = ?', [id]);
    if (!student) return next();
    await db.run('DELETE FROM students WHERE id = ?', [id]);
    if (student.photo) upload.remove(student.photo);
    req.flash('success', i18n.pack('f.stu.deleted', { name: student.name }));
    res.redirect('/admin/students');
  } catch (err) { next(err); }
});

module.exports = router;

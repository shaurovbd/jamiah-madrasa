'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const af = require('../../lib/admission-form');

const mailer = require('../../lib/mailer');
const i18n = require('../../lib/i18n');
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';
    const q = String(req.query.q || '').trim();
    const where = [];
    const params = [];
    if (status) { where.push('a.status = ?'); params.push(status); }
    if (q) { where.push('(a.name LIKE ? OR a.application_no LIKE ? OR a.guardian_phone LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await db.scalar(`SELECT COUNT(*) AS c FROM admissions a ${whereSql}`, params);
    const p = h.paginate(total, req.query.page, 25);
    const applications = await db.query(
      `SELECT a.*, c.name AS class_name, d.name AS dept_name
         FROM admissions a
         LEFT JOIN classes c ON c.id = a.class_id
         LEFT JOIN departments d ON d.id = a.department_id
         ${whereSql} ORDER BY a.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params
    );
    const counts = await db.one(
      `SELECT SUM(status='pending') AS pending, SUM(status='approved') AS approved, SUM(status='rejected') AS rejected FROM admissions`
    );
    res.render('admin/admissions/list', { title: res.locals.t('admin.nav.admissions'), applications, p, counts: counts || {}, filters: { status, q } });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const app = await db.one(
      `SELECT a.*, c.name AS class_name, d.name AS dept_name, s.admission_no
         FROM admissions a
         LEFT JOIN classes c ON c.id = a.class_id
         LEFT JOIN departments d ON d.id = a.department_id
         LEFT JOIN students s ON s.id = a.student_id
        WHERE a.id = ?`, [h.toInt(req.params.id)]
    );
    if (!app) return next();
    const [classes, sections, years] = await Promise.all([
      db.query('SELECT id, name, department_id FROM classes ORDER BY department_id, level'),
      db.query('SELECT id, name, class_id FROM sections ORDER BY class_id, name'),
      db.query('SELECT id, name, is_current FROM academic_years ORDER BY name DESC')
    ]);
    const last = await db.one('SELECT MAX(id) AS id FROM students');
    res.render('admin/admissions/view', {
      title: app.application_no, app, af, classes, sections, years,
      suggestedAdmissionNo: h.nextNo('ADM', last ? last.id : 0)
    });
  } catch (err) { next(err); }
});

/* Approve: create the student record and link it back to the application. */
router.post('/:id/approve', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const app = await db.one('SELECT * FROM admissions WHERE id = ?', [id]);
    if (!app) return next();
    if (app.status === 'approved' && app.student_id) {
      req.flash('info', 'f.adm.already_approved');
      return res.redirect(`/admin/admissions/${id}`);
    }
    const b = req.body;
    const admissionNo = String(b.admission_no || '').trim();
    if (!admissionNo) { req.flash('error', 'f.adm.no_required'); return res.redirect(`/admin/admissions/${id}`); }
    const dup = await db.one('SELECT id FROM students WHERE admission_no = ?', [admissionNo]);
    if (dup) { req.flash('error', i18n.pack('f.adm.no_in_use', { no: admissionNo })); return res.redirect(`/admin/admissions/${id}`); }

    const studentId = await db.transaction(async (conn) => {
      /* If no roll number was typed, assign the next free one in the target class. */
      let rollNo = h.orNull(b.roll_no);
      const classId = h.toInt(b.class_id) || app.class_id;
      if (!rollNo && classId) {
        const [[row]] = await conn.execute(
          `SELECT COALESCE(MAX(CAST(roll_no AS UNSIGNED)), 0) + 1 AS next
             FROM students
            WHERE class_id = ? AND roll_no REGEXP '^[0-9]+$'`,
          [classId]
        );
        rollNo = String(row.next);
      }
      const [r] = await conn.execute(
        `INSERT INTO students (admission_no, roll_no, name, father_name, mother_name, guardian_phone, dob,
           gender, address, department_id, class_id, section_id, academic_year_id, admission_date, is_resident, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active')`,
        [admissionNo, rollNo, app.name, app.father_name, app.mother_name, app.guardian_phone,
         app.dob, app.gender, app.address, h.toInt(b.department_id) || app.department_id,
         h.toInt(b.class_id) || app.class_id, h.toInt(b.section_id), h.toInt(b.academic_year_id),
         h.orNull(b.admission_date) || h.today(), b.is_resident ? 1 : 0]
      );
      await conn.execute(
        "UPDATE admissions SET status = 'approved', student_id = ?, processed_at = NOW() WHERE id = ?",
        [r.insertId, id]
      );
      return r.insertId;
    });

    /* Let the applicant know they were admitted. Fire-and-forget so a
       mail problem can never undo or delay the admission itself. */
    mailer.notifyApproved({
      applicationNo: app.application_no,
      admissionNo: admissionNo,
      name: app.name,
      email: app.email,
      department: app.department_key
    }).catch(function () {});

    req.flash('success', i18n.pack('f.adm.admitted_as', { name: app.name, no: admissionNo }));
    res.redirect(`/admin/students/${studentId}`);
  } catch (err) { next(err); }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    await db.run("UPDATE admissions SET status = 'rejected', processed_at = NOW() WHERE id = ?", [id]);
    req.flash('success', 'f.adm.rejected');
    res.redirect(`/admin/admissions/${id}`);
  } catch (err) { next(err); }
});

router.post('/:id/reopen', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    await db.run("UPDATE admissions SET status = 'pending', processed_at = NULL WHERE id = ? AND student_id IS NULL", [id]);
    req.flash('success', 'f.adm.reopened');
    res.redirect(`/admin/admissions/${id}`);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM admissions WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'f.adm.deleted');
    res.redirect('/admin/admissions');
  } catch (err) { next(err); }
});

module.exports = router;

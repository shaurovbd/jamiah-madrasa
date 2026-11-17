'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');

const router = express.Router();

const TABS = [
  ['/admin/attendance', 'Take Attendance'],
  ['/admin/attendance/report', 'Monthly Report']
];

/* --------------------------------------------------------------- take */
router.get('/', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const sectionId = h.toInt(req.query.section_id);
    const date = String(req.query.date || h.today()).slice(0, 10);

    const [classes, sections] = await Promise.all([
      db.query('SELECT id, name FROM classes ORDER BY department_id, level'),
      db.query('SELECT id, name, class_id FROM sections ORDER BY class_id, name')
    ]);

    let students = [];
    if (classId) {
      const params = [date, classId];
      let sectionSql = '';
      if (sectionId) { sectionSql = 'AND s.section_id = ?'; params.push(sectionId); }
      students = await db.query(
        `SELECT s.id, s.name, s.roll_no, s.admission_no, a.status, a.remarks
           FROM students s
           LEFT JOIN attendance a ON a.student_id = s.id AND a.adate = ?
          WHERE s.class_id = ? ${sectionSql} AND s.status = 'active'
          ORDER BY s.roll_no + 0, s.name`,
        params
      );
    }

    const alreadyTaken = students.some((s) => s.status);
    res.render('admin/attendance/take', {
      title: 'Attendance', TABS, classes, sections, students, alreadyTaken,
      filters: { class_id: classId, section_id: sectionId, date }
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const date = String(req.body.date || h.today()).slice(0, 10);
    const classId = h.toInt(req.body.class_id);
    const sectionId = h.toInt(req.body.section_id);
    const statuses = req.body.status || {};
    const remarks = req.body.remarks || {};
    const userId = req.session.user.id;

    const ids = Object.keys(statuses);
    if (!ids.length) {
      req.flash('error', 'No students to record.');
      return res.redirect(`/admin/attendance?class_id=${classId || ''}&section_id=${sectionId || ''}&date=${date}`);
    }

    let saved = 0;
    await db.transaction(async (conn) => {
      for (const sid of ids) {
        const studentId = h.idFromKey(sid);
        if (!studentId) continue;
        const st = ['present', 'absent', 'late', 'leave'].includes(statuses[sid]) ? statuses[sid] : 'present';
        await conn.execute(
          `INSERT INTO attendance (student_id, class_id, section_id, adate, status, remarks, taken_by)
           VALUES (?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE status = VALUES(status), remarks = VALUES(remarks), taken_by = VALUES(taken_by)`,
          [studentId, classId, sectionId, date, st, (remarks[sid] || '').slice(0, 200) || null, userId]
        );
        saved++;
      }
    });

    req.flash('success', `Attendance saved for ${saved} student${saved === 1 ? '' : 's'} on ${h.fmtDate(date)}.`);
    res.redirect(`/admin/attendance?class_id=${classId || ''}&section_id=${sectionId || ''}&date=${date}`);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- report */
router.get('/report', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const period = String(req.query.period || h.currentPeriod()).slice(0, 7);
    const classes = await db.query('SELECT id, name FROM classes ORDER BY department_id, level');

    let rows = [];
    let days = [];
    if (classId) {
      const [y, m] = period.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

      const students = await db.query(
        "SELECT id, name, roll_no FROM students WHERE class_id = ? AND status = 'active' ORDER BY roll_no + 0, name",
        [classId]
      );
      const records = await db.query(
        `SELECT student_id, DAY(adate) AS d, status FROM attendance
          WHERE class_id = ? AND DATE_FORMAT(adate, '%Y-%m') = ?`,
        [classId, period]
      );
      const map = {};
      for (const r of records) {
        map[r.student_id] = map[r.student_id] || {};
        map[r.student_id][r.d] = r.status;
      }
      rows = students.map((s) => {
        const marks = map[s.id] || {};
        const present = Object.values(marks).filter((v) => v === 'present' || v === 'late').length;
        const absent = Object.values(marks).filter((v) => v === 'absent').length;
        const leave = Object.values(marks).filter((v) => v === 'leave').length;
        const taken = present + absent + leave;
        return { ...s, marks, present, absent, leave, taken, percent: taken ? Math.round((present / taken) * 100) : 0 };
      });
    }

    res.render('admin/attendance/report', {
      title: 'Attendance Report', TABS, classes, rows, days,
      filters: { class_id: classId, period }
    });
  } catch (err) { next(err); }
});

module.exports = router;

'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');
const sh = require('../../lib/shifts');

const router = express.Router();

const TABS = [
  ['/admin/attendance', 'a.att.tab.students'],
  ['/admin/attendance/report', 'a.att.tab.student_report'],
  ['/admin/attendance/staff', 'a.att.tab.staff'],
  ['/admin/attendance/staff/report', 'a.att.tab.staff_report']
];

const STUDENT_STATUSES = ['present', 'absent', 'late', 'leave'];

/** The shifts offered in the filters — inactive ones stay out of new entries. */
function activeShifts() {
  return db.query('SELECT * FROM shifts WHERE is_active = 1 ORDER BY sort_order, id');
}

/* --------------------------------------------------------------- take */
router.get('/', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const sectionId = h.toInt(req.query.section_id);
    const date = String(req.query.date || h.today()).slice(0, 10);

    const [classes, sections, shifts] = await Promise.all([
      db.query('SELECT id, name, shift_id FROM classes ORDER BY department_id, level'),
      db.query('SELECT id, name, class_id FROM sections ORDER BY class_id, name'),
      activeShifts()
    ]);

    // On a first visit, no shift in the URL at all, the class's own shift is
    // what the clerk means nine times out of ten, so it is filled in for them.
    // But once the filter form has been submitted, shift_id is always present —
    // empty then means they picked "all shifts", and that must be honoured, or
    // a student moved to the other shift individually would never be listed.
    const chosenClass = classId ? classes.find((c) => c.id === classId) : null;
    const shiftChosen = Object.prototype.hasOwnProperty.call(req.query, 'shift_id');
    const shiftId = shiftChosen
      ? h.toInt(req.query.shift_id)
      : (chosenClass ? chosenClass.shift_id : null) || null;
    const shift = shiftId ? shifts.find((s) => s.id === shiftId) || null : null;

    let students = [];
    if (classId) {
      const params = [date, classId];
      let extraSql = '';
      if (sectionId) { extraSql += ' AND s.section_id = ?'; params.push(sectionId); }
      // A student whose own shift_id is set sits in that shift; one without
      // inherits the class's. Either way only this shift's students show.
      if (shiftId) { extraSql += ' AND COALESCE(s.shift_id, c.shift_id) = ?'; params.push(shiftId); }
      students = await db.query(
        `SELECT s.id, s.name, s.roll_no, s.admission_no, a.status, a.remarks
           FROM students s
           LEFT JOIN classes c ON c.id = s.class_id
           LEFT JOIN attendance a ON a.student_id = s.id AND a.adate = ?
          WHERE s.class_id = ?${extraSql} AND s.status = 'active'
          ORDER BY s.roll_no + 0, s.name`,
        params
      );
    }

    const alreadyTaken = students.some((s) => s.status);
    res.render('admin/attendance/take', {
      title: res.locals.t('admin.nav.attendance'), TABS, classes, sections, shifts, students, alreadyTaken,
      shift, weeklyOff: sh.isWeeklyOff(shift, date), sh,
      filters: { class_id: classId, section_id: sectionId, shift_id: shiftId, date }
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const date = String(req.body.date || h.today()).slice(0, 10);
    const classId = h.toInt(req.body.class_id);
    const sectionId = h.toInt(req.body.section_id);
    const shiftId = h.toInt(req.body.shift_id);
    const statuses = req.body.status || {};
    const remarks = req.body.remarks || {};
    const userId = req.session.user.id;
    const back = `/admin/attendance${h.qs({ class_id: classId, section_id: sectionId, shift_id: shiftId, date })}`;

    const ids = Object.keys(statuses);
    if (!ids.length) {
      req.flash('error', 'f.att.no_students');
      return res.redirect(back);
    }

    let saved = 0;
    await db.transaction(async (conn) => {
      for (const sid of ids) {
        const studentId = h.idFromKey(sid);
        if (!studentId) continue;
        const st = STUDENT_STATUSES.includes(statuses[sid]) ? statuses[sid] : 'present';
        await conn.execute(
          `INSERT INTO attendance (student_id, class_id, section_id, shift_id, adate, status, remarks, taken_by)
           VALUES (?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE status = VALUES(status), remarks = VALUES(remarks),
                                   shift_id = VALUES(shift_id), taken_by = VALUES(taken_by)`,
          [studentId, classId, sectionId, shiftId, date, st, (remarks[sid] || '').slice(0, 200) || null, userId]
        );
        saved++;
      }
    });

    req.flash('success', i18n.pack('f.att.saved', { count: saved, date: h.fmtDate(date, res.locals.lang) }));
    res.redirect(back);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- report */
router.get('/report', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const shiftId = h.toInt(req.query.shift_id);
    const period = String(req.query.period || h.currentPeriod()).slice(0, 7);
    const [classes, shifts] = await Promise.all([
      db.query('SELECT id, name FROM classes ORDER BY department_id, level'),
      activeShifts()
    ]);

    let rows = [];
    let days = [];
    if (classId) {
      const [y, m] = period.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

      const params = [classId];
      let shiftSql = '';
      if (shiftId) { shiftSql = ' AND COALESCE(s.shift_id, c.shift_id) = ?'; params.push(shiftId); }
      const students = await db.query(
        `SELECT s.id, s.name, s.roll_no FROM students s
           LEFT JOIN classes c ON c.id = s.class_id
          WHERE s.class_id = ?${shiftSql} AND s.status = 'active'
          ORDER BY s.roll_no + 0, s.name`,
        params
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
      title: res.locals.t('a.att.report_title'), TABS, classes, shifts, rows, days,
      filters: { class_id: classId, shift_id: shiftId, period }
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------- staff: take */
router.get('/staff', async (req, res, next) => {
  try {
    const departmentId = h.toInt(req.query.department_id);
    const shiftId = h.toInt(req.query.shift_id);
    const date = String(req.query.date || h.today()).slice(0, 10);

    const [departments, shifts] = await Promise.all([
      db.query('SELECT id, name FROM departments ORDER BY sort_order, id'),
      activeShifts()
    ]);
    const shift = shiftId ? shifts.find((s) => s.id === shiftId) || null : null;

    const params = [date];
    let where = "WHERE f.status = 'active'";
    if (departmentId) { where += ' AND f.department_id = ?'; params.push(departmentId); }
    if (shiftId) { where += ' AND f.shift_id = ?'; params.push(shiftId); }

    const staff = await db.query(
      `SELECT f.id, f.name, f.staff_no, f.designation, d.name AS dept_name,
              COALESCE(f.shift_id, 0) AS own_shift_id, sf.name AS shift_name,
              sa.status, sa.in_time, sa.out_time, sa.leave_type, sa.substitute_id, sa.remarks
         FROM staff f
         LEFT JOIN departments d ON d.id = f.department_id
         LEFT JOIN shifts sf ON sf.id = f.shift_id
         LEFT JOIN staff_attendance sa ON sa.staff_id = f.id AND sa.adate = ?
         ${where}
        ORDER BY d.sort_order, f.name`,
      params
    );

    const alreadyTaken = staff.some((s) => s.status);
    res.render('admin/attendance/staff-take', {
      title: res.locals.t('a.att.tab.staff'), TABS, departments, shifts, staff, alreadyTaken,
      shift, weeklyOff: sh.isWeeklyOff(shift, date), sh,
      STATUSES: sh.STAFF_STATUSES, LEAVE_TYPES: sh.LEAVE_TYPES,
      filters: { department_id: departmentId, shift_id: shiftId, date }
    });
  } catch (err) { next(err); }
});

router.post('/staff', async (req, res, next) => {
  try {
    const date = String(req.body.date || h.today()).slice(0, 10);
    const departmentId = h.toInt(req.body.department_id);
    const formShiftId = h.toInt(req.body.shift_id);
    const statuses = req.body.status || {};
    const inTimes = req.body.in_time || {};
    const outTimes = req.body.out_time || {};
    const leaveTypes = req.body.leave_type || {};
    const substitutes = req.body.substitute_id || {};
    const remarks = req.body.remarks || {};
    const userId = req.session.user.id;
    const back = `/admin/attendance/staff${h.qs({ department_id: departmentId, shift_id: formShiftId, date })}`;

    const keys = Object.keys(statuses);
    if (!keys.length) {
      req.flash('error', 'f.satt.no_staff');
      return res.redirect(back);
    }

    // Each row's own shift decides its lateness, so a mixed list (no shift
    // filter) is still judged correctly, row by row.
    const shifts = await db.query('SELECT * FROM shifts');
    const shiftById = new Map(shifts.map((s) => [s.id, s]));

    let saved = 0;
    await db.transaction(async (conn) => {
      for (const key of keys) {
        const staffId = h.idFromKey(key);
        if (!staffId) continue;

        const rowShiftId = h.toInt(req.body.row_shift_id && req.body.row_shift_id[key]) || formShiftId || null;
        const inTime = sh.toTimeValue(inTimes[key]);
        const outTime = sh.toTimeValue(outTimes[key]);

        let status = sh.STAFF_STATUSES.includes(statuses[key]) ? statuses[key] : 'present';
        // An arrival time is harder evidence than the default radio, so when a
        // time is given and the clerk left the row on 'present', the shift's
        // own grace and half-day rules settle it. An explicit absent or leave
        // is never overridden.
        if (status === 'present' && inTime) {
          const derived = sh.statusFromInTime(shiftById.get(rowShiftId), inTime);
          if (derived) status = derived;
        }

        const leaveType = status === 'leave' && sh.LEAVE_TYPES.includes(leaveTypes[key])
          ? leaveTypes[key] : null;
        const substitute = h.toInt(substitutes[key]);

        await conn.execute(
          `INSERT INTO staff_attendance
             (staff_id, shift_id, adate, status, in_time, out_time, leave_type, substitute_id, remarks, taken_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE shift_id = VALUES(shift_id), status = VALUES(status),
             in_time = VALUES(in_time), out_time = VALUES(out_time), leave_type = VALUES(leave_type),
             substitute_id = VALUES(substitute_id), remarks = VALUES(remarks), taken_by = VALUES(taken_by)`,
          [staffId, rowShiftId, date, status,
           status === 'absent' || status === 'leave' ? null : inTime,
           status === 'absent' || status === 'leave' ? null : outTime,
           leaveType, substitute === staffId ? null : substitute,
           (remarks[key] || '').slice(0, 200) || null, userId]
        );
        saved++;
      }
    });

    req.flash('success', i18n.pack('f.satt.saved', { count: saved, date: h.fmtDate(date, res.locals.lang) }));
    res.redirect(back);
  } catch (err) { next(err); }
});

/* ----------------------------------------------------- staff: report */
router.get('/staff/report', async (req, res, next) => {
  try {
    const departmentId = h.toInt(req.query.department_id);
    const shiftId = h.toInt(req.query.shift_id);
    const period = String(req.query.period || h.currentPeriod()).slice(0, 7);

    const [departments, shifts] = await Promise.all([
      db.query('SELECT id, name FROM departments ORDER BY sort_order, id'),
      activeShifts()
    ]);

    const [y, m] = period.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const params = [];
    let where = "WHERE f.status = 'active'";
    if (departmentId) { where += ' AND f.department_id = ?'; params.push(departmentId); }
    if (shiftId) { where += ' AND f.shift_id = ?'; params.push(shiftId); }

    const staff = await db.query(
      `SELECT f.id, f.name, f.staff_no, f.designation, d.name AS dept_name, sf.name AS shift_name
         FROM staff f
         LEFT JOIN departments d ON d.id = f.department_id
         LEFT JOIN shifts sf ON sf.id = f.shift_id
         ${where} ORDER BY d.sort_order, f.name`,
      params
    );

    const records = await db.query(
      `SELECT staff_id, DAY(adate) AS d, status, leave_type FROM staff_attendance
        WHERE DATE_FORMAT(adate, '%Y-%m') = ?`,
      [period]
    );
    const map = {};
    for (const r of records) {
      map[r.staff_id] = map[r.staff_id] || {};
      map[r.staff_id][r.d] = r;
    }

    const rows = staff.map((f) => {
      const marks = map[f.id] || {};
      const list = Object.values(marks);
      const present = list.filter((r) => r.status === 'present').length;
      const late = list.filter((r) => r.status === 'late').length;
      const halfDay = list.filter((r) => r.status === 'half_day').length;
      const absent = list.filter((r) => r.status === 'absent').length;
      const leave = list.filter((r) => r.status === 'leave').length;
      const paidLeave = list.filter((r) => r.status === 'leave' && r.leave_type !== 'unpaid').length;
      const unpaidLeave = leave - paidLeave;
      const taken = list.length;
      // Half a day worked counts as half a day present, which is what the
      // month-end salary sheet needs.
      const worked = present + late + halfDay * 0.5;
      return {
        ...f, marks, present, late, halfDay, absent, leave, paidLeave, unpaidLeave, taken, worked,
        percent: taken ? Math.round((worked / taken) * 100) : 0
      };
    });

    res.render('admin/attendance/staff-report', {
      title: res.locals.t('a.att.tab.staff_report'), TABS, departments, shifts, rows, days,
      filters: { department_id: departmentId, shift_id: shiftId, period }
    });
  } catch (err) { next(err); }
});

module.exports = router;

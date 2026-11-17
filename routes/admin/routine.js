'use strict';

/**
 * Weekly class routine (ক্লাস রুটিন).
 *
 *   /admin/routine/classes   pick a class and edit its whole week as one grid
 *   /admin/routine/periods   the bell times every class shares
 *   /admin/routine/teachers  one teacher's week, read-only
 *
 * Routine rows are stored one per filled slot. Saving a class replaces that
 * class's rows wholesale inside a transaction, so the grid on screen is always
 * exactly what is in the table.
 */

const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const routine = require('../../lib/routine');

const router = express.Router();
const DAYS = routine.DAYS;
const hhmm = routine.hhmm;

/* No tab path may be a prefix of another, or the tab partial lights up two at
   once. /admin/routine itself therefore only redirects. */
const TABS = [
  ['/admin/routine/classes', 'Class Routine'],
  ['/admin/routine/periods', 'Periods & Times'],
  ['/admin/routine/teachers', 'Teacher View']
];

/* The WHERE that identifies one class's routine. section_id and
   academic_year_id are nullable, and NULL means "the whole class" / "no year
   recorded", so those need IS NULL rather than = ?. */
function scope(classId, sectionId, yearId, prefix) {
  const p = prefix || '';
  const where = [p + 'class_id = ?'];
  const params = [classId];
  if (sectionId) { where.push(p + 'section_id = ?'); params.push(sectionId); }
  else { where.push(p + 'section_id IS NULL'); }
  if (yearId) { where.push(p + 'academic_year_id = ?'); params.push(yearId); }
  else { where.push(p + 'academic_year_id IS NULL'); }
  return { sql: where.join(' AND '), params: params };
}

/* Shared by the editor's GET and by the POST that refuses to save a clash, so
   a rejected save comes back with the office's own edits still in the boxes. */
async function renderGrid(req, res, opts) {
  const classId = opts.classId;
  const sectionId = opts.sectionId;
  const yearId = opts.yearId;

  const [classes, years, periods] = await Promise.all([
    db.query(`SELECT c.id, c.name, d.name AS dept_name
                FROM classes c LEFT JOIN departments d ON d.id = c.department_id
               ORDER BY d.sort_order, c.level, c.name`),
    db.query('SELECT id, name, is_current FROM academic_years ORDER BY name DESC'),
    db.query('SELECT * FROM routine_periods ORDER BY sort_order, start_time, id')
  ]);

  const sections = classId
    ? await db.query('SELECT id, name FROM sections WHERE class_id = ? ORDER BY name', [classId])
    : [];

  let subjects = [];
  let teachers = [];
  if (classId) {
    const both = await Promise.all([
      db.query('SELECT id, name FROM subjects WHERE class_id = ? ORDER BY sort_order, name', [classId]),
      db.query("SELECT id, name FROM staff WHERE status = 'active' ORDER BY name")
    ]);
    subjects = both[0];
    teachers = both[1];
  }

  let grid = opts.grid;
  if (!grid && classId) {
    grid = {};
    const s = scope(classId, sectionId, yearId);
    const rows = await db.query('SELECT * FROM routine_entries WHERE ' + s.sql, s.params);
    rows.forEach(function (r) { grid[r.day_of_week + '_' + r.period_id] = r; });
  }

  res.render('admin/routine/index', {
    title: 'Class Routine',
    TABS: TABS,
    DAYS: DAYS,
    hhmm: hhmm,
    classes: classes,
    years: years,
    periods: periods,
    sections: sections,
    subjects: subjects,
    teachers: teachers,
    classId: classId,
    sectionId: sectionId,
    yearId: yearId,
    grid: grid || {},
    clashes: opts.clashes || []
  });
}

router.get('/', (req, res) => {
  const qs = require('querystring').stringify(req.query || {});
  res.redirect('/admin/routine/classes' + (qs ? '?' + qs : ''));
});

/* ------------------------------------------------------------ bell times */

router.get('/periods', async (req, res, next) => {
  try {
    const periods = await db.query('SELECT * FROM routine_periods ORDER BY sort_order, start_time, id');
    const editId = h.toInt(req.query.edit);
    const edit = editId ? periods.find(function (p) { return p.id === editId; }) : null;
    res.render('admin/routine/periods', {
      title: 'Periods & Times', TABS: TABS, periods: periods, edit: edit || null, hhmm: hhmm
    });
  } catch (err) { next(err); }
});

router.post('/periods', async (req, res, next) => {
  try {
    const b = req.body;
    const id = h.toInt(b.id);
    const name = String(b.name || '').trim();
    const start = String(b.start_time || '').trim();
    const end = String(b.end_time || '').trim();
    const isBreak = b.is_break ? 1 : 0;
    const sortOrder = h.toInt(b.sort_order) || 0;

    if (!name || !start || !end) {
      req.flash('error', 'নাম, শুরু ও শেষের সময় দিন। / Name, start time and end time are all required.');
      return res.redirect('/admin/routine/periods');
    }
    if (end <= start) {
      req.flash('error', 'শেষের সময় শুরুর সময়ের পরে হতে হবে। / The end time must be after the start time.');
      return res.redirect('/admin/routine/periods');
    }

    if (id) {
      await db.run(
        'UPDATE routine_periods SET name = ?, start_time = ?, end_time = ?, is_break = ?, sort_order = ? WHERE id = ?',
        [name, start, end, isBreak, sortOrder, id]
      );
      req.flash('success', 'Period updated.');
    } else {
      await db.run(
        'INSERT INTO routine_periods (name, start_time, end_time, is_break, sort_order) VALUES (?,?,?,?,?)',
        [name, start, end, isBreak, sortOrder]
      );
      req.flash('success', 'Period added.');
    }
    res.redirect('/admin/routine/periods');
  } catch (err) { next(err); }
});

router.delete('/periods/:id', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const used = await db.scalar('SELECT COUNT(*) AS c FROM routine_entries WHERE period_id = ?', [id]);
    await db.run('DELETE FROM routine_periods WHERE id = ?', [id]);
    req.flash('success', Number(used)
      ? 'Period deleted, along with ' + used + ' routine slot(s) that used it.'
      : 'Period deleted.');
    res.redirect('/admin/routine/periods');
  } catch (err) { next(err); }
});

/* -------------------------------------------------------- teacher view */

router.get('/teachers', async (req, res, next) => {
  try {
    const teacherId = h.toInt(req.query.teacher_id);
    const [teachers, periods] = await Promise.all([
      db.query("SELECT id, name, designation FROM staff WHERE status = 'active' ORDER BY name"),
      db.query('SELECT * FROM routine_periods ORDER BY sort_order, start_time, id')
    ]);

    const grid = {};
    let load = 0;
    if (teacherId) {
      const rows = await db.query(
        `SELECT re.*, s.name AS subject_name, cl.name AS class_name, se.name AS section_name
           FROM routine_entries re
           LEFT JOIN subjects s ON s.id = re.subject_id
           JOIN classes cl ON cl.id = re.class_id
           LEFT JOIN sections se ON se.id = re.section_id
          WHERE re.teacher_id = ?`, [teacherId]);
      rows.forEach(function (r) { grid[r.day_of_week + '_' + r.period_id] = r; });
      load = rows.length;
    }

    res.render('admin/routine/teachers', {
      title: 'Teacher Routine',
      TABS: TABS, DAYS: DAYS, hhmm: hhmm,
      teachers: teachers, periods: periods, teacherId: teacherId, grid: grid, load: load
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------- the class grid */

router.get('/classes', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const sectionId = h.toInt(req.query.section_id) || null;
    let yearId = h.toInt(req.query.year_id) || null;

    if (!yearId) {
      const cur = await db.one('SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1');
      if (cur) yearId = cur.id;
    }

    await renderGrid(req, res, { classId: classId, sectionId: sectionId, yearId: yearId });
  } catch (err) { next(err); }
});

router.post('/classes', async (req, res, next) => {
  try {
    const b = req.body;
    const classId = h.toInt(b.class_id);
    const sectionId = h.toInt(b.section_id) || null;
    const yearId = h.toInt(b.year_id) || null;

    if (!classId) {
      req.flash('error', 'একটি ক্লাস নির্বাচন করুন। / Choose a class first.');
      return res.redirect('/admin/routine/classes');
    }

    const periods = await db.query('SELECT id, name, is_break FROM routine_periods ORDER BY sort_order, start_time, id');
    const teachable = periods.filter(function (p) { return !p.is_break; });

    /* Read the grid back out of the form. A slot counts as filled when it
       names a subject, a teacher or a room. */
    const cells = [];
    const grid = {};
    DAYS.forEach(function (d) {
      teachable.forEach(function (p) {
        const key = d.n + '_' + p.id;
        const subjectId = h.toInt(b['s_' + key]) || null;
        const teacherId = h.toInt(b['t_' + key]) || null;
        const room = String(b['r_' + key] || '').trim();
        if (subjectId || teacherId || room) {
          const cell = {
            day_of_week: d.n, period_id: p.id,
            subject_id: subjectId, teacher_id: teacherId, room: room || null
          };
          cells.push(cell);
          grid[key] = cell;
        }
      });
    });

    /* A teacher cannot be in two rooms at once. Check every slot being saved
       against the other classes' routines before touching the table. */
    const clashes = [];
    const teacherIds = [];
    cells.forEach(function (c) {
      if (c.teacher_id && teacherIds.indexOf(c.teacher_id) === -1) teacherIds.push(c.teacher_id);
    });

    if (teacherIds.length) {
      const mine = scope(classId, sectionId, yearId, 're.');
      const marks = teacherIds.map(function () { return '?'; }).join(',');
      const booked = await db.query(
        `SELECT re.teacher_id, re.day_of_week, re.period_id,
                st.name AS teacher_name, cl.name AS class_name, se.name AS section_name,
                p.name AS period_name
           FROM routine_entries re
           LEFT JOIN staff st ON st.id = re.teacher_id
           JOIN classes cl ON cl.id = re.class_id
           LEFT JOIN sections se ON se.id = re.section_id
           LEFT JOIN routine_periods p ON p.id = re.period_id
          WHERE re.teacher_id IN (${marks}) AND NOT (${mine.sql})`,
        teacherIds.concat(mine.params)
      );

      const taken = {};
      booked.forEach(function (r) { taken[r.teacher_id + '_' + r.day_of_week + '_' + r.period_id] = r; });

      cells.forEach(function (c) {
        if (!c.teacher_id) return;
        const hit = taken[c.teacher_id + '_' + c.day_of_week + '_' + c.period_id];
        if (!hit) return;
        const day = DAYS.find(function (d) { return d.n === c.day_of_week; });
        clashes.push({
          teacher: hit.teacher_name || 'This teacher',
          day: day ? day.bn + ' / ' + day.en : String(c.day_of_week),
          period: hit.period_name || '',
          where: hit.class_name + (hit.section_name ? ' (' + hit.section_name + ')' : '')
        });
      });
    }

    if (clashes.length) {
      req.flash('error', clashes.length + ' টি সময়সূচি সংঘর্ষ, রুটিন সংরক্ষণ করা হয়নি। / '
        + clashes.length + ' teacher clash(es) found — nothing was saved.');
      return renderGrid(req, res, {
        classId: classId, sectionId: sectionId, yearId: yearId, grid: grid, clashes: clashes
      });
    }

    const mine2 = scope(classId, sectionId, yearId);
    await db.transaction(async (conn) => {
      await conn.execute('DELETE FROM routine_entries WHERE ' + mine2.sql, mine2.params);
      for (const c of cells) {
        await conn.execute(
          `INSERT INTO routine_entries
             (academic_year_id, class_id, section_id, period_id, day_of_week, subject_id, teacher_id, room)
           VALUES (?,?,?,?,?,?,?,?)`,
          [yearId, classId, sectionId, c.period_id, c.day_of_week, c.subject_id, c.teacher_id, c.room]
        );
      }
    });

    req.flash('success', 'রুটিন সংরক্ষিত হয়েছে। / Routine saved — ' + cells.length + ' slot(s).');
    const q = '?class_id=' + classId
      + (sectionId ? '&section_id=' + sectionId : '')
      + (yearId ? '&year_id=' + yearId : '');
    res.redirect('/admin/routine/classes' + q);
  } catch (err) { next(err); }
});

module.exports = router;

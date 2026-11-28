'use strict';
/**
 * Year-end promotion (/admin/students/promote).
 *
 * Pick the class (and section) students are in now, tick who moves, and say
 * where to: another class and section in the new academic year, "passed out"
 * (left after the final class) or "left". Everyone is moved in one
 * transaction, so a half-done promotion never happens. Students not ticked
 * stay exactly where they are.
 *
 * With an exam chosen, the list shows each student's result and the ticks
 * start on those who passed, so the usual case is one click.
 */
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');
const { classRanking } = require('../../lib/results');

const router = express.Router();

async function lookups() {
  const [classes, sections, years, exams] = await Promise.all([
    db.query(`SELECT c.id, c.name, c.department_id, d.name AS dept_name FROM classes c
                LEFT JOIN departments d ON d.id = c.department_id ORDER BY d.sort_order, c.level, c.id`),
    db.query('SELECT id, name, class_id FROM sections ORDER BY class_id, name'),
    db.query('SELECT id, name, is_current FROM academic_years ORDER BY name DESC'),
    db.query('SELECT id, name FROM exams ORDER BY id DESC LIMIT 30')
  ]);
  return { classes, sections, years, exams };
}

router.get('/', async (req, res, next) => {
  try {
    const f = {
      from_class: h.toInt(req.query.from_class) || '',
      from_section: h.toInt(req.query.from_section) || '',
      exam_id: h.toInt(req.query.exam_id) || ''
    };
    const look = await lookups();
    let students = [];
    let suggestedClass = null;
    if (f.from_class) {
      const params = [f.from_class];
      let sql = '';
      if (f.from_section) { sql = ' AND s.section_id = ?'; params.push(f.from_section); }
      students = await db.query(
        `SELECT s.id, s.name, s.roll_no, s.admission_no, sec.name AS section_name
           FROM students s LEFT JOIN sections sec ON sec.id = s.section_id
          WHERE s.status = 'active' AND s.class_id = ?${sql}
          ORDER BY s.roll_no + 0, s.name`, params);

      if (f.exam_id) {
        const ranking = await classRanking(f.exam_id, f.from_class);
        const byId = {};
        ranking.forEach((r) => { byId[r.student_id] = r; });
        students.forEach((s) => { s.result = byId[s.id] || null; });
      }

      // Suggest the next class: the one after this in the same department.
      const idx = look.classes.findIndex((c) => c.id === f.from_class);
      const cur = look.classes[idx];
      const nextInDept = look.classes.slice(idx + 1).find((c) => cur && c.department_id === cur.department_id);
      suggestedClass = nextInDept ? nextInDept.id : null;
    }
    const currentYear = look.years.find((y) => y.is_current) || look.years[0];
    res.render('admin/promotion/index', {
      title: res.locals.t('a.promo.title'), ...look, students, f, suggestedClass,
      suggestedYear: currentYear ? currentYear.id : ''
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const b = req.body;
    const fromClass = h.toInt(b.from_class);
    const action = ['promote', 'passed', 'left'].includes(b.action) ? b.action : 'promote';
    const toClass = h.toInt(b.to_class);
    const toSection = h.toInt(b.to_section);
    const toYear = h.toInt(b.to_year);
    const clearRoll = b.clear_roll ? 1 : 0;
    const picked = [].concat(b.ids || []).map(h.toInt).filter(Boolean);
    const back = `/admin/students/promote${h.qs({ from_class: fromClass, from_section: h.toInt(b.from_section), exam_id: h.toInt(b.exam_id) })}`;

    if (!fromClass || !picked.length) { req.flash('error', 'f.promo.none_selected'); return res.redirect(back); }
    if (action === 'promote' && !toClass) { req.flash('error', 'f.promo.pick_class'); return res.redirect(back); }

    const target = toClass ? await db.one('SELECT id, name, department_id, shift_id FROM classes WHERE id = ?', [toClass]) : null;
    if (action === 'promote' && !target) { req.flash('error', 'f.promo.pick_class'); return res.redirect(back); }
    if (toSection) {
      const sec = await db.one('SELECT class_id FROM sections WHERE id = ?', [toSection]);
      if (!sec || sec.class_id !== toClass) { req.flash('error', 'f.promo.section_mismatch'); return res.redirect(back); }
    }

    // Only students who really are active in the "from" class are touched.
    const ids = (await db.query(
      `SELECT id FROM students WHERE status = 'active' AND class_id = ? AND id IN (${picked.map(() => '?').join(',')})`,
      [fromClass, ...picked])).map((r) => r.id);
    if (!ids.length) { req.flash('error', 'f.promo.none_selected'); return res.redirect(back); }
    const inList = ids.map(() => '?').join(',');

    await db.transaction(async (conn) => {
      if (action === 'promote') {
        await conn.execute(
          `UPDATE students SET class_id = ?, section_id = ?, department_id = COALESCE(?, department_id),
                  academic_year_id = COALESCE(?, academic_year_id)${clearRoll ? ', roll_no = NULL' : ''}
            WHERE id IN (${inList})`,
          [toClass, toSection || null, target.department_id, toYear || null, ...ids]);
      } else {
        await conn.execute(`UPDATE students SET status = ? WHERE id IN (${inList})`, [action, ...ids]);
      }
    });

    const key = action === 'promote' ? 'f.promo.done' : (action === 'passed' ? 'f.promo.done_passed' : 'f.promo.done_left');
    req.flash('success', i18n.pack(key, { count: ids.length, cls: target ? target.name : '' }));
    res.redirect(back);
  } catch (err) { next(err); }
});

module.exports = router;

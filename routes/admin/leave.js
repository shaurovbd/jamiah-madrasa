'use strict';
/**
 * Leave applications (/admin/leave).
 *
 * Anyone whose sign-in is linked to a staff record applies for themselves.
 * The principal and admin see everyone's requests and decide. Approving writes
 * each working day of the leave into staff attendance as 'leave' with its type
 * (weekly days off are skipped), so the attendance report and payroll —
 * which deducts unpaid leave — need nothing typed twice.
 */
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');
const roles = require('../../lib/roles');
const sh = require('../../lib/shifts');

const router = express.Router();
const TYPES = ['casual', 'sick', 'earned', 'unpaid', 'maternity', 'official'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

const approver = (user) => roles.can(user.role, 'leave_approve');

async function myStaff(user) {
  return db.one("SELECT s.*, sf.weekly_off FROM staff s LEFT JOIN shifts sf ON sf.id = s.shift_id WHERE s.user_id = ? LIMIT 1", [user.id]);
}

/** Working days between two dates for this staff member (their shift's weekly days off excluded). */
function workingDays(from, to, shift) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    const iso = d.toISOString().slice(0, 10);
    if (!sh.isWeeklyOff(shift, iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

router.get('/', async (req, res, next) => {
  try {
    const user = req.session.user;
    const me = await myStaff(user);
    const canDecide = approver(user);
    const year = new Date().getFullYear();
    const [mine, pending, recent, balance, staff] = await Promise.all([
      me ? db.query('SELECT * FROM leave_requests WHERE staff_id = ? ORDER BY id DESC LIMIT 20', [me.id]) : [],
      canDecide ? db.query(`SELECT l.*, s.name, s.designation FROM leave_requests l JOIN staff s ON s.id = l.staff_id
                             WHERE l.status = 'pending' ORDER BY l.from_date`) : [],
      canDecide ? db.query(`SELECT l.*, s.name, u.name AS decided_name FROM leave_requests l JOIN staff s ON s.id = l.staff_id
                             LEFT JOIN users u ON u.id = l.decided_by
                             WHERE l.status <> 'pending' ORDER BY l.decided_at DESC, l.id DESC LIMIT 30`) : [],
      canDecide ? db.query(`SELECT s.id, s.name, l.leave_type, SUM(l.days) AS days FROM leave_requests l JOIN staff s ON s.id = l.staff_id
                             WHERE l.status = 'approved' AND YEAR(l.from_date) = ? GROUP BY s.id, s.name, l.leave_type ORDER BY s.name`, [year])
        : (me ? db.query(`SELECT leave_type, SUM(days) AS days FROM leave_requests WHERE staff_id = ? AND status = 'approved'
                           AND YEAR(from_date) = ? GROUP BY leave_type`, [me.id, year]) : []),
      canDecide ? db.query("SELECT id, name FROM staff WHERE status = 'active' ORDER BY name") : []
    ]);
    // Year summary: one row per person, one column per type.
    const summary = {};
    if (canDecide) balance.forEach((b) => { (summary[b.name] = summary[b.name] || {})[b.leave_type] = Number(b.days); });
    res.render('admin/leave/index', {
      title: res.locals.t('admin.nav.leave'), me, mine, pending, recent, canDecide, TYPES, staff, year,
      summary, myBalance: canDecide ? [] : balance, today: h.today()
    });
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') { req.flash('error', 'f.leave.table_missing'); return res.redirect('/admin'); }
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const user = req.session.user;
    const canDecide = approver(user);
    let member = await myStaff(user);
    // The principal can enter leave for someone else (a phone call, a note).
    if (canDecide && h.toInt(req.body.staff_id)) {
      member = await db.one('SELECT s.*, sf.weekly_off FROM staff s LEFT JOIN shifts sf ON sf.id = s.shift_id WHERE s.id = ?', [h.toInt(req.body.staff_id)]);
    }
    if (!member) { req.flash('error', 'f.leave.no_staff'); return res.redirect('/admin/leave'); }
    const type = TYPES.includes(req.body.leave_type) ? req.body.leave_type : 'casual';
    const from = req.body.from_date, to = req.body.to_date || req.body.from_date;
    if (!isDate(from) || !isDate(to) || to < from) { req.flash('error', 'f.leave.bad_dates'); return res.redirect('/admin/leave'); }
    const days = workingDays(from, to, { weekly_off: member.weekly_off }).length;
    if (!days) { req.flash('error', 'f.leave.no_working_days'); return res.redirect('/admin/leave'); }
    const clash = await db.one(
      `SELECT id FROM leave_requests WHERE staff_id = ? AND status IN ('pending','approved') AND from_date <= ? AND to_date >= ? LIMIT 1`,
      [member.id, to, from]);
    if (clash) { req.flash('error', 'f.leave.overlap'); return res.redirect('/admin/leave'); }
    await db.run(
      `INSERT INTO leave_requests (staff_id, leave_type, from_date, to_date, days, reason, requested_by) VALUES (?,?,?,?,?,?,?)`,
      [member.id, type, from, to, days, h.orNull(String(req.body.reason || '').slice(0, 500)), user.id]);
    req.flash('success', i18n.pack('f.leave.sent', { days }));
    res.redirect('/admin/leave');
  } catch (err) { next(err); }
});

async function decide(req, res, next, status) {
  try {
    if (!approver(req.session.user)) { res.status(403); return res.render('admin/forbidden', { title: res.locals.t('error.forbidden.title'), needed: [] }); }
    const id = h.toInt(req.params.id);
    const lr = await db.one(
      `SELECT l.*, s.shift_id, sf.weekly_off FROM leave_requests l JOIN staff s ON s.id = l.staff_id
         LEFT JOIN shifts sf ON sf.id = s.shift_id WHERE l.id = ?`, [id]);
    if (!lr || lr.status !== 'pending') { req.flash('error', 'f.leave.already'); return res.redirect('/admin/leave'); }
    const note = h.orNull(String(req.body.decision_note || '').slice(0, 255));
    await db.transaction(async (conn) => {
      await conn.execute('UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ?',
        [status, req.session.user.id, note, id]);
      if (status === 'approved') {
        for (const day of workingDays(h.inputDate(lr.from_date), h.inputDate(lr.to_date), { weekly_off: lr.weekly_off })) {
          await conn.execute(
            `INSERT INTO staff_attendance (staff_id, shift_id, adate, status, leave_type, remarks, taken_by)
             VALUES (?,?,?,'leave',?,?,?)
             ON DUPLICATE KEY UPDATE status = 'leave', leave_type = VALUES(leave_type), remarks = VALUES(remarks), taken_by = VALUES(taken_by)`,
            [lr.staff_id, lr.shift_id || null, day, lr.leave_type, `ছুটির আবেদন #${id}`, req.session.user.id]);
        }
      }
    });
    req.flash('success', status === 'approved' ? 'f.leave.approved' : 'f.leave.rejected');
    res.redirect('/admin/leave');
  } catch (err) { next(err); }
}
router.post('/:id/approve', (req, res, next) => decide(req, res, next, 'approved'));
router.post('/:id/reject', (req, res, next) => decide(req, res, next, 'rejected'));

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const me = await myStaff(req.session.user);
    const r = me ? await db.run("UPDATE leave_requests SET status = 'cancelled' WHERE id = ? AND staff_id = ? AND status = 'pending'",
      [h.toInt(req.params.id), me.id]) : { affectedRows: 0 };
    req.flash(r.affectedRows ? 'success' : 'error', r.affectedRows ? 'f.leave.cancelled' : 'f.leave.already');
    res.redirect('/admin/leave');
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.workingDays = workingDays;

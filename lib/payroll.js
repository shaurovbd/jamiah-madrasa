'use strict';
/**
 * Monthly payslips from the staff list and staff attendance.
 *
 *   basic            staff.salary
 *   daily rate       basic / days in the month
 *   absence          absent days + half of each half-day + unpaid-leave days,
 *                    times the daily rate. Days with no attendance taken count
 *                    as present, so a month nobody recorded deducts nothing.
 *   advance          each open advance takes its monthly instalment (never more
 *                    than is left on it, and never more than the pay itself)
 *   net              basic + allowance + bonus − absence − advance − other
 *
 * Allowance, bonus and other deductions are typed in on the draft sheet.
 * Late arrivals are counted and shown but not deducted.
 */
const db = require('../config/db');

const round = (n) => Math.round(Number(n || 0));

function daysIn(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Staff who teach: linked to a teacher sign-in, or set as section/subject/routine teacher. */
async function teacherIds() {
  const rows = await db.query(
    `SELECT s.id FROM staff s LEFT JOIN users u ON u.id = s.user_id
      WHERE u.role IN ('teacher','hifz_teacher')
         OR s.id IN (SELECT teacher_id FROM sections WHERE teacher_id IS NOT NULL)
         OR s.id IN (SELECT teacher_id FROM subjects WHERE teacher_id IS NOT NULL)`);
  const extra = await db.query('SELECT DISTINCT teacher_id AS id FROM routine_entries WHERE teacher_id IS NOT NULL').catch(() => []);
  return new Set(rows.concat(extra).map((r) => r.id));
}

async function attendanceFor(period) {
  const rows = await db.query(
    `SELECT staff_id,
            SUM(status = 'absent') AS absent,
            SUM(status = 'half_day') AS half,
            SUM(status = 'late') AS late,
            SUM(status = 'leave' AND leave_type = 'unpaid') AS unpaid
       FROM staff_attendance WHERE DATE_FORMAT(adate, '%Y-%m') = ? GROUP BY staff_id`, [period]);
  const map = {};
  rows.forEach((r) => { map[r.staff_id] = r; });
  return map;
}

async function openAdvances() {
  const rows = await db.query('SELECT * FROM staff_advances WHERE recovered < amount ORDER BY given_on, id');
  const map = {};
  rows.forEach((a) => { (map[a.staff_id] = map[a.staff_id] || []).push(a); });
  return map;
}

/** Recompute a slip's figures from its inputs. Mutates and returns it. */
function figure(slip, advancesForStaff) {
  const daily = Number(slip.basic) / Number(slip.days_in_month || 30);
  slip.absence_deduction = round(daily * (Number(slip.absent_days) + Number(slip.unpaid_leave_days)));
  const gross = Number(slip.basic) + Number(slip.allowance) + Number(slip.bonus) - slip.absence_deduction - Number(slip.other_deduction);
  if (advancesForStaff) {
    let adv = 0;
    for (const a of advancesForStaff) adv += Math.min(Number(a.monthly_installment), Number(a.amount) - Number(a.recovered));
    slip.advance_deduction = round(Math.max(0, Math.min(adv, gross)));
  }
  slip.net = Math.max(0, round(gross - Number(slip.advance_deduction)));
  return slip;
}

/** Fresh slips for every active staff member with a salary. */
async function buildSlips(period) {
  const [staff, att, adv, teachers] = await Promise.all([
    db.query("SELECT id, salary FROM staff WHERE status = 'active' AND salary > 0 ORDER BY name"),
    attendanceFor(period), openAdvances(), teacherIds()
  ]);
  const days = daysIn(period);
  return staff.map((s) => {
    const a = att[s.id] || {};
    return figure({
      staff_id: s.id,
      expense_head: teachers.has(s.id) ? 'teacher' : 'staff',
      basic: Number(s.salary), allowance: 0, bonus: 0, other_deduction: 0, advance_deduction: 0,
      days_in_month: days,
      absent_days: Number(a.absent || 0) + Number(a.half || 0) * 0.5,
      unpaid_leave_days: Number(a.unpaid || 0),
      late_days: Number(a.late || 0)
    }, adv[s.id]);
  });
}

module.exports = { buildSlips, figure, attendanceFor, openAdvances, teacherIds, daysIn };

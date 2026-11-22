'use strict';

/**
 * Shared shift logic, used by the shift settings page, student attendance and
 * staff attendance, so the three can never disagree about what counts as late.
 *
 * Day numbers follow JavaScript's Date#getDay(): 0 = Sunday … 6 = Saturday.
 * That is deliberately NOT the same numbering as routine_entries.day_of_week
 * (which starts the week on Saturday), because a weekly holiday is compared
 * against a real calendar date here, and `new Date(...).getDay()` is what we
 * have in hand.
 */

const WEEKDAYS = [
  { n: 0, bn: 'রবিবার', en: 'Sunday', keyShort: 'day.short.sun' },
  { n: 1, bn: 'সোমবার', en: 'Monday', keyShort: 'day.short.mon' },
  { n: 2, bn: 'মঙ্গলবার', en: 'Tuesday', keyShort: 'day.short.tue' },
  { n: 3, bn: 'বুধবার', en: 'Wednesday', keyShort: 'day.short.wed' },
  { n: 4, bn: 'বৃহস্পতিবার', en: 'Thursday', keyShort: 'day.short.thu' },
  { n: 5, bn: 'শুক্রবার', en: 'Friday', keyShort: 'day.short.fri' },
  { n: 6, bn: 'শনিবার', en: 'Saturday', keyShort: 'day.short.sat' }
];

const STAFF_STATUSES = ['present', 'late', 'half_day', 'absent', 'leave'];
const LEAVE_TYPES = ['casual', 'sick', 'earned', 'unpaid', 'maternity', 'official'];

/** MySQL hands back TIME as 'HH:MM:SS'; the screens only ever show HH:MM. */
function hhmm(t) {
  if (!t) return '';
  const s = String(t);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

/** 'HH:MM' or 'HH:MM:SS' -> minutes since midnight, or null if unreadable. */
function toMinutes(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/** '07:30' -> '07:30:00', for a TIME column. Empty input stays null. */
function toTimeValue(t) {
  const mins = toMinutes(t);
  if (mins === null) return null;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`;
}

/** weekly_off is stored as "5" or "5,6"; read it back as a list of numbers. */
function offDays(weeklyOff) {
  return String(weeklyOff || '')
    .split(',')
    .map((d) => parseInt(d, 10))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

/** Normalise a set of checkbox values back into the stored "5,6" form. */
function packOffDays(values) {
  const list = (Array.isArray(values) ? values : [values])
    .map((d) => parseInt(d, 10))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return [...new Set(list)].sort((a, b) => a - b).join(',');
}

/** Is this date a weekly holiday for this shift? `date` is 'YYYY-MM-DD'. */
function isWeeklyOff(shift, date) {
  if (!shift || !date) return false;
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return offDays(shift.weekly_off).includes(d.getDay());
}

/**
 * Status implied by an arrival time, given the shift's own rules:
 *   within grace            -> present
 *   past the half-day mark  -> half_day
 *   anything between        -> late
 *
 * Returns null when there is nothing to judge (no time, or no shift to judge
 * it against), so the caller keeps whatever the clerk chose by hand.
 */
function statusFromInTime(shift, inTime) {
  if (!shift) return null;
  const arrived = toMinutes(inTime);
  const starts = toMinutes(shift.start_time);
  if (arrived === null || starts === null) return null;

  const lateBy = arrived - starts;
  if (lateBy <= Number(shift.grace_minutes || 0)) return 'present';
  if (lateBy >= Number(shift.half_day_after || Infinity)) return 'half_day';
  return 'late';
}

/** "07:30 – 11:30", for list rows and page headers. */
function window_(shift) {
  if (!shift) return '';
  return `${hhmm(shift.start_time)} – ${hhmm(shift.end_time)}`;
}

module.exports = {
  WEEKDAYS,
  STAFF_STATUSES,
  LEAVE_TYPES,
  hhmm,
  toMinutes,
  toTimeValue,
  offDays,
  packOffDays,
  isWeeklyOff,
  statusFromInTime,
  window: window_
};

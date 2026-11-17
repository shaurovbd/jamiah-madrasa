'use strict';

/**
 * Shared bits of the weekly class routine, used by both the admin module
 * (routes/admin/routine.js) and the public page (routes/public.js), so the two
 * can never drift apart on day order or time formatting.
 */

/* Friday is the weekly holiday, so the working week runs Saturday to Thursday.
   `n` is what goes in routine_entries.day_of_week. */
const DAYS = [
  { n: 0, bn: 'শনিবার',      en: 'Saturday' },
  { n: 1, bn: 'রবিবার',      en: 'Sunday' },
  { n: 2, bn: 'সোমবার',      en: 'Monday' },
  { n: 3, bn: 'মঙ্গলবার',     en: 'Tuesday' },
  { n: 4, bn: 'বুধবার',       en: 'Wednesday' },
  { n: 5, bn: 'বৃহস্পতিবার',  en: 'Thursday' }
];

/* MySQL hands back TIME as 'HH:MM:SS'; a routine only ever shows HH:MM. */
function hhmm(t) {
  if (!t) return '';
  const s = String(t);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

module.exports = { DAYS: DAYS, hhmm: hhmm };

'use strict';
/**
 * The four numbers on the home page.
 *
 * A number typed in Settings wins, and is printed exactly as typed so the
 * client can write "500+" or Bangla digits. Left blank, it is counted from the
 * records instead, which is what the site did before these fields existed.
 */
const db = require('../config/db');
const h = require('./helpers');

const KEYS = [
  ['stat_students', 'Students'],
  ['stat_teachers', 'Teachers & Staff'],
  ['stat_huffaz', 'Huffaz Graduated'],
  ['stat_years', 'Years of Service']
];

async function autoCounts(settings = {}) {
  const [students, staff, huffaz] = await Promise.all([
    db.scalar("SELECT COUNT(*) AS c FROM students WHERE status = 'active'"),
    db.scalar("SELECT COUNT(*) AS c FROM staff WHERE status = 'active'"),
    db.scalar('SELECT COALESCE(SUM(hifz_para_completed >= 30), 0) AS c FROM students')
  ]);
  const established = Number(settings.established || 0);
  const years = established > 1900 ? Math.max(1, new Date().getFullYear() - established) : 0;
  return { stat_students: students, stat_teachers: staff, stat_huffaz: huffaz, stat_years: years };
}

async function forHome(settings = {}) {
  const auto = await autoCounts(settings);
  return KEYS.map(([key, fallbackLabel]) => {
    const manual = String(settings[key] == null ? '' : settings[key]).trim();
    return {
      value: manual !== '' ? manual : h.num(auto[key]),
      label: String(settings[`${key}_label`] || '').trim() || fallbackLabel,
      auto: manual === ''
    };
  });
}

module.exports = { forHome, autoCounts, KEYS };

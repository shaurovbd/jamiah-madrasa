'use strict';
/**
 * Guardian portal accounts: one per guardian mobile number (guardian_accounts).
 * Phones are always stored in the 8801XXXXXXXXX form (lib/sms normalizePhone),
 * whatever way the office typed them on the student record.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { normalizePhone } = require('./sms');

const MAX_FAILS = 5;
// Compared against when a number has no account, so a wrong number takes as
// long to answer as a wrong PIN.
const DUMMY_HASH = bcrypt.hashSync('000000', 8);
const LOCK_MINUTES = 15;

/** A random 6-digit PIN that does not start with 0 (easier to read aloud). */
function newPin() {
  return String(100000 + crypto.randomInt(900000));
}

/** Active students whose guardian phone is this (normalised) number. */
async function childrenOf(phone) {
  // Narrow by the last four digits in SQL (the stored number may hold spaces,
  // dashes or +88), then compare the full number in its normal form.
  const tail = String(phone).slice(-4);
  const rows = await db.query(
    `SELECT s.id, s.name, s.roll_no, s.admission_no, s.photo, s.gender, s.guardian_phone, s.hifz_para_completed,
            s.class_id, c.name AS class_name, sec.name AS section_name, d.name AS dept_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN departments d ON d.id = s.department_id
      WHERE s.status = 'active' AND s.guardian_phone LIKE ?
      ORDER BY s.name`, [`%${tail}%`]);
  return rows.filter((s) => normalizePhone(s.guardian_phone) === phone);
}

/** Set a fresh PIN for a phone (creating the account if needed). -> the PIN, in clear, once. */
async function setPin(phone, userId) {
  const pin = newPin();
  const hash = await bcrypt.hash(pin, 8);
  await db.run(
    `INSERT INTO guardian_accounts (phone, pin_hash, created_by) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE pin_hash = VALUES(pin_hash), failed_count = 0, locked_until = NULL`,
    [phone, hash, userId || null]);
  return pin;
}

/**
 * -> { ok: true } or { ok: false, reason: 'unknown'|'locked'|'wrong' }.
 * The page shows the same message for unknown and wrong, so it does not reveal
 * which numbers have an account.
 */
async function verify(phone, pin) {
  const acc = await db.one('SELECT * FROM guardian_accounts WHERE phone = ?', [phone]);
  if (!acc) {
    await bcrypt.compare(String(pin), DUMMY_HASH);
    return { ok: false, reason: 'unknown' };
  }
  if (acc.locked_until && new Date(acc.locked_until) > new Date()) return { ok: false, reason: 'locked' };
  const good = /^\d{6}$/.test(String(pin)) && await bcrypt.compare(String(pin), acc.pin_hash);
  if (!good) {
    const fails = acc.failed_count + 1;
    await db.run(
      `UPDATE guardian_accounts SET failed_count = ?, locked_until = ${fails >= MAX_FAILS ? `NOW() + INTERVAL ${LOCK_MINUTES} MINUTE` : 'NULL'}
        WHERE phone = ?`, [fails >= MAX_FAILS ? 0 : fails, phone]);
    return { ok: false, reason: fails >= MAX_FAILS ? 'locked' : 'wrong' };
  }
  await db.run('UPDATE guardian_accounts SET failed_count = 0, locked_until = NULL, last_login = NOW() WHERE phone = ?', [phone]);
  return { ok: true };
}

module.exports = { newPin, childrenOf, setPin, verify, normalizePhone, MAX_FAILS, LOCK_MINUTES };

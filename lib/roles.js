'use strict';
/**
 * Who may open which part of the management panel — in one place.
 *
 * routes/admin/index.js guards each module with this map, the sidebar and the
 * dashboard read it to decide what to show, and the Users page lists ROLES.
 * Change access here and every one of those follows.
 *
 * `admin` passes everything and is not listed. `principal` sees everything
 * except user accounts and settings.
 */

const ROLES = ['admin', 'principal', 'accountant', 'office', 'teacher', 'hifz_teacher', 'librarian'];

const ACCESS = {
  students:   ['principal', 'accountant', 'office', 'teacher', 'hifz_teacher'],
  admissions: ['principal', 'accountant', 'office'],
  staff:      ['principal', 'accountant', 'office', 'teacher'],
  academics:  ['principal', 'teacher'],
  routine:    ['principal', 'office', 'teacher', 'hifz_teacher'],
  attendance: ['principal', 'teacher', 'hifz_teacher'],
  exams:      ['principal', 'teacher'],
  hifz:       ['principal', 'teacher', 'hifz_teacher'],
  fees:       ['principal', 'accountant'],
  finance:    ['principal', 'accountant'],       // ledger, receipts, loans, donors (sidebar)
  orphans:    ['principal'],                     // children's family details
  library:    ['principal', 'librarian'],
  hostel:     ['principal', 'accountant'],
  notices:    ['principal', 'office'],
  events:     ['principal', 'office'],
  gallery:    ['principal', 'office'],
  pages:      ['principal', 'office'],
  messages:   ['principal', 'office'],
  logs:       ['principal'],
  sms:        ['principal', 'office', 'accountant'],   // SMS to guardians
  sms_config: [],                                      // SMS gateway key and settings
  promotion:  ['principal', 'office'],                 // year-end class promotion
  print:      ['principal', 'office'],                 // ID cards, admit cards, certificates
  users:      [],
  settings:   []
};

/** Can this role open this area? Unknown areas are admin-only. */
function can(role, area) {
  if (role === 'admin') return true;
  return (ACCESS[area] || []).includes(role);
}

/** The roles allowed into an area, for requireRole(...). */
function rolesFor(area) {
  return ACCESS[area] || [];
}

/**
 * Finance pages have their own role (users.finance_role). When an account has
 * none set, it follows the main role, so "Accountant" is enough on its own.
 * A finance_role set by hand always wins.
 */
/**
 * Roles that only see the classes they teach (lib/scope.js): the classes where
 * they are section teacher, subject teacher, or have a routine period.
 */
const CLASS_LIMITED = ['teacher', 'hifz_teacher'];

/** Roles that may read students but not add, edit or delete them. */
const STUDENT_READ_ONLY = ['teacher', 'hifz_teacher'];

const FINANCE_DEFAULT = { admin: 'principal', principal: 'principal', accountant: 'accountant' };

function financeRoleFor(mainRole, stored) {
  if (stored && stored !== 'none') return stored;
  return FINANCE_DEFAULT[mainRole] || 'none';
}

module.exports = { ROLES, ACCESS, CLASS_LIMITED, STUDENT_READ_ONLY, can, rolesFor, financeRoleFor };

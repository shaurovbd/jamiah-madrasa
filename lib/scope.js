'use strict';
/**
 * Which classes a teacher may work with.
 *
 * Teachers and Hifz teachers (lib/roles.js CLASS_LIMITED) see only:
 *   - classes where they are the section (class) teacher   sections.teacher_id
 *   - classes where they teach a subject                   subjects.teacher_id
 *   - classes where they have a period in the routine      routine_entries.teacher_id
 * and, for marks, only the subjects they teach — or every subject of a class
 * they are class teacher of.
 *
 * The link from a sign-in to a teacher is staff.user_id ("Link to staff
 * record" on the Users page). A teacher with no link, or with no classes
 * assigned, sees an empty list and a note saying why — never other classes.
 *
 * Everyone else gets { limited: false } and nothing changes for them.
 */
const db = require('../config/db');
const h = require('./helpers');
const { CLASS_LIMITED } = require('./roles');

async function loadScope(req) {
  if (req._scope) return req._scope;
  const user = req.session && req.session.user;
  if (!user || !CLASS_LIMITED.includes(user.role)) {
    req._scope = { limited: false };
    return req._scope;
  }

  const staff = await db.one("SELECT id FROM staff WHERE user_id = ? AND status = 'active' LIMIT 1", [user.id]);
  const scope = {
    limited: true,
    staffId: staff ? staff.id : null,
    classIds: new Set(),
    classTeacherOf: new Set(),
    subjectIds: new Set()
  };

  if (staff) {
    const [secRows, subRows, routineRows] = await Promise.all([
      db.query('SELECT DISTINCT class_id FROM sections WHERE teacher_id = ?', [staff.id]),
      db.query('SELECT id, class_id FROM subjects WHERE teacher_id = ?', [staff.id]),
      db.query('SELECT DISTINCT class_id, subject_id FROM routine_entries WHERE teacher_id = ?', [staff.id])
        .catch(() => []) // routine tables may not exist on a very old database
    ]);
    secRows.forEach((r) => { scope.classIds.add(r.class_id); scope.classTeacherOf.add(r.class_id); });
    subRows.forEach((r) => { scope.classIds.add(r.class_id); scope.subjectIds.add(r.id); });
    routineRows.forEach((r) => { scope.classIds.add(r.class_id); if (r.subject_id) scope.subjectIds.add(r.subject_id); });
  }

  req._scope = scope;
  return scope;
}

function classAllowed(scope, classId) {
  return !scope.limited || scope.classIds.has(Number(classId));
}

/** Marks: own subjects, or any subject of a class they are class teacher of. */
async function subjectAllowed(scope, subjectId) {
  if (!scope.limited) return true;
  const id = Number(subjectId);
  if (scope.subjectIds.has(id)) return true;
  const sub = await db.one('SELECT class_id FROM subjects WHERE id = ?', [id]);
  return Boolean(sub && scope.classTeacherOf.has(sub.class_id));
}

/** Keep only the rows (classes) this person may see. rows need an `id`. */
function filterClasses(scope, rows) {
  return scope.limited ? rows.filter((r) => scope.classIds.has(r.id)) : rows;
}

/** Keep only the subjects this person may enter marks for. rows need id and class_id or a known classId. */
function filterSubjects(scope, rows, classId) {
  if (!scope.limited) return rows;
  return rows.filter((r) => scope.subjectIds.has(r.id) || scope.classTeacherOf.has(Number(r.class_id || classId)));
}

async function studentAllowed(scope, studentId) {
  if (!scope.limited) return true;
  const s = await db.one('SELECT class_id FROM students WHERE id = ?', [Number(studentId)]);
  return Boolean(s && scope.classIds.has(s.class_id));
}

/** Of these student ids, the ones inside this person's classes. */
async function allowedStudentIds(scope, ids) {
  const list = ids.map(Number).filter(Boolean);
  if (!scope.limited || !list.length) return new Set(list);
  if (!scope.classIds.size) return new Set();
  const rows = await db.query(
    `SELECT id FROM students WHERE id IN (${list.map(() => '?').join(',')})
       AND class_id IN (${[...scope.classIds].map(() => '?').join(',')})`,
    [...list, ...scope.classIds]
  );
  return new Set(rows.map((r) => r.id));
}

/** SQL fragment limiting `alias.class_id` to this scope, for list queries. */
function classSql(scope, alias = 's') {
  if (!scope.limited) return { sql: '', params: [] };
  if (!scope.classIds.size) return { sql: ' AND 1 = 0', params: [] };
  const ids = [...scope.classIds];
  return { sql: ` AND ${alias}.class_id IN (${ids.map(() => '?').join(',')})`, params: ids };
}

function deny(req, res) {
  res.status(403);
  return res.render('admin/forbidden', { title: res.locals.t('a.scope.not_your_class'), needed: [] });
}

/**
 * Router middleware: loads the scope, exposes it to views as `scope`, and
 * refuses any class_id / subject_id in the query or form that is not theirs.
 * Student ids are checked by the routes themselves (studentAllowed / allowedStudentIds).
 */
function guard() {
  return async (req, res, next) => {
    try {
      const scope = await loadScope(req);
      res.locals.scope = scope;
      if (!scope.limited) return next();
      const src = Object.assign({}, req.query, req.body && typeof req.body === 'object' ? req.body : {});
      const classId = h.toInt(src.class_id);
      if (classId && !classAllowed(scope, classId)) return deny(req, res);
      const subjectId = h.toInt(src.subject_id);
      if (subjectId && !(await subjectAllowed(scope, subjectId))) return deny(req, res);
      next();
    } catch (err) { next(err); }
  };
}

module.exports = {
  loadScope, guard, deny, classAllowed, subjectAllowed, filterClasses, filterSubjects,
  studentAllowed, allowedStudentIds, classSql
};

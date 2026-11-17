'use strict';
const db = require('../config/db');
const { gradeFor } = require('./helpers');

/**
 * Build a marksheet for one student in one exam.
 * Returns null when the student has no marks recorded for that exam.
 */
async function buildMarksheet(examId, studentId) {
  const student = await db.one(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name, d.name AS dept_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN departments d ON d.id = s.department_id
      WHERE s.id = ?`, [studentId]
  );
  if (!student) return null;

  const exam = await db.one('SELECT * FROM exams WHERE id = ?', [examId]);
  if (!exam) return null;

  const rows = await db.query(
    `SELECT sub.id AS subject_id, sub.name AS subject, sub.code, sub.full_marks, sub.pass_marks,
            m.marks, m.is_absent
       FROM subjects sub
       LEFT JOIN exam_marks m ON m.subject_id = sub.id AND m.exam_id = ? AND m.student_id = ?
      WHERE sub.class_id = ?
      ORDER BY sub.sort_order, sub.id`,
    [examId, studentId, student.class_id]
  );
  if (!rows.length) return null;

  let totalObtained = 0, totalFull = 0, failed = 0, graded = 0, pointSum = 0, anyMark = false;
  const subjects = rows.map((r) => {
    const full = Number(r.full_marks || 100);
    const absent = !!r.is_absent;
    const marks = r.marks === null || r.marks === undefined ? null : Number(r.marks);
    if (marks !== null) anyMark = true;
    const effective = absent ? 0 : (marks || 0);
    const percent = full ? (effective / full) * 100 : 0;
    const g = gradeFor(percent);
    const passed = !absent && marks !== null && effective >= Number(r.pass_marks || 33);
    if (marks !== null || absent) {
      totalObtained += effective;
      totalFull += full;
      graded++;
      pointSum += g.point;
      if (!passed) failed++;
    }
    return {
      subject_id: r.subject_id, subject: r.subject, code: r.code,
      full_marks: full, pass_marks: Number(r.pass_marks || 33),
      marks: absent ? null : marks, is_absent: absent,
      percent: Math.round(percent * 100) / 100,
      grade: (marks === null && !absent) ? '—' : g.grade,
      point: g.point, passed
    };
  });

  if (!anyMark) return null;

  const percent = totalFull ? (totalObtained / totalFull) * 100 : 0;
  const overall = gradeFor(percent);
  const gpa = failed > 0 ? 0 : (graded ? Math.round((pointSum / graded) * 100) / 100 : 0);

  return {
    exam, student, subjects,
    summary: {
      total_obtained: Math.round(totalObtained * 100) / 100,
      total_full: totalFull,
      percent: Math.round(percent * 100) / 100,
      grade: failed > 0 ? 'F' : overall.grade,
      gpa,
      failed_count: failed,
      result: failed > 0 ? 'Failed' : 'Passed'
    }
  };
}

/** Class ranking for an exam: [{student_id, name, roll_no, total, percent, position}] */
async function classRanking(examId, classId) {
  const rows = await db.query(
    `SELECT s.id AS student_id, s.name, s.roll_no,
            SUM(CASE WHEN m.is_absent = 1 THEN 0 ELSE m.marks END) AS total,
            SUM(sub.full_marks) AS full,
            SUM(CASE WHEN m.is_absent = 1 OR m.marks < sub.pass_marks THEN 1 ELSE 0 END) AS failed
       FROM students s
       JOIN exam_marks m ON m.student_id = s.id AND m.exam_id = ?
       JOIN subjects sub ON sub.id = m.subject_id
      WHERE s.class_id = ?
      GROUP BY s.id, s.name, s.roll_no
      ORDER BY failed ASC, total DESC`,
    [examId, classId]
  );
  return rows.map((r, i) => ({
    student_id: r.student_id,
    name: r.name,
    roll_no: r.roll_no,
    total: Number(r.total || 0),
    full: Number(r.full || 0),
    percent: Number(r.full) ? Math.round((Number(r.total) / Number(r.full)) * 10000) / 100 : 0,
    failed: Number(r.failed || 0),
    result: Number(r.failed || 0) > 0 ? 'Failed' : 'Passed',
    position: i + 1
  }));
}

module.exports = { buildMarksheet, classRanking };

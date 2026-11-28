'use strict';
/**
 * Printable documents (/admin/print).
 *
 *   GET  /                        the hub: pick a document and who it is for
 *   GET  /id-cards                student ID cards, 10 to an A4 sheet
 *                                 ?class_id[&section_id]  or  ?student_id
 *   GET  /admit-cards             exam admit cards, 2 to an A4 sheet
 *                                 ?exam_id&class_id[&section_id]
 *   POST /issue                   issue a testimonial / transfer certificate /
 *                                 Hifz certificate: gives it a serial number and
 *                                 records it in issued_documents
 *   GET  /doc/:id                 print (or reprint) an issued certificate
 *
 * Certificates are numbered PT-2026-0001 (testimonial), TC-… and HC-…, and
 * carry a QR code with the serial, name and date, so a copy can be checked
 * against the register on the hub page.
 */
const express = require('express');
const QRCode = require('qrcode');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const settingsLib = require('../../lib/settings');
const docVerify = require('../../lib/doc-verify');

const router = express.Router();

const DOCS = ['testimonial', 'tc', 'hifz'];
const PREFIX = { testimonial: 'PT', tc: 'TC', hifz: 'HC' };

const STUDENT_SQL = `
  SELECT s.*, c.name AS class_name, sec.name AS section_name, d.name AS dept_name, y.name AS year_name
    FROM students s
    LEFT JOIN classes c ON c.id = s.class_id
    LEFT JOIN sections sec ON sec.id = s.section_id
    LEFT JOIN departments d ON d.id = s.department_id
    LEFT JOIN academic_years y ON y.id = s.academic_year_id`;

function qr(text) {
  return QRCode.toDataURL(text, { margin: 0, width: 220, errorCorrectionLevel: 'M' });
}

async function org() {
  const s = await settingsLib.all();
  return {
    name: s.site_name || 'Jamiah Scholars International',
    name_bn: s.site_name_bn || '',
    short: s.site_short || '',
    address: s.address || '',
    phone: s.phone || '',
    email: s.email || '',
    established: s.established || '',
    principal: s.principal_name || ''
  };
}

/** Print pages render in their own bare layout. */
function printView(res, view, locals) {
  res.render(view, Object.assign({ layout: 'layouts/print' }, locals));
}

/* ------------------------------------------------------------------ hub */
router.get('/', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const studentId = h.toInt(req.query.student_id);
    const doc = DOCS.includes(req.query.doc) ? req.query.doc : 'testimonial';
    const [classes, sections, exams, recent] = await Promise.all([
      db.query('SELECT id, name FROM classes ORDER BY department_id, level, id'),
      db.query('SELECT id, name, class_id FROM sections ORDER BY class_id, name'),
      db.query('SELECT id, name FROM exams ORDER BY id DESC LIMIT 30'),
      db.query(`SELECT d.*, s.name AS student_name, s.admission_no, u.name AS issued_by_name
                  FROM issued_documents d JOIN students s ON s.id = d.student_id
                  LEFT JOIN users u ON u.id = d.issued_by
                 ORDER BY d.id DESC LIMIT 30`).catch((e) => { if (e.code === 'ER_NO_SUCH_TABLE') return null; throw e; })
    ]);
    const student = studentId ? await db.one(`${STUDENT_SQL} WHERE s.id = ?`, [studentId]) : null;
    const pickList = !student && classId
      ? await db.query("SELECT id, name, roll_no, admission_no, status FROM students WHERE class_id = ? ORDER BY status, roll_no + 0, name", [classId])
      : [];
    res.render('admin/print/hub', {
      title: res.locals.t('admin.nav.print'), classes, sections, exams, recent, student, pickList, doc,
      filters: { class_id: classId }, DOCS, today: h.today(), tableMissing: recent === null
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- ID cards */
router.get('/id-cards', async (req, res, next) => {
  try {
    const studentId = h.toInt(req.query.student_id);
    const classId = h.toInt(req.query.class_id);
    const sectionId = h.toInt(req.query.section_id);
    let students = [];
    if (studentId) students = await db.query(`${STUDENT_SQL} WHERE s.id = ?`, [studentId]);
    else if (classId) {
      const params = [classId];
      let sql = '';
      if (sectionId) { sql = ' AND s.section_id = ?'; params.push(sectionId); }
      students = await db.query(`${STUDENT_SQL} WHERE s.status = 'active' AND s.class_id = ?${sql} ORDER BY s.roll_no + 0, s.name`, params);
    }
    const o = await org();
    for (const s of students) {
      s.qr = await qr(`${o.name}\n${s.name}\nID: ${s.admission_no}\n${s.class_name || ''}${s.roll_no ? ' · Roll ' + s.roll_no : ''}`);
    }
    printView(res, 'admin/print/id-cards', { title: res.locals.t('a.print.id_cards'), students, org: o });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------- admit cards */
router.get('/admit-cards', async (req, res, next) => {
  try {
    const examId = h.toInt(req.query.exam_id);
    const classId = h.toInt(req.query.class_id);
    const sectionId = h.toInt(req.query.section_id);
    const exam = examId ? await db.one('SELECT e.*, y.name AS year_name FROM exams e LEFT JOIN academic_years y ON y.id = e.academic_year_id WHERE e.id = ?', [examId]) : null;
    let students = [];
    let subjects = [];
    if (exam && classId) {
      const params = [classId];
      let sql = '';
      if (sectionId) { sql = ' AND s.section_id = ?'; params.push(sectionId); }
      [students, subjects] = await Promise.all([
        db.query(`${STUDENT_SQL} WHERE s.status = 'active' AND s.class_id = ?${sql} ORDER BY s.roll_no + 0, s.name`, params),
        db.query('SELECT name, code, full_marks FROM subjects WHERE class_id = ? ORDER BY sort_order, id', [classId])
      ]);
    }
    printView(res, 'admin/print/admit-cards', { title: res.locals.t('a.print.admit_cards'), exam, students, subjects, org: await org() });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------- certificates */
router.post('/issue', async (req, res, next) => {
  try {
    const b = req.body;
    const docType = DOCS.includes(b.doc_type) ? b.doc_type : null;
    const studentId = h.toInt(b.student_id);
    const student = studentId ? await db.one('SELECT id FROM students WHERE id = ?', [studentId]) : null;
    if (!docType || !student) { req.flash('error', 'f.print.pick_student'); return res.redirect('/admin/print'); }

    const data = {};
    const keep = ['issue_date', 'leaving_date', 'reason', 'conduct', 'last_class', 'dues_cleared',
      'completion_date', 'ustad', 'remarks', 'session'];
    keep.forEach((k) => { if (b[k] !== undefined) data[k] = String(b[k]).trim().slice(0, 300); });
    if (!data.issue_date || !/^\d{4}-\d{2}-\d{2}$/.test(data.issue_date)) data.issue_date = h.today();
    const lang = b.doc_lang === 'en' ? 'en' : 'bn';

    // Serial: PREFIX-YEAR-NNNN, counted per type and year. The UNIQUE key
    // settles a race between two people issuing at the same moment.
    const year = data.issue_date.slice(0, 4);
    let id = null;
    for (let attempt = 0; attempt < 5 && !id; attempt++) {
      const n = await db.scalar(
        'SELECT COUNT(*) AS c FROM issued_documents WHERE doc_type = ? AND serial_no LIKE ?', [docType, `${PREFIX[docType]}-${year}-%`]);
      const serial = `${PREFIX[docType]}-${year}-${String(n + 1 + attempt).padStart(4, '0')}`;
      try {
        const r = await db.run(
          'INSERT INTO issued_documents (doc_type, serial_no, student_id, lang, data, issued_by) VALUES (?,?,?,?,?,?)',
          [docType, serial, studentId, lang, JSON.stringify(data), req.session.user.id]);
        id = r.insertId;
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }
    if (!id) throw new Error('Could not allocate a serial number');
    res.redirect(`/admin/print/doc/${id}`);
  } catch (err) { next(err); }
});

router.get('/doc/:id', async (req, res, next) => {
  try {
    const doc = await db.one(
      'SELECT d.*, u.name AS issued_by_name FROM issued_documents d LEFT JOIN users u ON u.id = d.issued_by WHERE d.id = ?',
      [h.toInt(req.params.id)]);
    if (!doc) return next();
    const student = await db.one(`${STUDENT_SQL} WHERE s.id = ?`, [doc.student_id]);
    if (!student) return next();
    let data = {};
    try { data = JSON.parse(doc.data || '{}'); } catch (e) { data = {}; }
    const o = await org();
    // The QR opens the public check page for this certificate.
    const checkUrl = docVerify.url(req, doc.serial_no);
    const qrImg = await qr(checkUrl);
    printView(res, 'admin/print/certificate', {
      title: doc.serial_no, doc, student, data, org: o, qrImg, docLang: doc.lang, checkUrl
    });
  } catch (err) { next(err); }
});

module.exports = router;

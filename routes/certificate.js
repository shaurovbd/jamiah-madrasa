'use strict';
/**
 * Public certificate check (/certificate).
 *
 *   /certificate/:serial?k=…   what the QR code on a certificate opens
 *   /certificate               a form: serial number + admission number,
 *                              for someone holding a paper copy without a phone
 *
 * Shows only what is printed on the certificate itself: the type, the name,
 * the father's name, class, dates. Nothing else about the student.
 */
const express = require('express');
const db = require('../config/db');
const v = require('../lib/doc-verify');

const router = express.Router();

async function find(serial) {
  return db.one(
    `SELECT d.serial_no, d.doc_type, d.issued_at, d.data, s.name, s.father_name, s.admission_no, c.name AS class_name
       FROM issued_documents d JOIN students s ON s.id = d.student_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE d.serial_no = ?`, [String(serial).slice(0, 30)]);
}

function show(res, doc, state) {
  let data = {};
  try { data = JSON.parse((doc && doc.data) || '{}'); } catch (e) { data = {}; }
  res.render('public/certificate-check', { title: res.locals.t('cert.title'), doc, data, state });
}

router.get('/', (req, res) => show(res, null, 'form'));

router.post('/', async (req, res, next) => {
  try {
    const doc = await find(String(req.body.serial || '').trim().toUpperCase());
    const ok = doc && String(doc.admission_no).trim().toLowerCase() === String(req.body.admission_no || '').trim().toLowerCase();
    show(res, ok ? doc : null, ok ? 'valid' : 'not_found');
  } catch (err) { next(err); }
});

router.get('/:serial', async (req, res, next) => {
  try {
    if (!v.valid(req.params.serial, req.query.k)) return show(res, null, 'not_found');
    const doc = await find(req.params.serial);
    show(res, doc, doc ? 'valid' : 'not_found');
  } catch (err) { next(err); }
});

module.exports = router;

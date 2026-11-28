'use strict';
/**
 * Import students from Excel or CSV (/admin/students/import).
 *
 *   GET  /            instructions, template download, upload form
 *   GET  /template    the template as CSV (opens in Excel, Bangla intact)
 *   POST /preview     read the file, check every row, show what will happen
 *   POST /commit      add the rows that passed (the checked rows come from a
 *                     server-side file tied to this session, never from the form)
 *
 * Columns are matched by name in Bangla or English, in any order — "নাম",
 * "name", or the template's "নাম (name)" all work. Only name and class are
 * required. A blank admission number gets the next ADM-YYYY-NNNN.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');
const reader = require('../../lib/sheet-reader');
const sms = require('../../lib/sms');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const TMP = path.join(os.tmpdir(), 'jamiah-import');

/** field -> header names it answers to (compared lower-case, trimmed). */
const FIELDS = {
  name: ['name', 'student name', 'নাম', 'ছাত্রের নাম', 'শিক্ষার্থীর নাম'],
  admission_no: ['admission_no', 'admission no', 'admission no.', 'id', 'ভর্তি নং', 'ভর্তি নম্বর', 'আইডি'],
  roll_no: ['roll', 'roll_no', 'roll no', 'রোল', 'রোল নং'],
  class: ['class', 'class name', 'শ্রেণি', 'শ্রেণী', 'ক্লাস'],
  section: ['section', 'সেকশন', 'শাখা'],
  father_name: ['father_name', 'father', "father's name", 'পিতার নাম', 'পিতা'],
  mother_name: ['mother_name', 'mother', "mother's name", 'মাতার নাম', 'মাতা'],
  guardian_name: ['guardian_name', 'guardian', 'অভিভাবকের নাম', 'অভিভাবক'],
  guardian_phone: ['guardian_phone', 'phone', 'mobile', 'guardian mobile', 'অভিভাবকের মোবাইল', 'মোবাইল', 'ফোন'],
  dob: ['dob', 'date of birth', 'birth date', 'জন্ম তারিখ', 'জন্মতারিখ'],
  gender: ['gender', 'sex', 'লিঙ্গ'],
  blood_group: ['blood_group', 'blood group', 'blood', 'রক্তের গ্রুপ'],
  address: ['address', 'ঠিকানা'],
  admission_date: ['admission_date', 'admission date', 'ভর্তির তারিখ'],
  resident: ['resident', 'is_resident', 'residential', 'আবাসিক']
};
const TEMPLATE = [
  ['name', 'নাম'], ['admission_no', 'ভর্তি নং'], ['roll', 'রোল'], ['class', 'শ্রেণি'], ['section', 'সেকশন'],
  ['father_name', 'পিতার নাম'], ['mother_name', 'মাতার নাম'], ['guardian_name', 'অভিভাবকের নাম'],
  ['guardian_phone', 'অভিভাবকের মোবাইল'], ['dob', 'জন্ম তারিখ'], ['gender', 'লিঙ্গ'], ['blood_group', 'রক্তের গ্রুপ'],
  ['address', 'ঠিকানা'], ['admission_date', 'ভর্তির তারিখ'], ['resident', 'আবাসিক']
];

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Header text -> field, trying the whole text and each part of "বাংলা (english)". */
function fieldFor(header) {
  const parts = [norm(header)].concat(norm(header).split(/[()/|]/).map((p) => p.trim()).filter(Boolean));
  for (const [field, names] of Object.entries(FIELDS)) {
    if (parts.some((p) => names.includes(p))) return field;
  }
  return null;
}

/** Many ways of writing a date -> YYYY-MM-DD, or null. */
function toDate(v) {
  const s = String(v || '').trim().replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c)));
  if (!s) return null;
  if (/^\d{4,5}(\.\d+)?$/.test(s) && Number(s) > 3000) return reader.excelDate(s); // Excel day number
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(m[1], m[2], m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); // Bangladesh writes day first
  if (m) return valid(m[3], m[2], m[1]);
  return undefined; // present but unreadable
  function valid(y, mo, d) {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d));
    return dt.getUTCFullYear() === +y && dt.getUTCMonth() === +mo - 1 && dt.getUTCDate() === +d
      ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : undefined;
  }
}

function gender(v) {
  const s = norm(v);
  if (['female', 'f', 'girl', 'মেয়ে', 'মহিলা', 'ছাত্রী', 'নারী'].includes(s)) return 'female';
  return 'male';
}
const yes = (v) => ['yes', 'y', '1', 'true', 'হ্যাঁ', 'হা', 'আবাসিক'].includes(norm(v));

function tokenFile(token) {
  if (!/^[a-f0-9]{32}$/.test(String(token))) return null;
  return path.join(TMP, `${token}.json`);
}

/* ---------------------------------------------------------------- pages */
router.get('/', (req, res) => {
  res.render('admin/students/import', { title: res.locals.t('a.imp.title'), result: null, TEMPLATE });
});

router.get('/template', (req, res) => {
  const head = TEMPLATE.map(([en, bn]) => `${bn} (${en})`);
  const example = ['আব্দুল্লাহ', '', '1', 'Hifz Year 1', 'A', 'মোঃ করিম', 'ফাতেমা বেগম', 'মোঃ করিম', '01712345678',
    '02/05/2014', 'ছেলে', 'B+', 'খুলনা', h.today(), 'না'];
  const csv = [head, example].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="students-template.csv"');
  res.send('﻿' + csv + '\r\n');
});

router.post('/preview', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer.length) { req.flash('error', 'f.imp.no_file'); return res.redirect('/admin/students/import'); }
    let rows;
    try { rows = reader.read(req.file.buffer, req.file.originalname); } catch (e) {
      req.flash('error', 'f.imp.unreadable'); return res.redirect('/admin/students/import');
    }
    if (rows.length < 2) { req.flash('error', 'f.imp.empty'); return res.redirect('/admin/students/import'); }

    const header = rows[0].map(fieldFor);
    if (!header.includes('name') || !header.includes('class')) {
      req.flash('error', 'f.imp.need_columns'); return res.redirect('/admin/students/import');
    }

    const [classes, sections, existing, year] = await Promise.all([
      db.query('SELECT id, name, department_id, shift_id FROM classes'),
      db.query('SELECT id, name, class_id FROM sections'),
      db.query('SELECT admission_no FROM students'),
      db.one('SELECT id FROM academic_years WHERE is_current = 1 ORDER BY id DESC LIMIT 1')
    ]);
    const classByName = new Map(classes.map((c) => [norm(c.name), c]));
    const taken = new Set(existing.map((e) => norm(e.admission_no)));
    const yearNo = new Date().getFullYear();
    let seq = existing.filter((e) => String(e.admission_no).startsWith(`ADM-${yearNo}-`))
      .reduce((m, e) => Math.max(m, Number(String(e.admission_no).split('-')[2]) || 0), 0);

    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const raw = {};
      header.forEach((f, i) => { if (f && raw[f] === undefined) raw[f] = String(rows[r][i] == null ? '' : rows[r][i]).trim(); });
      if (Object.values(raw).every((v) => !v)) continue; // blank line
      const errors = [], warnings = [];
      const name = raw.name || '';
      if (!name) errors.push('a.imp.err.name');
      const cls = classByName.get(norm(raw.class));
      if (!raw.class) errors.push('a.imp.err.class_missing');
      else if (!cls) errors.push('a.imp.err.class_unknown');
      let sectionId = null;
      if (raw.section && cls) {
        const sec = sections.find((s) => s.class_id === cls.id && norm(s.name) === norm(raw.section));
        if (sec) sectionId = sec.id; else warnings.push('a.imp.warn.section');
      }
      let admNo = raw.admission_no;
      if (admNo) {
        if (taken.has(norm(admNo))) errors.push('a.imp.err.dup_no');
      } else if (!errors.length) {
        do { seq++; admNo = `ADM-${yearNo}-${String(seq).padStart(4, '0')}`; } while (taken.has(norm(admNo)));
        warnings.push('a.imp.warn.new_no');
      }
      if (admNo && !errors.includes('a.imp.err.dup_no')) taken.add(norm(admNo));
      const dob = toDate(raw.dob);
      if (dob === undefined) warnings.push('a.imp.warn.dob');
      const admDate = toDate(raw.admission_date);
      if (admDate === undefined) warnings.push('a.imp.warn.adm_date');
      const phone = raw.guardian_phone ? sms.normalizePhone(raw.guardian_phone) : null;
      if (raw.guardian_phone && !phone) warnings.push('a.imp.warn.phone');

      out.push({
        line: r + 1, errors, warnings,
        data: {
          name, admission_no: admNo || '', roll_no: raw.roll_no || null,
          class_id: cls ? cls.id : null, class_name: cls ? cls.name : raw.class, department_id: cls ? cls.department_id : null,
          section_id: sectionId, section_name: raw.section || '',
          father_name: raw.father_name || null, mother_name: raw.mother_name || null,
          guardian_name: raw.guardian_name || null,
          guardian_phone: phone ? '0' + phone.slice(3) : (raw.guardian_phone || null),
          dob: dob || null, gender: gender(raw.gender), blood_group: raw.blood_group || null,
          address: raw.address || null, admission_date: admDate || h.today(), is_resident: yes(raw.resident) ? 1 : 0,
          academic_year_id: year ? year.id : null
        }
      });
    }

    const token = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(tokenFile(token), JSON.stringify({ user: req.session.user.id, rows: out.filter((x) => !x.errors.length).map((x) => x.data) }));
    req.session.importToken = token;

    const unmatched = rows[0].filter((c, i) => String(c).trim() && !header[i]);
    res.render('admin/students/import', {
      title: res.locals.t('a.imp.title'), TEMPLATE,
      result: {
        token, file: req.file.originalname, rows: out, unmatched,
        ok: out.filter((x) => !x.errors.length).length, bad: out.filter((x) => x.errors.length).length,
        classes: classes.map((c) => c.name)
      }
    });
  } catch (err) { next(err); }
});

router.post('/commit', async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const file = tokenFile(token);
    if (!file || req.session.importToken !== token || !fs.existsSync(file)) {
      req.flash('error', 'f.imp.expired'); return res.redirect('/admin/students/import');
    }
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.unlink(file, () => {});
    delete req.session.importToken;
    if (saved.user !== req.session.user.id || !saved.rows.length) {
      req.flash('error', 'f.imp.expired'); return res.redirect('/admin/students/import');
    }

    let added = 0, skipped = 0;
    await db.transaction(async (conn) => {
      for (const d of saved.rows) {
        // Someone may have added the same admission number since the preview.
        const [dup] = await conn.execute('SELECT id FROM students WHERE admission_no = ?', [d.admission_no]);
        if (dup.length) { skipped++; continue; }
        await conn.execute(
          `INSERT INTO students (admission_no, roll_no, name, father_name, mother_name, guardian_name, guardian_phone,
             dob, gender, blood_group, address, department_id, class_id, section_id, academic_year_id,
             admission_date, is_resident, status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active')`,
          [d.admission_no, d.roll_no, d.name, d.father_name, d.mother_name, d.guardian_name, d.guardian_phone,
            d.dob, d.gender, d.blood_group, d.address, d.department_id, d.class_id, d.section_id, d.academic_year_id,
            d.admission_date, d.is_resident]);
        added++;
      }
    });
    req.flash('success', i18n.pack('f.imp.done', { count: added }));
    if (skipped) req.flash('info', i18n.pack('f.imp.skipped', { count: skipped }));
    res.redirect('/admin/students');
  } catch (err) { next(err); }
});

module.exports = router;
module.exports._test = { fieldFor, toDate };

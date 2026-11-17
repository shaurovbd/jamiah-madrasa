'use strict';
const express = require('express');
const db = require('../../config/db');
const settingsLib = require('../../lib/settings');

const router = express.Router();

const FIELDS = [
  ['site_name', 'Institution name', 'text'],
  ['site_short', 'Short name', 'text'],
  ['tagline', 'Tagline', 'text'],
  ['established', 'Established (year)', 'text'],
  ['address', 'Address', 'text'],
  ['phone', 'Phone', 'text'],
  ['email', 'Email', 'email'],
  ['currency', 'Currency code', 'text'],
  ['currency_symbol', 'Currency symbol', 'text'],
  ['facebook', 'Facebook URL', 'text'],
  ['youtube', 'YouTube URL', 'text'],
  ['principal_name', 'Principal name', 'text'],
  ['about_intro', 'Short introduction (home page and footer)', 'textarea'],
  ['principal_message', "Principal's message", 'textarea'],
  ['result_notice', 'Note shown above the public result form', 'textarea']
];

router.get('/', async (req, res, next) => {
  try {
    const settings = await settingsLib.all(true);
    const counts = await db.one(
      `SELECT (SELECT COUNT(*) FROM students) AS students,
              (SELECT COUNT(*) FROM staff) AS staff,
              (SELECT COUNT(*) FROM fee_invoices) AS invoices,
              (SELECT COUNT(*) FROM exams) AS exams`
    );
    res.render('admin/system/settings', { title: 'Settings', FIELDS, values: settings, counts: counts || {} });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const update = {};
    for (const [key] of FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) update[key] = String(req.body[key] || '').slice(0, 5000);
    }
    await settingsLib.setMany(update);
    req.flash('success', 'Settings saved.');
    res.redirect('/admin/settings');
  } catch (err) { next(err); }
});

module.exports = router;

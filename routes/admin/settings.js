'use strict';
const express = require('express');
const db = require('../../config/db');
const settingsLib = require('../../lib/settings');
const upload = require('../../lib/upload');
const csrf = require('../../lib/csrf');
const maps = require('../../lib/maps');
const stats = require('../../lib/stats');

const router = express.Router();

/**
 * Everything on this page is grouped the way the client thinks about it, not
 * the way it is stored. Adding a field here is enough: the view renders the
 * groups and the handler saves whatever the groups declare.
 */
const GROUPS = [
  {
    title: 'Institution',
    help: 'The name and wording that appear across the website, receipts and marksheets.',
    fields: [
      { key: 'site_name', label: 'Institution name', type: 'text' },
      { key: 'site_short', label: 'Short name', type: 'text', help: 'Used in the panel and on small screens.' },
      { key: 'tagline', label: 'Tagline', type: 'text', help: 'The large headline on the home page.' },
      { key: 'established', label: 'Established (year)', type: 'text', help: 'Four digits, e.g. 2015. Also used to work out years of service.' },
      { key: 'principal_name', label: 'Principal name', type: 'text' }
    ]
  },
  {
    title: 'Contact and location',
    help: 'Shown in the top bar, the footer, the About page and the Contact page.',
    fields: [
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'office_hours', label: 'Office hours', type: 'textarea', help: 'Shown on the Contact page. One line per line.' },
      {
        key: 'google_map', label: 'Google Map', type: 'textarea',
        help: 'Easiest way: open Google Maps, find the campus, choose Share → Embed a map → Copy HTML, and paste it here. ' +
              'Or simply type the address and a map is looked up for you. Leave empty for no map.'
      }
    ]
  },
  {
    title: 'Social links',
    help: 'Full web addresses. Leave a box empty to hide that link.',
    fields: [
      { key: 'facebook', label: 'Facebook page', type: 'text' },
      { key: 'youtube', label: 'YouTube channel', type: 'text' }
    ]
  },
  {
    title: 'Home page text',
    fields: [
      { key: 'about_intro', label: 'Short introduction', type: 'textarea', help: 'Appears under the headline on the home page and in the footer.' },
      { key: 'principal_message', label: "Principal's message", type: 'textarea' }
    ]
  },
  {
    title: 'Results page',
    fields: [
      { key: 'result_notice', label: 'Note above the result form', type: 'textarea' }
    ]
  },
  {
    title: 'Currency',
    help: 'Used on invoices, receipts and the fee reports.',
    fields: [
      { key: 'currency', label: 'Currency code', type: 'text', help: 'e.g. BDT' },
      { key: 'currency_symbol', label: 'Currency symbol', type: 'text', help: 'e.g. Tk' }
    ]
  }
];

const TEXT_KEYS = GROUPS.reduce((acc, g) => acc.concat(g.fields.map((f) => f.key)), []);

function withScheme(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

router.get('/', async (req, res, next) => {
  try {
    const values = await settingsLib.all(true);
    const counts = await db.one(
      `SELECT (SELECT COUNT(*) FROM students) AS students,
              (SELECT COUNT(*) FROM staff) AS staff,
              (SELECT COUNT(*) FROM fee_invoices) AS invoices,
              (SELECT COUNT(*) FROM exams) AS exams`
    );
    res.render('admin/system/settings', {
      title: 'Settings',
      GROUPS,
      STAT_KEYS: stats.KEYS,
      values,
      counts: counts || {},
      mapUrl: maps.embedUrl(values.google_map),
      autoStats: await stats.autoCounts(values)
    });
  } catch (err) { next(err); }
});

// The logo makes this form multipart, so the CSRF token is checked by
// csrf.afterUpload once multer has parsed the fields. The file itself is
// vetted below rather than by the strict chain, so that a wrong logo does not
// throw away everything else the client just typed.
router.post('/', [upload.image.single('logo'), csrf.afterUpload], async (req, res, next) => {
  try {
    const current = await settingsLib.all(true);
    const update = {};

    for (const key of TEXT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        update[key] = String(req.body[key] || '').trim().slice(0, 5000);
      }
    }

    for (const [key] of stats.KEYS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        update[key] = String(req.body[key] || '').trim().slice(0, 40);
      }
      const labelKey = `${key}_label`;
      if (Object.prototype.hasOwnProperty.call(req.body, labelKey)) {
        update[labelKey] = String(req.body[labelKey] || '').trim().slice(0, 60);
      }
    }

    for (const key of ['facebook', 'youtube']) {
      if (key in update) update[key] = withScheme(update[key]);
    }

    // A map value that cannot be turned into an embed is reported and the old
    // one kept, rather than silently saving something that shows nothing.
    if ('google_map' in update && update.google_map && !maps.embedUrl(update.google_map)) {
      delete update.google_map;
      req.flash('error', 'That map could not be read, so the previous map was kept. Paste the embed code from Google Maps (Share → Embed a map), or just type the address. Shortened maps.app.goo.gl links do not work.');
    }

    if (req.file) {
      const filename = upload.accept(req.file);
      if (!filename) {
        req.flash('error', 'That logo was not a valid image file, so the previous logo was kept. Use a JPG, PNG, WebP or GIF under 4 MB.');
      } else {
        if (current.logo) upload.remove(current.logo);
        update.logo = filename;
      }
    } else if (req.body.logo_remove) {
      if (current.logo) upload.remove(current.logo);
      update.logo = '';
    }

    await settingsLib.setMany(update);
    req.flash('success', 'Settings saved.');
    res.redirect('/admin/settings');
  } catch (err) { next(err); }
});

module.exports = router;

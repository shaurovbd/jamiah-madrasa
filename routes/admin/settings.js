'use strict';
const express = require('express');
const db = require('../../config/db');
const settingsLib = require('../../lib/settings');
const i18n = require('../../lib/i18n');

const router = express.Router();

// [settings key, translation key for the label, input type]
// The label is a translation key rather than literal text, so the form reads in
// whichever language the signed-in user picked.
const FIELDS = [
  ['site_name', 'settings.field.site_name', 'text'],
  ['site_short', 'settings.field.site_short', 'text'],
  ['tagline', 'settings.field.tagline', 'text'],
  ['established', 'settings.field.established', 'text'],
  ['address', 'settings.field.address', 'text'],
  ['phone', 'settings.field.phone', 'text'],
  ['email', 'settings.field.email', 'email'],
  ['currency', 'settings.field.currency', 'text'],
  ['currency_symbol', 'settings.field.currency_symbol', 'text'],
  ['facebook', 'settings.field.facebook', 'text'],
  ['youtube', 'settings.field.youtube', 'text'],
  ['principal_name', 'settings.field.principal_name', 'text'],
  ['default_language', 'settings.field.default_language', 'language'],
  ['about_intro', 'settings.field.about_intro', 'textarea'],
  ['principal_message', 'settings.field.principal_message', 'textarea'],
  ['result_notice', 'settings.field.result_notice', 'textarea'],
  // Appearance. The view renders these in its own card rather than the main
  // grid, so they are skipped there by key.
  ['accent_color', 'settings.field.accent_color', 'color'],
  ['accent_secondary', 'settings.field.accent_secondary', 'color'],
  ['sidebar_style', 'settings.field.sidebar_style', 'text'],
  ['surface_style', 'settings.field.surface_style', 'text'],
  ['corner_radius', 'settings.field.corner_radius', 'text'],
  ['background_glow', 'settings.field.background_glow', 'text']
];

/** Appearance values the form always needs a value for. */
function withThemeDefaults(s) {
  const v = Object.assign({}, s || {});
  if (!v.accent_color) v.accent_color = '#166049';
  if (!v.accent_secondary) v.accent_secondary = '#c3952f';
  if (!v.sidebar_style) v.sidebar_style = 'gradient';
  if (!v.surface_style) v.surface_style = 'solid';
  if (!v.corner_radius) v.corner_radius = '9';
  return v;
}

router.get('/', async (req, res, next) => {
  try {
    const settings = await settingsLib.all(true);
    const counts = await db.one(
      `SELECT (SELECT COUNT(*) FROM students) AS students,
              (SELECT COUNT(*) FROM staff) AS staff,
              (SELECT COUNT(*) FROM fee_invoices) AS invoices,
              (SELECT COUNT(*) FROM exams) AS exams`
    );
    res.render('admin/system/settings', {
      title: res.locals.t('settings.title'),
      FIELDS,
      languages: i18n.LANGUAGES,
      values: withThemeDefaults(settings),
      counts: counts || {}
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const update = {};
    for (const [key] of FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) update[key] = String(req.body[key] || '').slice(0, 5000);
    }
    // Never store a language the site cannot serve: a bad value here would be
    // the default for every visitor who has not chosen one.
    if (Object.prototype.hasOwnProperty.call(update, 'default_language')) {
      update.default_language = i18n.normalize(update.default_language, i18n.DEFAULT_LANG);
    }
    await settingsLib.setMany(update);
    // Flash a translation key: the layout runs it through t(), so the message
    // renders in whatever language the next page is shown in.
    req.flash('success', 'common.saved');
    res.redirect('/admin/settings');
  } catch (err) { next(err); }
});

module.exports = router;

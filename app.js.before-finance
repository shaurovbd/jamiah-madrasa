'use strict';
/**
 * Jamiah Scholars International
 * Madrasa website + school management system.
 *
 * Runs behind Phusion Passenger on cPanel (Setup Node.js App) and standalone in development.
 */
require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const expressLayouts = require('express-ejs-layouts');
const flash = require('connect-flash');
const methodOverride = require('method-override');

const helpers = require('./lib/helpers');
const settingsLib = require('./lib/settings');
const i18n = require('./lib/i18n');

const app = express();

// Behind cPanel's Apache/Passenger proxy.
app.set('trust proxy', 1);

// ---------------------------------------------------------------- views
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/public');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ---------------------------------------------------------------- basics
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '5mb' }));
// Forms can only send GET and POST, so a hidden _method field stands in for
// PUT and DELETE. Passing a string here would read the query string, not the
// body, so the override is read from the parsed body explicitly.
app.use(methodOverride((req) => {
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    const method = String(req.body._method).toUpperCase();
    delete req.body._method;
    if (['PUT', 'DELETE', 'PATCH'].includes(method)) return method;
  }
  return undefined;
}));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// cPanel's AutoSSL proves domain control over http://<domain>/.well-known/... .
// This app owns the document root, so that directory has to be served from disk
// or certificate renewal quietly starts failing. Point WELLKNOWN_DIR at the
// .well-known folder inside the document root.
if (process.env.WELLKNOWN_DIR) {
  app.use('/.well-known', express.static(process.env.WELLKNOWN_DIR, { dotfiles: 'allow', maxAge: 0 }));
}

// ---------------------------------------------------------------- session
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'jamiah_madrasa',
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 8 * 60 * 60 * 1000
});

app.use(session({
  key: 'jsi.sid',
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-env',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use(flash());

// ---------------------------------------------------------------- csrf
// Small per-session token; checked on every state-changing request.
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  next();
});

// ---------------------------------------------------------------- language
/**
 * Keep a redirect on this site. The switcher sends people back where they came
 * from, and both ?next= and Referer are attacker-controllable, so only a plain
 * path from our own host is ever followed.
 */
function localPath(raw, host) {
  const value = String(raw || '');
  if (!value) return '/';
  // Absolute URL (a Referer header): accept only our own host, keep path+query.
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      if (host && u.host !== host) return '/';
      return (u.pathname || '/') + (u.search || '');
    } catch (err) {
      return '/';
    }
  }
  // Relative path: must be a single-slash path, never "//evil.com" or a scheme.
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

/**
 * Resolve the active language, most specific wins:
 *   ?lang= on this request  ->  the visitor's saved choice  ->  the institution's
 *   default from Settings  ->  English.
 * Nobody is forced into a language, and a fresh visitor gets what the admin chose.
 */
app.use(async (req, res, next) => {
  try {
    const settings = await settingsLib.all();
    if (req.query.lang && i18n.isLang(req.query.lang)) {
      req.session.lang = i18n.normalize(req.query.lang);
    }
    const chosen = req.session && req.session.lang;
    const lang = i18n.normalize(chosen || settings.default_language, i18n.DEFAULT_LANG);

    res.locals.lang = lang;
    res.locals.langDir = i18n.language(lang).dir;
    res.locals.languages = i18n.LANGUAGES;
    res.locals.t = i18n.translator(lang);
    res.locals.tflash = i18n.flashTranslator(lang);
    // Labels for values stored in the database (ENUM columns and the like).
    res.locals.label = i18n.enumLabeler(lang);
    // Same path in the other language, for the header toggle.
    res.locals.langSwitchUrl = (code) =>
      `/lang/${code}?next=${encodeURIComponent(req.originalUrl || '/')}`;
    next();
  } catch (err) {
    next(err);
  }
});

// Switching language is a plain link, so it works without JavaScript.
app.get('/lang/:code', (req, res) => {
  const code = i18n.normalize(req.params.code, i18n.DEFAULT_LANG);
  if (req.session) req.session.lang = code;
  res.redirect(localPath(req.query.next || req.get('referer'), req.get('host')));
});

// ---------------------------------------------------------------- locals
app.use(async (req, res, next) => {
  try {
    const settings = await settingsLib.all();
    res.locals.settings = settings;
    res.locals.site = {
      name: settings.site_name || 'Jamiah Scholars International',
      short: settings.site_short || 'Jamiah Scholars',
      tagline: settings.tagline || '',
      address: settings.address || '',
      phone: settings.phone || '',
      email: settings.email || '',
      facebook: settings.facebook || '',
      youtube: settings.youtube || ''
    };
    res.locals.currency = settings.currency_symbol || 'Tk';
    res.locals.user = req.session.user || null;

    // --- theme (Appearance settings) ---
    // Kept from the server's own Appearance work: the admin layout reads these
    // to set --a-seed and the data-sidebar / data-surface / data-glow hooks.
    const __hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : d);
    const __opt = (v, allowed, d) => (allowed.indexOf(v) !== -1 ? v : d);
    res.locals.theme = {
      accent: __hex(settings.accent_color, '#166049'),
      accent2: __hex(settings.accent_secondary, '#c3952f'),
      sidebar: __opt(settings.sidebar_style, ['gradient', 'solid', 'light'], 'gradient'),
      surface: __opt(settings.surface_style, ['solid', 'glass'], 'solid'),
      radius: Math.max(8, Math.min(28, parseInt(settings.corner_radius, 10) || 9)),
      glow: String(settings.background_glow) === '1' ? 'on' : 'off'
    };
    res.locals.flash = {
      success: req.flash('success'),
      error: req.flash('error'),
      info: req.flash('info')
    };
    res.locals.h = helpers;
    res.locals.money = (n) => helpers.money(n, res.locals.currency);
    // Date helpers bound to the active language, so views can call fmtDate(d)
    // and get Bangla month names without threading `lang` through every call.
    res.locals.fmtDate = (d) => helpers.fmtDate(d, res.locals.lang);
    res.locals.fmtPeriod = (p) => helpers.fmtPeriod(p, res.locals.lang);
    res.locals.monthShort = (i) => helpers.monthShort(i, res.locals.lang);
    res.locals.currentPath = req.path;
    res.locals.query = req.query || {};
    res.locals.title = '';
    next();
  } catch (err) {
    next(err);
  }
});

// Verify the CSRF token only after the locals above exist, so the rejection
// page itself has everything the layout needs to render.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (sent && sent === req.session.csrf) return next();
  res.status(403);
  return res.render('error', {
    layout: 'layouts/public',
    title: res.locals.t('error.403.title'),
    message: res.locals.t('error.403.message'),
    status: 403
  });
});

// ---------------------------------------------------------------- routes
app.use('/', require('./routes/public'));
app.use('/', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));

// ---------------------------------------------------------------- health
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ---------------------------------------------------------------- errors
app.use((req, res) => {
  res.status(404).render('error', {
    layout: 'layouts/public',
    title: res.locals.t('error.404.title'),
    message: res.locals.t('error.404.message'),
    status: 404
  });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', err && err.stack ? err.stack : err);
  const isDev = (process.env.NODE_ENV || 'development') !== 'production';
  // The language middleware may itself be what failed, so fall back to a
  // translator rather than assuming res.locals.t exists.
  const tr = res.locals.t || i18n.translator(i18n.DEFAULT_LANG);
  res.locals.t = tr;
  res.locals.lang = res.locals.lang || i18n.DEFAULT_LANG;
  res.locals.langDir = res.locals.langDir || 'ltr';
  res.locals.languages = res.locals.languages || i18n.LANGUAGES;
  res.locals.langSwitchUrl = res.locals.langSwitchUrl || ((code) => `/lang/${code}`);
  res.locals.tflash = res.locals.tflash || i18n.flashTranslator(res.locals.lang);
  res.locals.label = res.locals.label || i18n.enumLabeler(res.locals.lang);
  res.status(500).render('error', {
    layout: 'layouts/public',
    title: tr('error.500.title'),
    message: isDev && err ? err.message : tr('error.500.message'),
    status: 500
  });
});

// ---------------------------------------------------------------- start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jamiah Scholars International running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = app;

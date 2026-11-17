'use strict';
/**
 * Jamiah Scholars International
 * Madrasa website + school management system.
 *
 * Runs behind Phusion Passenger on cPanel (Setup Node.js App) and standalone in development.
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const expressLayouts = require('express-ejs-layouts');
const flash = require('connect-flash');
const methodOverride = require('method-override');

const helpers = require('./lib/helpers');
const settingsLib = require('./lib/settings');
const csrf = require('./lib/csrf');
const maps = require('./lib/maps');

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
app.use(csrf.ensure);

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
      youtube: settings.youtube || '',
      logo: settings.logo || ''
    };
    res.locals.currency = settings.currency_symbol || 'Tk';
    // Whatever the client pasted into Settings, turned into one safe URL.
    res.locals.mapUrl = maps.embedUrl(settings.google_map);
    res.locals.user = req.session.user || null;
    res.locals.flash = {
      success: req.flash('success'),
      error: req.flash('error'),
      info: req.flash('info')
    };
    res.locals.h = helpers;
    res.locals.money = (n) => helpers.money(n, res.locals.currency);
    res.locals.currentPath = req.path;
    res.locals.query = req.query || {};
    res.locals.title = '';
    next();
  } catch (err) {
    next(err);
  }
});

// Verify the CSRF token only after the locals above exist, so the rejection
// page itself has everything the layout needs to render. Upload forms send
// multipart bodies, which nothing has parsed yet at this point, so those are
// checked a moment later by lib/csrf.afterUpload() - see lib/upload.js.
app.use(csrf.verify);

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
    title: 'Page not found',
    message: 'The page you are looking for does not exist or has been moved.',
    status: 404
  });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', err && err.stack ? err.stack : err);
  const isDev = (process.env.NODE_ENV || 'development') !== 'production';
  res.status(500).render('error', {
    layout: 'layouts/public',
    title: 'Something went wrong',
    message: isDev && err ? err.message : 'An unexpected error occurred. Please try again, or contact the administrator if it continues.',
    status: 500
  });
});

// ---------------------------------------------------------------- start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jamiah Scholars International running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = app;

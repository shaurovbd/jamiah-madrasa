'use strict';
/**
 * Logs for the management panel: what people changed, who signed in, and
 * what broke. Read on /admin/logs (routes/admin/logs.js).
 *
 * Three rules hold everywhere in this file:
 *   1. Writing a log never slows down or breaks the request it describes.
 *      Inserts are fire-and-forget; a failed insert is printed and dropped.
 *   2. Passwords, tokens and the CSRF value never reach a log row.
 *   3. Activity rows are only inserted, never updated or deleted.
 *
 * Activity is captured by one middleware (trackAdminWrites) rather than a call
 * in every route, so every module — including the finance pages, which are
 * mounted separately — is covered, and a new module is covered the day it is
 * added. A write counts as done only when the response succeeded and the route
 * did not flash an error, which is how every route here reports "not saved".
 */
const db = require('../config/db');

const SENSITIVE = /pass(word)?|secret|token|csrf|otp|api[_-]?key|cookie|^_method$/i;

/** Last path segments that name what happened, rather than a resource. */
const VERBS = new Set([
  'approve', 'reject', 'generate', 'void', 'cancel', 'pay', 'payment', 'issue',
  'return', 'password', 'publish', 'unpublish', 'restore', 'import', 'upload',
  'reorder', 'promote', 'enroll', 'verify', 'end', 'close', 'reopen', 'post',
  'reverse', 'remind', 'status', 'mark', 'read', 'unread', 'toggle', 'photo',
  'documents', 'waive', 'discount', 'renew', 'allocate', 'vacate', 'checkout'
]);

/** Body fields that most likely name the record, in order of preference. */
const LABEL_FIELDS = [
  'name', 'full_name', 'title', 'username', 'student_name', 'donor_name',
  'application_no', 'receipt_no', 'voucher_no', 'invoice_no', 'code',
  'subject', 'label', 'period'
];

const LOGIN_KEEP_DAYS = 180;
const ERROR_KEEP_DAYS = 90;

function clip(v, n) {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function ipOf(req) {
  return clip(req.ip || (req.socket && req.socket.remoteAddress) || '', 45);
}

function agentOf(req) {
  return clip(req.get ? req.get('user-agent') : '', 255);
}

function insert(sql, params) {
  db.run(sql, params).catch((err) => {
    // Most likely the 006 migration has not been run yet. Say so once per
    // process instead of filling stderr.log with the same line.
    if (err && err.code === 'ER_NO_SUCH_TABLE') {
      if (!insert.warned) console.error('[logs] log tables missing — run: npm run migrate');
      insert.warned = true;
      return;
    }
    console.error('[logs] could not write log row:', err && err.message);
  });
}

/** A copy of the submitted form that is safe to store: no secrets, nothing huge. */
function sanitize(body, depth = 0) {
  if (body === null || body === undefined) return null;
  if (typeof body !== 'object') return clip(body, 300);
  if (depth > 2) return '[…]';
  if (Array.isArray(body)) {
    const list = body.slice(0, 20).map((v) => sanitize(v, depth + 1));
    if (body.length > 20) list.push(`… +${body.length - 20}`);
    return list;
  }
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE.test(k)) continue;
    if (n >= 40) { out['…'] = `+${Object.keys(body).length - 40}`; break; }
    out[k] = sanitize(v, depth + 1);
    n += 1;
  }
  return out;
}

function labelFrom(body) {
  if (!body || typeof body !== 'object') return null;
  for (const f of LABEL_FIELDS) {
    const v = body[f];
    if (typeof v === 'string' && v.trim()) return clip(v.trim(), 190);
  }
  return null;
}

/**
 * /admin/<module>/<...>  ->  { module, recordId, action }
 * The action is a verb from the path when there is one (…/5/approve), and
 * otherwise follows the HTTP method.
 */
function describe(method, path, body) {
  const segs = String(path).split('?')[0].split('/').filter(Boolean); // ['admin', module, ...]
  const module = clip((segs[1] || 'dashboard').toLowerCase().replace(/[^a-z0-9_-]/g, ''), 40);
  const rest = segs.slice(2);
  const idSeg = rest.find((s) => /^\d+$/.test(s));
  const last = (rest[rest.length - 1] || '').toLowerCase();
  const bodyId = body && typeof body === 'object' && /^\d+$/.test(String(body.id || '')) ? String(body.id) : null;

  let action;
  if (VERBS.has(last)) action = last;
  else if (method === 'DELETE') action = 'delete';
  else if (method === 'PUT' || method === 'PATCH') action = 'update';
  else if (idSeg || bodyId) action = 'update';
  else action = 'create';

  return { module, recordId: idSeg || bodyId || null, action };
}

function flashCount(req, type) {
  const f = req.session && req.session.flash;
  return f && Array.isArray(f[type]) ? f[type].length : 0;
}

/**
 * Express middleware. Mount once in app.js, after the CSRF check and before the
 * routes. Only POST/PUT/PATCH/DELETE under /admin by a signed-in user is logged.
 */
function trackAdminWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const url = req.originalUrl || req.url || '';
  if (!url.startsWith('/admin')) return next();
  const user = req.session && req.session.user;
  if (!user) return next();

  const method = req.method;
  const errorsBefore = flashCount(req, 'error');

  res.on('finish', () => {
    try {
      if (res.statusCode >= 400) return;
      if (flashCount(req, 'error') > errorsBefore) return;

      // Read the body now, not earlier: multipart forms are parsed by multer
      // inside the route, so req.body is only complete once the route has run.
      const body = req.body;
      const { module, recordId, action } = describe(method, url, body);
      const details = sanitize(body) || {};
      const files = []
        .concat(req.file ? [req.file] : [])
        .concat(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat());
      if (files.length) details._files = files.map((f) => f && f.originalname).filter(Boolean);
      const json = Object.keys(details).length ? clip(JSON.stringify(details), 20000) : null;

      insert(
        `INSERT INTO activity_logs
           (user_id, user_name, user_role, method, action, module, record_id, record_label,
            path, details, ip_address, user_agent)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [user.id || null, clip(user.name, 120), clip(user.role, 30), method, action, module,
          recordId, labelFrom(body), clip(url.split('?')[0], 255), json, ipOf(req), agentOf(req)]
      );
    } catch (err) {
      console.error('[logs] activity:', err && err.message);
    }
  });
  next();
}

/** event: 'login' | 'failed' | 'logout'. reason only for failures. */
function logLogin(req, { event, userId = null, username = null, reason = null }) {
  insert(
    `INSERT INTO login_logs (user_id, username, event, reason, ip_address, user_agent)
     VALUES (?,?,?,?,?,?)`,
    [userId, clip(username, 60), event, clip(reason, 30), ipOf(req), agentOf(req)]
  );
}

/** Called from the error handler in app.js. Never throws. */
function logError(req, err, status = 500) {
  try {
    const user = req && req.session && req.session.user;
    insert(
      `INSERT INTO error_logs (status, method, path, message, stack, user_id, user_name, ip_address)
       VALUES (?,?,?,?,?,?,?,?)`,
      [status, req ? clip(req.method, 10) : null,
        req ? clip(String(req.originalUrl || '').split('?')[0], 255) : null,
        clip(err && err.message ? err.message : String(err), 1000),
        clip(err && err.stack ? err.stack : null, 15000),
        user ? user.id : null, user ? clip(user.name, 120) : null, req ? ipOf(req) : null]
    );
  } catch (e) {
    console.error('[logs] error log:', e && e.message);
  }
}

/**
 * Prune old login and error rows once at start-up and then daily. Activity is
 * kept: it is the record of who changed what, and it is small.
 */
function startCleanup() {
  const run = () => {
    db.run(`DELETE FROM login_logs WHERE created_at < NOW() - INTERVAL ${LOGIN_KEEP_DAYS} DAY`).catch(() => {});
    db.run(`DELETE FROM error_logs WHERE created_at < NOW() - INTERVAL ${ERROR_KEEP_DAYS} DAY`).catch(() => {});
  };
  setTimeout(run, 30 * 1000).unref();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

module.exports = {
  trackAdminWrites, logLogin, logError, startCleanup,
  // exported for tests
  describe, sanitize, labelFrom,
  LOGIN_KEEP_DAYS, ERROR_KEEP_DAYS
};

'use strict';
/**
 * Per-session CSRF token.
 *
 * Why this is split into two checks:
 * express.urlencoded() does not parse multipart/form-data, so on an upload
 * form req.body is still empty where the global gate runs. Reading the token
 * there would reject every upload form in the panel. So multipart requests
 * skip the global gate and are checked by afterUpload() instead, which runs
 * immediately after multer has parsed the fields (see lib/upload.js).
 */
const crypto = require('crypto');
const fs = require('fs');

/** Make sure the session has a token, and expose it to the views. */
function ensure(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  next();
}

function isMultipart(req) {
  return (req.get('content-type') || '').toLowerCase().startsWith('multipart/form-data');
}

/** Constant-time comparison of the submitted token against the session's. */
function matches(req) {
  const sent = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
  const want = String((req.session && req.session.csrf) || '');
  if (!sent || !want || sent.length !== want.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(want));
  } catch (err) {
    return false;
  }
}

function reject(req, res) {
  res.status(403);
  return res.render('error', {
    layout: 'layouts/public',
    title: 'Session expired',
    message: 'Your session expired or the form was submitted from an unexpected place. Please go back, reload the page and try again.',
    status: 403
  });
}

/** Global gate: every state-changing request except multipart (see above). */
function verify(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (isMultipart(req)) return next();
  if (matches(req)) return next();
  return reject(req, res);
}

/** Runs straight after multer on upload routes. Discards files if the token is wrong. */
function afterUpload(req, res, next) {
  if (matches(req)) return next();
  const files = [].concat(req.files || [], req.file ? [req.file] : []);
  for (const f of files) if (f && f.path) fs.unlink(f.path, () => {});
  return reject(req, res);
}

module.exports = { ensure, verify, afterUpload, matches, isMultipart };

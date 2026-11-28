'use strict';
/**
 * Links that let anyone check a printed certificate: the QR code on a
 * certificate opens /certificate/<serial>?k=<key>. The key is an HMAC of the
 * serial with the session secret, so serial numbers (which run in order)
 * cannot be walked through to read other students' names.
 */
const crypto = require('crypto');

function key(serial) {
  const secret = process.env.SESSION_SECRET || 'change-this-secret-in-env';
  return crypto.createHmac('sha256', secret).update('doc:' + String(serial)).digest('base64url').slice(0, 12);
}

function valid(serial, k) {
  const want = Buffer.from(key(serial));
  const got = Buffer.from(String(k || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function url(req, serial) {
  return `${req.protocol}://${req.get('host')}/certificate/${encodeURIComponent(serial)}?k=${key(serial)}`;
}

module.exports = { key, valid, url };

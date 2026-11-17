'use strict';
const db = require('../config/db');

let cache = null;
let loadedAt = 0;
const TTL = 60 * 1000;

async function all(force = false) {
  if (!force && cache && Date.now() - loadedAt < TTL) return cache;
  try {
    const rows = await db.query('SELECT skey, svalue FROM settings');
    cache = {};
    for (const r of rows) cache[r.skey] = r.svalue;
    loadedAt = Date.now();
  } catch (err) {
    // Database not ready yet: fall back to sane defaults rather than crashing the site.
    cache = cache || {};
  }
  return cache;
}

async function set(key, value) {
  await db.run(
    'INSERT INTO settings (skey, svalue) VALUES (?,?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)',
    [key, value == null ? '' : String(value)]
  );
  cache = null;
}

async function setMany(obj) {
  for (const [k, v] of Object.entries(obj)) await set(k, v);
  cache = null;
}

function invalidate() { cache = null; }

module.exports = { all, set, setMany, invalidate };

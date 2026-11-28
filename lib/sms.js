'use strict';
/**
 * SMS to guardians and staff.
 *
 * Gateways (Settings → SMS):
 *   test       nothing leaves the server; every message is logged as "test".
 *              The default, so a fresh install can never send by accident.
 *   bulksmsbd  bulksmsbd.net   POST /api/smsapi  api_key, senderid, number, message
 *   smsnetbd   sms.net.bd      POST /sendsms     api_key, msg, to
 *   custom     any gateway with a plain HTTP GET; the URL holds the
 *              placeholders {api_key} {sender} {number} {message}
 *
 * Sending never happens inside a page request. A batch is written to
 * sms_logs as "queued" and worked through in the background, a few at a time,
 * so sending to 500 guardians does not hold the page open. Batches left
 * half-done by a restart are picked up again when the app starts.
 */
const db = require('../config/db');
const settingsLib = require('./settings');

const PROVIDERS = ['test', 'bulksmsbd', 'smsnetbd', 'custom'];
const CONCURRENCY = 3;
const TIMEOUT_MS = 20000;

const DEFAULT_ABSENT_TEMPLATE =
  'আসসালামু আলাইকুম। আপনার সন্তান {name} ({class}, রোল {roll}) আজ {date} মাদরাসায় অনুপস্থিত। — {school}';

/* --------------------------------------------------------------- config */
async function config() {
  const s = await settingsLib.all();
  return {
    provider: PROVIDERS.includes(s.sms_provider) ? s.sms_provider : 'test',
    apiKey: process.env.SMS_API_KEY || s.sms_api_key || '',
    senderId: s.sms_sender_id || '',
    customUrl: s.sms_custom_url || '',
    absentAuto: String(s.sms_absent_auto) === '1',
    absentTemplate: s.sms_absent_template || DEFAULT_ABSENT_TEMPLATE,
    school: s.site_short || s.site_name || ''
  };
}

/* ---------------------------------------------------------------- phone */
/** Any Bangladeshi mobile number as written by a person -> 8801XXXXXXXXX, or null. */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c))).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('1')) d = '880' + d;
  if (d.length === 11 && d.startsWith('01')) d = '88' + d;
  return /^8801[3-9]\d{8}$/.test(d) ? d : null;
}

/* ---------------------------------------------------------------- text */
function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) && vars[k] !== null && vars[k] !== undefined ? String(vars[k]) : '');
}

/** SMS parts: 160/153 characters in plain Latin text, 70/67 once any Bangla (Unicode) is used. */
function parts(text) {
  const s = String(text || '');
  const unicode = /[^\x00-\x7F]/.test(s);
  const len = [...s].length;
  if (!len) return { len, parts: 0, unicode };
  const single = unicode ? 70 : 160, multi = unicode ? 67 : 153;
  return { len, parts: len <= single ? 1 : Math.ceil(len / multi), unicode };
}

/* -------------------------------------------------------------- gateway */
async function http(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({ signal: ctrl.signal }, options));
    const text = await res.text();
    return { status: res.status, text };
  } finally { clearTimeout(timer); }
}

/** -> { ok, status: 'sent'|'failed'|'test', response } */
async function sendOne(cfg, number, message) {
  if (cfg.provider === 'test') return { ok: true, status: 'test', response: 'test mode — not sent' };
  if (!cfg.apiKey && cfg.provider !== 'custom') return { ok: false, status: 'failed', response: 'no API key set' };
  try {
    if (cfg.provider === 'bulksmsbd') {
      const r = await http('http://bulksmsbd.net/api/smsapi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ api_key: cfg.apiKey, type: 'text', number, senderid: cfg.senderId, message }).toString()
      });
      let j = {}; try { j = JSON.parse(r.text); } catch (e) { /* not JSON */ }
      const ok = Number(j.response_code) === 202;
      return { ok, status: ok ? 'sent' : 'failed', response: r.text.slice(0, 500) };
    }
    if (cfg.provider === 'smsnetbd') {
      const body = { api_key: cfg.apiKey, msg: message, to: number };
      if (cfg.senderId) body.sender_id = cfg.senderId;
      const r = await http('https://api.sms.net.bd/sendsms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString()
      });
      let j = {}; try { j = JSON.parse(r.text); } catch (e) { /* not JSON */ }
      const ok = Number(j.error) === 0;
      return { ok, status: ok ? 'sent' : 'failed', response: r.text.slice(0, 500) };
    }
    // custom: plain GET with placeholders
    if (!/^https?:\/\//i.test(cfg.customUrl)) return { ok: false, status: 'failed', response: 'custom URL not set' };
    const url = cfg.customUrl
      .replace(/\{api_key\}/g, encodeURIComponent(cfg.apiKey))
      .replace(/\{sender\}/g, encodeURIComponent(cfg.senderId))
      .replace(/\{number\}/g, encodeURIComponent(number))
      .replace(/\{message\}/g, encodeURIComponent(message));
    const r = await http(url, { method: 'GET' });
    const ok = r.status >= 200 && r.status < 300;
    return { ok, status: ok ? 'sent' : 'failed', response: (`HTTP ${r.status} ` + r.text).slice(0, 500) };
  } catch (err) {
    return { ok: false, status: 'failed', response: String(err && err.message || err).slice(0, 500) };
  }
}

/* ---------------------------------------------------------------- queue */
/**
 * recipients: [{ phone, message, student_id?, staff_id?, name? }]
 * Bad numbers are dropped here and counted, so the batch only holds what can go.
 * -> { batchId, queued, skipped }
 */
async function queue({ kind, title, recipients, userId }) {
  const good = [];
  let skipped = 0;
  const seen = new Set();
  for (const r of recipients) {
    const phone = normalizePhone(r.phone);
    const text = String(r.message || '').trim();
    if (!phone || !text) { skipped++; continue; }
    const key = phone + '|' + text;
    if (seen.has(key)) continue; // same message to the same number once (siblings share a guardian)
    seen.add(key);
    good.push({ ...r, phone, message: text.slice(0, 1000) });
  }
  if (!good.length) return { batchId: null, queued: 0, skipped };

  const cfg = await config();
  const result = await db.transaction(async (conn) => {
    const [b] = await conn.execute(
      `INSERT INTO sms_batches (kind, title, provider, total, created_by) VALUES (?,?,?,?,?)`,
      [kind, String(title || '').slice(0, 190), cfg.provider, good.length, userId || null]
    );
    for (const r of good) {
      await conn.execute(
        `INSERT INTO sms_logs (batch_id, phone, recipient_name, student_id, staff_id, message, parts, status)
         VALUES (?,?,?,?,?,?,?, 'queued')`,
        [b.insertId, r.phone, r.name ? String(r.name).slice(0, 140) : null, r.student_id || null, r.staff_id || null,
          r.message, parts(r.message).parts]
      );
    }
    return b.insertId;
  });

  setImmediate(() => processBatch(result).catch((e) => console.error('[sms] batch', result, e && e.message)));
  return { batchId: result, queued: good.length, skipped };
}

const running = new Set();

async function processBatch(batchId) {
  if (running.has(batchId)) return;
  running.add(batchId);
  try {
    const cfg = await config();
    const batch = await db.one('SELECT kind FROM sms_batches WHERE id = ?', [batchId]);
    // Portal PIN messages: once sent, the stored copy has the PIN blanked out,
    // so nobody can read it later from the SMS history.
    const redact = batch && batch.kind === 'portal';
    const rows = await db.query("SELECT id, phone, message FROM sms_logs WHERE batch_id = ? AND status = 'queued' ORDER BY id", [batchId]);
    let i = 0;
    const worker = async () => {
      while (i < rows.length) {
        const row = rows[i++];
        const r = await sendOne(cfg, row.phone, row.message);
        await db.run('UPDATE sms_logs SET status = ?, response = ?, sent_at = NOW(), message = ? WHERE id = ?',
          [r.status, r.response, redact ? row.message.replace(/\b\d{6}\b/g, '••••••') : row.message, row.id]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
    await db.run(
      `UPDATE sms_batches b SET
         sent   = (SELECT COUNT(*) FROM sms_logs l WHERE l.batch_id = b.id AND l.status IN ('sent','test')),
         failed = (SELECT COUNT(*) FROM sms_logs l WHERE l.batch_id = b.id AND l.status = 'failed'),
         finished_at = NOW()
       WHERE b.id = ?`, [batchId]);
  } finally {
    running.delete(batchId);
  }
}

/** Finish batches a restart interrupted. Called once from app.js. */
function resumePending() {
  setTimeout(async () => {
    try {
      const rows = await db.query(
        "SELECT DISTINCT batch_id FROM sms_logs WHERE status = 'queued' AND created_at > NOW() - INTERVAL 2 DAY");
      for (const r of rows) await processBatch(r.batch_id);
    } catch (err) {
      if (!(err && err.code === 'ER_NO_SUCH_TABLE')) console.error('[sms] resume:', err && err.message);
    }
  }, 15 * 1000).unref();
}

module.exports = {
  PROVIDERS, DEFAULT_ABSENT_TEMPLATE,
  config, normalizePhone, fill, parts, sendOne, queue, processBatch, resumePending
};

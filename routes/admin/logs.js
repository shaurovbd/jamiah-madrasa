'use strict';
/**
 * Settings → Logs. Admins only (mounted with requireRole() in index.js).
 *
 *   /admin/logs/activity       who changed what   (activity_logs)
 *   /admin/logs/activity.csv   the same, filtered, as a spreadsheet
 *   /admin/logs/logins         sign-ins, failures, sign-outs (login_logs)
 *   /admin/logs/errors         server errors (error_logs) + tail of stderr.log
 *
 * Read-only: nothing here edits or deletes a log row.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const { LOGIN_KEEP_DAYS, ERROR_KEEP_DAYS } = require('../../lib/activity-log');

const router = express.Router();

const TABS = [
  ['/admin/logs/activity', 'a.log.tab.activity'],
  ['/admin/logs/logins', 'a.log.tab.logins'],
  ['/admin/logs/errors', 'a.log.tab.errors']
];
const TZ = process.env.APP_TZ || 'Asia/Dhaka';
const STDERR_FILE = process.env.STDERR_LOG || path.join(__dirname, '..', '..', 'stderr.log');
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** "28 Nov 2026, 08:15" in the institution's time zone, Bangla digits in Bangla. */
function whenFor(lang) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  return (d) => {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt)) return String(d);
    const p = Object.fromEntries(fmt.formatToParts(dt).map((x) => [x.type, x.value]));
    const out = `${p.day} ${h.monthShort(Number(p.month) - 1, lang)} ${p.year}, ${p.hour}:${p.minute}`;
    return lang === 'bn' ? out.replace(/\d/g, (c) => BN_DIGITS[c]) : out;
  };
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** WHERE clause shared by the activity page and its CSV export. */
function activityFilters(q) {
  const f = {
    user: h.toInt(q.user) || '',
    module: /^[a-z0-9_-]{1,40}$/.test(String(q.module || '')) ? String(q.module) : '',
    action: /^[a-z0-9_-]{1,40}$/.test(String(q.action || '')) ? String(q.action) : '',
    from: isDate(q.from) ? q.from : '',
    to: isDate(q.to) ? q.to : '',
    q: String(q.q || '').trim().slice(0, 100)
  };
  const where = [];
  const params = [];
  if (f.user) { where.push('user_id = ?'); params.push(f.user); }
  if (f.module) { where.push('module = ?'); params.push(f.module); }
  if (f.action) { where.push('action = ?'); params.push(f.action); }
  if (f.from) { where.push('created_at >= ?'); params.push(`${f.from} 00:00:00`); }
  if (f.to) { where.push('created_at < ? + INTERVAL 1 DAY'); params.push(`${f.to} 00:00:00`); }
  if (f.q) {
    where.push('(record_label LIKE ? OR path LIKE ? OR record_id = ?)');
    params.push(`%${f.q}%`, `%${f.q}%`, f.q);
  }
  return { f, whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function tableMissing(err) {
  return err && err.code === 'ER_NO_SUCH_TABLE';
}

function renderMissing(res) {
  res.render('admin/system/logs', {
    title: res.locals.t('admin.nav.logs'), TABS, tab: 'missing', when: whenFor(res.locals.lang)
  });
}

router.get('/', (req, res) => res.redirect('/admin/logs/activity'));

/* ------------------------------------------------------------- activity */
router.get('/activity', async (req, res, next) => {
  try {
    const { f, whereSql, params } = activityFilters(req.query);
    const total = await db.scalar(`SELECT COUNT(*) AS c FROM activity_logs ${whereSql}`, params);
    const p = h.paginate(total, req.query.page, 50);
    const rows = await db.query(
      `SELECT * FROM activity_logs ${whereSql} ORDER BY id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params);
    rows.forEach((r) => {
      try { r.detailsObj = r.details ? JSON.parse(r.details) : null; } catch (e) { r.detailsObj = r.details; }
    });
    const [users, modules, actions, today] = await Promise.all([
      db.query('SELECT id, name FROM users ORDER BY name'),
      db.query('SELECT DISTINCT module FROM activity_logs ORDER BY module'),
      db.query('SELECT DISTINCT action FROM activity_logs ORDER BY action'),
      db.scalar('SELECT COUNT(*) AS c FROM activity_logs WHERE created_at >= CURDATE()')
    ]);
    res.render('admin/system/logs', {
      title: res.locals.t('admin.nav.logs'), TABS, tab: 'activity', when: whenFor(res.locals.lang),
      rows, p, filters: f, users,
      modules: modules.map((m) => m.module), actions: actions.map((a) => a.action),
      stats: { today, total }
    });
  } catch (err) {
    if (tableMissing(err)) return renderMissing(res);
    next(err);
  }
});

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  // Keep spreadsheet programs from reading a cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

router.get('/activity.csv', async (req, res, next) => {
  try {
    const { whereSql, params } = activityFilters(req.query);
    const rows = await db.query(
      `SELECT * FROM activity_logs ${whereSql} ORDER BY id DESC LIMIT 20000`, params);
    const when = whenFor('en');
    const head = ['Time', 'User', 'Role', 'Action', 'Module', 'Record ID', 'Record', 'Path', 'IP', 'Details'];
    const lines = [head.map(csvCell).join(',')].concat(rows.map((r) => [
      when(r.created_at), r.user_name, r.user_role, r.action, r.module, r.record_id,
      r.record_label, r.path, r.ip_address, r.details
    ].map(csvCell).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-log-${h.today()}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  } catch (err) {
    if (tableMissing(err)) return res.redirect('/admin/logs/activity');
    next(err);
  }
});

/* --------------------------------------------------------------- logins */
router.get('/logins', async (req, res, next) => {
  try {
    const f = {
      event: ['login', 'failed', 'logout'].includes(req.query.event) ? req.query.event : '',
      from: isDate(req.query.from) ? req.query.from : '',
      to: isDate(req.query.to) ? req.query.to : '',
      q: String(req.query.q || '').trim().slice(0, 100)
    };
    const where = [];
    const params = [];
    if (f.event) { where.push('event = ?'); params.push(f.event); }
    if (f.from) { where.push('created_at >= ?'); params.push(`${f.from} 00:00:00`); }
    if (f.to) { where.push('created_at < ? + INTERVAL 1 DAY'); params.push(`${f.to} 00:00:00`); }
    if (f.q) { where.push('(username LIKE ? OR ip_address LIKE ?)'); params.push(`%${f.q}%`, `%${f.q}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await db.scalar(`SELECT COUNT(*) AS c FROM login_logs ${whereSql}`, params);
    const p = h.paginate(total, req.query.page, 50);
    const [rows, todayOk, todayFailed, suspicious] = await Promise.all([
      db.query(`SELECT * FROM login_logs ${whereSql} ORDER BY id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
      db.scalar("SELECT COUNT(*) AS c FROM login_logs WHERE event = 'login' AND created_at >= CURDATE()"),
      db.scalar("SELECT COUNT(*) AS c FROM login_logs WHERE event = 'failed' AND created_at >= CURDATE()"),
      // Five or more failures from one address in a day is worth a look.
      db.query(`SELECT ip_address, COUNT(*) AS c, MAX(created_at) AS last_at,
                       GROUP_CONCAT(DISTINCT username ORDER BY username SEPARATOR ', ') AS names
                  FROM login_logs
                 WHERE event = 'failed' AND created_at >= NOW() - INTERVAL 24 HOUR
                 GROUP BY ip_address HAVING c >= 5 ORDER BY c DESC LIMIT 10`)
    ]);
    res.render('admin/system/logs', {
      title: res.locals.t('admin.nav.logs'), TABS, tab: 'logins', when: whenFor(res.locals.lang),
      rows, p, filters: f, suspicious, stats: { todayOk, todayFailed }, keepDays: LOGIN_KEEP_DAYS
    });
  } catch (err) {
    if (tableMissing(err)) return renderMissing(res);
    next(err);
  }
});

/* --------------------------------------------------------------- errors */

/** Last `maxLines` lines of stderr.log, reading at most the final 64 KB. */
function tailFile(file, maxLines = 200) {
  try {
    const stat = fs.statSync(file);
    const size = Math.min(stat.size, 64 * 1024);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, stat.size - size);
      const lines = buf.toString('utf8').split(/\r?\n/);
      if (stat.size > size) lines.shift(); // first line is probably cut in half
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      return { ok: true, text: lines.slice(-maxLines).join('\n'), size: stat.size, mtime: stat.mtime };
    } finally { fs.closeSync(fd); }
  } catch (err) {
    return { ok: false };
  }
}

router.get('/errors', async (req, res, next) => {
  try {
    const total = await db.scalar('SELECT COUNT(*) AS c FROM error_logs');
    const p = h.paginate(total, req.query.page, 25);
    const [rows, today] = await Promise.all([
      db.query(`SELECT * FROM error_logs ORDER BY id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`),
      db.scalar('SELECT COUNT(*) AS c FROM error_logs WHERE created_at >= CURDATE()')
    ]);
    res.render('admin/system/logs', {
      title: res.locals.t('admin.nav.logs'), TABS, tab: 'errors', when: whenFor(res.locals.lang),
      rows, p, stats: { today, total }, stderr: tailFile(STDERR_FILE), keepDays: ERROR_KEEP_DAYS
    });
  } catch (err) {
    if (tableMissing(err)) return renderMissing(res);
    next(err);
  }
});

module.exports = router;

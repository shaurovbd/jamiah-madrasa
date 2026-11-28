'use strict';
/**
 * Settings → Backup (/admin/backup). Admins only.
 *
 * One button per database: the school database and the finance database.
 * Each download is a gzipped SQL file and is recorded in the activity log.
 */
const express = require('express');
const db = require('../../config/db');
const backup = require('../../lib/backup');

const router = express.Router();

const DBS = {
  main: () => process.env.DB_NAME || 'jamiah_madrasa',
  finance: () => process.env.FINANCE_DB_NAME || 'jamiah_finance'
};

async function sizes() {
  const rows = await db.query(
    `SELECT TABLE_SCHEMA AS db, COUNT(*) AS tables, COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS bytes,
            COALESCE(SUM(TABLE_ROWS), 0) AS approx_rows
       FROM information_schema.TABLES WHERE TABLE_SCHEMA IN (?, ?) GROUP BY TABLE_SCHEMA`,
    [DBS.main(), DBS.finance()]);
  const out = {};
  rows.forEach((r) => { out[r.db] = r; });
  return out;
}

router.get('/', async (req, res, next) => {
  try {
    const [info, last] = await Promise.all([
      sizes(),
      db.query(`SELECT user_name, record_label, created_at FROM activity_logs
                 WHERE module = 'backup' ORDER BY id DESC LIMIT 10`).catch(() => [])
    ]);
    res.render('admin/system/backup', {
      title: res.locals.t('admin.nav.backup'),
      dbs: [
        { key: 'main', name: DBS.main(), label: 'a.backup.main', hint: 'a.backup.main_hint', info: info[DBS.main()] },
        { key: 'finance', name: DBS.finance(), label: 'a.backup.finance', hint: 'a.backup.finance_hint', info: info[DBS.finance()] }
      ],
      last
    });
  } catch (err) { next(err); }
});

router.get('/download/:which', async (req, res, next) => {
  const which = DBS[req.params.which] ? req.params.which : null;
  if (!which) return next();
  const name = DBS[which]();
  const stamp = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const file = `${name}-${stamp}.sql.gz`;
  try {
    const r = await backup.sendDump(res, name, file);
    // A download changes nothing, so the activity middleware does not see it;
    // a backup is still worth a line in the log, so it is written here.
    const u = req.session.user;
    db.run(`INSERT INTO activity_logs (user_id, user_name, user_role, method, action, module, record_label, path, details, ip_address, user_agent)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [u.id, u.name, u.role, 'GET', 'download', 'backup', file, req.originalUrl.split('?')[0],
        JSON.stringify({ tables: r.tables, rows: r.rows }), req.ip, String(req.get('user-agent') || '').slice(0, 255)])
      .catch(() => {});
  } catch (err) {
    console.error('[backup]', err && err.message);
    if (!res.headersSent) return next(err);
  }
});

module.exports = router;
module.exports.DBS = DBS;

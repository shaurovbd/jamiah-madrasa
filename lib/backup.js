'use strict';
/**
 * Database backup as a downloadable .sql.gz, written in plain Node so it works
 * on shared hosting where the mysqldump program may not be reachable.
 *
 * The file restores with phpMyAdmin → Import, or `mysql dbname < file.sql`.
 * It holds DROP TABLE + CREATE TABLE + INSERT for every table, wrapped in
 * FOREIGN_KEY_CHECKS=0 so tables can load in any order. Session rows (who is
 * signed in right now) are left out: they are useless after a restore and
 * contain live sign-in tokens.
 *
 * Every value is read as text (dateStrings, bigNumberStrings), so dates,
 * times and money come back exactly as stored, with no time-zone shift.
 */
const zlib = require('zlib');
const mysql = require('mysql2/promise');

const STRUCTURE_ONLY = new Set(['sessions']);
const CHUNK = 500;

function connect(database) {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    charset: 'utf8mb4_general_ci',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false
  });
}

const qid = (name) => '`' + String(name).replace(/`/g, '``') + '`';

/** Write one database to `out` (a writable stream). Resolves with { tables, rows }. */
async function dump(database, out) {
  const conn = await connect(database);
  // TIMESTAMP columns are read in UTC, matching the time_zone line written at
  // the top of the file, so they restore unchanged on any server. (Read in the
  // server's local zone they came back hours off.)
  await conn.query("SET time_zone = '+00:00'");
  const write = (s) => new Promise((resolve) => { if (out.write(s)) resolve(); else out.once('drain', resolve); });
  let tables = 0, rows = 0;
  try {
    const [list] = await conn.query('SHOW FULL TABLES');
    const key = Object.keys(list[0] || {}).find((k) => k.startsWith('Tables_in_'));
    const baseTables = list.filter((r) => r.Table_type === 'BASE TABLE').map((r) => r[key]);
    const views = list.filter((r) => r.Table_type === 'VIEW').map((r) => r[key]);

    await write(`-- Backup of ${database}\n-- Made ${new Date().toISOString()} by the management panel\n` +
      `-- Restore: phpMyAdmin → choose the database → Import → this file\n\n` +
      'SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\nSET SQL_MODE = \'NO_AUTO_VALUE_ON_ZERO\';\nSET time_zone = \'+00:00\';\n\n');

    for (const table of baseTables) {
      const [[create]] = await conn.query(`SHOW CREATE TABLE ${qid(table)}`);
      await write(`-- ----------------------------------------------- ${table}\n` +
        `DROP TABLE IF EXISTS ${qid(table)};\n${create['Create Table']};\n\n`);
      tables++;
      if (STRUCTURE_ONLY.has(table)) continue;

      const [cols] = await conn.query(`SHOW COLUMNS FROM ${qid(table)}`);
      const colList = cols.map((c) => qid(c.Field)).join(', ');
      const pk = cols.filter((c) => c.Key === 'PRI').map((c) => qid(c.Field));
      const order = pk.length ? ` ORDER BY ${pk.join(', ')}` : '';
      for (let offset = 0; ; offset += CHUNK) {
        const [data] = await conn.query({ sql: `SELECT * FROM ${qid(table)}${order} LIMIT ${CHUNK} OFFSET ${offset}`, rowsAsArray: true });
        if (!data.length) break;
        const values = data.map((row) => '(' + row.map((v) => conn.escape(v)).join(',') + ')').join(',\n');
        await write(`INSERT INTO ${qid(table)} (${colList}) VALUES\n${values};\n`);
        rows += data.length;
        if (data.length < CHUNK) break;
      }
      await write('\n');
    }

    for (const view of views) {
      const [[create]] = await conn.query(`SHOW CREATE VIEW ${qid(view)}`);
      // DEFINER names the database user of this server; drop it so the file
      // restores under whatever user does the import.
      const sql = String(create['Create View']).replace(/DEFINER=`[^`]*`@`[^`]*`\s*/i, '');
      await write(`DROP VIEW IF EXISTS ${qid(view)};\n${sql};\n\n`);
    }

    await write('SET FOREIGN_KEY_CHECKS = 1;\n');
  } finally {
    await conn.end().catch(() => {});
  }
  return { tables, rows };
}

/** Stream a gzipped dump to an Express response. */
async function sendDump(res, database, filename) {
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  const gz = zlib.createGzip({ level: 6 });
  gz.pipe(res);
  try {
    const r = await dump(database, gz);
    gz.end();
    return r;
  } catch (err) {
    // Headers are already out, so the best we can do is end the file with a
    // visible marker; a truncated backup must never look complete.
    gz.end(`\n-- BACKUP FAILED: ${String(err && err.message).replace(/\n/g, ' ')}\n`);
    throw err;
  }
}

module.exports = { dump, sendDump };

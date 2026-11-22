'use strict';
/**
 * Applies every .sql file in db/migrations in filename order.
 * Usage: npm run migrate
 *
 * Safe to run repeatedly: "duplicate column" and "duplicate key" errors are
 * treated as "already applied" and skipped, so a half-finished run can be
 * resumed without hand-editing the SQL.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ALREADY_APPLIED = new Set([
  'ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_DUP_ENTRY',
  'ER_CANT_DROP_FIELD_OR_KEY', 'ER_TABLE_EXISTS_ERROR'
]);

/**
 * Re-adding a named foreign key does not report ER_DUP_KEYNAME. It comes back
 * as ER_CANT_CREATE_TABLE carrying the storage engine's errno 121, "duplicate
 * key on write or update" — which here means the constraint name is taken, i.e.
 * this statement ran before. Everything else behind ER_CANT_CREATE_TABLE is a
 * genuine failure (a missing referenced table, a type mismatch), so the errno
 * is matched rather than the code alone.
 */
function isDuplicateConstraint(err) {
  return err.code === 'ER_CANT_CREATE_TABLE' && /errno:\s*121\b/.test(err.sqlMessage || '');
}

/**
 * Splits a migration file into statements.
 *
 * Walks the text once so that quoted strings are respected: a `;`, a `--` or
 * a `#` inside quotes is data, not a separator or a comment. Comments are
 * dropped as they are read, which matters because a statement preceded by a
 * comment block would otherwise look like one long comment and be skipped.
 */
function statements(sql) {
  const out = [];
  let buf = '';
  let quote = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];

    if (quote) {
      buf += ch;
      if (ch === '\\') { buf += sql[i + 1] || ''; i += 1; } else if (ch === quote) { quote = null; }
      continue;
    }

    /* -- line comment, or # line comment */
    if ((ch === '-' && sql[i + 1] === '-') || ch === '#') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      buf += ' ';
      continue;
    }

    /* /* block comment *\/ */
    if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? sql.length : close + 1;
      buf += ' ';
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; buf += ch; continue; }

    if (ch === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }

    buf += ch;
  }

  if (buf.trim()) out.push(buf.trim());
  return out;
}

(async () => {
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) { console.log('No migrations directory — nothing to do.'); return; }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (!files.length) { console.log('No migrations found.'); return; }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'jamiah_madrasa'
  });
  console.log('Connected to', process.env.DB_NAME || 'jamiah_madrasa');

  for (const file of files) {
    console.log('\n→', file);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const stmt of statements(sql)) {
      try {
        await conn.query(stmt);
        console.log('   ok   ', stmt.split('\n')[0].slice(0, 70));
      } catch (err) {
        if (ALREADY_APPLIED.has(err.code) || isDuplicateConstraint(err)) {
          console.log('   skip  already applied —', err.sqlMessage);
        } else {
          console.error('   FAIL  ', stmt.split('\n')[0].slice(0, 70));
          throw err;
        }
      }
    }
  }

  await conn.end();
  console.log('\nMigrations complete.');
})().catch((err) => {
  console.error('\nMigration failed:', err.sqlMessage || err.message);
  process.exit(1);
});

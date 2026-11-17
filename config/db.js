'use strict';
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'jamiah_madrasa',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 5),
  queueLimit: 0,
  charset: 'utf8mb4_general_ci',
  dateStrings: ['DATE']
});

/** Run a query, return rows. */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Run a query, return the first row or null. */
async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/** Run an INSERT/UPDATE/DELETE, return the raw result (insertId, affectedRows). */
async function run(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

/** Scalar helper: SELECT COUNT(*) AS c ... -> number */
async function scalar(sql, params = [], field = 'c') {
  const row = await one(sql, params);
  return row ? Number(row[field] || 0) : 0;
}

/** Run several statements inside a transaction. fn receives a connection. */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, one, run, scalar, transaction };

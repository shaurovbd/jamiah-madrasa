'use strict';
/**
 * Creates every table from schema.sql, then runs the seed.
 * Usage: npm run setup
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'jamiah_madrasa',
    multipleStatements: true
  });
  console.log('Connected to', process.env.DB_NAME);
  await conn.query(sql);
  console.log('Schema applied.');
  await conn.end();
  // Seed afterwards so the tables exist.
  require('./seed.js');
})().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});

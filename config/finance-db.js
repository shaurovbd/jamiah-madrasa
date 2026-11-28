'use strict';
/**
 * হিসাব ও অর্থ মডিউলের ডেটাবেস পুল।
 *
 * মূল অ্যাপের ডেটাবেস (config/db.js) থেকে আলাদা — হিসাবের টেবিলগুলো
 * jamiah_finance ডেটাবেসে থাকে, যাতে jamiah_madrasa-র কোনো টেবিলের
 * সাথে নামের সংঘর্ষ না হয়। ইউজার ও পাসওয়ার্ড একই (.env থেকে)।
 */
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.FINANCE_DB_NAME || 'jamiah_finance',

  waitForConnections: true,
  connectionLimit: Number(process.env.FINANCE_DB_POOL || 10),
  charset: 'utf8mb4_unicode_ci',

  // এই দুটো অবশ্যক:
  decimalNumbers: true,   // টাকা — নইলে DECIMAL স্ট্রিং হয়ে আসে, যোগ করলে ভুল হয়
  dateStrings: true,      // তারিখ — নইলে রশিদে একদিন পিছিয়ে ছাপে
  timezone: '+06:00',
});

module.exports = { pool };

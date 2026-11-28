'use strict';
/**
 * স্থানীয় ডেমো সার্ভার — শুধু পরীক্ষার জন্য।
 * আপনার আসল অ্যাপে routes/ledger.js মাউন্ট করাই যথেষ্ট; এই ফাইল লাগবে না।
 *
 *   node demo-server.js            → http://localhost:3100/admin/ledger
 *   ROLE=accountant node demo-server.js
 */
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const ledgerRouter = require('./routes/ledger');
const receipts = require('./routes/receipts');
const donorRouter = require('./routes/donors');
const orphanRouter = require('./routes/orphans');

const PORT = Number(process.env.PORT || 3100);
const ROLE = process.env.ROLE || 'principal';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'jamiah',
  password: process.env.DB_PASS || 'test_pw_local',
  database: process.env.DB_NAME || 'jamiah',
  decimalNumbers: true,

  dateStrings: true,              // ← DATE কলাম স্ট্রিং হিসেবে আসে, টাইমজোনে একদিন পিছিয়ে যায় না
  connectionLimit: 10,
});

const app = express();
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));

app.use('/admin/ledger', ledgerRouter({
  pool,
  getActor: (req) => ({
    userId: Number(req.query.uid || 1),
    role: req.query.role || ROLE,
    ip: req.ip,
  }),
}));

// সংখ্যা-লাইব্রেরি ব্রাউজারেও একই ফাইল থেকে
app.get('/js/bangla-number.js', (req, res) =>
  res.type('application/javascript').sendFile(path.join(__dirname, 'lib/bangla-number.js')));

const actor = (req) => ({
  userId: Number(req.query.uid || 1),
  role: req.query.role || ROLE,
  ip: req.ip,
});

app.use('/admin/receipts', receipts.admin({ pool, getActor: actor }));
app.use('/admin/donors', donorRouter({ pool, getActor: actor }));
app.use('/admin/orphans', orphanRouter({ pool, getActor: actor }));
app.use('/verify', receipts.publicVerify({ pool }));   // auth ছাড়া

app.get('/', (req, res) => res.redirect('/admin/receipts'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, errors: ['সার্ভার ত্রুটি: ' + err.message] });
});

const server = app.listen(PORT, () => {
  console.log('ডেমো সার্ভার: http://localhost:' + PORT + '/admin/ledger  (role=' + ROLE + ')');
});

module.exports = { app, server, pool };

#!/usr/bin/env node
'use strict';
/**
 * ডেটাবেস ইনস্টলার — সাতটি SQL ফাইল ঠিক ক্রমে চালায় ও যাচাই করে।
 *
 * ব্যবহার:
 *   node setup-db.js --host 127.0.0.1 --user root --pass '****' --db jamiah --create
 *
 * বিকল্প:
 *   --create        ডেটাবেস না থাকলে বানিয়ে নেয় (সঠিক কোলেশনসহ)
 *   --fy-start      আর্থিক বছরের শুরু, যেমন 2026-07-01 (ডিফল্ট 2026-01-01)
 *   --fy-end        আর্থিক বছরের শেষ,  যেমন 2027-06-30
 *   --fy-name       বছরের নাম, যেমন 2026-2027
 *   --force         ডেটা থাকলেও চালায় (সাবধান — টেবিল মুছে যাবে)
 *
 * পরিবেশ ভেরিয়েবলও চলে: DB_HOST, DB_USER, DB_PASS, DB_NAME
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const FILES = [
  ['01_schema.sql', 'খতিয়ানের স্কিমা — হিসাব, ফান্ড, ভাউচার'],
  ['02_seed_chart_of_accounts.sql', 'চার্ট অফ অ্যাকাউন্টস, ৮টি ফান্ড, আর্থিক বছর'],
  ['03_schema_receipts.sql', 'রশিদের স্কিমা'],
  ['04_seed_receipt_types.sql', '১০টি রশিদের ধরন ও নমুনা বই'],
  ['05_schema_donors.sql', 'দাতা, প্রচারাভিযান, প্রতিশ্রুতি'],
  ['06_seed_campaigns.sql', 'নমুনা প্রচারাভিযান'],
  ['07_schema_orphans.sql', 'এতিম ও স্পনসরশিপ'],
];

const CHECKS = [
  ['accounts',           110, 'হিসাব'],
  ['funds',                8, 'ফান্ড'],
  ['fund_account_rules',  47, 'ফান্ডের বিধিনিষেধ'],
  ['cost_centers',         7, 'কস্ট সেন্টার'],
  ['fiscal_periods',      12, 'মাসিক পিরিয়ড'],
  ['receipt_types',       10, 'রশিদের ধরন'],
  ['voucher_sequences',    5, 'ভাউচার নম্বর সিরিজ'],
  ['receipt_sequences',   10, 'রশিদ নম্বর সিরিজ'],
];

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return dflt;
}
const flag = (name) => process.argv.indexOf('--' + name) >= 0;

const say  = (m) => console.log(m);
const ok   = (m) => console.log('  ✅ ' + m);
const warn = (m) => console.log('  ⚠  ' + m);
const die  = (m) => { console.error('\n❌ ' + m + '\n'); process.exit(1); };

async function main() {
  const host = arg('host', process.env.DB_HOST || '127.0.0.1');
  const port = Number(arg('port', process.env.DB_PORT || 3306));
  const user = arg('user', process.env.DB_USER);
  const pass = arg('pass', process.env.DB_PASS || '');
  const db   = arg('db',   process.env.DB_NAME || 'jamiah');

  if (!user) die("ডেটাবেস ইউজার দিতে হবে: --user <নাম>   (বা DB_USER)");

  const dir = __dirname;
  for (const [f] of FILES) {
    if (!fs.existsSync(path.join(dir, f))) die(`ফাইল পাওয়া যায়নি: ${f}\n   setup-db.js যে ফোল্ডারে, SQL ফাইলগুলোও সেখানেই রাখুন।`);
  }

  say('\n╔══════════════════════════════════════════════════════════╗');
  say('║  জামিয়াহ স্কলার্স — হিসাব ও অনুদান ব্যবস্থা                ║');
  say('║  ডেটাবেস ইনস্টলার                                        ║');
  say('╚══════════════════════════════════════════════════════════╝\n');
  say(`সার্ভার : ${host}:${port}`);
  say(`ইউজার  : ${user}`);
  say(`ডেটাবেস: ${db}\n`);

  // ---- সংযোগ ----
  let conn;
  try {
    conn = await mysql.createConnection({
      host, port, user, password: pass,
      multipleStatements: true, charset: 'utf8mb4_unicode_ci',
    });
  } catch (e) {
    die('ডেটাবেসে সংযোগ হয়নি: ' + e.message +
        '\n   ইউজার, পাসওয়ার্ড ও হোস্ট আবার দেখুন।');
  }

  // ---- সংস্করণ ----
  const [[v]] = await conn.query('SELECT VERSION() AS v');
  say('MySQL সংস্করণ: ' + v.v);
  const m = String(v.v).match(/^(\d+)\.(\d+)\.(\d+)/);
  const isMaria = /maria/i.test(v.v);
  if (m) {
    const [, M, mi, p] = m.map(Number);
    const okVer = isMaria ? (M > 10 || (M === 10 && mi >= 5))
                          : (M > 8 || (M === 8 && (mi > 0 || p >= 16)));
    if (!okVer) {
      warn('সংস্করণ পুরনো — CHECK কনস্ট্রেইন্ট নীরবে উপেক্ষিত হবে।');
      warn('স্কিমা চলবে, কিন্তু ডেটাবেস-স্তরের কিছু সুরক্ষা থাকবে না।');
      warn('প্রয়োজন: MySQL 8.0.16+ বা MariaDB 10.5+\n');
    } else ok('সংস্করণ যথেষ্ট নতুন');
  }

  // ---- ডেটাবেস ----
  if (flag('create')) {
    try {
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${db}\`
           CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      ok(`ডেটাবেস '${db}' প্রস্তুত`);
    } catch (e) {
      // শেয়ারড হোস্টিংয়ে (cPanel) অ্যাপ-ইউজারের ডেটাবেস বানানোর অনুমতি থাকে না
      if (/Access denied/i.test(e.message)) {
        await conn.end();
        die(`এই ইউজারের ডেটাবেস বানানোর অনুমতি নেই।\n` +
            `   cPanel → MySQL Databases থেকে '${db}' নামে ডেটাবেস বানান,\n` +
            `   ইউজারটিকে ALL PRIVILEGES দিন, তারপর --create ছাড়া আবার চালান:\n\n` +
            `   node setup-db.js --user ${user} --pass '****' --db ${db}\n\n` +
            `   গুরুত্বপূর্ণ: cPanel-এ ডেটাবেস বানানোর সময় collation\n` +
            `   utf8mb4_unicode_ci বেছে নিন, নইলে বাংলা লেখা ভাঙবে।`);
      }
      throw e;
    }
  }
  try {
    await conn.query(`USE \`${db}\``);
  } catch (e) {
    die(`'${db}' ডেটাবেস খোলা যায়নি: ${e.message}\n   --create দিয়ে চালান, অথবা আগে ডেটাবেসটি বানিয়ে নিন।`);
  }

  // ---- কোলেশন ----
  const [[col]] = await conn.query(
    `SELECT DEFAULT_COLLATION_NAME c FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`, [db]);
  if (col.c !== 'utf8mb4_unicode_ci') {
    warn(`ডেটাবেসের কোলেশন '${col.c}' — হওয়া দরকার 'utf8mb4_unicode_ci'।`);
    warn('ঠিক করছি…');
    await conn.query(
      `ALTER DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    ok('কোলেশন ঠিক করা হলো');
  } else ok('কোলেশন ঠিক আছে');

  // ---- সংঘর্ষের যাচাই ----
  // ইনস্টলার নিচের টেবিলগুলো DROP করে নতুন করে বানায়। এর মধ্যে 'accounts',
  // 'receipts', 'donors' এর মতো নাম আছে যা অন্য অ্যাপেও থাকতে পারে — তাই
  // চালানোর আগে প্রতিটি নাম যাচাই করা হয়, শুধু কয়েকটি নয়।
  const OWNED = [
    'accounts','funds','fund_account_rules','cost_centers','fiscal_years','fiscal_periods',
    'voucher_sequences','vouchers','voucher_lines','voucher_attachments','opening_balances',
    'audit_logs','receipt_types','receipt_sequences','receipts','receipt_books',
    'donors','campaigns','pledges','recurring_plans','orphans','sponsorships',
    'orphan_documents','orphan_progress_reports','orphan_visits',
  ];
  const [existing] = await conn.query(
    `SELECT TABLE_NAME t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`, [db, OWNED]);

  if (existing.length) {
    const withRows = [];
    let total = 0;
    for (const e of existing) {
      const [[c]] = await conn.query(`SELECT COUNT(*) n FROM \`${e.t}\``);
      if (Number(c.n) > 0) { withRows.push([e.t, Number(c.n)]); total += Number(c.n); }
    }
    if (total > 0 && !flag('force')) {
      await conn.end();
      die('এই ডেটাবেসে একই নামের টেবিল আছে, যাতে ডেটা রয়েছে:\n\n' +
          withRows.map(([t, n]) => `     ${t.padEnd(26)} ${String(n).padStart(8)} সারি`).join('\n') +
          '\n\n   ইনস্টলার এই টেবিলগুলো মুছে নতুন করে বানায় — সব ডেটা হারাবে।\n\n' +
          '   সম্ভবত এগুলো আপনার বিদ্যমান অ্যাপের টেবিল। সেক্ষেত্রে\n' +
          '   হিসাবের মডিউল একটি আলাদা ডেটাবেসে বসান:\n\n' +
          `     node setup-db.js --user ${user} --pass '****' --db jamiah_finance --create\n\n` +
          '   আলাদা ডেটাবেসে রাখলে কিছুই ভাঙবে না — এই মডিউলের কোনো\n' +
          '   টেবিলের সাথে আপনার students বা users টেবিলের ফরেন কি নেই।\n\n' +
          '   সত্যিই এই ডেটাবেসেই চাইলে আগে ব্যাকআপ নিন, তারপর --force:\n' +
          `     mysqldump -u ${user} -p ${db} > backup-${new Date().toISOString().slice(0,10)}.sql`);
    }
    if (total > 0) {
      warn(`--force দেওয়া হয়েছে — ${existing.length}টি টেবিলের ${total}টি সারি মুছে যাবে`);
    } else {
      warn(`${existing.length}টি খালি টেবিল আগে থেকেই আছে — নতুন করে বানানো হবে`);
    }
  } else ok('নামের সংঘর্ষ নেই');

  // ---- আর্থিক বছর ----
  const fyStart = arg('fy-start', null);
  const fyEnd   = arg('fy-end', null);
  const fyName  = arg('fy-name', null);

  // ---- ফাইলগুলো ----
  say('\nSQL ফাইল চালানো হচ্ছে:\n');
  for (let i = 0; i < FILES.length; i++) {
    const [file, desc] = FILES[i];
    let sql = fs.readFileSync(path.join(dir, file), 'utf8');

    if (file.startsWith('02_') && (fyStart || fyEnd || fyName)) {
      if (fyName)  sql = sql.replace(/SET @fy_name\s*=\s*'[^']*';/, `SET @fy_name  = '${fyName}';`);
      if (fyStart) sql = sql.replace(/SET @fy_start\s*=\s*'[^']*';/, `SET @fy_start = '${fyStart}';`);
      if (fyEnd)   sql = sql.replace(/SET @fy_end\s*=\s*'[^']*';/, `SET @fy_end   = '${fyEnd}';`);
      say(`  আর্থিক বছর: ${fyName || 'অপরিবর্তিত'} (${fyStart || '…'} → ${fyEnd || '…'})`);
    }

    process.stdout.write(`  [${i + 1}/${FILES.length}] ${file.padEnd(32)} `);
    try {
      await conn.query(sql);
      console.log('✅  ' + desc);
    } catch (e) {
      console.log('❌');
      await conn.end();
      die(`${file} চালাতে সমস্যা:\n   ${e.message}\n` +
          (/collation/i.test(e.message)
            ? '\n   কোলেশন সমস্যা — ডেটাবেসটি utf8mb4_unicode_ci দিয়ে নতুন করে বানান।'
            : /Unknown column|doesn't exist/i.test(e.message)
              ? '\n   আগের কোনো ফাইল পুরো চলেনি। ডেটাবেস ফেলে আবার শুরু করুন।'
              : ''));
    }
  }

  // ---- যাচাই ----
  say('\nযাচাই:\n');
  let bad = 0;
  for (const [table, expect, label] of CHECKS) {
    const [[c]] = await conn.query(`SELECT COUNT(*) n FROM \`${table}\``);
    const n = Number(c.n);
    if (n === expect) ok(`${label.padEnd(24)} ${String(n).padStart(4)}`);
    else { bad++; console.log(`  ❌ ${label.padEnd(24)} ${String(n).padStart(4)}  (হওয়ার কথা ${expect})`); }
  }

  const [[tb]] = await conn.query(
    'SELECT COALESCE(SUM(total_debit),0) d, COALESCE(SUM(total_credit),0) c FROM v_trial_balance');
  Number(tb.d) === 0 && Number(tb.c) === 0
    ? ok('রেওয়ামিল শূন্য থেকে শুরু')
    : (bad++, console.log(`  ❌ রেওয়ামিল শূন্য নয়: ${tb.d} / ${tb.c}`));

  const [[fy]] = await conn.query(
    'SELECT name, start_date, end_date FROM fiscal_years ORDER BY id DESC LIMIT 1');
  const ymd = (d) => {
    if (!(d instanceof Date)) return String(d).slice(0, 10);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  ok(`আর্থিক বছর: ${fy.name} (${ymd(fy.start_date)} → ${ymd(fy.end_date)})`);

  const [[bn]] = await conn.query("SELECT name_bn FROM accounts WHERE code = '5201'");
  bn && bn.name_bn === 'শিক্ষার্থীদের খাবার'
    ? ok('বাংলা লেখা ঠিক আছে')
    : (bad++, console.log(`  ❌ বাংলা লেখা ভেঙেছে: "${bn && bn.name_bn}" — charset দেখুন`));

  await conn.end();

  if (bad) die(`${bad}টি যাচাই ব্যর্থ। ডেটাবেস ফেলে আবার চালানোই নিরাপদ।`);

  say('\n╔══════════════════════════════════════════════════════════╗');
  say('║  ✅  ডেটাবেস প্রস্তুত                                       ║');
  say('╚══════════════════════════════════════════════════════════╝\n');
  say('পরের ধাপ:');
  say('  ১. npm install mysql2 qrcode');
  say('  ২. app.js এ রাউটারগুলো মাউন্ট করুন (mount-example.js দেখুন)');
  say('  ৩. users টেবিলে finance_role কলাম যোগ করুন');
  say('  ৪. অ্যাপ রিস্টার্ট করে /admin/ledger খুলুন\n');
  say('বিস্তারিত নির্দেশিকা: INSTALL.md\n');
}

main().catch((e) => die('অপ্রত্যাশিত ত্রুটি: ' + (e && e.stack || e)));

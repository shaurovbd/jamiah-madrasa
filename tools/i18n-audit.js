'use strict';
/**
 * Checks the locale files against each other and against the code.
 *
 *   node tools/i18n-audit.js
 *
 * Reports: keys present in one language but not the other, empty strings,
 * placeholder mismatches between the two languages (a %{name} that exists in
 * English but not in Bangla silently loses the value), keys referenced in the
 * code that no locale defines, and keys no longer referenced anywhere.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const en = read('locales/en.json');
const bn = read('locales/bn.json');

const problems = [];
const warn = [];

/* ------------------------------------------------- key sets and values */
const enKeys = Object.keys(en);
const bnKeys = Object.keys(bn);

for (const k of enKeys) {
  if (!(k in bn)) problems.push(`missing in bn: ${k}`);
}
for (const k of bnKeys) {
  if (!(k in en)) problems.push(`missing in en (bn-only): ${k}`);
}
for (const [k, v] of Object.entries(en)) {
  if (typeof v !== 'string' || v.trim() === '') problems.push(`empty en value: ${k}`);
}
for (const [k, v] of Object.entries(bn)) {
  if (typeof v !== 'string' || v.trim() === '') problems.push(`empty bn value: ${k}`);
}

/* --------------------------------------------------- placeholder parity */
const holders = (s) => (String(s).match(/%\{\w+\}/g) || []).slice().sort().join(',');
for (const k of enKeys) {
  if (!(k in bn)) continue;
  const a = holders(en[k]);
  const b = holders(bn[k]);
  if (a !== b) problems.push(`placeholders differ for ${k}: en[${a || 'none'}] vs bn[${b || 'none'}]`);
}

/* ------------------------------------------- bn values that are still English */
// A Bangla value with no Bengali characters at all is almost always an
// untranslated copy. Values that are only digits, punctuation or a Latin brand
// name are fine, so this is a warning rather than a failure.
const hasBengali = (s) => /[ঀ-৿]/.test(s);
// The language switcher's English label is English on purpose, in both files.
const LATIN_ON_PURPOSE = new Set(['lang.switch_to_en']);
for (const k of bnKeys) {
  if (LATIN_ON_PURPOSE.has(k)) continue;
  const v = bn[k];
  if (!hasBengali(v) && /[A-Za-z]{3}/.test(v) && v !== en[k]) continue;
  if (!hasBengali(v) && /[A-Za-z]{3}/.test(v)) warn.push(`bn same as en (untranslated?): ${k} = ${JSON.stringify(v)}`);
}

/* ------------------------------------------------ keys used in the code */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|ejs)$/.test(e.name)) out.push(full);
  }
  return out;
}

const files = walk(ROOT).filter((f) => !f.includes(`${path.sep}tools${path.sep}`));
const used = new Map();           // key -> first file that uses it
const dynamic = [];               // t(variable) call sites we cannot resolve

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  // t('key'), i18n.pack('key', ...), flash('x', 'key')
  for (const m of src.matchAll(/\bt\(\s*'([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)'/g)) {
    if (!used.has(m[1])) used.set(m[1], rel);
  }
  for (const m of src.matchAll(/pack\(\s*'([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)'/g)) {
    if (!used.has(m[1])) used.set(m[1], rel);
  }
  for (const m of src.matchAll(/flash\(\s*'\w+'\s*,\s*'([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)'/g)) {
    if (!used.has(m[1])) used.set(m[1], rel);
  }
  // Keys are also passed around as plain strings — FIELDS tables, tab labels,
  // the list validate() returns, flash arrays. Any quoted string that matches a
  // defined key counts as a reference, which keeps the unused list honest.
  for (const m of src.matchAll(/'([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)'/g)) {
    if ((m[1] in en) && !used.has(m[1])) used.set(m[1], rel);
  }
  if (/\bt\(\s*[A-Za-z_$]/.test(src) || /\blabel\(\s*'/.test(src)) dynamic.push(rel);
}

for (const [k, where] of used) {
  if (!(k in en)) problems.push(`used in ${where} but not defined: ${k}`);
}

// enum.* and a few keys are looked up from variables, so exclude those prefixes
// from the unused report rather than chasing false positives.
const DYNAMIC_PREFIXES = ['enum.', 'role.', 'lang.', 'a.log.act.', 'a.log.ev.', 'a.log.reason.', 'a.user.role_', 'a.sms.aud.', 'a.sms.aud_hint.', 'a.sms.tpl', 'a.sms.st.', 'a.sms.prov', 'a.promo.act', 'a.print.doc', 'portal.dow.', 'a.imp.err.', 'a.imp.warn.'];
const unused = enKeys.filter((k) =>
  !used.has(k) && !DYNAMIC_PREFIXES.some((p) => k.startsWith(p)));
for (const k of unused) warn.push(`defined but never referenced: ${k}`);

/* ------------------------------------------------------------- report */
console.log(`en: ${enKeys.length} keys   bn: ${bnKeys.length} keys   referenced in code: ${used.size}`);
console.log(`files with dynamic lookups (not checked): ${dynamic.length}`);

if (warn.length) {
  console.log(`\nWarnings (${warn.length}):`);
  warn.forEach((w) => console.log('  ' + w));
}
if (problems.length) {
  console.log(`\nProblems (${problems.length}):`);
  problems.forEach((p) => console.log('  ' + p));
  process.exit(1);
}
console.log('\nLocale files are consistent.');

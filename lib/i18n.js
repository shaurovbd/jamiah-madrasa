'use strict';
/**
 * Two-language support (English / Bangla) for the website and the management panel.
 *
 * Strings live in locales/en.json and locales/bn.json as flat dotted keys, e.g.
 * "nav.home". Views call t('nav.home'); the active language comes from
 * res.locals.lang, which the middleware in app.js resolves per request.
 *
 * A key with no Bangla string falls back to English rather than rendering blank,
 * so a half-finished translation never leaves a hole in the page.
 */

const fs = require('fs');
const path = require('path');

const LOCALE_DIR = path.join(__dirname, '..', 'locales');

/** Languages the site offers. `dir` is here so an RTL language can be added later. */
const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', dir: 'ltr' },
  { code: 'bn', label: 'Bangla', native: 'বাংলা', dir: 'ltr' }
];

const CODES = LANGUAGES.map((l) => l.code);
const DEFAULT_LANG = 'en';

const tables = {};
let loaded = false;

function load(force = false) {
  if (loaded && !force) return;
  for (const { code } of LANGUAGES) {
    try {
      const raw = fs.readFileSync(path.join(LOCALE_DIR, `${code}.json`), 'utf8');
      tables[code] = JSON.parse(raw);
    } catch (err) {
      // A missing or malformed locale file must not take the site down; English
      // keys still resolve and Bangla falls back to them.
      console.error(`[i18n] could not load locale "${code}":`, err.message);
      tables[code] = tables[code] || {};
    }
  }
  loaded = true;
}

function isLang(code) {
  return CODES.includes(String(code || '').toLowerCase());
}

/** Normalise anything user-supplied down to a language we actually have. */
function normalize(code, fallback = DEFAULT_LANG) {
  const c = String(code || '').toLowerCase().slice(0, 5);
  if (isLang(c)) return c;
  // Accept "bn-BD" and the like.
  const base = c.split(/[-_]/)[0];
  if (isLang(base)) return base;
  return isLang(fallback) ? fallback : DEFAULT_LANG;
}

/**
 * Interpolate %{name} placeholders.
 * Values are substituted raw: views escape with <%= %>, and the only inputs are
 * counts and names the caller already has in hand.
 */
function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/%\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m
  );
}

/**
 * Look up a key. Falls back: requested language -> English -> the key itself.
 * Returning the key (rather than an empty string) makes a missing string
 * obvious on the page and findable by the audit script.
 */
function t(key, lang = DEFAULT_LANG, vars = null) {
  load();
  const k = String(key || '');
  const code = normalize(lang);
  const hit = tables[code] && tables[code][k];
  if (typeof hit === 'string' && hit !== '') return interpolate(hit, vars);
  const en = tables[DEFAULT_LANG] && tables[DEFAULT_LANG][k];
  if (typeof en === 'string' && en !== '') return interpolate(en, vars);
  return k;
}

/** Does this key exist in the given language (no fallback)? Used by the audit script. */
function has(key, lang) {
  load();
  const code = normalize(lang);
  return Boolean(tables[code] && tables[code][String(key)]);
}

/** Every key defined in English — the canonical list. */
function keys(lang = DEFAULT_LANG) {
  load();
  return Object.keys(tables[normalize(lang)] || {});
}

/** Bind a language once so views can call t('key') without repeating it. */
function translator(lang) {
  const code = normalize(lang);
  return (key, vars) => t(key, code, vars);
}

/**
 * Flash messages outlive the request that set them: they are written, the
 * browser is redirected, and the next page renders them — possibly in a
 * different language. So a flash carries its translation key and values rather
 * than finished text, and is translated at render time.
 *
 *   req.flash('success', i18n.pack('f.att.saved', { count: 12, date: '09 Mar 2026' }))
 */
const PACK_PREFIX = 'i18n:';

function pack(key, vars) {
  if (!vars) return String(key);
  try {
    return PACK_PREFIX + JSON.stringify({ k: String(key), v: vars });
  } catch (err) {
    return String(key);
  }
}

/**
 * Render a flash entry. Accepts a packed message, a bare translation key, or
 * literal text — anything unrecognised comes back unchanged, so older code
 * that flashes a plain English sentence still works.
 */
function unpack(message, lang) {
  const raw = String(message == null ? '' : message);
  if (!raw.startsWith(PACK_PREFIX)) return t(raw, lang);
  try {
    const parsed = JSON.parse(raw.slice(PACK_PREFIX.length));
    return t(parsed.k, lang, parsed.v);
  } catch (err) {
    return raw;
  }
}

function flashTranslator(lang) {
  const code = normalize(lang);
  return (message) => unpack(message, code);
}

/**
 * Label for a value stored in the database, such as an ENUM column.
 *
 * Views used to print these columns raw, which left "unpaid" and "excellent"
 * in English on a Bangla page. Keys live under enum.<group>.<value>; a value
 * with no key falls back to the stored string rather than showing a key, since
 * a new ENUM member added in SQL should not break a page.
 */
function enumLabel(group, value, lang) {
  const raw = String(value == null ? '' : value);
  if (!raw) return '';
  const key = `enum.${group}.${raw}`;
  if (has(key, lang) || has(key, DEFAULT_LANG)) return t(key, lang);
  return raw;
}

function enumLabeler(lang) {
  const code = normalize(lang);
  return (group, value) => enumLabel(group, value, code);
}

function language(code) {
  const c = normalize(code);
  return LANGUAGES.find((l) => l.code === c) || LANGUAGES[0];
}

module.exports = {
  LANGUAGES, CODES, DEFAULT_LANG,
  t, has, keys, translator, normalize, isLang, language, load,
  pack, unpack, flashTranslator, enumLabel, enumLabeler
};

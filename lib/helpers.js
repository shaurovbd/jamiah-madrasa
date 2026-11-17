'use strict';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200) || 'item';
}

/** 2026-03-09 -> 09 Mar 2026 */
function fmtDate(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt)) return String(d);
  const mm = MONTHS[dt.getMonth()].slice(0, 3);
  return `${String(dt.getDate()).padStart(2, '0')} ${mm} ${dt.getFullYear()}`;
}

/** Date value for an <input type="date"> */
function inputDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.toISOString().slice(0, 10);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 2026-03 -> March 2026 */
function fmtPeriod(p) {
  if (!p) return '';
  const [y, m] = String(p).split('-');
  const idx = Number(m) - 1;
  return `${MONTHS[idx] || m} ${y}`;
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function money(n, symbol = 'Tk') {
  const v = Number(n || 0);
  return `${symbol} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function num(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/** Letter grade from a percentage, GPA 5 scale. */
function gradeFor(percent) {
  const p = Number(percent || 0);
  if (p >= 80) return { grade: 'A+', point: 5.0 };
  if (p >= 70) return { grade: 'A',  point: 4.0 };
  if (p >= 60) return { grade: 'A-', point: 3.5 };
  if (p >= 50) return { grade: 'B',  point: 3.0 };
  if (p >= 40) return { grade: 'C',  point: 2.0 };
  if (p >= 33) return { grade: 'D',  point: 1.0 };
  return { grade: 'F', point: 0.0 };
}

/** Escape a value for safe inclusion in HTML (views use <%= %>, this is for built strings). */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Build a querystring preserving existing filters. */
function qs(base, overrides = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function paginate(total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return { total, pages, current, perPage, offset: (current - 1) * perPage };
}

/** Next sequential document number, e.g. nextNo('INV', 23) -> INV-2026-0024 */
function nextNo(prefix, lastId) {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(Number(lastId || 0) + 1).padStart(4, '0')}`;
}

/**
 * Bulk-edit grids name their inputs field[id<N>] rather than field[<N>].
 * A purely numeric key would be parsed as an array index and the array then
 * compacted, which silently renumbers every row. This reads the id back out.
 */
function idFromKey(key) {
  const m = String(key).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function toInt(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function toNum(v, fallback = 0) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

/** Null for empty strings, so optional foreign keys and dates store cleanly. */
function orNull(v) {
  return (v === undefined || v === null || String(v).trim() === '') ? null : v;
}

module.exports = {
  MONTHS, slugify, fmtDate, inputDate, today, fmtPeriod, currentPeriod,
  money, num, gradeFor, esc, qs, paginate, nextNo, idFromKey, toInt, toNum, orNull
};

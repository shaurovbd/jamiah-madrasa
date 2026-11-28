'use strict';
/**
 * Read the first sheet of an .xlsx or a .csv file into rows of text.
 *
 * Built on Node's own zlib so the server needs no extra package (no npm
 * install on cPanel). An .xlsx file is a zip of XML; this reads just enough of
 * it: the shared strings, the workbook's first sheet, and its cells. Formulas
 * come through as their last saved value, as Excel shows them.
 *
 * Limits keep a hostile file from hurting the server: 5 MB upload (set in the
 * route), 40 MB unpacked per part, 5,000 rows, 60 columns.
 */
const zlib = require('zlib');

const MAX_UNZIPPED = 40 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_COLS = 60;

/* ------------------------------------------------------------------ zip */
function unzip(buf) {
  // End of central directory: last 22..65557 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    files[name] = { method, csize, local };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: Object.keys(files),
    read(name) {
      const f = files[name];
      if (!f) return null;
      const lp = f.local;
      if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error('broken zip entry');
      const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
      const data = buf.slice(start, start + f.csize);
      if (f.method === 0) return data.toString('utf8');
      if (f.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED }).toString('utf8');
      throw new Error('unsupported compression');
    }
  };
}

/* ------------------------------------------------------------------ xml */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unxml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] !== undefined ? ENT[e] : m;
  });
}
/** All <t>…</t> text inside a fragment, joined (rich text has several runs). */
function texts(fragment) {
  let out = '';
  fragment.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, t) => { out += unxml(t); return m; });
  return out;
}

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref);
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(buf) {
  const z = unzip(buf);
  const shared = [];
  const ss = z.read('xl/sharedStrings.xml');
  if (ss) ss.replace(/<si>([\s\S]*?)<\/si>/g, (m, si) => { shared.push(texts(si)); return m; });

  // First sheet in workbook order, through the relationships file.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = z.read('xl/workbook.xml');
  const rels = z.read('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb) || /<sheet\b[^>]*\bid="([^"]+)"/.exec(wb);
    if (first) {
      const rel = new RegExp(`<Relationship\\b[^>]*Id="${first[1]}"[^>]*Target="([^"]+)"`).exec(rels)
        || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${first[1]}"`).exec(rels);
      if (rel) sheetPath = rel[1].startsWith('/') ? rel[1].slice(1) : 'xl/' + rel[1].replace(/^\.\//, '');
    }
  }
  const sheet = z.read(sheetPath);
  if (!sheet) throw new Error('no worksheet found');

  const rows = [];
  sheet.replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (m, rowXml) => {
    if (rows.length >= MAX_ROWS) return m;
    const row = [];
    rowXml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (cm, attrs, inner) => {
      const ref = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1];
      const type = (/\bt="(\w+)"/.exec(attrs) || [])[1];
      let i = ref ? colIndex(ref) : row.length;
      if (i < 0 || i >= MAX_COLS) return cm;
      let v = '';
      if (inner) {
        if (type === 'inlineStr') v = texts(inner);
        else {
          const raw = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
          if (raw !== undefined) v = type === 's' ? (shared[Number(raw)] || '') : unxml(raw);
        }
      }
      while (row.length < i) row.push('');
      row[i] = String(v);
      return cm;
    });
    rows.push(row);
    return m;
  });
  return rows;
}

/* ------------------------------------------------------------------ csv */
function readCsv(buf) {
  let text = buf.toString('utf8').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = [',', ';', '\t'].map((s) => [s, firstLine.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row.slice(0, MAX_COLS)); row = []; cell = '';
      if (rows.length >= MAX_ROWS) break;
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row.slice(0, MAX_COLS)); }
  return rows;
}

/** -> rows (array of arrays of strings), empty trailing rows removed. */
function read(buf, filename) {
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  const rows = isZip || /\.xlsx$/i.test(filename || '') ? readXlsx(buf) : readCsv(buf);
  while (rows.length && rows[rows.length - 1].every((c) => !String(c).trim())) rows.pop();
  return rows;
}

/** Excel stores dates as day numbers since 1899-12-30. */
function excelDate(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(n)) * 86400000);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

module.exports = { read, excelDate, MAX_ROWS };

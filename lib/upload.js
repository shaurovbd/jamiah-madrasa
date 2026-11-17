'use strict';
/**
 * Uploads.
 *
 * Use the guarded chains (imageSingle / imageArray / docSingle) on routes,
 * never multer directly: they also verify the CSRF token once multer has
 * parsed the fields, and confirm the file really is the type it claims to be.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const csrf = require('./csrf');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase().slice(0, 8);
    cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`);
  }
});

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DOC_TYPES = IMAGE_TYPES.concat(['application/pdf']);

const EXT_FOR = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf'
};

function makeUploader(allowed, sizeMb) {
  return multer({
    storage,
    limits: { fileSize: sizeMb * 1024 * 1024, files: 20 },
    fileFilter: (req, file, cb) => {
      if (allowed.includes(file.mimetype)) return cb(null, true);
      cb(null, false); // silently skip; the route keeps the previous file
    }
  });
}

const image = makeUploader(IMAGE_TYPES, 4);
const doc = makeUploader(DOC_TYPES, 8);

/**
 * Read the first bytes and work out what the file actually is. The browser's
 * content-type is not evidence: anything can be renamed and relabelled.
 */
function sniff(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(16);
    const n = fs.readSync(fd, b, 0, 16, 0);
    if (n < 4) return null;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (b.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
    if (n >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    if (b.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
    return null;
  } catch (err) {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (err) { /* ignore */ } }
  }
}

/** Give the stored file the extension its real type deserves. */
function normaliseExtension(file, kind) {
  const want = EXT_FOR[kind];
  if (!want || path.extname(file.filename).toLowerCase() === want) return;
  const next = file.filename.replace(/\.[^.]*$/, '') + want;
  const nextPath = path.join(UPLOAD_DIR, next);
  try {
    fs.renameSync(file.path, nextPath);
    file.filename = next;
    file.path = nextPath;
  } catch (err) { /* keep the original name rather than losing the file */ }
}

function drop(file) {
  if (file && file.path) fs.unlink(file.path, () => {});
}

/** Third link in the chain: throw out anything that is not really an image/PDF. */
function checkSignatures(allowed, label) {
  return (req, res, next) => {
    const many = Array.isArray(req.files);
    const files = many ? req.files : (req.file ? [req.file] : []);
    if (!files.length) return next();

    const good = [];
    let bad = 0;
    for (const f of files) {
      const kind = sniff(f.path);
      if (kind && allowed.includes(kind)) {
        normaliseExtension(f, kind);
        good.push(f);
      } else {
        drop(f);
        bad++;
      }
    }

    if (bad) {
      req.flash('error', bad === files.length
        ? `That file is not a valid ${label}, so nothing was saved. Please choose a real ${label} file.`
        : `${bad} file${bad === 1 ? ' was' : 's were'} not a valid ${label} and ${bad === 1 ? 'was' : 'were'} skipped.`);
    }

    if (many) {
      req.files = good;
      if (!good.length) return res.redirect('back');
    } else {
      if (!good.length) { delete req.file; return res.redirect('back'); }
    }
    return next();
  };
}

const imageSingle = (field) => [image.single(field), csrf.afterUpload, checkSignatures(IMAGE_TYPES, 'image')];
const imageArray = (field, max) => [image.array(field, max), csrf.afterUpload, checkSignatures(IMAGE_TYPES, 'image')];
const docSingle = (field) => [doc.single(field), csrf.afterUpload, checkSignatures(DOC_TYPES, 'image or PDF')];

/** Delete an uploaded file by its stored name; ignores anything that is missing. */
function remove(filename) {
  if (!filename) return;
  const safe = path.basename(String(filename));
  fs.unlink(path.join(UPLOAD_DIR, safe), () => {});
}

/**
 * Check one already-uploaded file from inside a route handler. For forms where
 * the other fields should still be saved even if the chosen file is wrong.
 * Returns the stored filename, or null after deleting a file that is not one
 * of `allowed`.
 */
function accept(file, allowed = IMAGE_TYPES) {
  if (!file) return null;
  const kind = sniff(file.path);
  if (!kind || !allowed.includes(kind)) { drop(file); return null; }
  normaliseExtension(file, kind);
  return file.filename;
}

module.exports = {
  image, doc, remove, UPLOAD_DIR, sniff, accept,
  imageSingle, imageArray, docSingle,
  IMAGE_TYPES, DOC_TYPES
};

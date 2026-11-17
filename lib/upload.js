'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

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

function makeUploader(allowed, sizeMb = 4) {
  return multer({
    storage,
    limits: { fileSize: sizeMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (allowed.includes(file.mimetype)) return cb(null, true);
      cb(null, false); // silently skip; the route keeps the previous file
    }
  });
}

const image = makeUploader(IMAGE_TYPES, 4);
const doc = makeUploader(DOC_TYPES, 8);

/** Delete an uploaded file by its stored name; ignores anything that is missing. */
function remove(filename) {
  if (!filename) return;
  const safe = path.basename(String(filename));
  fs.unlink(path.join(UPLOAD_DIR, safe), () => {});
}

module.exports = { image, doc, remove, UPLOAD_DIR };

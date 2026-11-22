'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const upload = require('../../lib/upload');
const i18n = require('../../lib/i18n');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const images = await db.query('SELECT * FROM gallery ORDER BY album, sort_order, id DESC');
    res.render('admin/content/gallery', { title: res.locals.t('admin.nav.gallery'), images });
  } catch (err) { next(err); }
});

router.post('/', upload.image.array('images', 12), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      req.flash('error', 'f.web.choose_images');
      return res.redirect('/admin/gallery');
    }
    const album = String(req.body.album || '').trim() || 'Campus';
    const title = String(req.body.title || '').trim();
    for (const f of files) {
      await db.run('INSERT INTO gallery (title, album, image, sort_order) VALUES (?,?,?,?)',
        [title || null, album, f.filename, h.toNum(req.body.sort_order, 0)]);
    }
    req.flash('success', i18n.pack('f.web.images_uploaded', { count: files.length, album: album }));
    res.redirect('/admin/gallery');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = await db.one('SELECT image FROM gallery WHERE id = ?', [h.toInt(req.params.id)]);
    await db.run('DELETE FROM gallery WHERE id = ?', [h.toInt(req.params.id)]);
    if (row) upload.remove(row.image);
    req.flash('success', 'f.web.image_removed');
    res.redirect('/admin/gallery');
  } catch (err) { next(err); }
});

module.exports = router;

'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const pages = await db.query('SELECT * FROM pages ORDER BY slug');
    const edit = h.toInt(req.query.edit) ? await db.one('SELECT * FROM pages WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/content/pages', { title: res.locals.t('a.web.pages_title'), pages, edit });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    const slug = h.slugify(req.body.slug || title);
    if (!title) { req.flash('error', 'f.title_required'); return res.redirect('/admin/pages'); }
    const id = h.toInt(req.body.id);
    const published = req.body.is_published ? 1 : 0;
    if (id) {
      await db.run('UPDATE pages SET slug=?, title=?, body=?, is_published=? WHERE id=?',
        [slug, title, h.orNull(req.body.body), published, id]);
      req.flash('success', 'f.web.page_updated');
    } else {
      const dup = await db.one('SELECT id FROM pages WHERE slug = ?', [slug]);
      if (dup) { req.flash('error', i18n.pack('f.web.page_address_exists', { slug: slug })); return res.redirect('/admin/pages'); }
      await db.run('INSERT INTO pages (slug, title, body, is_published) VALUES (?,?,?,?)',
        [slug, title, h.orNull(req.body.body), published]);
      req.flash('success', 'f.web.page_created');
    }
    res.redirect('/admin/pages');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM pages WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'f.web.page_deleted');
    res.redirect('/admin/pages');
  } catch (err) { next(err); }
});

module.exports = router;

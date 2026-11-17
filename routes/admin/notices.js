'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const upload = require('../../lib/upload');

const router = express.Router();

async function uniqueSlug(base, table, ignoreId) {
  let slug = h.slugify(base);
  let n = 1;
  for (;;) {
    const row = await db.one(`SELECT id FROM ${table} WHERE slug = ?`, [slug]);
    if (!row || (ignoreId && row.id === ignoreId)) return slug;
    slug = `${h.slugify(base)}-${++n}`;
  }
}

router.get('/', async (req, res, next) => {
  try {
    const total = await db.scalar('SELECT COUNT(*) AS c FROM notices');
    const p = h.paginate(total, req.query.page, 20);
    const notices = await db.query(
      `SELECT * FROM notices ORDER BY COALESCE(published_at, DATE(created_at)) DESC, id DESC
        LIMIT ${p.perPage} OFFSET ${p.offset}`
    );
    const edit = h.toInt(req.query.edit) ? await db.one('SELECT * FROM notices WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/content/notices', { title: 'Notices', notices, p, edit });
  } catch (err) { next(err); }
});

router.post('/', upload.docSingle('attachment'), async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) { req.flash('error', 'A title is required.'); return res.redirect('/admin/notices'); }
    const id = h.toInt(req.body.id);
    const slug = await uniqueSlug(title, 'notices', id);
    const published = req.body.is_published ? 1 : 0;

    if (id) {
      const existing = await db.one('SELECT attachment FROM notices WHERE id = ?', [id]);
      if (req.file && existing && existing.attachment) upload.remove(existing.attachment);
      await db.run(
        'UPDATE notices SET title=?, slug=?, body=?, category=?, attachment=?, is_published=?, published_at=? WHERE id=?',
        [title, slug, h.orNull(req.body.body), h.orNull(req.body.category) || 'General',
         req.file ? req.file.filename : (existing ? existing.attachment : null),
         published, h.orNull(req.body.published_at) || h.today(), id]
      );
      req.flash('success', 'Notice updated.');
    } else {
      await db.run(
        `INSERT INTO notices (title, slug, body, category, attachment, is_published, published_at, created_by)
         VALUES (?,?,?,?,?,?,?,?)`,
        [title, slug, h.orNull(req.body.body), h.orNull(req.body.category) || 'General',
         req.file ? req.file.filename : null, published,
         h.orNull(req.body.published_at) || h.today(), req.session.user.id]
      );
      req.flash('success', published ? 'Notice published to the website.' : 'Notice saved as a draft.');
    }
    res.redirect('/admin/notices');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = await db.one('SELECT attachment FROM notices WHERE id = ?', [h.toInt(req.params.id)]);
    await db.run('DELETE FROM notices WHERE id = ?', [h.toInt(req.params.id)]);
    if (row && row.attachment) upload.remove(row.attachment);
    req.flash('success', 'Notice deleted.');
    res.redirect('/admin/notices');
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.uniqueSlug = uniqueSlug;

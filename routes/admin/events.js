'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const upload = require('../../lib/upload');
const { uniqueSlug } = require('./notices');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const total = await db.scalar('SELECT COUNT(*) AS c FROM events');
    const p = h.paginate(total, req.query.page, 20);
    const events = await db.query(`SELECT * FROM events ORDER BY event_date DESC LIMIT ${p.perPage} OFFSET ${p.offset}`);
    const edit = h.toInt(req.query.edit) ? await db.one('SELECT * FROM events WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/content/events', { title: 'Events', events, p, edit });
  } catch (err) { next(err); }
});

router.post('/', upload.image.single('image'), async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    const eventDate = h.orNull(req.body.event_date);
    if (!title || !eventDate) { req.flash('error', 'Title and event date are required.'); return res.redirect('/admin/events'); }
    const id = h.toInt(req.body.id);
    const slug = await uniqueSlug(title, 'events', id);
    const published = req.body.is_published ? 1 : 0;

    if (id) {
      const existing = await db.one('SELECT image FROM events WHERE id = ?', [id]);
      if (req.file && existing && existing.image) upload.remove(existing.image);
      await db.run(
        'UPDATE events SET title=?, slug=?, description=?, event_date=?, end_date=?, location=?, image=?, is_published=? WHERE id=?',
        [title, slug, h.orNull(req.body.description), eventDate, h.orNull(req.body.end_date),
         h.orNull(req.body.location), req.file ? req.file.filename : (existing ? existing.image : null), published, id]
      );
      req.flash('success', 'Event updated.');
    } else {
      await db.run(
        `INSERT INTO events (title, slug, description, event_date, end_date, location, image, is_published)
         VALUES (?,?,?,?,?,?,?,?)`,
        [title, slug, h.orNull(req.body.description), eventDate, h.orNull(req.body.end_date),
         h.orNull(req.body.location), req.file ? req.file.filename : null, published]
      );
      req.flash('success', 'Event saved.');
    }
    res.redirect('/admin/events');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = await db.one('SELECT image FROM events WHERE id = ?', [h.toInt(req.params.id)]);
    await db.run('DELETE FROM events WHERE id = ?', [h.toInt(req.params.id)]);
    if (row && row.image) upload.remove(row.image);
    req.flash('success', 'Event deleted.');
    res.redirect('/admin/events');
  } catch (err) { next(err); }
});

module.exports = router;

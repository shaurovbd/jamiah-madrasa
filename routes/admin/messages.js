'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread === '1';
    const where = unreadOnly ? 'WHERE is_read = 0' : '';
    const total = await db.scalar(`SELECT COUNT(*) AS c FROM contact_messages ${where}`);
    const p = h.paginate(total, req.query.page, 20);
    const messages = await db.query(
      `SELECT * FROM contact_messages ${where} ORDER BY id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`
    );
    const unread = await db.scalar('SELECT COUNT(*) AS c FROM contact_messages WHERE is_read = 0');
    res.render('admin/content/messages', { title: res.locals.t('admin.nav.messages'), messages, p, unread, filters: { unread: unreadOnly } });
  } catch (err) { next(err); }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    await db.run('UPDATE contact_messages SET is_read = 1 - is_read WHERE id = ?', [h.toInt(req.params.id)]);
    res.redirect('back');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM contact_messages WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'f.web.message_deleted');
    res.redirect('/admin/messages');
  } catch (err) { next(err); }
});

module.exports = router;

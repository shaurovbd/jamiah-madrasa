'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');

const router = express.Router();
const TABS = [['/admin/library', 'a.tab.books'], ['/admin/library/issues', 'a.lib.issue_return_title']];

/* ----------------------------------------------------------------- books */
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const where = [];
    const params = [];
    if (q) { where.push('(title LIKE ? OR author LIKE ? OR book_no LIKE ? OR category LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await db.scalar(`SELECT COUNT(*) AS c FROM books ${whereSql}`, params);
    const p = h.paginate(total, req.query.page, 25);
    const books = await db.query(`SELECT * FROM books ${whereSql} ORDER BY title LIMIT ${p.perPage} OFFSET ${p.offset}`, params);
    const stats = await db.one(
      `SELECT COALESCE(SUM(total_copies),0) AS copies, COALESCE(SUM(available_copies),0) AS available FROM books`
    );
    const edit = h.toInt(req.query.edit) ? await db.one('SELECT * FROM books WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/library/books', { title: res.locals.t('admin.nav.library'), TABS, books, p, edit, stats: stats || {}, filters: { q } });
  } catch (err) { next(err); }
});

router.post('/books', async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    const bookNo = String(req.body.book_no || '').trim();
    if (!title || !bookNo) { req.flash('error', 'f.lib.book_required'); return res.redirect('/admin/library'); }
    const id = h.toInt(req.body.id);
    const copies = Math.max(1, h.toNum(req.body.total_copies, 1));

    if (id) {
      const existing = await db.one('SELECT total_copies, available_copies FROM books WHERE id = ?', [id]);
      if (!existing) return next();
      // Keep availability consistent when the number of copies changes.
      const onLoan = Number(existing.total_copies) - Number(existing.available_copies);
      const available = Math.max(0, copies - onLoan);
      await db.run(
        `UPDATE books SET book_no=?, title=?, author=?, publisher=?, category=?, shelf=?, total_copies=?, available_copies=? WHERE id=?`,
        [bookNo, title, h.orNull(req.body.author), h.orNull(req.body.publisher), h.orNull(req.body.category),
         h.orNull(req.body.shelf), copies, available, id]
      );
      req.flash('success', 'f.lib.book_updated');
    } else {
      const dup = await db.one('SELECT id FROM books WHERE book_no = ?', [bookNo]);
      if (dup) { req.flash('error', i18n.pack('f.lib.book_no_in_use', { no: bookNo })); return res.redirect('/admin/library'); }
      await db.run(
        `INSERT INTO books (book_no, title, author, publisher, category, shelf, total_copies, available_copies)
         VALUES (?,?,?,?,?,?,?,?)`,
        [bookNo, title, h.orNull(req.body.author), h.orNull(req.body.publisher), h.orNull(req.body.category),
         h.orNull(req.body.shelf), copies, copies]
      );
      req.flash('success', 'f.lib.book_added');
    }
    res.redirect('/admin/library');
  } catch (err) { next(err); }
});

router.delete('/books/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM books WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'f.lib.book_removed');
    res.redirect('/admin/library');
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------- issues */
router.get('/issues', async (req, res, next) => {
  try {
    const status = ['issued', 'returned', 'lost'].includes(req.query.status) ? req.query.status : 'issued';
    const total = await db.scalar('SELECT COUNT(*) AS c FROM book_issues WHERE status = ?', [status]);
    const p = h.paginate(total, req.query.page, 25);
    const [issues, books, students, staff] = await Promise.all([
      db.query(
        `SELECT bi.*, b.title, b.book_no, s.name AS student_name, s.admission_no, st.name AS staff_name
           FROM book_issues bi
           JOIN books b ON b.id = bi.book_id
           LEFT JOIN students s ON s.id = bi.student_id
           LEFT JOIN staff st ON st.id = bi.staff_id
          WHERE bi.status = ? ORDER BY bi.due_date ASC, bi.id DESC
          LIMIT ${p.perPage} OFFSET ${p.offset}`, [status]),
      db.query('SELECT id, title, book_no, available_copies FROM books WHERE available_copies > 0 ORDER BY title'),
      db.query("SELECT id, name, admission_no FROM students WHERE status = 'active' ORDER BY name"),
      db.query("SELECT id, name FROM staff WHERE status = 'active' ORDER BY name")
    ]);
    res.render('admin/library/issues', { title: res.locals.t('a.lib.issue_return_title'), TABS, issues, books, students, staff, p, filters: { status } });
  } catch (err) { next(err); }
});

router.post('/issues', async (req, res, next) => {
  try {
    const bookId = h.toInt(req.body.book_id);
    const studentId = h.toInt(req.body.student_id);
    const staffId = h.toInt(req.body.staff_id);
    if (!bookId || (!studentId && !staffId)) {
      req.flash('error', 'f.lib.choose_borrower');
      return res.redirect('/admin/library/issues');
    }
    const book = await db.one('SELECT available_copies, title FROM books WHERE id = ?', [bookId]);
    if (!book || Number(book.available_copies) < 1) {
      req.flash('error', 'f.lib.no_copies');
      return res.redirect('/admin/library/issues');
    }
    const issueDate = h.orNull(req.body.issue_date) || h.today();
    const dueDate = h.orNull(req.body.due_date) ||
      new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    await db.transaction(async (conn) => {
      await conn.execute(
        'INSERT INTO book_issues (book_id, student_id, staff_id, issue_date, due_date) VALUES (?,?,?,?,?)',
        [bookId, studentId, staffId, issueDate, dueDate]
      );
      await conn.execute('UPDATE books SET available_copies = available_copies - 1 WHERE id = ? AND available_copies > 0', [bookId]);
    });
    req.flash('success', i18n.pack('f.lib.issued', { title: book.title, date: h.fmtDate(dueDate, res.locals.lang) }));
    res.redirect('/admin/library/issues');
  } catch (err) { next(err); }
});

router.post('/issues/:id/return', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const issue = await db.one("SELECT * FROM book_issues WHERE id = ? AND status = 'issued'", [id]);
    if (!issue) { req.flash('error', 'f.lib.loan_not_open'); return res.redirect('/admin/library/issues'); }
    const lost = req.body.lost === '1';
    await db.transaction(async (conn) => {
      await conn.execute(
        'UPDATE book_issues SET return_date = ?, fine = ?, status = ? WHERE id = ?',
        [lost ? null : (h.orNull(req.body.return_date) || h.today()), h.toNum(req.body.fine, 0), lost ? 'lost' : 'returned', id]
      );
      if (!lost) {
        await conn.execute(
          'UPDATE books SET available_copies = LEAST(available_copies + 1, total_copies) WHERE id = ?', [issue.book_id]
        );
      } else {
        await conn.execute('UPDATE books SET total_copies = GREATEST(total_copies - 1, 0) WHERE id = ?', [issue.book_id]);
      }
    });
    req.flash('success', lost ? 'f.lib.marked_lost' : 'f.lib.returned');
    res.redirect('/admin/library/issues');
  } catch (err) { next(err); }
});

module.exports = router;

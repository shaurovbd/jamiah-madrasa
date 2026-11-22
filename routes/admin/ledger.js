'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const period = String(req.query.period || h.currentPeriod()).slice(0, 7);
    const etype = ['income', 'expense'].includes(req.query.etype) ? req.query.etype : '';
    const categoryId = h.toInt(req.query.category_id);

    const where = ["DATE_FORMAT(e.edate, '%Y-%m') = ?"];
    const params = [period];
    if (etype) { where.push('e.etype = ?'); params.push(etype); }
    if (categoryId) { where.push('e.category_id = ?'); params.push(categoryId); }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const total = await db.scalar(`SELECT COUNT(*) AS c FROM ledger_entries e ${whereSql}`, params);
    const p = h.paginate(total, req.query.page, 30);

    const [entries, categories, sums, feeIncome, byCategory] = await Promise.all([
      db.query(`SELECT e.*, c.name AS category_name, u.name AS created_by_name
                  FROM ledger_entries e
                  LEFT JOIN ledger_categories c ON c.id = e.category_id
                  LEFT JOIN users u ON u.id = e.created_by
                  ${whereSql} ORDER BY e.edate DESC, e.id DESC
                  LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
      db.query('SELECT * FROM ledger_categories ORDER BY ctype, name'),
      db.one(`SELECT COALESCE(SUM(CASE WHEN etype='income' THEN amount END),0) AS income,
                     COALESCE(SUM(CASE WHEN etype='expense' THEN amount END),0) AS expense
                FROM ledger_entries WHERE DATE_FORMAT(edate, '%Y-%m') = ?`, [period]),
      db.scalar(`SELECT COALESCE(SUM(amount),0) AS c FROM fee_payments WHERE DATE_FORMAT(paid_on, '%Y-%m') = ?`, [period]),
      db.query(`SELECT c.name, c.ctype, COALESCE(SUM(e.amount),0) AS total
                  FROM ledger_entries e JOIN ledger_categories c ON c.id = e.category_id
                 WHERE DATE_FORMAT(e.edate, '%Y-%m') = ?
                 GROUP BY c.id, c.name, c.ctype ORDER BY total DESC`, [period])
    ]);

    const income = Number(sums.income || 0);
    const expense = Number(sums.expense || 0);
    const maxCat = Math.max(1, ...byCategory.map((c) => Number(c.total)));

    const edit = h.toInt(req.query.edit)
      ? await db.one('SELECT * FROM ledger_entries WHERE id = ?', [h.toInt(req.query.edit)]) : null;

    res.render('admin/ledger/index', {
      title: res.locals.t('admin.nav.ledger'), entries, categories, p, edit, byCategory, maxCat,
      summary: { income, expense, balance: income - expense, feeIncome: Number(feeIncome) },
      filters: { period, etype, category_id: categoryId }
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const amount = h.toNum(req.body.amount, 0);
    if (amount <= 0) { req.flash('error', 'f.amount_gt_zero'); return res.redirect('/admin/ledger'); }
    const etype = req.body.etype === 'income' ? 'income' : 'expense';
    const id = h.toInt(req.body.id);
    const vals = [h.orNull(req.body.edate) || h.today(), h.toInt(req.body.category_id), etype, amount,
                  h.orNull(req.body.description), h.orNull(req.body.reference)];
    if (id) {
      await db.run('UPDATE ledger_entries SET edate=?, category_id=?, etype=?, amount=?, description=?, reference=? WHERE id=?',
        [...vals, id]);
      req.flash('success', 'f.ledger.entry_updated');
    } else {
      await db.run(`INSERT INTO ledger_entries (edate, category_id, etype, amount, description, reference, created_by)
                    VALUES (?,?,?,?,?,?,?)`, [...vals, req.session.user.id]);
      req.flash('success', i18n.pack(etype === 'income' ? 'f.ledger.income_recorded' : 'f.ledger.expense_recorded', { amount: h.money(amount, res.locals.currency) }));
    }
    res.redirect(`/admin/ledger?period=${String(vals[0]).slice(0, 7)}`);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM ledger_entries WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'f.ledger.entry_deleted');
    res.redirect('/admin/ledger');
  } catch (err) { next(err); }
});

router.post('/categories', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) { req.flash('error', 'f.ledger.cat_required'); return res.redirect('/admin/ledger'); }
    await db.run('INSERT INTO ledger_categories (name, ctype) VALUES (?,?)',
      [name, req.body.ctype === 'income' ? 'income' : 'expense']);
    req.flash('success', 'f.ledger.cat_added');
    res.redirect('/admin/ledger');
  } catch (err) { next(err); }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM ledger_categories WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'f.ledger.cat_deleted');
    res.redirect('/admin/ledger');
  } catch (err) { next(err); }
});

module.exports = router;

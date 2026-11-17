'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');

const router = express.Router();

/* ------------------------------------------------------- invoice list */
router.get('/', async (req, res, next) => {
  try {
    const period = String(req.query.period || '').slice(0, 7);
    const status = ['unpaid', 'partial', 'paid'].includes(req.query.status) ? req.query.status : '';
    const classId = h.toInt(req.query.class_id);
    const q = String(req.query.q || '').trim();

    const where = [];
    const params = [];
    if (period) { where.push('i.period = ?'); params.push(period); }
    if (status) { where.push('i.status = ?'); params.push(status); }
    if (classId) { where.push('s.class_id = ?'); params.push(classId); }
    if (q) { where.push('(s.name LIKE ? OR s.admission_no LIKE ? OR i.invoice_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await db.scalar(
      `SELECT COUNT(*) AS c FROM fee_invoices i JOIN students s ON s.id = i.student_id ${whereSql}`, params
    );
    const p = h.paginate(total, req.query.page, 25);
    const [invoices, classes, periods, totals] = await Promise.all([
      db.query(
        `SELECT i.*, s.name AS student, s.admission_no, c.name AS class_name
           FROM fee_invoices i
           JOIN students s ON s.id = i.student_id
           LEFT JOIN classes c ON c.id = s.class_id
           ${whereSql} ORDER BY i.period DESC, s.name
           LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
      db.query('SELECT id, name FROM classes ORDER BY department_id, level'),
      db.query('SELECT DISTINCT period FROM fee_invoices ORDER BY period DESC LIMIT 24'),
      db.one(
        `SELECT COALESCE(SUM(i.total_amount - i.discount),0) AS billed,
                COALESCE(SUM(i.paid_amount),0) AS collected
           FROM fee_invoices i JOIN students s ON s.id = i.student_id ${whereSql}`, params)
    ]);

    res.render('admin/fees/list', {
      title: 'Fee Invoices', invoices, classes, periods, p,
      totals: { billed: Number(totals.billed || 0), collected: Number(totals.collected || 0) },
      filters: { period, status, class_id: classId, q }
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------- fee setup */
router.get('/structure', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const [heads, classes] = await Promise.all([
      db.query('SELECT * FROM fee_heads ORDER BY ftype, name'),
      db.query('SELECT id, name FROM classes ORDER BY department_id, level')
    ]);
    let structure = [];
    if (classId) {
      structure = await db.query(
        `SELECT fh.id AS fee_head_id, fh.name, fh.ftype, fh.amount AS default_amount, fs.amount
           FROM fee_heads fh
           LEFT JOIN fee_structures fs ON fs.fee_head_id = fh.id AND fs.class_id = ?
          WHERE fh.is_active = 1 ORDER BY fh.ftype, fh.name`, [classId]
      );
    }
    const editHead = h.toInt(req.query.edit)
      ? await db.one('SELECT * FROM fee_heads WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/fees/structure', {
      title: 'Fee Setup', heads, classes, structure, editHead, classId,
      klass: classId ? classes.find((c) => c.id === classId) : null
    });
  } catch (err) { next(err); }
});

router.post('/heads', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) { req.flash('error', 'Fee head name is required.'); return res.redirect('/admin/fees/structure'); }
    const id = h.toInt(req.body.id);
    const ftype = ['monthly', 'one_time', 'annual'].includes(req.body.ftype) ? req.body.ftype : 'monthly';
    const vals = [name, ftype, h.toNum(req.body.amount, 0), req.body.is_active ? 1 : 0];
    if (id) {
      await db.run('UPDATE fee_heads SET name=?, ftype=?, amount=?, is_active=? WHERE id=?', [...vals, id]);
      req.flash('success', 'Fee head updated.');
    } else {
      await db.run('INSERT INTO fee_heads (name, ftype, amount, is_active) VALUES (?,?,?,?)', vals);
      req.flash('success', 'Fee head added.');
    }
    res.redirect('/admin/fees/structure');
  } catch (err) { next(err); }
});

router.delete('/heads/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM fee_heads WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'Fee head deleted.');
    res.redirect('/admin/fees/structure');
  } catch (err) { next(err); }
});

router.post('/structure', async (req, res, next) => {
  try {
    const classId = h.toInt(req.body.class_id);
    if (!classId) { req.flash('error', 'Choose a class first.'); return res.redirect('/admin/fees/structure'); }
    const amounts = req.body.amount || {};
    await db.transaction(async (conn) => {
      for (const key of Object.keys(amounts)) {
        const headId = h.idFromKey(key);
        if (!headId) continue;
        const value = String(amounts[key]).trim();
        if (value === '') {
          await conn.execute('DELETE FROM fee_structures WHERE class_id = ? AND fee_head_id = ?', [classId, headId]);
        } else {
          await conn.execute(
            `INSERT INTO fee_structures (class_id, fee_head_id, amount) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
            [classId, headId, h.toNum(value, 0)]
          );
        }
      }
    });
    req.flash('success', 'Fee structure saved for this class.');
    res.redirect(`/admin/fees/structure?class_id=${classId}`);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------ generate bills */
router.get('/generate', async (req, res, next) => {
  try {
    const classes = await db.query('SELECT id, name FROM classes ORDER BY department_id, level');
    res.render('admin/fees/generate', { title: 'Generate Invoices', classes, period: h.currentPeriod(), result: null });
  } catch (err) { next(err); }
});

router.post('/generate', async (req, res, next) => {
  try {
    const period = String(req.body.period || h.currentPeriod()).slice(0, 7);
    const classId = h.toInt(req.body.class_id);
    const includeOneTime = !!req.body.include_one_time;
    const includeAnnual = !!req.body.include_annual;
    const dueDate = h.orNull(req.body.due_date);
    const classes = await db.query('SELECT id, name FROM classes ORDER BY department_id, level');

    const types = ['monthly'];
    if (includeOneTime) types.push('one_time');
    if (includeAnnual) types.push('annual');

    const studentWhere = classId ? 'AND s.class_id = ?' : '';
    const students = await db.query(
      `SELECT s.id, s.name, s.class_id, s.is_resident FROM students s
        WHERE s.status = 'active' AND s.class_id IS NOT NULL ${studentWhere}
        ORDER BY s.class_id, s.name`,
      classId ? [classId] : []
    );

    let created = 0, skipped = 0, noStructure = 0;

    await db.transaction(async (conn) => {
      const [lastRow] = await conn.execute('SELECT MAX(id) AS id FROM fee_invoices');
      let seq = Number((lastRow[0] && lastRow[0].id) || 0);

      for (const s of students) {
        const [existing] = await conn.execute(
          'SELECT id FROM fee_invoices WHERE student_id = ? AND period = ?', [s.id, period]
        );
        if (existing.length) { skipped++; continue; }

        const [items] = await conn.execute(
          `SELECT fs.amount, fh.name, fh.id AS head_id, fh.ftype
             FROM fee_structures fs JOIN fee_heads fh ON fh.id = fs.fee_head_id
            WHERE fs.class_id = ? AND fh.is_active = 1 AND fh.ftype IN (${types.map(() => '?').join(',')})`,
          [s.class_id, ...types]
        );
        // Hostel fee only applies to boarders.
        const applicable = items.filter((i) => s.is_resident || !/hostel/i.test(i.name));
        if (!applicable.length) { noStructure++; continue; }

        const total = applicable.reduce((sum, i) => sum + Number(i.amount), 0);
        seq += 1;
        const invoiceNo = `INV-${period.replace('-', '')}-${String(seq).padStart(4, '0')}`;
        const [inv] = await conn.execute(
          `INSERT INTO fee_invoices (invoice_no, student_id, period, issue_date, due_date, total_amount, status)
           VALUES (?,?,?,?,?,?, 'unpaid')`,
          [invoiceNo, s.id, period, h.today(), dueDate, total]
        );
        for (const i of applicable) {
          await conn.execute(
            'INSERT INTO fee_invoice_items (invoice_id, fee_head_id, description, amount) VALUES (?,?,?,?)',
            [inv.insertId, i.head_id, i.name, i.amount]
          );
        }
        created++;
      }
    });

    res.render('admin/fees/generate', {
      title: 'Generate Invoices', classes, period,
      result: { created, skipped, noStructure, period, total: students.length }
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------ invoice detail */
router.get('/invoice/:id', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const invoice = await db.one(
      `SELECT i.*, s.name AS student, s.admission_no, s.roll_no, s.father_name, s.guardian_phone,
              c.name AS class_name, sec.name AS section_name
         FROM fee_invoices i
         JOIN students s ON s.id = i.student_id
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN sections sec ON sec.id = s.section_id
        WHERE i.id = ?`, [id]
    );
    if (!invoice) return next();
    const [items, payments] = await Promise.all([
      db.query('SELECT * FROM fee_invoice_items WHERE invoice_id = ? ORDER BY id', [id]),
      db.query(`SELECT p.*, u.name AS received_by_name FROM fee_payments p
                  LEFT JOIN users u ON u.id = p.received_by
                 WHERE p.invoice_id = ? ORDER BY p.id DESC`, [id])
    ]);
    const payable = Number(invoice.total_amount) - Number(invoice.discount);
    res.render('admin/fees/invoice', {
      title: invoice.invoice_no, invoice, items, payments,
      payable, balance: payable - Number(invoice.paid_amount)
    });
  } catch (err) { next(err); }
});

/** Recalculate paid_amount and status from the payment rows. */
async function refreshInvoice(conn, invoiceId) {
  const [paidRows] = await conn.execute(
    'SELECT COALESCE(SUM(amount),0) AS paid FROM fee_payments WHERE invoice_id = ?', [invoiceId]
  );
  const paid = Number(paidRows[0].paid);
  const [invRows] = await conn.execute(
    'SELECT total_amount, discount FROM fee_invoices WHERE id = ?', [invoiceId]
  );
  if (!invRows.length) return { paid, payable: 0, status: 'unpaid' };
  const payable = Number(invRows[0].total_amount) - Number(invRows[0].discount);
  const status = paid <= 0 ? 'unpaid' : (paid + 0.001 >= payable ? 'paid' : 'partial');
  await conn.execute('UPDATE fee_invoices SET paid_amount = ?, status = ? WHERE id = ?', [paid, status, invoiceId]);
  return { paid, payable, status };
}

router.post('/invoice/:id/pay', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const invoice = await db.one('SELECT * FROM fee_invoices WHERE id = ?', [id]);
    if (!invoice) return next();

    const amount = h.toNum(req.body.amount, 0);
    const payable = Number(invoice.total_amount) - Number(invoice.discount);
    const balance = payable - Number(invoice.paid_amount);
    if (amount <= 0) { req.flash('error', 'Enter an amount greater than zero.'); return res.redirect(`/admin/fees/invoice/${id}`); }
    if (amount > balance + 0.001) {
      req.flash('error', `That is more than the outstanding balance of ${h.money(balance, res.locals.currency)}.`);
      return res.redirect(`/admin/fees/invoice/${id}`);
    }

    const paymentId = await db.transaction(async (conn) => {
      const [lastRow] = await conn.execute('SELECT MAX(id) AS id FROM fee_payments');
      const receiptNo = h.nextNo('RCP', (lastRow[0] && lastRow[0].id) || 0);
      const [r] = await conn.execute(
        `INSERT INTO fee_payments (receipt_no, invoice_id, student_id, amount, method, paid_on, received_by, note)
         VALUES (?,?,?,?,?,?,?,?)`,
        [receiptNo, id, invoice.student_id, amount,
         ['cash', 'bank', 'mobile', 'other'].includes(req.body.method) ? req.body.method : 'cash',
         h.orNull(req.body.paid_on) || h.today(), req.session.user.id, h.orNull(req.body.note)]
      );
      await refreshInvoice(conn, id);
      return r.insertId;
    });

    req.flash('success', `Payment of ${h.money(amount, res.locals.currency)} recorded.`);
    res.redirect(`/admin/fees/receipt/${paymentId}`);
  } catch (err) { next(err); }
});

router.post('/invoice/:id/discount', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const invoice = await db.one('SELECT * FROM fee_invoices WHERE id = ?', [id]);
    if (!invoice) return next();
    let discount = h.toNum(req.body.discount, 0);
    if (discount < 0) discount = 0;
    if (discount > Number(invoice.total_amount)) discount = Number(invoice.total_amount);
    await db.transaction(async (conn) => {
      await conn.execute('UPDATE fee_invoices SET discount = ?, note = ? WHERE id = ?',
        [discount, h.orNull(req.body.note), id]);
      await refreshInvoice(conn, id);
    });
    req.flash('success', 'Discount updated.');
    res.redirect(`/admin/fees/invoice/${id}`);
  } catch (err) { next(err); }
});

router.delete('/invoice/:id/payment/:paymentId', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    await db.transaction(async (conn) => {
      await conn.execute('DELETE FROM fee_payments WHERE id = ? AND invoice_id = ?', [h.toInt(req.params.paymentId), id]);
      await refreshInvoice(conn, id);
    });
    req.flash('success', 'Payment removed and the invoice balance recalculated.');
    res.redirect(`/admin/fees/invoice/${id}`);
  } catch (err) { next(err); }
});

router.delete('/invoice/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM fee_invoices WHERE id = ?', [h.toInt(req.params.id)]);
    req.flash('success', 'Invoice deleted together with its payments.');
    res.redirect('/admin/fees');
  } catch (err) { next(err); }
});

/* -------------------------------------------------------------- receipt */
router.get('/receipt/:paymentId', async (req, res, next) => {
  try {
    const payment = await db.one(
      `SELECT p.*, i.invoice_no, i.period, i.total_amount, i.discount, i.paid_amount, i.status,
              s.name AS student, s.admission_no, s.roll_no, s.father_name,
              c.name AS class_name, u.name AS received_by_name
         FROM fee_payments p
         JOIN fee_invoices i ON i.id = p.invoice_id
         JOIN students s ON s.id = p.student_id
         LEFT JOIN classes c ON c.id = s.class_id
         LEFT JOIN users u ON u.id = p.received_by
        WHERE p.id = ?`, [h.toInt(req.params.paymentId)]
    );
    if (!payment) return next();
    const items = await db.query('SELECT * FROM fee_invoice_items WHERE invoice_id = ? ORDER BY id', [payment.invoice_id]);
    const balance = Number(payment.total_amount) - Number(payment.discount) - Number(payment.paid_amount);
    res.render('admin/fees/receipt', { title: `Receipt ${payment.receipt_no}`, payment, items, balance });
  } catch (err) { next(err); }
});

/* ----------------------------------------------------------------- dues */
router.get('/dues', async (req, res, next) => {
  try {
    const classId = h.toInt(req.query.class_id);
    const classes = await db.query('SELECT id, name FROM classes ORDER BY department_id, level');
    const where = classId ? 'AND s.class_id = ?' : '';
    const params = classId ? [classId] : [];
    const rows = await db.query(
      `SELECT s.id, s.name, s.admission_no, s.roll_no, s.guardian_phone, c.name AS class_name,
              COUNT(i.id) AS invoice_count,
              COALESCE(SUM(i.total_amount - i.discount - i.paid_amount),0) AS due,
              MIN(i.period) AS oldest_period
         FROM students s
         JOIN fee_invoices i ON i.student_id = s.id AND i.status <> 'paid'
         LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.status = 'active' ${where}
        GROUP BY s.id, s.name, s.admission_no, s.roll_no, s.guardian_phone, c.name
        HAVING due > 0
        ORDER BY due DESC`, params
    );
    const totalDue = rows.reduce((sum, r) => sum + Number(r.due), 0);
    res.render('admin/fees/dues', { title: 'Dues Report', rows, classes, totalDue, filters: { class_id: classId } });
  } catch (err) { next(err); }
});

module.exports = router;

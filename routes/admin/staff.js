'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const upload = require('../../lib/upload');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const deptId = h.toInt(req.query.department_id);
    const status = ['active', 'inactive'].includes(req.query.status) ? req.query.status : 'active';

    const where = ['s.status = ?'];
    const params = [status];
    if (q) { where.push('(s.name LIKE ? OR s.staff_no LIKE ? OR s.phone LIKE ? OR s.designation LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (deptId) { where.push('s.department_id = ?'); params.push(deptId); }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const total = await db.scalar(`SELECT COUNT(*) AS c FROM staff s ${whereSql}`, params);
    const p = h.paginate(total, req.query.page, 25);
    const [staff, departments] = await Promise.all([
      db.query(`SELECT s.*, d.name AS dept_name FROM staff s LEFT JOIN departments d ON d.id = s.department_id
                ${whereSql} ORDER BY s.name LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
      db.query('SELECT id, name FROM departments ORDER BY sort_order, id')
    ]);
    const payroll = await db.scalar("SELECT COALESCE(SUM(salary),0) AS c FROM staff WHERE status = 'active'");

    res.render('admin/staff/list', {
      title: 'Staff', staff, departments, p, payroll: Number(payroll),
      filters: { q, department_id: deptId, status }
    });
  } catch (err) { next(err); }
});

router.get('/new', async (req, res, next) => {
  try {
    const last = await db.one('SELECT MAX(id) AS id FROM staff');
    const departments = await db.query('SELECT id, name FROM departments ORDER BY sort_order, id');
    res.render('admin/staff/form', {
      title: 'Add staff member', isNew: true, departments,
      member: { staff_no: `STF-${String((last && last.id ? last.id : 0) + 1).padStart(3, '0')}`, status: 'active' }
    });
  } catch (err) { next(err); }
});

router.post('/', upload.image.single('photo'), async (req, res, next) => {
  try {
    const b = req.body;
    if (!String(b.name || '').trim() || !String(b.staff_no || '').trim()) {
      req.flash('error', 'Name and staff number are required.');
      return res.redirect('/admin/staff/new');
    }
    const dup = await db.one('SELECT id FROM staff WHERE staff_no = ?', [b.staff_no.trim()]);
    if (dup) { req.flash('error', `Staff number ${b.staff_no} is already used.`); return res.redirect('/admin/staff/new'); }

    const r = await db.run(
      `INSERT INTO staff (staff_no, name, designation, department_id, qualification, phone, email,
         address, photo, join_date, salary, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.staff_no.trim(), b.name.trim(), h.orNull(b.designation), h.toInt(b.department_id), h.orNull(b.qualification),
       h.orNull(b.phone), h.orNull(b.email), h.orNull(b.address), req.file ? req.file.filename : null,
       h.orNull(b.join_date), h.toNum(b.salary, 0), b.status === 'inactive' ? 'inactive' : 'active']
    );
    req.flash('success', `${b.name.trim()} has been added.`);
    res.redirect(`/admin/staff/${r.insertId}`);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const member = await db.one(
      `SELECT s.*, d.name AS dept_name, u.username, u.role
         FROM staff s LEFT JOIN departments d ON d.id = s.department_id
         LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`, [id]
    );
    if (!member) return next();
    const [sections, subjects] = await Promise.all([
      db.query(`SELECT s.name, c.name AS class_name FROM sections s LEFT JOIN classes c ON c.id = s.class_id WHERE s.teacher_id = ?`, [id]),
      db.query(`SELECT s.name, c.name AS class_name FROM subjects s LEFT JOIN classes c ON c.id = s.class_id WHERE s.teacher_id = ?`, [id])
    ]);
    res.render('admin/staff/profile', { title: member.name, member, sections, subjects });
  } catch (err) { next(err); }
});

router.get('/:id/edit', async (req, res, next) => {
  try {
    const member = await db.one('SELECT * FROM staff WHERE id = ?', [h.toInt(req.params.id)]);
    if (!member) return next();
    const departments = await db.query('SELECT id, name FROM departments ORDER BY sort_order, id');
    res.render('admin/staff/form', { title: `Edit ${member.name}`, member, isNew: false, departments });
  } catch (err) { next(err); }
});

router.put('/:id', upload.image.single('photo'), async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const b = req.body;
    const existing = await db.one('SELECT photo FROM staff WHERE id = ?', [id]);
    if (!existing) return next();
    if (req.file && existing.photo) upload.remove(existing.photo);

    await db.run(
      `UPDATE staff SET staff_no=?, name=?, designation=?, department_id=?, qualification=?, phone=?, email=?,
         address=?, photo=?, join_date=?, salary=?, status=? WHERE id=?`,
      [b.staff_no.trim(), b.name.trim(), h.orNull(b.designation), h.toInt(b.department_id), h.orNull(b.qualification),
       h.orNull(b.phone), h.orNull(b.email), h.orNull(b.address), req.file ? req.file.filename : existing.photo,
       h.orNull(b.join_date), h.toNum(b.salary, 0), b.status === 'inactive' ? 'inactive' : 'active', id]
    );
    req.flash('success', 'Staff record updated.');
    res.redirect(`/admin/staff/${id}`);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const member = await db.one('SELECT name, photo FROM staff WHERE id = ?', [id]);
    if (!member) return next();
    await db.run('DELETE FROM staff WHERE id = ?', [id]);
    if (member.photo) upload.remove(member.photo);
    req.flash('success', `${member.name} has been removed.`);
    res.redirect('/admin/staff');
  } catch (err) { next(err); }
});

module.exports = router;

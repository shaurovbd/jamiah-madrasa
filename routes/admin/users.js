'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../config/db');
const h = require('../../lib/helpers');

const router = express.Router();
const ROLES = ['admin', 'teacher', 'accountant', 'librarian'];

router.get('/', async (req, res, next) => {
  try {
    const users = await db.query('SELECT id, name, username, email, role, is_active, last_login, created_at FROM users ORDER BY name');
    const staff = await db.query("SELECT id, name, user_id FROM staff WHERE status = 'active' ORDER BY name");
    const edit = h.toInt(req.query.edit)
      ? await db.one('SELECT id, name, username, email, role, is_active FROM users WHERE id = ?', [h.toInt(req.query.edit)]) : null;
    res.render('admin/system/users', { title: 'Users', users, staff, edit, ROLES });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    const role = ROLES.includes(req.body.role) ? req.body.role : 'teacher';
    const password = String(req.body.password || '');
    const id = h.toInt(req.body.id);
    const isActive = req.body.is_active ? 1 : 0;

    if (!name || !username) { req.flash('error', 'Name and username are required.'); return res.redirect('/admin/users'); }

    const clash = await db.one('SELECT id FROM users WHERE username = ?', [username]);
    if (clash && clash.id !== id) { req.flash('error', `The username "${username}" is already taken.`); return res.redirect('/admin/users'); }

    if (id) {
      // Never let the last active admin be demoted or switched off.
      if (role !== 'admin' || !isActive) {
        const current = await db.one('SELECT role, is_active FROM users WHERE id = ?', [id]);
        const admins = await db.scalar("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1");
        if (current && current.role === 'admin' && current.is_active && admins <= 1) {
          req.flash('error', 'This is the only active administrator, so their role and access cannot be changed.');
          return res.redirect('/admin/users');
        }
      }
      if (password) {
        if (password.length < 8) { req.flash('error', 'A password must be at least 8 characters.'); return res.redirect('/admin/users'); }
        await db.run('UPDATE users SET name=?, username=?, email=?, role=?, is_active=?, password_hash=? WHERE id=?',
          [name, username, h.orNull(req.body.email), role, isActive, await bcrypt.hash(password, 10), id]);
      } else {
        await db.run('UPDATE users SET name=?, username=?, email=?, role=?, is_active=? WHERE id=?',
          [name, username, h.orNull(req.body.email), role, isActive, id]);
      }
      if (req.session.user.id === id) req.session.user.name = name, req.session.user.role = role;
      req.flash('success', 'User updated.');
    } else {
      if (password.length < 8) { req.flash('error', 'Set a password of at least 8 characters for the new user.'); return res.redirect('/admin/users'); }
      const r = await db.run('INSERT INTO users (name, username, email, password_hash, role, is_active) VALUES (?,?,?,?,?,?)',
        [name, username, h.orNull(req.body.email), await bcrypt.hash(password, 10), role, isActive]);
      const staffId = h.toInt(req.body.staff_id);
      if (staffId) await db.run('UPDATE staff SET user_id = ? WHERE id = ?', [r.insertId, staffId]);
      req.flash('success', `Account created for ${name}.`);
    }
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    if (id === req.session.user.id) { req.flash('error', 'You cannot delete the account you are signed in with.'); return res.redirect('/admin/users'); }
    const target = await db.one('SELECT role, is_active, name FROM users WHERE id = ?', [id]);
    if (!target) return next();
    const admins = await db.scalar("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1");
    if (target.role === 'admin' && target.is_active && admins <= 1) {
      req.flash('error', 'This is the only active administrator and cannot be deleted.');
      return res.redirect('/admin/users');
    }
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    req.flash('success', `Account for ${target.name} deleted.`);
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

/* ---------------------------------------------------- own password */
router.get('/password', (req, res) => res.redirect('/admin/users'));

router.post('/password', async (req, res, next) => {
  try {
    const current = String(req.body.current_password || '');
    const next_ = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');
    const me = await db.one('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
    if (!me || !(await bcrypt.compare(current, me.password_hash))) {
      req.flash('error', 'Your current password is not correct.');
      return res.redirect('/admin/users');
    }
    if (next_.length < 8) { req.flash('error', 'The new password must be at least 8 characters.'); return res.redirect('/admin/users'); }
    if (next_ !== confirm) { req.flash('error', 'The new password and its confirmation do not match.'); return res.redirect('/admin/users'); }
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(next_, 10), req.session.user.id]);
    req.flash('success', 'Your password has been changed.');
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

module.exports = router;

'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  res.render('auth/login', { layout: 'layouts/blank', title: res.locals.t('auth.sign_in') });
});

router.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) {
      req.flash('error', 'f.auth.enter_both');
      return res.redirect('/login');
    }
    const user = await db.one(
      'SELECT id, name, username, email, password_hash, role, is_active FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    // Same message either way, so the form does not reveal which usernames exist.
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      req.flash('error', 'auth.invalid');
      return res.redirect('/login');
    }
    await db.run('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    req.session.user = { id: user.id, name: user.name, username: user.username, role: user.role, email: user.email };
    const back = req.session.returnTo;
    delete req.session.returnTo;
    res.redirect(back && back.startsWith('/admin') ? back : '/admin');
  } catch (err) {
    next(err);
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;

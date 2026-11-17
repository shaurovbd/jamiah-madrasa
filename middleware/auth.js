'use strict';

/** Everything under /admin requires a signed-in user. */
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  req.session.returnTo = req.originalUrl;
  if (req.flash) req.flash('error', 'Please sign in to continue.');
  return res.redirect('/login');
}

/**
 * Role gate. Admins pass everything.
 * usage: requireRole('accountant'), requireRole('teacher', 'admin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.session && req.session.user;
    if (!user) return res.redirect('/login');
    if (user.role === 'admin' || roles.includes(user.role)) return next();
    res.status(403).render('admin/forbidden', { title: 'Not allowed', needed: roles });
  };
}

/** Blocks the demo/read-only account from writing, if one is ever configured. */
function blockReadOnly(req, res, next) {
  const user = req.session && req.session.user;
  if (user && user.readOnly && req.method !== 'GET') {
    req.flash('error', 'This account has read-only access.');
    return res.redirect('back');
  }
  next();
}

module.exports = { requireLogin, requireRole, blockReadOnly };

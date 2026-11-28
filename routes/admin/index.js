'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const { requireLogin, requireRole } = require('../../middleware/auth');

const router = express.Router();

// Everything below here needs a signed-in user, and renders in the admin shell.
router.use(requireLogin);
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  next();
});

/* ------------------------------------------------------------- dashboard */
router.get('/', async (req, res, next) => {
  try {
    const period = h.currentPeriod();
    const todayStr = h.today();
    const role = req.session.user.role;
    // The dashboard only shows what this role can actually open.
    const can = (...roles) => role === 'admin' || roles.includes(role);

    const [
      students, staffCount, pendingAdmissions, unreadMessages,
      presentToday, absentToday, monthBilled, monthCollected, totalDue,
      byDepartment, recentAdmissions, recentPayments, upcomingEvents, booksOut
    ] = await Promise.all([
      db.scalar("SELECT COUNT(*) AS c FROM students WHERE status = 'active'"),
      db.scalar("SELECT COUNT(*) AS c FROM staff WHERE status = 'active'"),
      db.scalar("SELECT COUNT(*) AS c FROM admissions WHERE status = 'pending'"),
      db.scalar('SELECT COUNT(*) AS c FROM contact_messages WHERE is_read = 0'),
      db.scalar("SELECT COUNT(*) AS c FROM attendance WHERE adate = ? AND status IN ('present','late')", [todayStr]),
      db.scalar("SELECT COUNT(*) AS c FROM attendance WHERE adate = ? AND status = 'absent'", [todayStr]),
      db.scalar('SELECT COALESCE(SUM(total_amount - discount),0) AS c FROM fee_invoices WHERE period = ?', [period]),
      db.scalar('SELECT COALESCE(SUM(amount),0) AS c FROM fee_payments WHERE DATE_FORMAT(paid_on, "%Y-%m") = ?', [period]),
      db.scalar("SELECT COALESCE(SUM(total_amount - discount - paid_amount),0) AS c FROM fee_invoices WHERE status <> 'paid'"),
      db.query(`SELECT d.name, COUNT(s.id) AS c FROM departments d
                 LEFT JOIN students s ON s.department_id = d.id AND s.status = 'active'
                 GROUP BY d.id, d.name ORDER BY d.sort_order`),
      db.query(`SELECT a.application_no, a.name, a.status, a.applied_at, c.name AS class_name
                  FROM admissions a LEFT JOIN classes c ON c.id = a.class_id
                 ORDER BY a.id DESC LIMIT 6`),
      db.query(`SELECT p.receipt_no, p.amount, p.paid_on, s.name AS student
                  FROM fee_payments p JOIN students s ON s.id = p.student_id
                 ORDER BY p.id DESC LIMIT 6`),
      db.query('SELECT title, event_date, location FROM events WHERE event_date >= CURDATE() ORDER BY event_date LIMIT 4'),
      db.scalar("SELECT COUNT(*) AS c FROM book_issues WHERE status = 'issued'")
    ]);

    const maxDept = Math.max(1, ...byDepartment.map((d) => Number(d.c)));

    res.render('admin/dashboard', {
      title: res.locals.t('admin.dashboard'),
      period,
      stats: {
        students, staffCount, pendingAdmissions, unreadMessages,
        presentToday, absentToday, booksOut,
        monthBilled: Number(monthBilled), monthCollected: Number(monthCollected), totalDue: Number(totalDue)
      },
      byDepartment, maxDept, recentAdmissions, recentPayments, upcomingEvents,
      can
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- modules */
router.use('/students',   requireRole('teacher', 'accountant'), require('./students'));
router.use('/admissions', requireRole('accountant'),            require('./admissions'));
router.use('/staff',      requireRole('teacher', 'accountant'), require('./staff'));
router.use('/academics',  requireRole('teacher'),               require('./academics'));
router.use('/routine',    requireRole('teacher'),              require('./routine'));
router.use('/attendance', requireRole('teacher'),               require('./attendance'));
router.use('/exams',      requireRole('teacher'),               require('./exams'));
router.use('/hifz',       requireRole('teacher'),               require('./hifz'));
router.use('/fees',       requireRole('accountant'),            require('./fees'));
// পুরনো সরল আয়-ব্যয় পাতা — নতুন দ্বি-খাতা খতিয়ান (finance-mount.js)
// এখন /admin/ledger এ বসে, তাই এটি বন্ধ। কোড ও ledger_entries টেবিল
// মুছে ফেলা হয়নি; এই তিন লাইন সরালেই পুরনোটা ফিরে আসবে।
// router.use('/ledger',     requireRole('accountant'),            require('./ledger'));
router.use('/library',    requireRole('librarian'),             require('./library'));
router.use('/hostel',     requireRole('accountant'),            require('./hostel'));
router.use('/notices',    requireRole(),                        require('./notices'));
router.use('/events',     requireRole(),                        require('./events'));
router.use('/gallery',    requireRole(),                        require('./gallery'));
router.use('/pages',      requireRole(),                        require('./pages'));
router.use('/messages',   requireRole(),                        require('./messages'));
router.use('/users',      requireRole(),                        require('./users'));
router.use('/settings',   requireRole(),                        require('./settings'));

module.exports = router;

'use strict';
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const { requireLogin, requireRole } = require('../../middleware/auth');
const roles = require('../../lib/roles');
const i18n = require('../../lib/i18n');
const scope = require('../../lib/scope');
const charts = require('../../lib/charts');

const router = express.Router();

// Everything below here needs a signed-in user, and renders in the admin shell.
router.use(requireLogin);
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  next();
});

// Leave requests waiting for a decision, for the sidebar badge (approvers only).
router.use(async (req, res, next) => {
  try {
    if (roles.can(req.session.user.role, 'leave_approve')) {
      res.locals.pendingLeave = await db.scalar("SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending'").catch(() => 0);
    }
    next();
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- dashboard */
router.get('/', async (req, res, next) => {
  try {
    const period = h.currentPeriod();
    const todayStr = h.today();
    const role = req.session.user.role;
    // The dashboard only shows what this role can actually open.
    const can = (area) => roles.can(role, area);

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
    const chartData = await dashboardCharts(can, res.locals.lang, res.locals.currency);

    res.render('admin/dashboard', {
      title: res.locals.t('admin.dashboard'),
      period,
      stats: {
        students, staffCount, pendingAdmissions, unreadMessages,
        presentToday, absentToday, booksOut,
        monthBilled: Number(monthBilled), monthCollected: Number(monthCollected), totalDue: Number(totalDue)
      },
      byDepartment, maxDept, recentAdmissions, recentPayments, upcomingEvents,
      can, charts: chartData
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------- charts */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/**
 * The three dashboard charts, each only for roles that can open that area:
 * fees billed vs collected (12 months), daily attendance rate (30 days),
 * and how far students are in their Hifz.
 */
async function dashboardCharts(can, lang, currency) {
  const digits = lang === 'bn' ? (s) => String(s).replace(/\d/g, (d) => BN_DIGITS[d]) : null;
  const num = (n) => (digits ? digits(h.num(n)) : h.num(n));
  const out = {};

  if (can('fees')) {
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const [billed, paid] = await Promise.all([
      db.query(`SELECT period AS p, COALESCE(SUM(total_amount - discount),0) AS v FROM fee_invoices
                 WHERE period >= ? GROUP BY period`, [months[0]]),
      db.query(`SELECT DATE_FORMAT(paid_on, '%Y-%m') AS p, COALESCE(SUM(amount),0) AS v FROM fee_payments
                 WHERE paid_on >= ? GROUP BY DATE_FORMAT(paid_on, '%Y-%m')`, [months[0] + '-01'])
    ]);
    const map = (rows) => { const m = {}; rows.forEach((r) => { m[r.p] = Number(r.v); }); return m; };
    const b = map(billed), p = map(paid);
    const labels = months.map((m) => h.monthShort(Number(m.slice(5)) - 1, lang));
    out.fees = {
      rows: months.map((m, i) => ({ label: labels[i] + ' ' + (digits ? digits(m.slice(2, 4)) : m.slice(2, 4)), billed: b[m] || 0, paid: p[m] || 0 })),
      svg: charts.columns({
        categories: labels,
        series: [
          { name: i18n.t('a.dash.ch.billed', lang), cls: 's2', values: months.map((m) => b[m] || 0) },
          { name: i18n.t('a.dash.ch.collected', lang), cls: 's1', values: months.map((m) => p[m] || 0) }
        ],
        fmt: (v) => h.money(v, currency), digits, label: i18n.t('a.dash.ch.fees', lang)
      }),
      any: billed.length + paid.length > 0
    };
  }

  if (can('attendance')) {
    const rows = await db.query(
      `SELECT adate AS d, COUNT(*) AS total, SUM(status IN ('present','late')) AS present
         FROM attendance WHERE adate >= CURDATE() - INTERVAL 29 DAY GROUP BY adate`);
    const byDay = {};
    rows.forEach((r) => { byDay[String(r.d).slice(0, 10)] = Math.round((Number(r.present) / Number(r.total)) * 100); });
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() + 6 * 3600e3 - i * 86400e3).toISOString().slice(0, 10);
      days.push(d);
    }
    const labels = days.map((d) => (digits ? digits(Number(d.slice(8))) : Number(d.slice(8))) + ' ' + h.monthShort(Number(d.slice(5, 7)) - 1, lang));
    const values = days.map((d) => (byDay[d] === undefined ? null : byDay[d]));
    const known = values.filter((v) => v !== null);
    out.attendance = {
      avg: known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null,
      days: known.length,
      rows: days.map((d, i) => ({ label: labels[i], value: values[i] })).filter((r) => r.value !== null),
      svg: charts.line({ labels, values, fmt: (v) => (digits ? digits(v) : v) + '%', digits, label: i18n.t('a.dash.ch.attendance', lang) }),
      any: known.length > 0
    };
  }

  if (can('hifz')) {
    const buckets = [[0, 0], [1, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, 29], [30, 30]];
    const rows = await db.query(`SELECT hifz_para_completed AS p, COUNT(*) AS c FROM students s
                                   JOIN classes c ON c.id = s.class_id JOIN departments d ON d.id = c.department_id
                                  WHERE s.status = 'active' AND (d.slug LIKE '%hifz%' OR s.hifz_para_completed > 0)
                                  GROUP BY hifz_para_completed`);
    const counts = buckets.map(([lo, hi]) => rows.filter((r) => r.p >= lo && r.p <= hi).reduce((a, r) => a + Number(r.c), 0));
    const labels = buckets.map(([lo, hi]) => (lo === hi ? (digits ? digits(lo) : String(lo)) : `${digits ? digits(lo) : lo}–${digits ? digits(hi) : hi}`));
    out.hifz = {
      rows: labels.map((l, i) => ({ label: l, value: counts[i] })),
      done: counts[counts.length - 1],
      svg: charts.columns({
        categories: labels,
        series: [{ name: i18n.t('a.dash.ch.students', lang), cls: 's1', values: counts }],
        fmt: (v) => num(v), digits, label: i18n.t('a.dash.ch.hifz', lang)
      }),
      any: counts.some((c) => c > 0)
    };
  }
  return out;
}

/* --------------------------------------------------------------- modules */
// Who may open what is defined once, in lib/roles.js.
const area = (name) => requireRole(...roles.rolesFor(name));

// Teachers read student records but do not add, edit or delete them.
function studentsReadOnly(req, res, next) {
  const readOnly = roles.STUDENT_READ_ONLY.includes(req.session.user.role);
  res.locals.canEditStudents = !readOnly;
  if (!readOnly) return next();
  const p = req.path;
  if (req.method !== 'GET' || p === '/new' || /\/edit$/.test(p) || p.startsWith('/promote')) return scope.deny(req, res);
  next();
}
router.use('/students/promote', area('promotion'), require('./promotion'));
// Import adds students, so it is for the roles that may add them.
router.use('/students/import', area('students'), (req, res, next) => (
  roles.STUDENT_READ_ONLY.includes(req.session.user.role) ? scope.deny(req, res) : next()
), require('./student-import'));
router.use('/students',   area('students'),   studentsReadOnly, scope.guard(), require('./students'));
router.use('/admissions', area('admissions'), require('./admissions'));
router.use('/staff',      area('staff'),      require('./staff'));
router.use('/academics',  area('academics'),  require('./academics'));
router.use('/routine',    area('routine'),    require('./routine'));
router.use('/attendance', area('attendance'), scope.guard(), require('./attendance'));
router.use('/exams',      area('exams'),      scope.guard(), require('./exams'));
router.use('/hifz',       area('hifz'),       scope.guard(), require('./hifz'));
router.use('/fees',       area('fees'),       require('./fees'));
// পুরনো সরল আয়-ব্যয় পাতা — নতুন দ্বি-খাতা খতিয়ান (finance-mount.js)
// এখন /admin/ledger এ বসে, তাই এটি বন্ধ। কোড ও ledger_entries টেবিল
// মুছে ফেলা হয়নি; এই লাইন ফেরালেই পুরনোটা ফিরে আসবে।
// router.use('/ledger',  area('finance'),    require('./ledger'));
router.use('/library',    area('library'),    require('./library'));
router.use('/hostel',     area('hostel'),     require('./hostel'));
router.use('/notices',    area('notices'),    require('./notices'));
router.use('/events',     area('events'),     require('./events'));
router.use('/gallery',    area('gallery'),    require('./gallery'));
router.use('/pages',      area('pages'),      require('./pages'));
router.use('/messages',   area('messages'),   require('./messages'));
router.use('/users',      area('users'),      require('./users'));
router.use('/settings',   area('settings'),   require('./settings'));
router.use('/logs',       area('logs'),       require('./logs'));
router.use('/sms',        area('sms'),        require('./sms'));
router.use('/print',      area('print'),      require('./print'));
router.use('/backup',     area('backup'),     require('./backup'));
router.use('/portal',     area('portal'),     require('./portal-admin'));
router.use('/payroll',    area('payroll'),    require('./payroll'));
router.use('/leave',      area('leave'),      require('./leave'));

module.exports = router;

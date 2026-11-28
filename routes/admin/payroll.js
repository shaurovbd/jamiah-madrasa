'use strict';
/**
 * Payroll (/admin/payroll) — accountant and principal.
 *
 *   GET  /                       months so far, start a month, advances
 *   POST /runs                   draft sheet for a month (from salary + attendance)
 *   GET  /runs/:id               the sheet
 *   POST /runs/:id/save          edit allowance, bonus, other deductions, head, note (draft only)
 *   POST /runs/:id/recalc        re-read attendance and advances (draft only)
 *   POST /runs/:id/finalize      lock the figures
 *   POST /runs/:id/reopen        back to draft, while nothing is paid
 *   DELETE /runs/:id             remove a draft
 *   POST /runs/:id/pay           pay ticked slips: one payment voucher in the ledger
 *   GET  /runs/:id/print         payslips, two to an A4 page
 *   GET  /advances, POST /advances   give an advance (voucher), see what is left on each
 */
const express = require('express');
const db = require('../../config/db');
const h = require('../../lib/helpers');
const i18n = require('../../lib/i18n');
const payroll = require('../../lib/payroll');
const bridge = require('../../lib/finance-bridge');
const { pool: financePool } = require('../../config/finance-db');

const router = express.Router();

const TABS = [['/admin/payroll', 'a.pay.tab.months'], ['/admin/payroll/advances', 'a.pay.tab.advances']];

function voucherErrors(err) {
  return err && err.name === 'VoucherError' ? err.errors || [err.message] : null;
}

async function loadRun(id) {
  const run = await db.one('SELECT * FROM payroll_runs WHERE id = ?', [id]);
  if (!run) return null;
  const slips = await db.query(
    `SELECT p.*, s.name, s.staff_no, s.designation, s.phone FROM payslips p JOIN staff s ON s.id = p.staff_id
      WHERE p.run_id = ? ORDER BY p.expense_head, s.name`, [id]);
  return { run, slips };
}

/* --------------------------------------------------------------- months */
router.get('/', async (req, res, next) => {
  try {
    const runs = await db.query(
      `SELECT r.*, COUNT(p.id) AS staff, COALESCE(SUM(p.net),0) AS total,
              SUM(p.status = 'paid') AS paid
         FROM payroll_runs r LEFT JOIN payslips p ON p.run_id = r.id
        GROUP BY r.id ORDER BY r.period DESC`
    ).catch((e) => { if (e.code === 'ER_NO_SUCH_TABLE') return null; throw e; });
    const staffCount = await db.scalar("SELECT COUNT(*) AS c FROM staff WHERE status = 'active' AND salary > 0");
    const monthly = await db.scalar("SELECT COALESCE(SUM(salary),0) AS c FROM staff WHERE status = 'active'");
    res.render('admin/payroll/index', {
      title: res.locals.t('admin.nav.payroll'), TABS, runs, tableMissing: runs === null,
      staffCount, monthly: Number(monthly), thisMonth: h.currentPeriod()
    });
  } catch (err) { next(err); }
});

router.post('/runs', async (req, res, next) => {
  try {
    const period = /^\d{4}-\d{2}$/.test(String(req.body.period || '')) ? req.body.period : null;
    if (!period) { req.flash('error', 'f.pay.pick_month'); return res.redirect('/admin/payroll'); }
    const existing = await db.one('SELECT id FROM payroll_runs WHERE period = ?', [period]);
    if (existing) return res.redirect(`/admin/payroll/runs/${existing.id}`);
    const slips = await payroll.buildSlips(period);
    const id = await db.transaction(async (conn) => {
      const [r] = await conn.execute('INSERT INTO payroll_runs (period, created_by) VALUES (?,?)', [period, req.session.user.id]);
      for (const s of slips) {
        await conn.execute(
          `INSERT INTO payslips (run_id, staff_id, expense_head, basic, allowance, bonus, days_in_month, absent_days,
             unpaid_leave_days, late_days, absence_deduction, advance_deduction, other_deduction, net)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.insertId, s.staff_id, s.expense_head, s.basic, s.allowance, s.bonus, s.days_in_month, s.absent_days,
            s.unpaid_leave_days, s.late_days, s.absence_deduction, s.advance_deduction, s.other_deduction, s.net]);
      }
      return r.insertId;
    });
    req.flash('success', i18n.pack('f.pay.created', { count: slips.length }));
    res.redirect(`/admin/payroll/runs/${id}`);
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------- sheet */
router.get('/runs/:id', async (req, res, next) => {
  try {
    const data = await loadRun(h.toInt(req.params.id));
    if (!data) return next();
    // Voucher status straight from the ledger (pending vouchers wait for approval there).
    const vids = [...new Set(data.slips.map((s) => s.voucher_id).filter(Boolean))];
    const vstatus = {};
    if (vids.length) {
      const [rows] = await financePool.query('SELECT id, status FROM vouchers WHERE id IN (?)', [vids]);
      rows.forEach((v) => { vstatus[v.id] = v.status; });
    }
    const totals = data.slips.reduce((t, s) => {
      ['basic', 'allowance', 'bonus', 'absence_deduction', 'advance_deduction', 'other_deduction', 'net'].forEach((k) => { t[k] = (t[k] || 0) + Number(s[k]); });
      if (s.status === 'paid') t.paid = (t.paid || 0) + Number(s.net);
      return t;
    }, {});
    res.render('admin/payroll/run', {
      title: res.locals.t('a.pay.sheet_title', { month: h.fmtPeriod(data.run.period, res.locals.lang) }),
      TABS, ...data, totals, vstatus, cashAccounts: await bridge.cashAccounts().catch(() => []), today: h.today()
    });
  } catch (err) { next(err); }
});

async function draftOnly(req, res) {
  const run = await db.one('SELECT * FROM payroll_runs WHERE id = ?', [h.toInt(req.params.id)]);
  if (!run) { res.redirect('/admin/payroll'); return null; }
  if (run.status !== 'draft') { req.flash('error', 'f.pay.locked'); res.redirect(`/admin/payroll/runs/${run.id}`); return null; }
  return run;
}

router.post('/runs/:id/save', async (req, res, next) => {
  try {
    const run = await draftOnly(req, res); if (!run) return;
    const rows = req.body.slip || {};
    const adv = await payroll.openAdvances();
    await db.transaction(async (conn) => {
      for (const key of Object.keys(rows)) {
        const id = h.idFromKey(key);
        const r = rows[key] || {};
        const [[slip]] = await conn.execute('SELECT * FROM payslips WHERE id = ? AND run_id = ?', [id, run.id]);
        if (!slip) continue;
        slip.allowance = Math.max(0, h.toNum(r.allowance, 0));
        slip.bonus = Math.max(0, h.toNum(r.bonus, 0));
        slip.other_deduction = Math.max(0, h.toNum(r.other_deduction, 0));
        slip.expense_head = r.expense_head === 'teacher' ? 'teacher' : 'staff';
        payroll.figure(slip, adv[slip.staff_id]);
        await conn.execute(
          `UPDATE payslips SET allowance=?, bonus=?, other_deduction=?, expense_head=?, note=?,
             absence_deduction=?, advance_deduction=?, net=? WHERE id = ?`,
          [slip.allowance, slip.bonus, slip.other_deduction, slip.expense_head, h.orNull(String(r.note || '').slice(0, 255)),
            slip.absence_deduction, slip.advance_deduction, slip.net, id]);
      }
    });
    req.flash('success', 'common.saved');
    res.redirect(`/admin/payroll/runs/${run.id}`);
  } catch (err) { next(err); }
});

router.post('/runs/:id/recalc', async (req, res, next) => {
  try {
    const run = await draftOnly(req, res); if (!run) return;
    const fresh = await payroll.buildSlips(run.period);
    const adv = await payroll.openAdvances();
    const existing = await db.query('SELECT * FROM payslips WHERE run_id = ?', [run.id]);
    const byStaff = new Map(existing.map((s) => [s.staff_id, s]));
    await db.transaction(async (conn) => {
      for (const f of fresh) {
        const old = byStaff.get(f.staff_id);
        if (old) {
          // Keep what was typed in; refresh salary, attendance and advances.
          Object.assign(old, { basic: f.basic, days_in_month: f.days_in_month, absent_days: f.absent_days,
            unpaid_leave_days: f.unpaid_leave_days, late_days: f.late_days });
          payroll.figure(old, adv[old.staff_id]);
          await conn.execute(
            `UPDATE payslips SET basic=?, days_in_month=?, absent_days=?, unpaid_leave_days=?, late_days=?,
               absence_deduction=?, advance_deduction=?, net=? WHERE id = ?`,
            [old.basic, old.days_in_month, old.absent_days, old.unpaid_leave_days, old.late_days,
              old.absence_deduction, old.advance_deduction, old.net, old.id]);
        } else {
          await conn.execute(
            `INSERT INTO payslips (run_id, staff_id, expense_head, basic, days_in_month, absent_days, unpaid_leave_days,
               late_days, absence_deduction, advance_deduction, net) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [run.id, f.staff_id, f.expense_head, f.basic, f.days_in_month, f.absent_days, f.unpaid_leave_days,
              f.late_days, f.absence_deduction, f.advance_deduction, f.net]);
        }
      }
    });
    req.flash('success', 'f.pay.recalculated');
    res.redirect(`/admin/payroll/runs/${run.id}`);
  } catch (err) { next(err); }
});

router.post('/runs/:id/finalize', async (req, res, next) => {
  try {
    const run = await draftOnly(req, res); if (!run) return;
    await db.run("UPDATE payroll_runs SET status = 'final', finalized_by = ?, finalized_at = NOW() WHERE id = ?", [req.session.user.id, run.id]);
    req.flash('success', 'f.pay.finalized');
    res.redirect(`/admin/payroll/runs/${run.id}`);
  } catch (err) { next(err); }
});

router.post('/runs/:id/reopen', async (req, res, next) => {
  try {
    const id = h.toInt(req.params.id);
    const paid = await db.scalar("SELECT COUNT(*) AS c FROM payslips WHERE run_id = ? AND status = 'paid'", [id]);
    if (paid) { req.flash('error', 'f.pay.has_paid'); return res.redirect(`/admin/payroll/runs/${id}`); }
    await db.run("UPDATE payroll_runs SET status = 'draft', finalized_by = NULL, finalized_at = NULL WHERE id = ?", [id]);
    res.redirect(`/admin/payroll/runs/${id}`);
  } catch (err) { next(err); }
});

router.delete('/runs/:id', async (req, res, next) => {
  try {
    const run = await draftOnly(req, res); if (!run) return;
    await db.run('DELETE FROM payroll_runs WHERE id = ?', [run.id]);
    req.flash('success', 'f.pay.deleted');
    res.redirect('/admin/payroll');
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ pay */
router.post('/runs/:id/pay', async (req, res, next) => {
  const back = `/admin/payroll/runs/${h.toInt(req.params.id)}`;
  try {
    const data = await loadRun(h.toInt(req.params.id));
    if (!data) return next();
    if (data.run.status !== 'final') { req.flash('error', 'f.pay.finalize_first'); return res.redirect(back); }
    const picked = new Set([].concat(req.body.ids || []).map(h.toInt));
    const slips = data.slips.filter((s) => picked.has(s.id) && s.status === 'unpaid');
    if (!slips.length) { req.flash('error', 'f.pay.none_selected'); return res.redirect(back); }
    const cashId = h.toInt(req.body.cash_account_id);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.paid_on || '')) ? req.body.paid_on : h.today();
    const ids = await bridge.accountIds();
    if (!cashId || !ids.fund) { req.flash('error', 'f.pay.pick_account'); return res.redirect(back); }

    // Expense = what the person earned this month (net + advance recovered).
    const head = { teacher: 0, staff: 0 };
    let netTotal = 0;
    const lines = [];
    slips.forEach((s) => {
      head[s.expense_head] += Number(s.net) + Number(s.advance_deduction);
      netTotal += Number(s.net);
    });
    if (head.teacher > 0) lines.push({ account_id: ids.teacher, debit: head.teacher.toFixed(2), line_narration: 'শিক্ষক বেতন' });
    if (head.staff > 0) lines.push({ account_id: ids.staff, debit: head.staff.toFixed(2), line_narration: 'কর্মচারী বেতন' });
    slips.filter((s) => Number(s.advance_deduction) > 0).forEach((s) => lines.push({
      account_id: ids.advance, credit: Number(s.advance_deduction).toFixed(2), party_type: 'staff', party_id: s.staff_id,
      line_narration: `অগ্রিম কর্তন — ${s.name}`
    }));
    if (netTotal > 0) lines.push({ account_id: cashId, credit: netTotal.toFixed(2), line_narration: 'বেতন প্রদান' });

    let voucher = null;
    if (lines.length >= 2) {
      try {
        voucher = await bridge.paymentVoucher(req, {
          date, sourceRef: data.run.id,
          narration: `${data.run.period} মাসের বেতন — ${slips.length} জন`,
          lines
        });
      } catch (err) {
        const list = voucherErrors(err);
        if (!list) throw err;
        list.forEach((m) => req.flash('error', m));
        return res.redirect(back);
      }
    }

    // Mark paid and recover advances, oldest first.
    const adv = await payroll.openAdvances();
    await db.transaction(async (conn) => {
      for (const s of slips) {
        await conn.execute("UPDATE payslips SET status = 'paid', paid_on = ?, voucher_id = ?, voucher_no = ? WHERE id = ?",
          [date, voucher ? voucher.id : null, voucher ? voucher.voucher_no : null, s.id]);
        let left = Number(s.advance_deduction);
        for (const a of adv[s.staff_id] || []) {
          if (left <= 0) break;
          const take = Math.min(left, Number(a.amount) - Number(a.recovered), Number(a.monthly_installment));
          if (take <= 0) continue;
          await conn.execute('UPDATE staff_advances SET recovered = recovered + ? WHERE id = ?', [take, a.id]);
          left -= take;
        }
      }
    });
    req.flash('success', i18n.pack(voucher && voucher.status !== 'posted' ? 'f.pay.paid_pending' : 'f.pay.paid',
      { count: slips.length, voucher: voucher ? voucher.voucher_no : '—' }));
    res.redirect(back);
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------- print */
router.get('/runs/:id/print', async (req, res, next) => {
  try {
    const data = await loadRun(h.toInt(req.params.id));
    if (!data) return next();
    const only = h.toInt(req.query.staff_id);
    const slips = only ? data.slips.filter((s) => s.staff_id === only) : data.slips;
    res.render('admin/payroll/print', { layout: 'layouts/print', title: res.locals.t('a.pay.payslips'), run: data.run, slips });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- advances */
router.get('/advances', async (req, res, next) => {
  try {
    const [advances, staff] = await Promise.all([
      db.query(`SELECT a.*, s.name, s.staff_no FROM staff_advances a JOIN staff s ON s.id = a.staff_id
                 ORDER BY (a.recovered < a.amount) DESC, a.given_on DESC LIMIT 200`),
      db.query("SELECT id, name, staff_no, salary FROM staff WHERE status = 'active' ORDER BY name")
    ]);
    res.render('admin/payroll/advances', {
      title: res.locals.t('a.pay.tab.advances'), TABS, advances, staff,
      cashAccounts: await bridge.cashAccounts().catch(() => []), today: h.today()
    });
  } catch (err) { next(err); }
});

router.post('/advances', async (req, res, next) => {
  try {
    const staffId = h.toInt(req.body.staff_id);
    const amount = Math.round(h.toNum(req.body.amount, 0));
    const inst = Math.round(h.toNum(req.body.monthly_installment, 0));
    const cashId = h.toInt(req.body.cash_account_id);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.given_on || '')) ? req.body.given_on : h.today();
    const member = staffId ? await db.one('SELECT id, name FROM staff WHERE id = ?', [staffId]) : null;
    if (!member || amount <= 0 || inst <= 0 || !cashId) { req.flash('error', 'f.pay.advance_fields'); return res.redirect('/admin/payroll/advances'); }
    const ids = await bridge.accountIds();
    let voucher;
    try {
      voucher = await bridge.paymentVoucher(req, {
        date, sourceModule: 'payroll', partyId: member.id,
        narration: `কর্মচারী অগ্রিম — ${member.name}`,
        lines: [
          { account_id: ids.advance, debit: amount.toFixed(2), party_type: 'staff', party_id: member.id, line_narration: `অগ্রিম — ${member.name}` },
          { account_id: cashId, credit: amount.toFixed(2), line_narration: 'অগ্রিম প্রদান' }
        ]
      });
    } catch (err) {
      const list = voucherErrors(err);
      if (!list) throw err;
      list.forEach((m) => req.flash('error', m));
      return res.redirect('/admin/payroll/advances');
    }
    await db.run(
      `INSERT INTO staff_advances (staff_id, amount, monthly_installment, given_on, note, voucher_no, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [member.id, amount, Math.min(inst, amount), date, h.orNull(String(req.body.note || '').slice(0, 255)), voucher.voucher_no, req.session.user.id]);
    req.flash('success', i18n.pack('f.pay.advance_given', { name: member.name, voucher: voucher.voucher_no }));
    res.redirect('/admin/payroll/advances');
  } catch (err) { next(err); }
});

module.exports = router;

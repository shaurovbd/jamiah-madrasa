'use strict';
/**
 * ঋণ ও বাকি ব্যবস্থাপনা
 *
 * দুই দিকের ঋণ:
 *   given    — প্রতিষ্ঠান দিয়েছে (স্টাফ ঋণ/অগ্রিম)   → সম্পদ বাড়ে, হিসাব 1203
 *   received — প্রতিষ্ঠান নিয়েছে (কর্জে হাসানা)      → দায় বাড়ে, হিসাব 2201/2202
 *
 * খাতায় যা বসে:
 *   দেওয়া, বিতরণ     : ডেবিট 1203      / ক্রেডিট নগদ
 *   দেওয়া, ফেরত আদায় : ডেবিট নগদ       / ক্রেডিট 1203
 *   নেওয়া, গ্রহণ      : ডেবিট নগদ       / ক্রেডিট 2201
 *   নেওয়া, পরিশোধ    : ডেবিট 2201      / ক্রেডিট নগদ
 *   মওকুফ (দেওয়া)    : ডেবিট 5999 ব্যয় / ক্রেডিট 1203
 *   মওকুফ (নেওয়া)    : ডেবিট 2201      / ক্রেডিট 4399 আয়
 *
 * সুদের কোনো ঘর নেই — কর্জে হাসানা সুদমুক্ত।
 */
const VoucherService = require('./voucher-service');
const DonorService = require('./donor-service');
const { VoucherError } = VoucherService;

class LoanError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.join(' '));
    this.name = 'VoucherError';       // রাউটার একই আকারে ত্রুটি ফেরত দেয়
    this.errors = list;
    this.statusCode = 422;
  }
}

const money = (v) => Math.round(Number(v || 0) * 100) / 100;
const ymd = (d) => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return String(d).slice(0, 10);
};

class LoanService {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.vouchers = options.voucherService || new VoucherService(pool, options.serviceOptions || {});
    this.donors = options.donorService || new DonorService(pool);
    this.opt = Object.assign({
      writeOffExpenseCode: '5999',    // মওকুফ (দেওয়া ঋণ) যে ব্যয়ে যাবে
      writeOffIncomeCode:  '4399',    // মওকুফ (নেওয়া ঋণ) যে আয়ে যাবে
      writeOffMinRole:     'principal',
    }, options);
  }

  async _tx(external, fn) {
    if (external) return fn(external);
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /** LN-00001 — ফাঁকবিহীন, লেনদেনের ভেতরে তালাবদ্ধ */
  async _nextCode(conn) {
    const [[row]] = await conn.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(loan_code, 4) AS UNSIGNED)), 0) AS mx
         FROM loans WHERE loan_code LIKE 'LN-%' FOR UPDATE`);
    return 'LN-' + String(Number(row.mx) + 1).padStart(5, '0');
  }

  async _account(conn, idOrCode) {
    const byCode = /^\d{4}$/.test(String(idOrCode));
    const [[a]] = await conn.query(
      `SELECT id, code, name_bn, account_class, is_postable, requires_party
         FROM accounts WHERE ${byCode ? 'code' : 'id'} = ?`, [idOrCode]);
    return a || null;
  }

  // =================================================================
  // ঋণ তৈরি — বিতরণ বা গ্রহণ
  // =================================================================
  async create(payload, ctx, opts = {}) {
    return this._tx(opts.conn, async (conn) => {
      const errors = [];
      const dir = payload.direction;
      if (dir !== 'given' && dir !== 'received') errors.push('ঋণ দেওয়া না নেওয়া — তা নির্বাচন করুন।');

      const name = String(payload.party_name || '').trim();
      if (!name) errors.push('কার সাথে লেনদেন, তার নাম লিখুন।');

      const principal = money(payload.principal);
      if (!(principal > 0)) errors.push('টাকার পরিমাণ লিখুন।');

      const issueDate = ymd(payload.issue_date);
      if (!issueDate) errors.push('তারিখ দিন।');
      const dueDate = ymd(payload.due_date);
      if (dueDate && issueDate && dueDate < issueDate)
        errors.push('ফেরতের তারিখ শুরুর তারিখের আগে হতে পারে না।');

      if (!payload.cash_account_id) errors.push('টাকা কোন হিসাব থেকে যাবে বা কোথায় আসবে, তা নির্বাচন করুন।');
      if (errors.length) throw new LoanError(errors);

      // ঋণের হিসাব — দিক অনুযায়ী ডিফল্ট
      const wanted = payload.account_id || (dir === 'given' ? '1203' : '2201');
      const acc = await this._account(conn, wanted);
      if (!acc) throw new LoanError('ঋণের হিসাবটি পাওয়া যায়নি।');
      if (!acc.is_postable) throw new LoanError(acc.code + ' একটি গ্রুপ হিসাব, এতে সরাসরি এন্ট্রি হয় না।');
      if (dir === 'given' && acc.account_class !== 'asset')
        throw new LoanError('দেওয়া ঋণ সম্পদের হিসাবে বসে (যেমন 1203), ' + acc.code + ' এ নয়।');
      if (dir === 'received' && acc.account_class !== 'liability')
        throw new LoanError('নেওয়া ঋণ দায়ের হিসাবে বসে (যেমন 2201), ' + acc.code + ' এ নয়।');

      const cash = await this._account(conn, payload.cash_account_id);
      if (!cash) throw new LoanError('নগদ/ব্যাংক হিসাবটি পাওয়া যায়নি।');

      const [[fund]] = await conn.query(
        `SELECT id, code FROM funds WHERE ${payload.fund_id ? 'id' : 'code'} = ?`,
        [payload.fund_id || 'GEN']);
      if (!fund) throw new LoanError('ফান্ডটি পাওয়া যায়নি।');

      const code = await this._nextCode(conn);

      // পক্ষ — 1203, 2201 ইত্যাদি হিসাবে কে, তা বাধ্যতামূলক।
      // দাতা হলে নাম-মোবাইল থেকে রেকর্ড তৈরি/খুঁজে নিই, রশিদ যেভাবে করে।
      const partyType = payload.party_type || 'other';
      let partyId = payload.party_id || null;
      if (acc.requires_party && !partyId) {
        if (partyType === 'donor') {
          const d = await this.donors.upsertDonor({
            name, mobile: payload.party_mobile || null,
            address: payload.party_address || null,
            source_bn: 'ঋণ — ' + code,
          }, ctx, conn);
          partyId = d.id;
        } else {
          throw new LoanError(acc.code + ' ' + acc.name_bn +
            ' হিসাবে কে, তা নির্বাচন করতে হবে — ' +
            (partyType === 'staff' ? 'স্টাফ' :
             partyType === 'student' ? 'শিক্ষার্থী' : 'পক্ষের') + ' আইডি দিন।');
        }
      }

      const who = name + (payload.party_mobile ? ' (' + payload.party_mobile + ')' : '');

      // খাতার দুই লাইন
      const lines = dir === 'given'
        ? [{ account_id: acc.id,  fund_id: fund.id, debit: principal, credit: 0,
             party_type: partyType, party_id: partyId,
             cost_center_id: payload.cost_center_id || null,
             line_narration: 'ঋণ/অগ্রিম — ' + name },
           { account_id: cash.id, fund_id: fund.id, debit: 0, credit: principal }]
        : [{ account_id: cash.id, fund_id: fund.id, debit: principal, credit: 0 },
           { account_id: acc.id,  fund_id: fund.id, debit: 0, credit: principal,
             party_type: partyType, party_id: partyId,
             cost_center_id: payload.cost_center_id || null,
             line_narration: 'গৃহীত ঋণ — ' + name }];

      const voucher = await this.vouchers.create({
        voucher_type: dir === 'given' ? 'PV' : 'RV',
        voucher_date: issueDate,
        payment_method: payload.payment_method || 'cash',
        instrument_no: payload.instrument_no || null,
        instrument_date: ymd(payload.instrument_date),
        party_type: partyType,
        party_id: partyId,
        narration_bn: (dir === 'given' ? 'ঋণ/অগ্রিম প্রদান — ' : 'কর্জে হাসানা গ্রহণ — ') +
          who + ' | ' + code + (payload.purpose_bn ? ' | ' + payload.purpose_bn : ''),
        source_module: 'loan',
        lines,
      }, ctx, { conn, autoPost: dir === 'received' });

      const [r] = await conn.query(
        `INSERT INTO loans
           (loan_code, direction, party_type, party_id, party_name, party_mobile,
            account_id, fund_id, cost_center_id, principal, issue_date, due_date,
            installment_amount, installment_day, purpose_bn, note_bn,
            voucher_id, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [code, dir, partyType, partyId, name,
         payload.party_mobile || null, acc.id, fund.id, payload.cost_center_id || null,
         principal, issueDate, dueDate,
         payload.installment_amount ? money(payload.installment_amount) : null,
         payload.installment_day || null,
         payload.purpose_bn || null, payload.note_bn || null,
         voucher.id, ctx.userId]);

      return {
        id: r.insertId, loan_code: code, direction: dir, principal,
        outstanding: principal, issue_date: issueDate, due_date: dueDate,
        voucher_id: voucher.id, voucher_no: voucher.voucher_no, voucher_status: voucher.status,
      };
    });
  }

  // =================================================================
  // কিস্তি / ফেরত
  // =================================================================
  async repay(loanId, payload, ctx, opts = {}) {
    return this._tx(opts.conn, async (conn) => {
      const [[l]] = await conn.query(`SELECT * FROM loans WHERE id = ? FOR UPDATE`, [loanId]);
      if (!l) throw new LoanError('ঋণটি পাওয়া যায়নি।');
      if (l.status !== 'active')
        throw new LoanError('এই ঋণ আর চলমান নয় (' + l.status + '), তাই কিস্তি নেওয়া যাবে না।');

      const amount = money(payload.amount);
      if (!(amount > 0)) throw new LoanError('টাকার পরিমাণ লিখুন।');

      const payDate = ymd(payload.payment_date) || ymd(new Date().toISOString());
      if (payDate < ymd(l.issue_date))
        throw new LoanError('কিস্তির তারিখ ঋণ শুরুর তারিখের আগে হতে পারে না।');

      const [[sum]] = await conn.query(
        `SELECT COALESCE(SUM(amount), 0) AS paid FROM loan_payments WHERE loan_id = ?`, [loanId]);
      const outstanding = money(Number(l.principal) - Number(sum.paid));
      if (amount > outstanding)
        throw new LoanError('বাকি আছে ' + outstanding.toFixed(2) +
          ' টাকা, তার বেশি নেওয়া যাবে না।');

      if (!payload.cash_account_id) throw new LoanError('টাকা কোথায় জমা হলো বা কোথা থেকে গেল, তা নির্বাচন করুন।');
      const cash = await this._account(conn, payload.cash_account_id);
      if (!cash) throw new LoanError('নগদ/ব্যাংক হিসাবটি পাওয়া যায়নি।');

      // দেওয়া ঋণ ফেরত আসে → নগদ বাড়ে; নেওয়া ঋণ শোধ → নগদ কমে
      const inbound = l.direction === 'given';
      const lines = inbound
        ? [{ account_id: cash.id,      fund_id: l.fund_id, debit: amount, credit: 0 },
           { account_id: l.account_id, fund_id: l.fund_id, debit: 0, credit: amount,
             party_type: l.party_type, party_id: l.party_id,
             line_narration: 'ঋণ ফেরত — ' + l.party_name }]
        : [{ account_id: l.account_id, fund_id: l.fund_id, debit: amount, credit: 0,
             party_type: l.party_type, party_id: l.party_id,
             line_narration: 'ঋণ পরিশোধ — ' + l.party_name },
           { account_id: cash.id,      fund_id: l.fund_id, debit: 0, credit: amount }];

      const voucher = await this.vouchers.create({
        voucher_type: inbound ? 'RV' : 'PV',
        voucher_date: payDate,
        payment_method: payload.payment_method || 'cash',
        instrument_no: payload.instrument_no || null,
        instrument_date: ymd(payload.instrument_date),
        party_type: l.party_type, party_id: l.party_id,
        narration_bn: (inbound ? 'ঋণ ফেরত গ্রহণ — ' : 'ঋণ পরিশোধ — ') +
          l.party_name + ' | ' + l.loan_code,
        source_module: 'loan',
        source_ref_id: l.id,
        lines,
      }, ctx, { conn, autoPost: inbound });

      const [p] = await conn.query(
        `INSERT INTO loan_payments (loan_id, payment_date, amount, voucher_id, receipt_id, note_bn, created_by)
         VALUES (?,?,?,?,?,?,?)`,
        [l.id, payDate, amount, voucher.id, payload.receipt_id || null,
         payload.note_bn || null, ctx.userId]);

      const left = money(outstanding - amount);
      if (left <= 0) {
        await conn.query(
          `UPDATE loans SET status = 'settled', settled_at = NOW() WHERE id = ?`, [l.id]);
      }

      return {
        payment_id: p.insertId, loan_code: l.loan_code, amount,
        paid_total: money(Number(sum.paid) + amount), outstanding: left,
        settled: left <= 0,
        voucher_id: voucher.id, voucher_no: voucher.voucher_no, voucher_status: voucher.status,
      };
    });
  }

  // =================================================================
  // মওকুফ — বাকিটা ব্যয়/আয়ে চলে যায়, লিখিত কারণ বাধ্যতামূলক
  // =================================================================
  async writeOff(loanId, payload, ctx, opts = {}) {
    const need = this.opt.writeOffMinRole;
    const rank = VoucherService.ROLE_RANK || {};
    if ((rank[ctx.role] || 0) < (rank[need] || 99))
      throw new LoanError('ঋণ মওকুফ করতে ' + need + ' পর্যায়ের অনুমোদন লাগে।');

    const reason = String(payload.reason || '').trim();
    if (reason.length < 5) throw new LoanError('মওকুফের কারণ লিখিতভাবে দিতে হবে।');

    return this._tx(opts.conn, async (conn) => {
      const [[l]] = await conn.query(`SELECT * FROM loans WHERE id = ? FOR UPDATE`, [loanId]);
      if (!l) throw new LoanError('ঋণটি পাওয়া যায়নি।');
      if (l.status !== 'active') throw new LoanError('এই ঋণ আর চলমান নয়।');

      const [[sum]] = await conn.query(
        `SELECT COALESCE(SUM(amount), 0) AS paid FROM loan_payments WHERE loan_id = ?`, [loanId]);
      const outstanding = money(Number(l.principal) - Number(sum.paid));
      if (!(outstanding > 0)) throw new LoanError('বাকি কিছু নেই, মওকুফের দরকার নেই।');

      const given = l.direction === 'given';
      const other = await this._account(conn,
        given ? this.opt.writeOffExpenseCode : this.opt.writeOffIncomeCode);
      if (!other) throw new LoanError('মওকুফের বিপরীত হিসাবটি পাওয়া যায়নি।');

      const party = { party_type: l.party_type, party_id: l.party_id };
      const lines = given
        ? [{ account_id: other.id,    fund_id: l.fund_id, debit: outstanding, credit: 0,
             line_narration: 'ঋণ মওকুফ — ' + l.party_name },
           Object.assign({ account_id: l.account_id, fund_id: l.fund_id,
             debit: 0, credit: outstanding }, party)]
        : [Object.assign({ account_id: l.account_id, fund_id: l.fund_id,
             debit: outstanding, credit: 0 }, party),
           { account_id: other.id,    fund_id: l.fund_id, debit: 0, credit: outstanding,
             line_narration: 'ঋণদাতা মওকুফ করেছেন — ' + l.party_name }];

      const voucher = await this.vouchers.create({
        voucher_type: 'JV',
        voucher_date: ymd(payload.date) || ymd(new Date().toISOString()),
        narration_bn: 'ঋণ মওকুফ — ' + l.party_name + ' | ' + l.loan_code + ' | ' + reason,
        source_module: 'loan', source_ref_id: l.id,
        lines,
      }, ctx, { conn });

      await conn.query(
        `UPDATE loans SET status = 'written_off', write_off_voucher_id = ?,
                write_off_reason = ?, write_off_by = ?, write_off_at = NOW()
          WHERE id = ?`, [voucher.id, reason, ctx.userId, l.id]);

      return { loan_code: l.loan_code, written_off: outstanding,
               voucher_id: voucher.id, voucher_no: voucher.voucher_no };
    });
  }

  /** ভুল করে তোলা ঋণ — কোনো কিস্তি না থাকলে বাতিল, বিতরণ ভাউচার উল্টে যায় */
  async cancel(loanId, payload, ctx, opts = {}) {
    const reason = String(payload.reason || '').trim();
    if (reason.length < 5) throw new LoanError('বাতিলের কারণ লিখুন।');

    return this._tx(opts.conn, async (conn) => {
      const [[l]] = await conn.query(`SELECT * FROM loans WHERE id = ? FOR UPDATE`, [loanId]);
      if (!l) throw new LoanError('ঋণটি পাওয়া যায়নি।');
      if (l.status !== 'active') throw new LoanError('এই ঋণ আর চলমান নয়।');

      const [[c]] = await conn.query(
        `SELECT COUNT(*) AS n FROM loan_payments WHERE loan_id = ?`, [loanId]);
      if (Number(c.n) > 0)
        throw new LoanError('এই ঋণে কিস্তি জমা পড়েছে, তাই বাতিল করা যাবে না। মওকুফ করুন।');

      await this.vouchers.reverse(l.voucher_id, 'ঋণ বাতিল — ' + reason, ctx, { conn });
      await conn.query(
        `UPDATE loans SET status = 'cancelled', cancel_reason = ? WHERE id = ?`,
        [reason, l.id]);
      return { loan_code: l.loan_code, status: 'cancelled' };
    });
  }

  // =================================================================
  // পড়া
  // =================================================================
  async get(loanId) {
    const [[l]] = await this.pool.query(
      `SELECT * FROM v_loan_status WHERE loan_id = ?`, [loanId]);
    if (!l) return null;
    const [payments] = await this.pool.query(
      `SELECT lp.id, lp.payment_date, lp.amount, lp.note_bn,
              v.voucher_no, v.status AS voucher_status, lp.receipt_id
         FROM loan_payments lp
         JOIN vouchers v ON v.id = lp.voucher_id
        WHERE lp.loan_id = ?
        ORDER BY lp.payment_date, lp.id`, [loanId]);
    return { loan: l, payments };
  }

  async list(filters = {}) {
    const where = [], args = [];
    if (filters.direction) { where.push('direction = ?'); args.push(filters.direction); }
    if (filters.status)    { where.push('status = ?');    args.push(filters.status); }
    if (filters.party_type){ where.push('party_type = ?');args.push(filters.party_type); }
    if (filters.overdue)   { where.push('is_overdue = 1'); }
    if (filters.q) {
      where.push('(party_name LIKE ? OR loan_code LIKE ? OR party_mobile LIKE ?)');
      const q = '%' + filters.q + '%'; args.push(q, q, q);
    }
    const limit = Math.min(Number(filters.limit) || 100, 500);
    const [rows] = await this.pool.query(
      `SELECT * FROM v_loan_status
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY (status = 'active') DESC, is_overdue DESC, issue_date DESC
        LIMIT ${limit}`, args);
    return rows;
  }

  async overdue(asOf) {
    const date = ymd(asOf) || ymd(new Date().toISOString());
    const [rows] = await this.pool.query(
      `SELECT * FROM v_loan_status
        WHERE status = 'active' AND outstanding > 0
          AND due_date IS NOT NULL AND due_date < ?
        ORDER BY due_date`, [date]);
    const total = rows.reduce((s, r) => s + Number(r.outstanding), 0);
    return { date, rows, total_outstanding: money(total) };
  }

  async summary() {
    const [rows] = await this.pool.query(`SELECT * FROM v_loan_summary`);
    const out = { given: null, received: null };
    rows.forEach((r) => { out[r.direction] = r; });
    return out;
  }

  async markReminded(loanId) {
    await this.pool.query(
      `UPDATE loans SET last_reminded_at = CURDATE(), reminder_count = reminder_count + 1
        WHERE id = ?`, [loanId]);
    return { ok: true };
  }
}

module.exports = LoanService;
module.exports.LoanError = LoanError;

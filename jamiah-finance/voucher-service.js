'use strict';
/**
 * Jamiah Scholars International — হিসাব ও অর্থ বিভাগ
 * ভাউচার সার্ভিস: ভ্যালিডেশন, গ্যাপলেস নম্বরিং, অনুমোদন, পোস্টিং, রিভার্সাল
 *
 * ব্যবহার (Express):
 *   const mysql = require('mysql2/promise');
 *   const VoucherService = require('./voucher-service');
 *   const pool = mysql.createPool({ ..., decimalNumbers: true });
 *   const vouchers = new VoucherService(pool);
 *
 *   await vouchers.create({ voucher_type:'PV', ... }, { userId: 1, role:'principal', ip: req.ip });
 *
 * নীতি: সব হিসাব পূর্ণসংখ্যা পয়সায় (paisa) গোনা হয় — ফ্লোটিং পয়েন্ট ভুল এড়াতে।
 *       পোস্ট করা ভাউচার কখনো এডিট/ডিলিট হয় না, শুধু রিভার্স হয়।
 */

// ---------------------------------------------------------------------
// কনফিগ
// ---------------------------------------------------------------------
const ROLE_RANK = {
  accountant: 1,
  chief_accountant: 2,
  principal: 3,
  committee: 4,
};

const DEFAULT_OPTIONS = {
  // টাকার পরিমাণ অনুযায়ী ন্যূনতম অনুমোদনকারী
  approvalTiers: [
    { maxAmount: 2000, role: 'accountant' },
    { maxAmount: 20000, role: 'chief_accountant' },
    { maxAmount: 100000, role: 'principal' },
    { maxAmount: Infinity, role: 'committee' },
  ],
  allowFutureDates: false,
  // tier ≤ accountant হলে তৈরির সাথেই অটো-পোস্ট
  autoPostWithinOwnTier: true,
};

class VoucherError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.join(' | '));
    this.name = 'VoucherError';
    this.errors = list;
    this.statusCode = 422;
  }
}

// পয়সায় রূপান্তর — '1500.50' → 150050
const toPaisa = (v) => Math.round(Number(v || 0) * 100);
const toTaka = (p) => (p / 100).toFixed(2);
const bdt = (p) =>
  'Tk ' + (p / 100).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------
class VoucherService {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.opt = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * লেনদেনের মোড়ক। বাইরের conn দেওয়া থাকলে কলারই begin/commit সামলায় —
   * তখন এটি শুধু কাজটি চালায়, যাতে রশিদের মতো মডিউল একই লেনদেনে ভাউচার বসাতে পারে।
   */
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

  // =================================================================
  // তৈরি
  // =================================================================
  async create(payload, ctx, opts = {}) {
    return this._tx(opts.conn, async (conn) => {
      const meta = await this._validate(conn, payload, ctx);

      const voucherNo = await this._nextVoucherNo(
        conn,
        payload.voucher_type,
        meta.period.fiscal_year_id
      );

      // অনুমোদনের প্রয়োজন আছে কি না
      const needed = this._requiredApprover(meta.totalDebitPaisa, meta.funds);
      const userRank = ROLE_RANK[ctx.role] || 0;
      const canSelfApprove = userRank >= ROLE_RANK[needed];
      // opts.autoPost — শুধু জমার মতো ক্ষেত্রে, যেখানে টাকা ইতিমধ্যেই হাতে এসে গেছে
      // (রশিদ মডিউল)। অনুমোদনের স্তর এড়ানো হয়, কিন্তু সব ভ্যালিডেশন চলে।
      const status = (opts.autoPost || (canSelfApprove && this.opt.autoPostWithinOwnTier))
        ? 'posted' : 'pending';

      const now = new Date();
      const [res] = await conn.execute(
        `INSERT INTO vouchers
           (voucher_no, voucher_type, voucher_date, fiscal_period_id, narration_bn,
            party_type, party_id, payment_method, instrument_no, instrument_date,
            total_debit, total_credit, status, receipt_id, source_module, source_ref_id,
            fatwa_override, fatwa_note, created_by, created_at,
            approved_by, approved_at, posted_by, posted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          voucherNo,
          payload.voucher_type,
          payload.voucher_date,
          meta.period.id,
          payload.narration_bn || null,
          payload.party_type || null,
          payload.party_id || null,
          payload.payment_method || null,
          payload.instrument_no || null,
          payload.instrument_date || null,
          toTaka(meta.totalDebitPaisa),
          toTaka(meta.totalCreditPaisa),
          status,
          payload.receipt_id || null,
          payload.source_module || 'manual',
          payload.source_ref_id || null,
          payload.fatwa_override ? 1 : 0,
          payload.fatwa_note || null,
          ctx.userId,
          now,
          status === 'posted' ? ctx.userId : null,
          status === 'posted' ? now : null,
          status === 'posted' ? ctx.userId : null,
          status === 'posted' ? now : null,
        ]
      );
      const voucherId = res.insertId;

      let lineNo = 0;
      for (const l of payload.lines) {
        lineNo += 1;
        await conn.execute(
          `INSERT INTO voucher_lines
             (voucher_id, line_no, account_id, fund_id, cost_center_id,
              debit, credit, party_type, party_id, student_id, sponsorship_id, line_narration)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            voucherId,
            lineNo,
            l.account_id,
            l.fund_id,
            l.cost_center_id || null,
            toTaka(toPaisa(l.debit)),
            toTaka(toPaisa(l.credit)),
            l.party_type || null,
            l.party_id || null,
            l.student_id || null,
            l.sponsorship_id || null,
            l.line_narration || null,
          ]
        );
      }

      await this._audit(conn, {
        entity_type: 'voucher',
        entity_id: voucherId,
        action: status === 'posted' ? 'create_and_post' : 'create',
        after_json: { voucher_no: voucherNo, status, total: toTaka(meta.totalDebitPaisa) },
        user_id: ctx.userId,
        ip: ctx.ip,
      });

      return { id: voucherId, voucher_no: voucherNo, status, required_approver: needed };
    });
  }

  // =================================================================
  // অনুমোদন
  // =================================================================
  async approve(voucherId, ctx) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const v = await this._lockVoucher(conn, voucherId);

      if (v.status !== 'pending') {
        throw new VoucherError(`এই ভাউচারের অবস্থা '${v.status}' — অনুমোদনযোগ্য নয়।`);
      }
      await this._assertPeriodOpen(conn, v.fiscal_period_id);

      const funds = await this._voucherFunds(conn, voucherId);
      const needed = this._requiredApprover(toPaisa(v.total_debit), funds);
      if ((ROLE_RANK[ctx.role] || 0) < ROLE_RANK[needed]) {
        throw new VoucherError(
          `${bdt(toPaisa(v.total_debit))} পরিমাণের ভাউচারে '${needed}' স্তরের অনুমোদন প্রয়োজন।`
        );
      }

      await conn.execute(
        `UPDATE vouchers SET status='approved', approved_by=?, approved_at=NOW() WHERE id=?`,
        [ctx.userId, voucherId]
      );
      await this._audit(conn, {
        entity_type: 'voucher', entity_id: voucherId, action: 'approve',
        before_json: { status: v.status }, after_json: { status: 'approved' },
        user_id: ctx.userId, ip: ctx.ip,
      });
      await conn.commit();
      return { id: voucherId, status: 'approved' };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async reject(voucherId, reason, ctx) {
    if (!reason || !reason.trim()) throw new VoucherError('বাতিলের কারণ লিখতে হবে।');
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const v = await this._lockVoucher(conn, voucherId);
      if (!['pending', 'draft'].includes(v.status)) {
        throw new VoucherError(`'${v.status}' অবস্থার ভাউচার বাতিল করা যাবে না।`);
      }
      await conn.execute(
        `UPDATE vouchers SET status='rejected', reject_reason=? WHERE id=?`,
        [reason.trim(), voucherId]
      );
      await this._audit(conn, {
        entity_type: 'voucher', entity_id: voucherId, action: 'reject',
        reason: reason.trim(), user_id: ctx.userId, ip: ctx.ip,
      });
      await conn.commit();
      return { id: voucherId, status: 'rejected' };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  // =================================================================
  // পোস্টিং  (খতিয়ানে স্থায়ীভাবে বসে যায়)
  // =================================================================
  async post(voucherId, ctx) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const v = await this._lockVoucher(conn, voucherId);

      if (v.status === 'posted') throw new VoucherError('এই ভাউচার আগেই পোস্ট করা হয়েছে।');
      if (v.status !== 'approved') {
        throw new VoucherError(`পোস্ট করার আগে অনুমোদন প্রয়োজন (বর্তমান অবস্থা: ${v.status})।`);
      }
      await this._assertPeriodOpen(conn, v.fiscal_period_id);

      if (toPaisa(v.total_debit) !== toPaisa(v.total_credit)) {
        throw new VoucherError('ডেবিট ও ক্রেডিট সমান নয় — পোস্ট করা যাবে না।');
      }

      // পোস্টের সময় আবার ফান্ড ও ক্যাশ জের যাচাই (মধ্যবর্তী লেনদেনে বদলে থাকতে পারে)
      const lines = await this._lines(conn, voucherId);
      const errors = [];
      await this._checkFundBalances(conn, lines, errors, { excludeVoucherId: voucherId });
      await this._checkCashBalances(conn, lines, errors, { excludeVoucherId: voucherId });
      if (errors.length) throw new VoucherError(errors);

      await conn.execute(
        `UPDATE vouchers SET status='posted', posted_by=?, posted_at=NOW() WHERE id=?`,
        [ctx.userId, voucherId]
      );
      await this._audit(conn, {
        entity_type: 'voucher', entity_id: voucherId, action: 'post',
        before_json: { status: v.status }, after_json: { status: 'posted' },
        user_id: ctx.userId, ip: ctx.ip,
      });
      await conn.commit();
      return { id: voucherId, status: 'posted' };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  // =================================================================
  // রিভার্সাল — ভুল সংশোধনের একমাত্র বৈধ পথ
  // =================================================================
  async reverse(voucherId, reason, ctx, opts = {}) {
    if (!reason || !reason.trim()) throw new VoucherError('রিভার্সালের কারণ লিখতে হবে।');
    if ((ROLE_RANK[ctx.role] || 0) < ROLE_RANK.chief_accountant) {
      throw new VoucherError('রিভার্সালের জন্য অন্তত প্রধান হিসাবরক্ষকের অধিকার প্রয়োজন।');
    }

    return this._tx(opts.conn, async (conn) => {
      const v = await this._lockVoucher(conn, voucherId);
      if (v.status !== 'posted') throw new VoucherError('শুধু পোস্ট করা ভাউচার রিভার্স করা যায়।');
      if (v.reversal_of_id) throw new VoucherError('রিভার্সাল ভাউচার আবার রিভার্স করা যায় না।');
      if (v.reversed_at) throw new VoucherError('এই ভাউচার আগেই রিভার্স করা হয়েছে।');

      // রিভার্সাল চলতি খোলা পিরিয়ডে বসবে — বন্ধ মাস স্পর্শ করা হয় না
      const today = new Date().toISOString().slice(0, 10);
      const period = await this._resolvePeriod(conn, today);
      const voucherNo = await this._nextVoucherNo(conn, v.voucher_type, period.fiscal_year_id);

      const [res] = await conn.execute(
        `INSERT INTO vouchers
           (voucher_no, voucher_type, voucher_date, fiscal_period_id, narration_bn,
            party_type, party_id, payment_method, total_debit, total_credit, status,
            reversal_of_id, source_module, created_by, created_at,
            approved_by, approved_at, posted_by, posted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'posted', ?, 'reversal', ?, NOW(), ?, NOW(), ?, NOW())`,
        [
          voucherNo, v.voucher_type, today, period.id,
          `রিভার্সাল — ${v.voucher_no} | কারণ: ${reason.trim()}`,
          v.party_type, v.party_id, v.payment_method,
          v.total_debit, v.total_credit,
          voucherId, ctx.userId, ctx.userId, ctx.userId,
        ]
      );
      const newId = res.insertId;

      // ডেবিট ↔ ক্রেডিট উল্টে দেওয়া
      const lines = await this._lines(conn, voucherId);
      let n = 0;
      for (const l of lines) {
        n += 1;
        await conn.execute(
          `INSERT INTO voucher_lines
             (voucher_id, line_no, account_id, fund_id, cost_center_id,
              debit, credit, party_type, party_id, student_id, sponsorship_id, line_narration)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            newId, n, l.account_id, l.fund_id, l.cost_center_id,
            l.credit, l.debit,                        // ← উল্টানো
            l.party_type, l.party_id, l.student_id, l.sponsorship_id,
            'রিভার্সাল',
          ]
        );
      }

      // মূল ভাউচার 'posted' থেকেই যায় — দুটি এন্ট্রি খতিয়ানে পরস্পরকে কাটে।
      // শুধু রিভার্সালের চিহ্ন বসে, যাতে আবার রিভার্স করা না যায়।
      await conn.execute(
        `UPDATE vouchers SET reversed_at = NOW(), reversed_by_voucher_id = ? WHERE id = ?`,
        [newId, voucherId]
      );
      await this._audit(conn, {
        entity_type: 'voucher', entity_id: voucherId, action: 'reverse',
        after_json: { reversed_by_voucher: voucherNo }, reason: reason.trim(),
        user_id: ctx.userId, ip: ctx.ip,
      });

      return { original_id: voucherId, reversal_id: newId, reversal_no: voucherNo };
    });
  }

  // =================================================================
  // ভ্যালিডেশন — ১২টি রুল
  // =================================================================
  async _validate(conn, payload, ctx) {
    const errors = [];

    if (!payload.voucher_type || !['RV', 'PV', 'JV', 'CV', 'FT'].includes(payload.voucher_type)) {
      throw new VoucherError('ভাউচারের ধরন নির্বাচন করুন (RV/PV/JV/CV/FT)।');
    }
    if (!payload.voucher_date) throw new VoucherError('ভাউচারের তারিখ দিতে হবে।');
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (lines.length < 2) throw new VoucherError('অন্তত দুটি লাইন (ডেবিট ও ক্রেডিট) প্রয়োজন।');

    // --- রুল ১ ও ২: লাইন-পর্যায়ের শুদ্ধতা ---
    let totalDebitPaisa = 0;
    let totalCreditPaisa = 0;
    lines.forEach((l, i) => {
      const n = i + 1;
      const d = toPaisa(l.debit);
      const c = toPaisa(l.credit);
      if (d < 0 || c < 0) errors.push(`লাইন ${n}: ঋণাত্মক পরিমাণ দেওয়া যাবে না।`);
      if (d > 0 && c > 0) errors.push(`লাইন ${n}: একই লাইনে ডেবিট ও ক্রেডিট দুটোই দেওয়া যাবে না।`);
      if (d === 0 && c === 0) errors.push(`লাইন ${n}: পরিমাণ শূন্য হতে পারে না।`);
      if (!l.account_id) errors.push(`লাইন ${n}: হিসাব নির্বাচন করুন।`);
      // --- রুল ৩: ফান্ড বাধ্যতামূলক ---
      if (!l.fund_id) errors.push(`লাইন ${n}: ফান্ড নির্বাচন করুন।`);
      totalDebitPaisa += d;
      totalCreditPaisa += c;
    });

    // --- রুল ৪: ডেবিট = ক্রেডিট ---
    if (totalDebitPaisa !== totalCreditPaisa) {
      errors.push(
        `ডেবিট ও ক্রেডিট সমান হয়নি — পার্থক্য ${bdt(Math.abs(totalDebitPaisa - totalCreditPaisa))}।`
      );
    }
    if (errors.length) throw new VoucherError(errors);

    // --- হিসাবগুলো লোড ---
    const accountIds = [...new Set(lines.map((l) => l.account_id))];
    const [accRows] = await conn.query(
      `SELECT id, code, name_bn, account_class, account_subtype, is_group,
              is_postable, is_cash_like, is_active, requires_party
         FROM accounts WHERE id IN (?)`,
      [accountIds]
    );
    const acc = new Map(accRows.map((a) => [a.id, a]));

    lines.forEach((l, i) => {
      const n = i + 1;
      const a = acc.get(Number(l.account_id));
      if (!a) { errors.push(`লাইন ${n}: হিসাবটি পাওয়া যায়নি।`); return; }
      // --- রুল ৫: গ্রুপ হিসাবে এন্ট্রি নয় ---
      if (a.is_group || !a.is_postable) {
        errors.push(`লাইন ${n}: '${a.code} ${a.name_bn}' একটি শিরোনাম হিসাব — এতে এন্ট্রি দেওয়া যাবে না।`);
      }
      if (!a.is_active) errors.push(`লাইন ${n}: '${a.name_bn}' হিসাবটি নিষ্ক্রিয়।`);
      // --- রুল ৬: পার্টি বাধ্যতামূলক ---
      if (a.requires_party && !(l.party_id || l.student_id || payload.party_id)) {
        errors.push(`লাইন ${n}: '${a.name_bn}' হিসাবে শিক্ষার্থী/দাতা/স্টাফ নির্বাচন করুন।`);
      }
    });

    // --- রুল ৭: পিরিয়ড খোলা আছে ---
    const period = await this._resolvePeriod(conn, payload.voucher_date, errors);

    // --- রুল ৮: ভবিষ্যৎ তারিখ ---
    if (!this.opt.allowFutureDates) {
      const today = new Date().toISOString().slice(0, 10);
      if (String(payload.voucher_date) > today) {
        errors.push('ভবিষ্যৎ তারিখে ভাউচার দেওয়া যাবে না।');
      }
    }

    // --- ফান্ড লোড ---
    const fundIds = [...new Set(lines.map((l) => l.fund_id))];
    const [fundRows] = await conn.query(
      `SELECT id, code, name_bn, fund_type, allow_negative, corpus_protected,
              requires_approval_by, expiry_date, is_active
         FROM funds WHERE id IN (?)`,
      [fundIds]
    );
    const funds = new Map(fundRows.map((f) => [f.id, f]));
    fundIds.forEach((fid) => {
      const f = funds.get(Number(fid));
      if (!f) { errors.push('অজানা ফান্ড নির্বাচিত হয়েছে।'); return; }
      if (!f.is_active) errors.push(`'${f.name_bn}' ফান্ডটি নিষ্ক্রিয়।`);
      if (f.expiry_date && String(payload.voucher_date) > String(f.expiry_date).slice(0, 10)) {
        errors.push(`'${f.name_bn}' এর মেয়াদ ${String(f.expiry_date).slice(0, 10)} তারিখে শেষ হয়েছে।`);
      }
    });

    // --- রুল ৯ ও ১০: ফান্ড বিধিনিষেধ ও ওয়াকফ কর্পাস ---
    await this._checkFundRules(conn, lines, acc, funds, payload, ctx, errors);

    // --- রুল ১১: ফান্ড জের ঋণাত্মক হবে না ---
    await this._checkFundBalances(conn, lines, errors);

    // --- রুল ১২: নগদ/ব্যাংক জের ঋণাত্মক হবে না ---
    await this._checkCashBalances(conn, lines, errors);

    if (errors.length) throw new VoucherError(errors);

    return { period, totalDebitPaisa, totalCreditPaisa, funds: fundRows, accounts: acc };
  }

  /** ব্যয়ের লাইন = টাকা ফান্ড থেকে বেরিয়ে যাওয়া */
  _isSpendingLine(line, account) {
    if (!account) return false;
    const spendsOnDebit =
      account.account_class === 'expense' ||
      ['fixed_asset', 'inventory'].includes(account.account_subtype);
    return spendsOnDebit && toPaisa(line.debit) > 0;
  }

  async _checkFundRules(conn, lines, acc, funds, payload, ctx, errors) {
    const [ruleRows] = await conn.query(
      `SELECT fund_id, account_id, rule FROM fund_account_rules WHERE fund_id IN (?)`,
      [[...new Set(lines.map((l) => l.fund_id))]]
    );

    const allowByFund = new Map();
    const blockByFund = new Map();
    for (const r of ruleRows) {
      const target = r.rule === 'allow' ? allowByFund : blockByFund;
      if (!target.has(r.fund_id)) target.set(r.fund_id, new Set());
      target.get(r.fund_id).add(r.account_id);
    }

    const override = !!payload.fatwa_override;
    if (override) {
      if (!payload.fatwa_note || !payload.fatwa_note.trim()) {
        errors.push('ফান্ড বিধিনিষেধ অতিক্রম করতে লিখিত কারণ (ফতোয়া নোট) বাধ্যতামূলক।');
      }
      if ((ROLE_RANK[ctx.role] || 0) < ROLE_RANK.principal) {
        errors.push('ফান্ড বিধিনিষেধ অতিক্রমের অধিকার শুধু মুহতামিম/পরিচালনা কমিটির।');
      }
    }

    lines.forEach((l, i) => {
      const n = i + 1;
      const a = acc.get(Number(l.account_id));
      const f = funds.get(Number(l.fund_id));
      if (!a || !f) return;
      if (!this._isSpendingLine(l, a)) return;

      // ওয়াকফ কর্পাস — অতিক্রমযোগ্য নয়
      if (f.corpus_protected) {
        errors.push(
          `লাইন ${n}: '${f.name_bn}' এর মূল টাকা (কর্পাস) ব্যয় করা যাবে না — শুধু এর আয় ব্যয়যোগ্য।`
        );
        return;
      }

      const blocked = blockByFund.get(f.id);
      const allowed = allowByFund.get(f.id);
      const isBlocked = blocked && blocked.has(a.id);
      const notWhitelisted = allowed && allowed.size > 0 && !allowed.has(a.id);

      if (isBlocked || notWhitelisted) {
        if (override) return; // লিখিত কারণে অনুমোদিত, অডিট লগে থাকবে
        errors.push(
          `লাইন ${n}: '${f.name_bn}' থেকে '${a.code} ${a.name_bn}' খাতে ব্যয় করা যাবে না।`
        );
      }
    });
  }

  /** ফান্ডের জের: আয়/ব্যয়/ফান্ড শ্রেণির লাইনে (credit − debit) */
  async _checkFundBalances(conn, lines, errors, { excludeVoucherId = null } = {}) {
    const accountIds = [...new Set(lines.map((l) => l.account_id))];
    const [accRows] = await conn.query(
      `SELECT id, account_class FROM accounts WHERE id IN (?)`, [accountIds]
    );
    const cls = new Map(accRows.map((a) => [a.id, a.account_class]));

    const delta = new Map(); // fund_id → পয়সা
    for (const l of lines) {
      const c = cls.get(Number(l.account_id));
      if (!['income', 'expense', 'fund'].includes(c)) continue;
      const d = toPaisa(l.credit) - toPaisa(l.debit);
      delta.set(Number(l.fund_id), (delta.get(Number(l.fund_id)) || 0) + d);
    }

    for (const [fundId, d] of delta) {
      if (d >= 0) continue; // ফান্ডে টাকা ঢুকছে — যাচাইয়ের দরকার নেই
      // পোস্ট-ফিল্টার সাব-কোয়েরির ভেতরে INNER JOIN দিয়ে — নইলে অপোস্টেড লাইনও যোগ হয়
      const [[f]] = await conn.query(
        `SELECT f.code, f.name_bn, f.allow_negative,
                COALESCE((
                  SELECT SUM(CASE WHEN a.account_class IN ('income','expense','fund')
                                  THEN vl.credit - vl.debit ELSE 0 END)
                    FROM voucher_lines vl
                    JOIN vouchers v ON v.id = vl.voucher_id AND v.status = 'posted'
                    JOIN accounts a ON a.id = vl.account_id
                   WHERE vl.fund_id = f.id AND (? IS NULL OR v.id <> ?)
                ), 0) AS available
           FROM funds f
          WHERE f.id = ?`,
        [excludeVoucherId, excludeVoucherId, fundId]
      );
      if (!f || f.allow_negative) continue;
      const available = toPaisa(f.available);
      if (available + d < 0) {
        errors.push(
          `'${f.name_bn}' এ অবশিষ্ট ${bdt(available)} — ${bdt(-d)} ব্যয় করা যাবে না ` +
          `(ঘাটতি ${bdt(-(available + d))})।`
        );
      }
    }
  }

  /** নগদ/ব্যাংক জের: (debit − credit) */
  async _checkCashBalances(conn, lines, errors, { excludeVoucherId = null } = {}) {
    const accountIds = [...new Set(lines.map((l) => l.account_id))];
    const [accRows] = await conn.query(
      `SELECT id, code, name_bn, is_cash_like FROM accounts WHERE id IN (?)`, [accountIds]
    );
    const cash = new Map(accRows.filter((a) => a.is_cash_like).map((a) => [a.id, a]));
    if (!cash.size) return;

    const delta = new Map();
    for (const l of lines) {
      const id = Number(l.account_id);
      if (!cash.has(id)) continue;
      delta.set(id, (delta.get(id) || 0) + toPaisa(l.debit) - toPaisa(l.credit));
    }

    for (const [accId, d] of delta) {
      if (d >= 0) continue;
      const [[row]] = await conn.query(
        `SELECT COALESCE(SUM(vl.debit - vl.credit), 0) AS balance
           FROM voucher_lines vl
           JOIN vouchers v ON v.id = vl.voucher_id AND v.status = 'posted'
                          AND (? IS NULL OR v.id <> ?)
          WHERE vl.account_id = ?`,
        [excludeVoucherId, excludeVoucherId, accId]
      );
      const balance = toPaisa(row.balance);
      if (balance + d < 0) {
        const a = cash.get(accId);
        errors.push(
          `'${a.code} ${a.name_bn}' এ আছে ${bdt(balance)} — ${bdt(-d)} পরিশোধ করা যাবে না।`
        );
      }
    }
  }

  // =================================================================
  // সহায়ক
  // =================================================================
  _requiredApprover(amountPaisa, fundRows = []) {
    const amount = amountPaisa / 100;
    const tier =
      this.opt.approvalTiers.find((t) => amount <= t.maxAmount) ||
      this.opt.approvalTiers[this.opt.approvalTiers.length - 1];
    let rank = ROLE_RANK[tier.role];
    for (const f of fundRows) {
      const r = ROLE_RANK[f.requires_approval_by];
      if (r && r > rank) rank = r;   // ফান্ডের নিজস্ব স্তর বেশি হলে সেটাই চলবে
    }
    return Object.keys(ROLE_RANK).find((k) => ROLE_RANK[k] === rank);
  }

  async _resolvePeriod(conn, date, errors = null) {
    const [[p]] = await conn.query(
      `SELECT fp.id, fp.label, fp.status, fp.fiscal_year_id, fy.status AS fy_status
         FROM fiscal_periods fp
         JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
        WHERE ? BETWEEN fp.start_date AND fp.end_date
        LIMIT 1`,
      [date]
    );
    const fail = (m) => { if (errors) errors.push(m); else throw new VoucherError(m); };
    if (!p) { fail(`${date} তারিখের জন্য কোনো আর্থিক পিরিয়ড খোলা নেই।`); return null; }
    if (p.status === 'locked') fail(`'${p.label}' পিরিয়ড বন্ধ করা হয়েছে — এন্ট্রি দেওয়া যাবে না।`);
    if (p.fy_status === 'closed') fail('আর্থিক বছরটি সমাপ্ত — এন্ট্রি দেওয়া যাবে না।');
    return p;
  }

  async _assertPeriodOpen(conn, periodId) {
    const [[p]] = await conn.query(
      `SELECT fp.label, fp.status, fy.status AS fy_status
         FROM fiscal_periods fp JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
        WHERE fp.id = ?`, [periodId]
    );
    if (!p) throw new VoucherError('পিরিয়ড পাওয়া যায়নি।');
    if (p.status === 'locked') throw new VoucherError(`'${p.label}' পিরিয়ড বন্ধ।`);
    if (p.fy_status === 'closed') throw new VoucherError('আর্থিক বছর সমাপ্ত।');
  }

  /** গ্যাপলেস নম্বর — সারি লক করে বাড়ানো হয়, তাই দুটি ব্যবহারকারী একসাথে কাজ করলেও ফাঁক পড়ে না */
  async _nextVoucherNo(conn, type, fiscalYearId) {
    const [[seq]] = await conn.query(
      `SELECT prefix, year_token, last_no, padding
         FROM voucher_sequences
        WHERE voucher_type = ? AND fiscal_year_id = ?
        FOR UPDATE`,
      [type, fiscalYearId]
    );
    if (!seq) {
      throw new VoucherError(`${type} ধরনের নম্বর সিরিজ এই আর্থিক বছরের জন্য তৈরি করা হয়নি।`);
    }
    const next = Number(seq.last_no) + 1;
    await conn.execute(
      `UPDATE voucher_sequences SET last_no = ?
        WHERE voucher_type = ? AND fiscal_year_id = ?`,
      [next, type, fiscalYearId]
    );
    return `${seq.prefix}-${seq.year_token}-${String(next).padStart(seq.padding, '0')}`;
  }

  async _lockVoucher(conn, id) {
    const [[v]] = await conn.query(`SELECT * FROM vouchers WHERE id = ? FOR UPDATE`, [id]);
    if (!v) throw new VoucherError('ভাউচার পাওয়া যায়নি।');
    return v;
  }

  async _lines(conn, voucherId) {
    const [rows] = await conn.query(
      `SELECT * FROM voucher_lines WHERE voucher_id = ? ORDER BY line_no`, [voucherId]
    );
    return rows;
  }

  async _voucherFunds(conn, voucherId) {
    const [rows] = await conn.query(
      `SELECT DISTINCT f.id, f.code, f.name_bn, f.requires_approval_by
         FROM voucher_lines vl JOIN funds f ON f.id = vl.fund_id
        WHERE vl.voucher_id = ?`, [voucherId]
    );
    return rows;
  }

  async _audit(conn, e) {
    await conn.execute(
      `INSERT INTO audit_logs
         (entity_type, entity_id, action, before_json, after_json, reason, user_id, ip_address)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        e.entity_type, e.entity_id || null, e.action,
        e.before_json ? JSON.stringify(e.before_json) : null,
        e.after_json ? JSON.stringify(e.after_json) : null,
        e.reason || null, e.user_id || null, e.ip || null,
      ]
    );
  }
}

module.exports = VoucherService;
module.exports.VoucherError = VoucherError;
module.exports.ROLE_RANK = ROLE_RANK;
module.exports.toPaisa = toPaisa;

'use strict';
/**
 * রশিদ সার্ভিস
 *
 * নীতি:
 *  ১. প্রতিটি রশিদের সাথে ঠিক একটি জমা ভাউচার (RV) — একই লেনদেনে। একটি হলে অন্যটিও হবে,
 *     নইলে দুটোই বাতিল। তাই রশিদ আছে কিন্তু খতিয়ানে নেই — এমন হতে পারে না।
 *  ২. রশিদের ভাউচার সাথে সাথেই পোস্ট হয়। টাকা হাতে এসে গেছে, অনুমোদনের অপেক্ষায়
 *     ঝুলিয়ে রাখলে খতিয়ান পিছিয়ে থাকত। সব ভ্যালিডেশন তবু চলে।
 *  ৩. রশিদ কখনো মুছে ফেলা হয় না এবং নম্বর পুনর্ব্যবহার হয় না। ভুল হলে 'বাতিল' (void) —
 *     ভাউচার রিভার্স হয়, নম্বরটি বাতিল অবস্থায় রেকর্ডেই থাকে।
 */
const crypto = require('crypto');
const VoucherService = require('./voucher-service');
const DonorService = require('./donor-service');
const { VoucherError } = VoucherService;
const { takaInWords } = require('./lib/bangla-number');

const ROLE_RANK = VoucherService.ROLE_RANK;
const toPaisa = (v) => Math.round(Number(v || 0) * 100);

class ReceiptError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.join(' | '));
    this.name = 'VoucherError';     // রাউটার একই আকারে ত্রুটি ফেরত দেয়
    this.errors = list;
    this.statusCode = 422;
  }
}

class ReceiptService {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.vouchers = options.voucherService || new VoucherService(pool, options.serviceOptions || {});
    this.donors = options.donorService || new DonorService(pool);
    this.opt = {
      verifyBaseUrl: options.verifyBaseUrl || '/verify',
      ...options,
    };
  }

  // =================================================================
  // রশিদ কাটা
  // =================================================================
  async issue(payload, ctx) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const errors = [];
      const amountPaisa = toPaisa(payload.amount);
      if (!payload.receipt_type) errors.push('রশিদের ধরন নির্বাচন করুন।');
      if (amountPaisa <= 0) errors.push('পরিমাণ শূন্যের বেশি হতে হবে।');
      if (!payload.receipt_date) errors.push('তারিখ দিতে হবে।');
      if (!payload.cash_account_id) errors.push('টাকা কোথায় জমা হলো, তা নির্বাচন করুন।');
      if (errors.length) throw new ReceiptError(errors);

      // ---- ধরন ----
      const [[type]] = await conn.query(
        `SELECT * FROM receipt_types WHERE code = ? AND is_active = 1`, [payload.receipt_type]);
      if (!type) throw new ReceiptError(`'${payload.receipt_type}' ধরনের রশিদ পাওয়া যায়নি বা নিষ্ক্রিয়।`);

      if (type.requires_student && !payload.student_id) {
        errors.push(`${type.name_bn} রশিদে শিক্ষার্থী নির্বাচন করতে হবে।`);
      }
      if (type.requires_payer && !(payload.payer_name || '').trim()) {
        errors.push(`${type.name_bn} রশিদে যিনি দিচ্ছেন তাঁর নাম লিখতে হবে।`);
      }

      // ---- ফান্ড ও খাত ----
      let fundId = type.default_fund_id;
      if (payload.fund_id && String(payload.fund_id) !== String(type.default_fund_id)) {
        if (!type.allow_fund_change) {
          errors.push(`${type.name_bn} রশিদে ফান্ড বদলানো যাবে না।`);
        } else {
          fundId = Number(payload.fund_id);
        }
      }
      const creditAccountId = Number(payload.credit_account_id || type.default_credit_account_id);

      // ---- নগদ/ব্যাংক হিসাব ----
      const [[cashAcc]] = await conn.query(
        `SELECT id, code, name_bn, is_cash_like, is_active FROM accounts WHERE id = ?`,
        [payload.cash_account_id]);
      if (!cashAcc) errors.push('জমার হিসাবটি পাওয়া যায়নি।');
      else if (!cashAcc.is_cash_like) errors.push(`'${cashAcc.name_bn}' নগদ/ব্যাংক হিসাব নয়।`);
      else if (!cashAcc.is_active) errors.push(`'${cashAcc.name_bn}' হিসাবটি নিষ্ক্রিয়।`);

      // ---- পক্ষ লাগে এমন খাত (যেমন ঋণ ফেরত) ----
      const [[creditAcc]] = await conn.query(
        `SELECT id, code, name_bn, requires_party FROM accounts WHERE id = ?`, [creditAccountId]);
      if (!creditAcc) errors.push('জমার বিপরীত খাতটি পাওয়া যায়নি।');
      else if (creditAcc.requires_party &&
               !(payload.student_id || payload.donor_id || payload.party_id)) {
        errors.push(`'${creditAcc.name_bn}' খাতে শিক্ষার্থী/স্টাফ/দাতা নির্বাচন করতে হবে।`);
      }

      // ---- ম্যানুয়াল বই ----
      let book = null;
      if (payload.book_id) {
        const [[b]] = await conn.query(
          `SELECT * FROM receipt_books WHERE id = ? FOR UPDATE`, [payload.book_id]);
        if (!b) errors.push('রশিদ বইটি পাওয়া যায়নি।');
        else {
          if (b.status !== 'issued') errors.push(`বই ${b.book_no} কোনো কর্মচারীকে দেওয়া নেই।`);
          if (!payload.manual_no) errors.push('বইয়ের রশিদ নম্বর লিখুন।');
          else {
            const mn = Number(payload.manual_no);
            if (mn < b.from_no || mn > b.to_no) {
              errors.push(`${payload.manual_no} নম্বরটি বই ${b.book_no} (${b.from_no}–${b.to_no}) এর বাইরে।`);
            }
            const [[dup]] = await conn.query(
              `SELECT receipt_no FROM receipts WHERE book_id = ? AND manual_no = ?`,
              [payload.book_id, payload.manual_no]);
            if (dup) errors.push(`বইয়ের ${payload.manual_no} নম্বর রশিদ আগেই ব্যবহার হয়েছে (${dup.receipt_no})।`);
          }
          book = b;
        }
      }

      // ---- দাতা ----
      // মোবাইল নম্বরই চেনার চাবি: পুরনো দাতা হলে তাঁর সাথেই যুক্ত হয়, নইলে নতুন রেকর্ড।
      // কারণিককে আলাদা করে "দাতা যোগ করুন" ধাপে যেতে হয় না।
      let donorId = payload.donor_id ? Number(payload.donor_id) : null;
      let donorCreated = false;
      if (donorId) {
        const [[d]] = await conn.query(
          `SELECT id, name, merged_into_id FROM donors WHERE id = ?`, [donorId]);
        if (!d) errors.push('দাতা পাওয়া যায়নি।');
        else if (d.merged_into_id) donorId = Number(d.merged_into_id);   // একীভূত হলে মূলটিতে
      } else if (Number(type.links_donor) && (payload.payer_name || '').trim()) {
        const d = await this.donors.upsertDonor({
          name: payload.payer_name, mobile: payload.payer_mobile,
          address: payload.payer_address || payload.address,
          district: payload.district,
          thana: payload.thana, country: payload.country,
          is_expatriate: payload.is_expatriate, source_bn: payload.source_bn,
        }, ctx, conn);
        donorId = d.id;
        donorCreated = d.created;
      }

      // ---- প্রচারাভিযান ----
      let campaignId = payload.campaign_id ? Number(payload.campaign_id) : null;
      if (campaignId) {
        const [[c]] = await conn.query(
          `SELECT id, code, title_bn, fund_id, status FROM campaigns WHERE id = ?`, [campaignId]);
        if (!c) errors.push('প্রচারাভিযান পাওয়া যায়নি।');
        else if (c.status !== 'active') errors.push(`'${c.title_bn}' এখন সক্রিয় নয়।`);
        else if (String(c.fund_id) !== String(fundId)) {
          // ক্যাম্পেইনের ফান্ডই চূড়ান্ত — ধরনে ফান্ড বদলের অনুমতি থাকলে
          if (type.allow_fund_change) fundId = Number(c.fund_id);
          else errors.push(`'${c.title_bn}' এর ফান্ড এই ধরনের রশিদের ফান্ডের সাথে মেলে না।`);
        }
      }

      // ---- প্রতিশ্রুতি ----
      let pledgeId = payload.pledge_id ? Number(payload.pledge_id) : null;
      if (pledgeId) {
        const [[p]] = await conn.query(
          `SELECT id, donor_id, status, amount FROM pledges WHERE id = ? FOR UPDATE`, [pledgeId]);
        if (!p) errors.push('প্রতিশ্রুতি পাওয়া যায়নি।');
        else if (p.status === 'cancelled') errors.push('বাতিল হওয়া প্রতিশ্রুতিতে টাকা জমা করা যাবে না।');
        else if (p.status === 'fulfilled') errors.push('এই প্রতিশ্রুতি আগেই পূর্ণ হয়েছে।');
        else if (donorId && String(p.donor_id) !== String(donorId)) {
          errors.push('প্রতিশ্রুতিটি অন্য দাতার।');
        } else if (!donorId) donorId = Number(p.donor_id);
      }

      // ---- মাসিক পরিকল্পনা ----
      let recurringPlanId = payload.recurring_plan_id ? Number(payload.recurring_plan_id) : null;
      if (recurringPlanId) {
        const [[rp]] = await conn.query(
          `SELECT id, donor_id, status FROM recurring_plans WHERE id = ?`, [recurringPlanId]);
        if (!rp) errors.push('মাসিক পরিকল্পনা পাওয়া যায়নি।');
        else if (rp.status !== 'active') errors.push('মাসিক পরিকল্পনাটি সক্রিয় নয়।');
        else if (!donorId) donorId = Number(rp.donor_id);
      }

      // ---- এতিম স্পনসরশিপ ----
      let sponsorshipId = payload.sponsorship_id ? Number(payload.sponsorship_id) : null;
      if (sponsorshipId) {
        const [[sp]] = await conn.query(
          `SELECT id, sponsorship_code, orphan_id, donor_id, status
             FROM sponsorships WHERE id = ?`, [sponsorshipId]);
        if (!sp) errors.push('স্পনসরশিপ পাওয়া যায়নি।');
        else if (sp.status === 'ended') errors.push(`${sp.sponsorship_code} শেষ হয়ে গেছে।`);
        else if (donorId && String(sp.donor_id) !== String(donorId)) {
          errors.push('স্পনসরশিপটি অন্য দাতার।');
        } else if (!donorId) donorId = Number(sp.donor_id);
      }

      if (errors.length) throw new ReceiptError(errors);

      // ---- পিরিয়ড ----
      const [[period]] = await conn.query(
        `SELECT fp.id, fp.label, fp.status, fp.fiscal_year_id, fy.status AS fy_status
           FROM fiscal_periods fp JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
          WHERE ? BETWEEN fp.start_date AND fp.end_date LIMIT 1`, [payload.receipt_date]);
      if (!period) throw new ReceiptError(`${payload.receipt_date} তারিখের জন্য কোনো পিরিয়ড খোলা নেই।`);
      if (period.status === 'locked') throw new ReceiptError(`'${period.label}' পিরিয়ড বন্ধ — রশিদ কাটা যাবে না।`);
      if (period.fy_status === 'closed') throw new ReceiptError('আর্থিক বছর সমাপ্ত।');

      // ---- নম্বর ও টোকেন ----
      const receiptNo = await this._nextReceiptNo(conn, type, period.fiscal_year_id);
      const verifyToken = crypto.randomBytes(16).toString('hex');
      const amount = amountPaisa / 100;
      const inWords = takaInWords(amount);

      // ---- ভাউচার (একই লেনদেনে, সাথে সাথে পোস্ট) ----
      const partyType = payload.student_id ? 'student'
        : donorId ? 'donor'
        : payload.party_type || null;
      const partyId = payload.student_id || donorId || payload.party_id || null;
      const who = (payload.payer_name || '').trim();

      const voucher = await this.vouchers.create({
        voucher_type: 'RV',
        voucher_date: payload.receipt_date,
        payment_method: payload.payment_method || 'cash',
        instrument_no: payload.instrument_no || null,
        instrument_date: payload.instrument_date || null,
        party_type: partyType,
        party_id: partyId,
        narration_bn: type.name_bn + ' গ্রহণ' + (who ? ' — ' + who : '') +
          ' | রশিদ ' + receiptNo + (payload.purpose_bn ? ' | ' + payload.purpose_bn : ''),
        source_module: 'receipt',
        lines: [
          {
            account_id: Number(payload.cash_account_id), fund_id: fundId,
            cost_center_id: payload.cost_center_id || null,
            debit: amount, credit: 0,
            line_narration: 'রশিদ ' + receiptNo,
          },
          {
            account_id: creditAccountId, fund_id: fundId,
            cost_center_id: payload.cost_center_id || null,
            debit: 0, credit: amount,
            party_type: partyType, party_id: partyId,
            student_id: payload.student_id || null,
            sponsorship_id: sponsorshipId,
            line_narration: who || null,
          },
        ],
      }, ctx, { conn, autoPost: true });

      // ---- রশিদ ----
      const [res] = await conn.execute(
        `INSERT INTO receipts
           (receipt_no, receipt_type_id, receipt_date, fiscal_period_id,
            payer_name, payer_mobile, payer_address, student_id, donor_id,
            campaign_id, pledge_id, recurring_plan_id, sponsorship_id,
            fund_id, credit_account_id, cash_account_id, cost_center_id,
            amount, amount_in_words, payment_method, instrument_no, instrument_date,
            purpose_bn, verify_token, book_id, manual_no, voucher_id, issued_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          receiptNo, type.id, payload.receipt_date, period.id,
          who || null, payload.payer_mobile || null,
          payload.payer_address || payload.address || null,
          payload.student_id || null, donorId,
          campaignId, pledgeId, recurringPlanId, sponsorshipId,
          fundId, creditAccountId, Number(payload.cash_account_id),
          payload.cost_center_id || null,
          amount, inWords, payload.payment_method || 'cash',
          payload.instrument_no || null, payload.instrument_date || null,
          payload.purpose_bn || null, verifyToken,
          payload.book_id || null, payload.manual_no || null,
          voucher.id, ctx.userId,
        ]
      );
      const receiptId = res.insertId;

      // দুই দিক থেকেই খুঁজে পাওয়ার জন্য
      await conn.execute(`UPDATE vouchers SET receipt_id = ? WHERE id = ?`, [receiptId, voucher.id]);
      if (book) {
        await conn.execute(
          `UPDATE receipt_books SET used_count = used_count + 1 WHERE id = ?`, [book.id]);
      }
      // একই লেনদেনে প্রতিশ্রুতির অবস্থা হালনাগাদ হয় — open → partial → fulfilled
      if (pledgeId) await this.donors.recomputePledge(pledgeId, conn);

      await conn.execute(
        `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, user_id, ip_address)
         VALUES ('receipt', ?, 'issue', ?, ?, ?)`,
        [receiptId, JSON.stringify({
          receipt_no: receiptNo, amount, type: type.code, voucher_no: voucher.voucher_no,
        }), ctx.userId, ctx.ip || null]
      );

      await conn.commit();
      return {
        id: receiptId, receipt_no: receiptNo, verify_token: verifyToken,
        amount, amount_in_words: inWords,
        donor_id: donorId, donor_created: donorCreated,
        campaign_id: campaignId, pledge_id: pledgeId, recurring_plan_id: recurringPlanId,
        sponsorship_id: sponsorshipId,
        voucher_id: voucher.id, voucher_no: voucher.voucher_no, voucher_status: voucher.status,
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // =================================================================
  // বাতিল — ভাউচারও রিভার্স হয়
  // =================================================================
  async void(receiptId, reason, ctx) {
    if (!reason || !reason.trim()) throw new ReceiptError('বাতিলের কারণ লিখতে হবে।');
    if ((ROLE_RANK[ctx.role] || 0) < ROLE_RANK.chief_accountant) {
      throw new ReceiptError('রশিদ বাতিলের জন্য অন্তত প্রধান হিসাবরক্ষকের অধিকার প্রয়োজন।');
    }

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[r]] = await conn.query(`SELECT * FROM receipts WHERE id = ? FOR UPDATE`, [receiptId]);
      if (!r) throw new ReceiptError('রশিদ পাওয়া যায়নি।');
      if (r.status === 'void') throw new ReceiptError(`${r.receipt_no} আগেই বাতিল করা হয়েছে।`);

      const rev = await this.vouchers.reverse(
        r.voucher_id, 'রশিদ ' + r.receipt_no + ' বাতিল: ' + reason.trim(), ctx, { conn });

      await conn.execute(
        `UPDATE receipts
            SET status='void', void_reason=?, voided_by=?, voided_at=NOW(), reversal_voucher_id=?
          WHERE id=?`,
        [reason.trim(), ctx.userId, rev.reversal_id, receiptId]
      );
      if (r.book_id) {
        await conn.execute(
          `UPDATE receipt_books SET used_count = GREATEST(used_count - 1, 0) WHERE id = ?`,
          [r.book_id]);
      }
      // বাতিল রশিদ আর গোনা হয় না, তাই প্রতিশ্রুতি fulfilled থেকে partial-এ ফিরতে পারে
      if (r.pledge_id) await this.donors.recomputePledge(r.pledge_id, conn);

      await conn.execute(
        `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, reason, user_id, ip_address)
         VALUES ('receipt', ?, 'void', ?, ?, ?, ?)`,
        [receiptId, JSON.stringify({ receipt_no: r.receipt_no, reversal_no: rev.reversal_no }),
         reason.trim(), ctx.userId, ctx.ip || null]
      );

      await conn.commit();
      return {
        id: receiptId, receipt_no: r.receipt_no, status: 'void',
        reversal_voucher_no: rev.reversal_no,
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // =================================================================
  // যাচাই (পাবলিক — QR স্ক্যান করে)
  //   টোকেন ৩২ অক্ষরের র‍্যান্ডম, তাই অনুমান করে বের করা যায় না।
  //   মোবাইল/ঠিকানা ইচ্ছে করেই ফেরত দেওয়া হয় না।
  // =================================================================
  /**
   * রশিদ নম্বর + দাতার মোবাইল দিয়ে যাচাই।
   *
   * শুধু নম্বর দিয়ে খুঁজতে দিলে যে কেউ ক্রমিক নম্বর লিখে সব দাতার নাম ও
   * টাকার অঙ্ক বের করে ফেলতে পারত। তাই মোবাইলটাও মিলতে হয় — দাতার কাছে
   * দুটোই থাকে, বাইরের কারও কাছে থাকে না।
   *
   * মোবাইল মেলানো হয় শেষ ৯ সংখ্যা দিয়ে, যাতে ০১৭…, +৮৮০১৭… বা ৮৮০১৭…
   * যেভাবেই লেখা হোক মিলে যায়।
   */
  async verifyByNumber(receiptNo, mobile) {
    const no = String(receiptNo || '').trim().toUpperCase();
    const digits = String(mobile || '').replace(/\D/g, '');
    if (!no || digits.length < 9) return { ok: false, reason: 'input' };

    const [[r]] = await this.pool.query(
      `SELECT r.receipt_no, r.receipt_date, r.amount, r.amount_in_words, r.status,
              r.payer_name, r.purpose_bn, r.payment_method, r.void_reason,
              r.payer_mobile, d.mobile AS donor_mobile,
              rt.name_bn AS type_name, f.name_bn AS fund_name
         FROM receipts r
         JOIN receipt_types rt ON rt.id = r.receipt_type_id
         JOIN funds f ON f.id = r.fund_id
         LEFT JOIN donors d ON d.id = r.donor_id
        WHERE r.receipt_no = ?`, [no]);

    // রশিদ নেই, আর রশিদ আছে কিন্তু মোবাইল মেলেনি — দুটোতেই একই উত্তর,
    // নইলে কোন নম্বরগুলো সত্যি তা বাইরে থেকে বোঝা যেত।
    if (!r) return { ok: false, reason: 'nomatch' };

    const tail = (v) => {
      const d = String(v || '').replace(/\D/g, '');
      return d.length >= 9 ? d.slice(-9) : null;
    };
    const want = digits.slice(-9);
    const candidates = [tail(r.payer_mobile), tail(r.donor_mobile)].filter(Boolean);

    if (!candidates.length) return { ok: false, reason: 'nomobile' };
    if (!candidates.includes(want)) return { ok: false, reason: 'nomatch' };

    delete r.payer_mobile;
    delete r.donor_mobile;
    return { ok: true, receipt: r };
  }

  async verify(token) {
    if (!token || !/^[0-9a-f]{32}$/.test(String(token))) return null;
    const [[r]] = await this.pool.query(
      `SELECT r.receipt_no, r.receipt_date, r.amount, r.amount_in_words, r.status,
              r.payer_name, r.purpose_bn, r.payment_method, r.void_reason,
              rt.name_bn AS type_name, f.name_bn AS fund_name
         FROM receipts r
         JOIN receipt_types rt ON rt.id = r.receipt_type_id
         JOIN funds f ON f.id = r.fund_id
        WHERE r.verify_token = ?`, [token]);
    return r || null;
  }

  /** প্রিন্টের গণনা — প্রথমটি মূল কপি, পরেরগুলোতে 'নকল কপি' জলছাপ */
  async markPrinted(receiptId) {
    await this.pool.execute(
      `UPDATE receipts SET print_count = print_count + 1 WHERE id = ?`, [receiptId]);
    const [[r]] = await this.pool.query(`SELECT print_count FROM receipts WHERE id = ?`, [receiptId]);
    return r ? Number(r.print_count) : 0;
  }

  // =================================================================
  // ম্যানুয়াল রশিদ বই
  // =================================================================
  async assignBook(bookId, { staffId, staffName, date }, ctx) {
    const [[b]] = await this.pool.query(`SELECT * FROM receipt_books WHERE id = ?`, [bookId]);
    if (!b) throw new ReceiptError('বই পাওয়া যায়নি।');
    if (b.status === 'issued') throw new ReceiptError(`বই ${b.book_no} ইতিমধ্যে ${b.issued_to_name || '—'} কে দেওয়া আছে।`);
    if (b.status === 'lost') throw new ReceiptError(`বই ${b.book_no} হারানো হিসেবে চিহ্নিত।`);
    await this.pool.execute(
      `UPDATE receipt_books SET status='issued', issued_to=?, issued_to_name=?, issued_at=?, returned_at=NULL
        WHERE id=?`,
      [staffId || null, staffName || null, date || new Date().toISOString().slice(0, 10), bookId]);
    await this.pool.execute(
      `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, user_id)
       VALUES ('receipt_book', ?, 'assign', ?, ?)`,
      [bookId, JSON.stringify({ book_no: b.book_no, to: staffName }), ctx.userId]);
    return { id: bookId, book_no: b.book_no, status: 'issued' };
  }

  async returnBook(bookId, ctx) {
    const [[b]] = await this.pool.query(`SELECT * FROM receipt_books WHERE id = ?`, [bookId]);
    if (!b) throw new ReceiptError('বই পাওয়া যায়নি।');
    if (b.status !== 'issued') throw new ReceiptError(`বই ${b.book_no} এখন কারো কাছে নেই।`);
    await this.pool.execute(
      `UPDATE receipt_books SET status='returned', returned_at=CURDATE() WHERE id=?`, [bookId]);
    await this.pool.execute(
      `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, user_id)
       VALUES ('receipt_book', ?, 'return', ?, ?)`,
      [bookId, JSON.stringify({ book_no: b.book_no, used: b.used_count }), ctx.userId]);
    return { id: bookId, book_no: b.book_no, status: 'returned', used_count: b.used_count };
  }

  // =================================================================
  // সহায়ক
  // =================================================================
  async _nextReceiptNo(conn, type, fiscalYearId) {
    const [[seq]] = await conn.query(
      `SELECT year_token, last_no, padding FROM receipt_sequences
        WHERE receipt_type_id = ? AND fiscal_year_id = ? FOR UPDATE`,
      [type.id, fiscalYearId]);
    if (!seq) {
      throw new ReceiptError(
        `${type.name_bn} এর নম্বর সিরিজ এই আর্থিক বছরের জন্য তৈরি করা হয়নি।`);
    }
    const next = Number(seq.last_no) + 1;
    await conn.execute(
      `UPDATE receipt_sequences SET last_no = ?
        WHERE receipt_type_id = ? AND fiscal_year_id = ?`,
      [next, type.id, fiscalYearId]);
    return `${type.prefix}-${seq.year_token}-${String(next).padStart(seq.padding, '0')}`;
  }
}

module.exports = ReceiptService;
module.exports.ReceiptError = ReceiptError;

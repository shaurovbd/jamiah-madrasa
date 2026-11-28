'use strict';
/**
 * দাতা ও স্পনসর সার্ভিস
 *
 * মূল ধারণা: মোবাইল নম্বরই দাতা চেনার চাবি। রশিদ কাটার সময় নম্বর দিলে
 * পুরনো দাতা পাওয়া যায়, নইলে নতুন দাতা তৈরি হয় — কারণিককে আলাদা করে
 * "দাতা যোগ করুন" ধাপে যেতে হয় না। নম্বর না থাকলেও দাতা তৈরি হয়, শুধু
 * পরে আবার চেনা যায় না।
 */
const { takaInWords } = require('./lib/bangla-number');

class DonorError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.join(' | '));
    this.name = 'VoucherError';      // রাউটার একই আকারে ত্রুটি ফেরত দেয়
    this.errors = list;
    this.statusCode = 422;
  }
}

/** বাংলাদেশি মোবাইল নম্বর এক চেহারায় আনা: +8801711… / 8801711… / 01711… → 01711… */
function normalizeMobile(m) {
  if (!m) return null;
  let s = String(m).replace(/[^\d+]/g, '');
  s = s.replace(/^\+/, '');
  if (s.startsWith('880')) s = s.slice(3);
  if (s.startsWith('0')) s = s.slice(1);
  if (s.length === 10 && s.startsWith('1')) return '0' + s;
  // বিদেশি নম্বর: শুধু অঙ্ক রেখে দিই, তাই '+971…' আর '971…' একই দাতা হিসেবে চেনা যায়
  return s || null;
}

class DonorService {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.opt = { lapsedMonths: 6, ...options };
  }

  _db(conn) { return conn || this.pool; }

  // =================================================================
  // দাতা
  // =================================================================

  /** মোবাইল থাকলে খুঁজে নেয়, নইলে নতুন তৈরি করে। conn দিলে কলারের লেনদেনে চলে। */
  async upsertDonor(payload, ctx, conn) {
    const db = this._db(conn);
    const name = (payload.name || '').trim();
    const mobile = normalizeMobile(payload.mobile);
    if (!name) throw new DonorError('দাতার নাম লিখতে হবে।');

    if (mobile) {
      const [[found]] = await db.query(
        `SELECT * FROM donors WHERE mobile = ? LIMIT 1`, [mobile]);
      if (found) {
        // একীভূত করা দাতা হলে মূলটিতে নিয়ে যাই
        let target = found;
        if (found.merged_into_id) {
          const [[main]] = await db.query(
            `SELECT * FROM donors WHERE id = ?`, [found.merged_into_id]);
          if (main) target = main;
        }
        // যে ঘরগুলো খালি, শুধু সেগুলো ভরি — পুরনো তথ্য মুছে ফেলি না
        const fill = {};
        for (const k of ['email', 'address', 'thana', 'district', 'source_bn']) {
          if (!target[k] && payload[k]) fill[k] = payload[k];
        }
        if (Object.keys(fill).length) {
          const sets = Object.keys(fill).map((k) => k + ' = ?').join(', ');
          await db.query(`UPDATE donors SET ${sets} WHERE id = ?`,
            [...Object.values(fill), target.id]);
        }
        return { id: target.id, donor_code: target.donor_code, name: target.name, created: false };
      }
    }

    const [res] = await db.query(
      `INSERT INTO donors
         (name, donor_type, mobile, email, address, thana, district, country,
          is_expatriate, source_bn, preferred_contact, language, recognition_tier,
          notes_bn, allow_contact, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        name, payload.donor_type || 'individual', mobile,
        payload.email || null, payload.address || null,
        payload.thana || null, payload.district || null,
        payload.country || 'বাংলাদেশ',
        payload.is_expatriate ? 1 : ((payload.country && payload.country !== 'বাংলাদেশ') ? 1 : 0),
        payload.source_bn || null, payload.preferred_contact || 'sms',
        payload.language || 'bn', payload.recognition_tier || null,
        payload.notes_bn || null, payload.allow_contact === false ? 0 : 1,
        ctx && ctx.userId || null,
      ]);
    const id = res.insertId;
    const code = 'DNR-' + String(id).padStart(5, '0');
    await db.query(`UPDATE donors SET donor_code = ? WHERE id = ?`, [code, id]);
    return { id, donor_code: code, name, created: true };
  }

  async updateDonor(id, patch, ctx) {
    const allowed = ['name', 'donor_type', 'mobile', 'email', 'address', 'thana', 'district',
      'country', 'is_expatriate', 'source_bn', 'preferred_contact', 'language',
      'recognition_tier', 'notes_bn', 'allow_contact', 'is_active'];
    const sets = [], args = [];
    for (const k of allowed) {
      if (patch[k] === undefined) continue;
      sets.push(k + ' = ?');
      args.push(k === 'mobile' ? normalizeMobile(patch[k])
        : (k === 'is_expatriate' || k === 'allow_contact' || k === 'is_active')
          ? (patch[k] ? 1 : 0) : patch[k]);
    }
    if (!sets.length) throw new DonorError('বদলানোর কিছু পাওয়া যায়নি।');
    args.push(id);
    const [r] = await this.pool.query(`UPDATE donors SET ${sets.join(', ')} WHERE id = ?`, args);
    if (!r.affectedRows) throw new DonorError('দাতা পাওয়া যায়নি।');
    await this._audit('donor', id, 'update', patch, ctx);
    return this.getDonor(id);
  }

  /**
   * দুই রেকর্ড একই মানুষ হলে একীভূত করা। রশিদ, প্রতিশ্রুতি ও মাসিক পরিকল্পনা
   * রাখা রেকর্ডে চলে যায়; পুরনোটি মুছে ফেলা হয় না, চিহ্নিত হয় — ইতিহাস থাকে।
   */
  async mergeDonors(keepId, mergeId, ctx) {
    if (String(keepId) === String(mergeId)) throw new DonorError('একই দাতাকে নিজের সাথে মেলানো যায় না।');
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[keep]] = await conn.query(`SELECT * FROM donors WHERE id=? FOR UPDATE`, [keepId]);
      const [[gone]] = await conn.query(`SELECT * FROM donors WHERE id=? FOR UPDATE`, [mergeId]);
      if (!keep || !gone) throw new DonorError('দাতা পাওয়া যায়নি।');
      if (gone.merged_into_id) throw new DonorError(`${gone.name} আগেই একীভূত করা হয়েছে।`);

      const [[rc]] = await conn.query(
        `SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM receipts
          WHERE donor_id=? AND status='issued'`, [mergeId]);

      await conn.query(`UPDATE receipts SET donor_id=? WHERE donor_id=?`, [keepId, mergeId]);
      await conn.query(`UPDATE pledges SET donor_id=? WHERE donor_id=?`, [keepId, mergeId]);
      await conn.query(`UPDATE recurring_plans SET donor_id=? WHERE donor_id=?`, [keepId, mergeId]);

      // খালি ঘরগুলো ভরে নিই
      const fill = {};
      for (const k of ['mobile', 'email', 'address', 'thana', 'district', 'source_bn']) {
        if (!keep[k] && gone[k]) fill[k] = gone[k];
      }
      // মোবাইল অদ্বিতীয়, তাই পুরনোটি ছেড়ে দিতে হয়
      await conn.query(
        `UPDATE donors SET mobile = NULL, is_active = 0, merged_into_id = ?,
                notes_bn = CONCAT(COALESCE(notes_bn,''), ?)
          WHERE id = ?`,
        [keepId, `\n[${new Date().toISOString().slice(0, 10)}] ${keep.name} (${keep.donor_code}) এর সাথে একীভূত।`,
         mergeId]);
      if (Object.keys(fill).length) {
        const sets = Object.keys(fill).map((k) => k + ' = ?').join(', ');
        await conn.query(`UPDATE donors SET ${sets} WHERE id = ?`, [...Object.values(fill), keepId]);
      }

      await conn.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, user_id)
         VALUES ('donor', ?, 'merge', ?, ?)`,
        [keepId, JSON.stringify({
          merged: gone.donor_code, merged_name: gone.name,
          moved_receipts: Number(rc.n), moved_amount: Number(rc.s),
        }), ctx && ctx.userId || null]);

      await conn.commit();
      return {
        keep_id: Number(keepId), merged_id: Number(mergeId),
        moved_receipts: Number(rc.n), moved_amount: Number(rc.s),
      };
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async getDonor(id) {
    const [[d]] = await this.pool.query(`SELECT * FROM v_donor_summary WHERE donor_id = ?`, [id]);
    if (!d) return null;
    const [[raw]] = await this.pool.query(`SELECT * FROM donors WHERE id = ?`, [id]);
    const [receipts] = await this.pool.query(
      `SELECT id, receipt_no, receipt_date, type_name, fund_name, amount, status, payment_method
         FROM v_receipt_list WHERE donor_id = ? ORDER BY receipt_date DESC, id DESC LIMIT 50`, [id]);
    const [pledges] = await this.pool.query(
      `SELECT * FROM v_pledge_status WHERE donor_id = ? ORDER BY pledged_date DESC`, [id]);
    const [plans] = await this.pool.query(
      `SELECT rp.*, rt.name_bn AS type_name, f.name_bn AS fund_name
         FROM recurring_plans rp
         JOIN receipt_types rt ON rt.id = rp.receipt_type_id
         JOIN funds f ON f.id = rp.fund_id
        WHERE rp.donor_id = ? ORDER BY rp.status, rp.id`, [id]);
    const [byType] = await this.pool.query(
      `SELECT rt.name_bn AS type_name, COUNT(*) n, SUM(r.amount) total
         FROM receipts r JOIN receipt_types rt ON rt.id = r.receipt_type_id
        WHERE r.donor_id = ? AND r.status = 'issued'
        GROUP BY rt.name_bn ORDER BY total DESC`, [id]);
    return { donor: { ...raw, ...d }, receipts, pledges, plans, byType };
  }

  async searchDonors(q = {}) {
    const where = ['d.merged_into_id IS NULL'], args = [];
    if (q.q) {
      where.push('(d.name LIKE ? OR d.mobile LIKE ? OR d.donor_code LIKE ?)');
      const s = '%' + q.q + '%';
      args.push(s, s, s);
    }
    if (q.district) { where.push('d.district = ?'); args.push(q.district); }
    if (q.country)  { where.push('d.country = ?'); args.push(q.country); }
    if (q.expat === true || q.expat === 'true') where.push('d.is_expatriate = 1');
    if (q.tier) { where.push('d.recognition_tier = ?'); args.push(q.tier); }
    if (q.active === false || q.active === 'false') where.push('d.is_active = 0');

    const order = ({
      total: 's.total_given DESC',
      recent: 's.last_gift_date IS NULL, s.last_gift_date DESC',
      name: 'd.name ASC',
    })[q.sort] || 's.total_given DESC';
    const limit = Math.min(Number(q.limit) || 50, 200);

    const [rows] = await this.pool.query(
      `SELECT s.* FROM v_donor_summary s JOIN donors d ON d.id = s.donor_id
        WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`, [...args, limit]);
    return rows;
  }

  // =================================================================
  // রিপোর্ট
  // =================================================================

  /**
   * নিষ্ক্রিয় দাতা — আগে দিয়েছেন, কিন্তু কয়েক মাস ধরে দিচ্ছেন না।
   * ফান্ডরেইজিংয়ে এটাই সবচেয়ে কাজের তালিকা: নতুন দাতা খোঁজার চেয়ে
   * পুরনো দাতাকে ফিরিয়ে আনা অনেক সহজ।
   */
  async lapsedDonors(q = {}) {
    const months = Number(q.months) || this.opt.lapsedMonths;
    const minTotal = Number(q.minTotal) || 0;
    const limit = Math.min(Number(q.limit) || 100, 500);
    const [rows] = await this.pool.query(
      `SELECT * FROM v_donor_summary
        WHERE merged_into_id IS NULL AND is_active = 1 AND allow_contact = 1
          AND last_gift_date IS NOT NULL
          AND months_since_last >= ?
          AND total_given >= ?
        ORDER BY total_given DESC LIMIT ?`, [months, minTotal, limit]);
    return { months, minTotal, rows };
  }

  async topDonors(q = {}) {
    const where = ["r.status = 'issued'", 'r.donor_id IS NOT NULL'], args = [];
    if (q.from) { where.push('r.receipt_date >= ?'); args.push(q.from); }
    if (q.to)   { where.push('r.receipt_date <= ?'); args.push(q.to); }
    const limit = Math.min(Number(q.limit) || 10, 100);
    const [rows] = await this.pool.query(
      `SELECT d.id AS donor_id, d.donor_code, d.name, d.mobile, d.district, d.country,
              d.is_expatriate, COUNT(*) AS gift_count, SUM(r.amount) AS total_given,
              MAX(r.receipt_date) AS last_gift_date
         FROM receipts r JOIN donors d ON d.id = r.donor_id
        WHERE ${where.join(' AND ')}
        GROUP BY d.id, d.donor_code, d.name, d.mobile, d.district, d.country, d.is_expatriate
        ORDER BY total_given DESC LIMIT ?`, [...args, limit]);
    return rows;
  }

  /** মাস-ওয়ারি তুলনা — এ বছর বনাম গত বছর */
  async monthlyTrend(year) {
    const y = Number(year) || new Date().getFullYear();
    const [rows] = await this.pool.query(
      `SELECT mn,
              SUM(CASE WHEN yr = ? THEN total_amount ELSE 0 END) AS this_year,
              SUM(CASE WHEN yr = ? THEN total_amount ELSE 0 END) AS last_year,
              SUM(CASE WHEN yr = ? THEN receipt_count ELSE 0 END) AS this_year_count
         FROM v_donation_monthly WHERE yr IN (?, ?)
        GROUP BY mn ORDER BY mn`, [y, y - 1, y, y, y - 1]);
    return { year: y, rows };
  }

  async areaReport() {
    const [rows] = await this.pool.query(
      `SELECT * FROM v_donation_by_area WHERE total_amount > 0
        ORDER BY total_amount DESC`);
    return rows;
  }

  /** বার্ষিক বিবরণী — দাতাকে পাঠানোর জন্য "আপনার টাকা কোথায় গেল" */
  async statement(donorId, q = {}) {
    const from = q.from || (new Date().getFullYear() + '-01-01');
    const to = q.to || (new Date().getFullYear() + '-12-31');
    const [[d]] = await this.pool.query(`SELECT * FROM v_donor_summary WHERE donor_id = ?`, [donorId]);
    if (!d) return null;
    const [rows] = await this.pool.query(
      `SELECT r.receipt_no, r.receipt_date, rt.name_bn AS type_name,
              f.name_bn AS fund_name, c.title_bn AS campaign_title,
              r.amount, r.purpose_bn, r.payment_method
         FROM receipts r
         JOIN receipt_types rt ON rt.id = r.receipt_type_id
         JOIN funds f ON f.id = r.fund_id
         LEFT JOIN campaigns c ON c.id = r.campaign_id
        WHERE r.donor_id = ? AND r.status = 'issued'
          AND r.receipt_date BETWEEN ? AND ?
        ORDER BY r.receipt_date, r.id`, [donorId, from, to]);
    const [byFund] = await this.pool.query(
      `SELECT f.name_bn AS fund_name, SUM(r.amount) total
         FROM receipts r JOIN funds f ON f.id = r.fund_id
        WHERE r.donor_id = ? AND r.status = 'issued' AND r.receipt_date BETWEEN ? AND ?
        GROUP BY f.name_bn ORDER BY total DESC`, [donorId, from, to]);
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    return {
      donor: d, from, to, rows, byFund,
      total, total_in_words: takaInWords(total),
    };
  }

  // =================================================================
  // প্রচারাভিযান
  // =================================================================
  async createCampaign(p, ctx) {
    if (!p.code || !p.title_bn) throw new DonorError('কোড ও শিরোনাম দিতে হবে।');
    if (!p.fund_id) throw new DonorError('ফান্ড নির্বাচন করুন।');
    const [r] = await this.pool.query(
      `INSERT INTO campaigns (code, title_bn, description_bn, fund_id, receipt_type_id,
         target_amount, start_date, end_date, is_public, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [p.code.trim(), p.title_bn.trim(), p.description_bn || null, p.fund_id,
       p.receipt_type_id || null, Number(p.target_amount) || 0,
       p.start_date || null, p.end_date || null, p.is_public ? 1 : 0,
       p.status || 'active', ctx && ctx.userId || null]);
    await this._audit('campaign', r.insertId, 'create', { code: p.code }, ctx);
    return this.getCampaign(r.insertId);
  }

  async getCampaign(id) {
    const [[c]] = await this.pool.query(
      `SELECT * FROM v_campaign_progress WHERE campaign_id = ?`, [id]);
    if (!c) return null;
    const [recent] = await this.pool.query(
      `SELECT r.id, r.receipt_no, r.receipt_date, r.amount, r.payer_name,
              d.id AS donor_id, d.donor_code, d.name AS donor_name
         FROM receipts r LEFT JOIN donors d ON d.id = r.donor_id
        WHERE r.campaign_id = ? AND r.status = 'issued'
        ORDER BY r.receipt_date DESC, r.id DESC LIMIT 20`, [id]);
    const [pledges] = await this.pool.query(
      `SELECT * FROM v_pledge_status WHERE campaign_id = ? ORDER BY outstanding DESC`, [id]);
    return { campaign: c, recent, pledges };
  }

  async listCampaigns(q = {}) {
    const where = [], args = [];
    if (q.status) { where.push('status = ?'); args.push(q.status); }
    if (q.public === true || q.public === 'true') where.push('is_public = 1');
    const [rows] = await this.pool.query(
      `SELECT * FROM v_campaign_progress
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY FIELD(status,'active','draft','closed'), end_date IS NULL, end_date`, args);
    return rows;
  }

  async updateCampaign(id, patch, ctx) {
    const allowed = ['title_bn', 'description_bn', 'target_amount', 'start_date',
      'end_date', 'is_public', 'status', 'fund_id', 'receipt_type_id'];
    const sets = [], args = [];
    for (const k of allowed) {
      if (patch[k] === undefined) continue;
      sets.push(k + ' = ?');
      args.push(k === 'is_public' ? (patch[k] ? 1 : 0) : patch[k]);
    }
    if (!sets.length) throw new DonorError('বদলানোর কিছু পাওয়া যায়নি।');
    args.push(id);
    const [r] = await this.pool.query(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`, args);
    if (!r.affectedRows) throw new DonorError('প্রচারাভিযান পাওয়া যায়নি।');
    await this._audit('campaign', id, 'update', patch, ctx);
    return this.getCampaign(id);
  }

  // =================================================================
  // প্রতিশ্রুতি
  // =================================================================
  async createPledge(p, ctx) {
    const errors = [];
    if (!p.donor_id) errors.push('দাতা নির্বাচন করুন।');
    if (!(Number(p.amount) > 0)) errors.push('প্রতিশ্রুত পরিমাণ লিখুন।');
    if (!p.fund_id) errors.push('ফান্ড নির্বাচন করুন।');
    if (errors.length) throw new DonorError(errors);

    const [r] = await this.pool.query(
      `INSERT INTO pledges (donor_id, campaign_id, fund_id, amount, pledged_date,
         due_date, purpose_bn, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [p.donor_id, p.campaign_id || null, p.fund_id, Number(p.amount),
       p.pledged_date || new Date().toISOString().slice(0, 10),
       p.due_date || null, p.purpose_bn || null, ctx && ctx.userId || null]);
    await this._audit('pledge', r.insertId, 'create',
      { donor_id: p.donor_id, amount: p.amount }, ctx);
    const [[out]] = await this.pool.query(`SELECT * FROM v_pledge_status WHERE pledge_id = ?`, [r.insertId]);
    return out;
  }

  /** রশিদ এলে প্রতিশ্রুতির অবস্থা নতুন করে হিসাব হয়। receipt-service এটাই ডাকে। */
  async recomputePledge(pledgeId, conn) {
    const db = this._db(conn);
    const [[p]] = await db.query(
      `SELECT p.amount, p.status,
              COALESCE((SELECT SUM(amount) FROM receipts
                         WHERE pledge_id = p.id AND status = 'issued'), 0) AS received
         FROM pledges p WHERE p.id = ?`, [pledgeId]);
    if (!p) return null;
    if (p.status === 'cancelled') return p.status;
    const received = Number(p.received), amount = Number(p.amount);
    const status = received >= amount ? 'fulfilled' : received > 0 ? 'partial' : 'open';
    if (status !== p.status) {
      await db.query(`UPDATE pledges SET status = ? WHERE id = ?`, [status, pledgeId]);
    }
    return status;
  }

  async cancelPledge(id, reason, ctx) {
    if (!reason || !reason.trim()) throw new DonorError('বাতিলের কারণ লিখতে হবে।');
    const [[p]] = await this.pool.query(`SELECT * FROM v_pledge_status WHERE pledge_id = ?`, [id]);
    if (!p) throw new DonorError('প্রতিশ্রুতি পাওয়া যায়নি।');
    if (p.status === 'fulfilled') throw new DonorError('পূর্ণ হওয়া প্রতিশ্রুতি বাতিল করা যায় না।');
    if (p.status === 'cancelled') throw new DonorError('আগেই বাতিল করা হয়েছে।');
    await this.pool.query(
      `UPDATE pledges SET status='cancelled', cancel_reason=? WHERE id=?`, [reason.trim(), id]);
    await this._audit('pledge', id, 'cancel', { received: p.received }, ctx, reason.trim());
    return { id: Number(id), status: 'cancelled', received: Number(p.received) };
  }

  /** ফলো-আপের তালিকা — বাকি আছে এমন প্রতিশ্রুতি, মেয়াদ পেরোনো আগে */
  async pledgeFollowUps(q = {}) {
    const where = ["p.status IN ('open','partial')", 'd.allow_contact = 1'], args = [];
    if (q.overdue === true || q.overdue === 'true') {
      where.push('p.due_date IS NOT NULL AND p.due_date < CURDATE()');
    }
    if (q.campaign_id) { where.push('p.campaign_id = ?'); args.push(q.campaign_id); }
    const [rows] = await this.pool.query(
      `SELECT ps.* FROM v_pledge_status ps
         JOIN pledges p ON p.id = ps.pledge_id
         JOIN donors d ON d.id = p.donor_id
        WHERE ${where.join(' AND ')}
        ORDER BY ps.days_to_due IS NULL, ps.days_to_due ASC, ps.outstanding DESC`, args);
    return rows;
  }

  async markReminded(pledgeId, ctx) {
    const [r] = await this.pool.query(
      `UPDATE pledges SET last_reminded_at = CURDATE(), reminder_count = reminder_count + 1
        WHERE id = ? AND status IN ('open','partial')`, [pledgeId]);
    if (!r.affectedRows) throw new DonorError('প্রতিশ্রুতিটি খোলা নেই।');
    await this._audit('pledge', pledgeId, 'remind', {}, ctx);
    const [[out]] = await this.pool.query(`SELECT * FROM v_pledge_status WHERE pledge_id = ?`, [pledgeId]);
    return out;
  }

  // =================================================================
  // মাসিক নিয়মিত দাতা
  // =================================================================
  async createRecurring(p, ctx) {
    const errors = [];
    if (!p.donor_id) errors.push('দাতা নির্বাচন করুন।');
    if (!p.receipt_type_id) errors.push('রশিদের ধরন নির্বাচন করুন।');
    if (!p.fund_id) errors.push('ফান্ড নির্বাচন করুন।');
    if (!(Number(p.amount) > 0)) errors.push('মাসিক পরিমাণ লিখুন।');
    const day = Number(p.day_of_month) || 1;
    if (day < 1 || day > 28) errors.push('মাসের তারিখ ১ থেকে ২৮ এর মধ্যে দিন।');
    if (errors.length) throw new DonorError(errors);

    const [r] = await this.pool.query(
      `INSERT INTO recurring_plans (donor_id, receipt_type_id, fund_id, campaign_id,
         sponsorship_id, amount, day_of_month, start_date, end_date, note_bn, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [p.donor_id, p.receipt_type_id, p.fund_id, p.campaign_id || null,
       p.sponsorship_id || null, Number(p.amount), day,
       p.start_date || new Date().toISOString().slice(0, 10),
       p.end_date || null, p.note_bn || null, ctx && ctx.userId || null]);
    await this._audit('recurring_plan', r.insertId, 'create',
      { donor_id: p.donor_id, amount: p.amount, day }, ctx);
    return { id: r.insertId, status: 'active' };
  }

  async setRecurringStatus(id, status, ctx) {
    if (!['active', 'paused', 'ended'].includes(status)) throw new DonorError('অবস্থা ভুল।');
    const [r] = await this.pool.query(`UPDATE recurring_plans SET status=? WHERE id=?`, [status, id]);
    if (!r.affectedRows) throw new DonorError('পরিকল্পনা পাওয়া যায়নি।');
    await this._audit('recurring_plan', id, 'status', { status }, ctx);
    return { id: Number(id), status };
  }

  /**
   * এ মাসে যাঁদের কাছ থেকে টাকা আসার কথা ছিল কিন্তু আসেনি।
   * তারিখ প্যারামিটার নেয়, তাই পরীক্ষা করা যায় আর "আজ" এর ওপর নির্ভর করে না।
   */
  async recurringDue(dateStr) {
    const date = dateStr || new Date().toISOString().slice(0, 10);
    const [rows] = await this.pool.query(
      `SELECT rp.id AS plan_id, rp.amount, rp.day_of_month, rp.note_bn,
              d.id AS donor_id, d.donor_code, d.name AS donor_name, d.mobile,
              d.preferred_contact, d.allow_contact,
              rt.code AS type_code, rt.name_bn AS type_name,
              f.id AS fund_id, f.name_bn AS fund_name,
              rp.receipt_type_id, rp.campaign_id, rp.sponsorship_id,
              DAY(?) - rp.day_of_month AS days_overdue
         FROM recurring_plans rp
         JOIN donors d ON d.id = rp.donor_id
         JOIN receipt_types rt ON rt.id = rp.receipt_type_id
         JOIN funds f ON f.id = rp.fund_id
        WHERE rp.status = 'active'
          AND rp.start_date <= ?
          AND (rp.end_date IS NULL OR rp.end_date >= ?)
          AND rp.day_of_month <= DAY(?)
          AND NOT EXISTS (
            SELECT 1 FROM receipts r
             WHERE r.recurring_plan_id = rp.id AND r.status = 'issued'
               AND YEAR(r.receipt_date) = YEAR(?) AND MONTH(r.receipt_date) = MONTH(?)
          )
        ORDER BY days_overdue DESC, rp.amount DESC`,
      [date, date, date, date, date, date]);
    return { date, rows };
  }

  // =================================================================
  async _audit(entity, id, action, data, ctx, reason) {
    await this.pool.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, reason, user_id, ip_address)
       VALUES (?,?,?,?,?,?,?)`,
      [entity, id, action, JSON.stringify(data || {}), reason || null,
       ctx && ctx.userId || null, ctx && ctx.ip || null]);
  }
}

module.exports = DonorService;
module.exports.DonorError = DonorError;
module.exports.normalizeMobile = normalizeMobile;

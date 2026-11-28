'use strict';
/**
 * এতিম স্পনসর সার্ভিস
 *
 * এই ফাইলের সবচেয়ে গুরুত্বপূর্ণ অংশ `_safeChild()` — দাতার কাছে কী যাবে তার
 * একমাত্র দরজা। এটি **হোয়াইটলিস্ট**: যে ঘরগুলো এখানে স্পষ্টভাবে লেখা নেই,
 * সেগুলো কখনো বেরোয় না। নতুন কলাম যোগ করলেও আপনাআপনি ফাঁস হবে না।
 *
 * দাতার কাছে যায় না: পুরো নাম (নিয়ম না বললে), বাবা-মার নাম, অভিভাবকের নাম ও
 * মোবাইল, বাড়ির ঠিকানা, থানা, যাচাইয়ের কাগজ, প্রাতিষ্ঠানিক নোট, student_id।
 * জেলা পর্যন্ত দেখানো হয় — এর নিচে নয়।
 */
const { takaInWords } = require('./lib/bangla-number');

const ORPHAN_STATUS_BN = {
  father_deceased: 'পিতৃহীন',
  mother_deceased: 'মাতৃহীন',
  both_deceased: 'পিতা-মাতা উভয়হীন',
  abandoned: 'পরিত্যক্ত',
  extreme_poverty: 'অতিদরিদ্র',
};

const FREQ_MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
const FREQ_BN = {
  monthly: 'মাসিক', quarterly: 'ত্রৈমাসিক',
  half_yearly: 'ষাণ্মাসিক', yearly: 'বার্ষিক',
};
const ROLE_RANK = { accountant: 1, chief_accountant: 2, principal: 3, committee: 4 };

class OrphanError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.join(' | '));
    this.name = 'VoucherError';
    this.errors = list;
    this.statusCode = 422;
  }
}

class OrphanService {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.opt = { showDistrictToDonor: true, ...options };
  }

  // =================================================================
  // দাতার কাছে যা যায় — একমাত্র দরজা
  // =================================================================

  /** নিয়ম অনুযায়ী দাতাকে দেখানোর নাম */
  _donorName(o) {
    if (o.display_name) return o.display_name;
    const full = String(o.full_name || '').trim();
    if (o.name_display === 'full') return full;
    if (o.name_display === 'code_only') return o.orphan_code || 'শিক্ষার্থী';
    return full.split(/\s+/)[0] || (o.orphan_code || 'শিক্ষার্থী');  // first_only
  }

  /**
   * হোয়াইটলিস্ট। এখানে না থাকলে দাতার কাছে যায় না।
   * ছবি শুধু সম্মতি থাকলে — none হলে কোনো পথ ফেরত যায় না।
   */
  _safeChild(o) {
    const photoOk = o.photo_consent === 'sponsor_only' || o.photo_consent === 'public';
    const out = {
      orphan_code: o.orphan_code,
      name: this._donorName(o),
      age_years: o.age_years != null ? Number(o.age_years) : null,
      gender: o.gender === 'female' ? 'মেয়ে' : 'ছেলে',
      orphan_status: ORPHAN_STATUS_BN[o.orphan_status] || null,
      class_name: o.class_name || null,
      department: o.department_name || null,
      enrolled_date: o.enrolled_date || null,
      monthly_need: o.monthly_need != null ? Number(o.monthly_need) : null,
      health_note: o.health_note_bn || null,
      special_needs: o.special_needs_bn || null,
      photo: photoOk && o.photo_path ? o.photo_path : null,
      photo_available: !!(photoOk && o.photo_path),
    };
    if (this.opt.showDistrictToDonor) out.district = o.district || null;
    return out;
  }

  /** প্রগ্রেস রিপোর্টও হোয়াইটলিস্ট দিয়েই যায় */
  _safeReport(r, photoOk) {
    return {
      period: r.period_label,
      period_start: r.period_start,
      period_end: r.period_end,
      attendance_pct: r.attendance_pct != null ? Number(r.attendance_pct) : null,
      exam_result: r.exam_result_bn || null,
      hifz_progress: r.hifz_progress_bn || null,
      health_note: r.health_note_bn || null,
      teacher_comment: r.teacher_comment_bn || null,
      photo: photoOk && r.photo_path ? r.photo_path : null,
      child_letter: photoOk && r.child_letter_path ? r.child_letter_path : null,
      published_at: r.published_at,
    };
  }

  /** একটি স্পনসরশিপের দাতা-দৃশ্যমান পূর্ণ রিপোর্ট */
  async sponsorReport(sponsorshipId) {
    const [[sp]] = await this.pool.query(
      `SELECT * FROM v_sponsorship_status WHERE sponsorship_id = ?`, [sponsorshipId]);
    if (!sp) return null;
    const [[o]] = await this.pool.query(
      `SELECT * FROM v_orphan_summary WHERE orphan_id = ?`, [sp.orphan_id]);
    const [reports] = await this.pool.query(
      `SELECT * FROM orphan_progress_reports
        WHERE orphan_id = ? AND status = 'published'
        ORDER BY period_end DESC LIMIT 8`, [sp.orphan_id]);
    const [payments] = await this.pool.query(
      `SELECT receipt_no, receipt_date, amount FROM receipts
        WHERE sponsorship_id = ? AND status = 'issued'
        ORDER BY receipt_date DESC LIMIT 24`, [sponsorshipId]);

    const photoOk = o.photo_consent === 'sponsor_only' || o.photo_consent === 'public';
    const total = payments.reduce((s, p) => s + Number(p.amount), 0);

    return {
      sponsorship: {
        code: sp.sponsorship_code,
        monthly_amount: Number(sp.monthly_amount),
        start_date: sp.start_date,
        end_date: sp.end_date,
        status: sp.status,
        months_running: sp.months_running,
        report_frequency: FREQ_BN[sp.report_frequency] || sp.report_frequency,
      },
      donor: { name: sp.donor_name, code: sp.donor_code },   // দাতার নিজের তথ্য
      child: this._safeChild(o),
      reports: reports.map((r) => this._safeReport(r, photoOk)),
      payments: payments.map((p) => ({
        receipt_no: p.receipt_no, date: p.receipt_date, amount: Number(p.amount),
      })),
      total_paid: total,
      total_paid_in_words: takaInWords(total),
    };
  }

  /** এক দাতার সব স্পনসরশিপ — দাতার পোর্টালের জন্য */
  async donorSponsorships(donorId) {
    const [rows] = await this.pool.query(
      `SELECT sponsorship_id FROM v_sponsorship_status
        WHERE donor_id = ? ORDER BY FIELD(status,'active','paused','ended'), start_date`,
      [donorId]);
    const out = [];
    for (const r of rows) out.push(await this.sponsorReport(r.sponsorship_id));
    return out;
  }

  // =================================================================
  // এতিমের নথি (প্রাতিষ্ঠানিক)
  // =================================================================
  async createOrphan(p, ctx) {
    const errors = [];
    if (!(p.full_name || '').trim()) errors.push('শিশুর পুরো নাম লিখতে হবে।');
    if (!p.orphan_status) errors.push('অবস্থা নির্বাচন করুন (পিতৃহীন / মাতৃহীন / উভয়হীন …)।');
    if (p.photo_consent && p.photo_consent !== 'none' && !(p.consent_by || '').trim()) {
      errors.push('ছবি ব্যবহারের সম্মতি কে দিয়েছেন, তা লিখতে হবে।');
    }
    if (errors.length) throw new OrphanError(errors);

    const [r] = await this.pool.query(
      `INSERT INTO orphans
         (student_id, full_name, display_name, name_display, date_of_birth, gender,
          orphan_status, father_name, father_death_date, mother_name, mother_death_date,
          guardian_name, guardian_relation, guardian_mobile, guardian_address,
          thana, district, sibling_count, enrolled_date, class_name, cost_center_id,
          need_food, need_lodging, need_clothing, need_books, need_medical, need_other,
          photo_path, photo_consent, consent_by, consent_date, consent_note,
          health_note_bn, special_needs_bn, notes_bn, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        p.student_id || null, p.full_name.trim(), p.display_name || null,
        p.name_display || 'first_only', p.date_of_birth || null, p.gender || 'male',
        p.orphan_status, p.father_name || null, p.father_death_date || null,
        p.mother_name || null, p.mother_death_date || null,
        p.guardian_name || null, p.guardian_relation || null,
        p.guardian_mobile || null, p.guardian_address || null,
        p.thana || null, p.district || null, p.sibling_count || null,
        p.enrolled_date || null, p.class_name || null, p.cost_center_id || null,
        Number(p.need_food) || 0, Number(p.need_lodging) || 0, Number(p.need_clothing) || 0,
        Number(p.need_books) || 0, Number(p.need_medical) || 0, Number(p.need_other) || 0,
        p.photo_path || null, p.photo_consent || 'none', p.consent_by || null,
        p.consent_date || null, p.consent_note || null,
        p.health_note_bn || null, p.special_needs_bn || null, p.notes_bn || null,
        ctx && ctx.userId || null,
      ]);
    const id = r.insertId;
    const code = 'ORF-' + String(id).padStart(4, '0');
    await this.pool.query(`UPDATE orphans SET orphan_code = ? WHERE id = ?`, [code, id]);
    await this._audit('orphan', id, 'create', { code, name: p.full_name }, ctx);
    return { id, orphan_code: code };
  }

  async updateOrphan(id, patch, ctx) {
    const allowed = ['student_id', 'full_name', 'display_name', 'name_display',
      'date_of_birth', 'gender', 'orphan_status', 'father_name', 'father_death_date',
      'mother_name', 'mother_death_date', 'guardian_name', 'guardian_relation',
      'guardian_mobile', 'guardian_address', 'thana', 'district', 'sibling_count',
      'enrolled_date', 'class_name', 'cost_center_id', 'need_food', 'need_lodging',
      'need_clothing', 'need_books', 'need_medical', 'need_other',
      'health_note_bn', 'special_needs_bn', 'notes_bn', 'status', 'status_note'];
    const sets = [], args = [];
    for (const k of allowed) {
      if (patch[k] === undefined) continue;
      sets.push(k + ' = ?'); args.push(patch[k]);
    }
    if (!sets.length) throw new OrphanError('বদলানোর কিছু পাওয়া যায়নি।');
    args.push(id);
    const [r] = await this.pool.query(`UPDATE orphans SET ${sets.join(', ')} WHERE id = ?`, args);
    if (!r.affectedRows) throw new OrphanError('শিশুর নথি পাওয়া যায়নি।');
    await this._audit('orphan', id, 'update', Object.keys(patch), ctx);
    return this.getOrphan(id);
  }

  /**
   * ছবির সম্মতি — আলাদা পথ, কারণ এটি সাধারণ সম্পাদনা নয়।
   * সম্মতি তুলে নিলে ছবি সাথে সাথেই সব জায়গা থেকে অদৃশ্য হয়।
   */
  async setPhotoConsent(id, { level, by, date, note }, ctx) {
    if (!['none', 'sponsor_only', 'public'].includes(level)) {
      throw new OrphanError('সম্মতির স্তর ভুল (none / sponsor_only / public)।');
    }
    if (level !== 'none' && !(by || '').trim()) {
      throw new OrphanError('কে সম্মতি দিয়েছেন, তা লিখতে হবে (অভিভাবক / মুহতামিম)।');
    }
    if (level === 'public' && (ROLE_RANK[ctx && ctx.role] || 0) < ROLE_RANK.principal) {
      throw new OrphanError('ওয়েবসাইটে ছবি দেখানোর সম্মতি শুধু মুহতামিম দিতে পারেন।');
    }
    const [r] = await this.pool.query(
      `UPDATE orphans SET photo_consent=?, consent_by=?, consent_date=?, consent_note=?
        WHERE id=?`,
      [level, level === 'none' ? null : by.trim(),
       level === 'none' ? null : (date || new Date().toISOString().slice(0, 10)),
       note || null, id]);
    if (!r.affectedRows) throw new OrphanError('শিশুর নথি পাওয়া যায়নি।');
    await this._audit('orphan', id, 'photo_consent', { level, by }, ctx, note);
    return { id: Number(id), photo_consent: level };
  }

  async verifyOrphan(id, ctx) {
    if ((ROLE_RANK[ctx && ctx.role] || 0) < ROLE_RANK.principal) {
      throw new OrphanError('যাচাই অনুমোদন শুধু মুহতামিম করতে পারেন।');
    }
    const [[docs]] = await this.pool.query(
      `SELECT COUNT(*) n FROM orphan_documents
        WHERE orphan_id = ? AND doc_type IN ('death_certificate','chairman_certificate')`, [id]);
    if (!Number(docs.n)) {
      throw new OrphanError('যাচাইয়ের আগে মৃত্যু সনদ বা চেয়ারম্যান সার্টিফিকেট আপলোড করতে হবে।');
    }
    const [r] = await this.pool.query(
      `UPDATE orphans SET verification_status='verified', verified_by=?, verified_at=NOW(),
              reject_reason=NULL WHERE id=?`, [ctx.userId, id]);
    if (!r.affectedRows) throw new OrphanError('শিশুর নথি পাওয়া যায়নি।');
    await this._audit('orphan', id, 'verify', {}, ctx);
    return { id: Number(id), verification_status: 'verified' };
  }

  async rejectOrphan(id, reason, ctx) {
    if (!(reason || '').trim()) throw new OrphanError('কারণ লিখতে হবে।');
    await this.pool.query(
      `UPDATE orphans SET verification_status='rejected', reject_reason=? WHERE id=?`,
      [reason.trim(), id]);
    await this._audit('orphan', id, 'reject', {}, ctx, reason.trim());
    return { id: Number(id), verification_status: 'rejected' };
  }

  async addDocument(orphanId, doc, ctx) {
    if (!doc.file_path || !doc.file_name) throw new OrphanError('ফাইলের তথ্য অসম্পূর্ণ।');
    const [r] = await this.pool.query(
      `INSERT INTO orphan_documents
         (orphan_id, doc_type, file_path, file_name, mime_type, file_size,
          is_sensitive, note_bn, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [orphanId, doc.doc_type || 'other', doc.file_path, doc.file_name,
       doc.mime_type || null, doc.file_size || null,
       doc.is_sensitive === false ? 0 : 1, doc.note_bn || null,
       ctx && ctx.userId || null]);
    await this._audit('orphan', orphanId, 'add_document', { doc_type: doc.doc_type }, ctx);
    return { id: r.insertId };
  }

  /** প্রাতিষ্ঠানিক পূর্ণ নথি — শুধু অ্যাডমিন পেজে */
  async getOrphan(id) {
    const [[o]] = await this.pool.query(`SELECT * FROM v_orphan_summary WHERE orphan_id = ?`, [id]);
    if (!o) return null;
    const [[raw]] = await this.pool.query(`SELECT * FROM orphans WHERE id = ?`, [id]);
    const [sponsorships] = await this.pool.query(
      `SELECT * FROM v_sponsorship_status WHERE orphan_id = ?
        ORDER BY FIELD(status,'active','paused','ended'), start_date`, [id]);
    const [documents] = await this.pool.query(
      `SELECT id, doc_type, file_name, is_sensitive, note_bn, uploaded_at
         FROM orphan_documents WHERE orphan_id = ? ORDER BY uploaded_at DESC`, [id]);
    const [reports] = await this.pool.query(
      `SELECT * FROM orphan_progress_reports WHERE orphan_id = ?
        ORDER BY period_end DESC`, [id]);
    const [visits] = await this.pool.query(
      `SELECT v.*, d.name AS donor_name FROM orphan_visits v
         LEFT JOIN donors d ON d.id = v.donor_id
        WHERE v.orphan_id = ? ORDER BY v.visit_date DESC`, [id]);
    return { orphan: { ...raw, ...o }, sponsorships, documents, reports, visits };
  }

  async searchOrphans(q = {}) {
    const where = [], args = [];
    if (q.q) {
      where.push('(full_name LIKE ? OR orphan_code LIKE ? OR class_name LIKE ?)');
      const s = '%' + q.q + '%'; args.push(s, s, s);
    }
    if (q.status) { where.push('status = ?'); args.push(q.status); }
    else where.push("status = 'active'");
    if (q.verification) { where.push('verification_status = ?'); args.push(q.verification); }
    if (q.department) { where.push('department_code = ?'); args.push(q.department); }
    if (q.unsponsored === true || q.unsponsored === 'true') where.push('sponsor_count = 0');
    if (q.gap === true || q.gap === 'true') where.push('gap_monthly > 0');
    const order = ({
      gap: 'gap_monthly DESC',
      name: 'full_name ASC',
      report: 'months_since_report IS NULL DESC, months_since_report DESC',
    })[q.sort] || 'gap_monthly DESC, orphan_code';
    const [rows] = await this.pool.query(
      `SELECT * FROM v_orphan_summary
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY ${order} LIMIT ?`, [...args, Math.min(Number(q.limit) || 100, 500)]);
    return rows;
  }

  /** অসম্পৃক্ত পুল — যাদের স্পনসর দরকার। ঘাটতি বেশি যার, আগে তার নাম। */
  async unsponsoredPool() {
    const [rows] = await this.pool.query(
      `SELECT * FROM v_unsponsored_pool ORDER BY sponsor_count, gap_monthly DESC`);
    const [[tot]] = await this.pool.query(
      `SELECT COUNT(*) n, COALESCE(SUM(gap_monthly),0) gap FROM v_unsponsored_pool`);
    return { rows, count: Number(tot.n), total_gap: Number(tot.gap) };
  }

  // =================================================================
  // স্পনসরশিপ
  // =================================================================
  async createSponsorship(p, ctx) {
    const errors = [];
    if (!p.orphan_id) errors.push('শিশু নির্বাচন করুন।');
    if (!p.donor_id) errors.push('দাতা নির্বাচন করুন।');
    if (!(Number(p.monthly_amount) > 0)) errors.push('মাসিক পরিমাণ লিখুন।');
    if (errors.length) throw new OrphanError(errors);

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[o]] = await conn.query(
        `SELECT o.id, o.full_name, o.status, o.verification_status, o.monthly_need,
                COALESCE((SELECT SUM(monthly_amount) FROM sponsorships
                           WHERE orphan_id = o.id AND status = 'active'), 0) AS covered
           FROM orphans o WHERE o.id = ? FOR UPDATE`, [p.orphan_id]);
      if (!o) throw new OrphanError('শিশুর নথি পাওয়া যায়নি।');
      if (o.status !== 'active') throw new OrphanError('এই শিশু এখন সক্রিয় তালিকায় নেই।');
      if (o.verification_status !== 'verified') {
        throw new OrphanError('যাচাই সম্পন্ন না হওয়া পর্যন্ত স্পনসরশিপ করা যাবে না।');
      }
      const [[d]] = await conn.query(
        `SELECT id, name, merged_into_id FROM donors WHERE id = ?`, [p.donor_id]);
      if (!d) throw new OrphanError('দাতা পাওয়া যায়নি।');
      const donorId = d.merged_into_id || d.id;

      const [[dup]] = await conn.query(
        `SELECT sponsorship_code FROM sponsorships
          WHERE orphan_id = ? AND donor_id = ? AND status = 'active'`, [p.orphan_id, donorId]);
      if (dup) throw new OrphanError(`এই দাতার সাথে চলমান স্পনসরশিপ আছে (${dup.sponsorship_code})।`);

      const amount = Number(p.monthly_amount);
      const after = Number(o.covered) + amount;
      // প্রয়োজনের চেয়ে বেশি হলে আটকাই না — জানিয়ে রাখি, সিদ্ধান্ত মানুষের
      const overBy = Number(o.monthly_need) > 0 ? Math.max(after - Number(o.monthly_need), 0) : 0;

      const [r] = await conn.query(
        `INSERT INTO sponsorships
           (orphan_id, donor_id, monthly_amount, start_date, report_frequency, note_bn, created_by)
         VALUES (?,?,?,?,?,?,?)`,
        [p.orphan_id, donorId, amount,
         p.start_date || new Date().toISOString().slice(0, 10),
         p.report_frequency || 'quarterly', p.note_bn || null, ctx && ctx.userId || null]);
      const id = r.insertId;
      const code = 'SPN-' + String(id).padStart(5, '0');
      await conn.query(`UPDATE sponsorships SET sponsorship_code = ? WHERE id = ?`, [code, id]);
      await conn.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, user_id, ip_address)
         VALUES ('sponsorship', ?, 'create', ?, ?, ?)`,
        [id, JSON.stringify({ code, orphan_id: p.orphan_id, donor_id: donorId, amount }),
         ctx && ctx.userId || null, ctx && ctx.ip || null]);

      await conn.commit();
      return {
        id, sponsorship_code: code, donor_id: donorId,
        covered_after: after, monthly_need: Number(o.monthly_need),
        over_by: overBy,
        shared_with: Number(o.covered) > 0,
      };
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  /**
   * স্পনসরশিপ শেষ হলে শিশুটি আবার পুলে ফিরবে — তাই ফেরত বার্তায়
   * নতুন ঘাটতি কত, সেটা জানিয়ে দেওয়া হয়, যাতে কেউ অসহায় না থাকে।
   */
  async endSponsorship(id, reason, ctx) {
    if (!(reason || '').trim()) throw new OrphanError('শেষ করার কারণ লিখতে হবে।');
    const [[sp]] = await this.pool.query(
      `SELECT * FROM v_sponsorship_status WHERE sponsorship_id = ?`, [id]);
    if (!sp) throw new OrphanError('স্পনসরশিপ পাওয়া যায়নি।');
    if (sp.status === 'ended') throw new OrphanError('এটি আগেই শেষ হয়েছে।');

    await this.pool.query(
      `UPDATE sponsorships SET status='ended', end_date=CURDATE(), end_reason=? WHERE id=?`,
      [reason.trim(), id]);
    await this._audit('sponsorship', id, 'end', { code: sp.sponsorship_code }, ctx, reason.trim());

    const [[o]] = await this.pool.query(
      `SELECT * FROM v_orphan_summary WHERE orphan_id = ?`, [sp.orphan_id]);
    return {
      id: Number(id), status: 'ended',
      orphan_code: o.orphan_code, orphan_name: o.full_name,
      new_gap: Number(o.gap_monthly), sponsor_count: Number(o.sponsor_count),
      back_to_pool: Number(o.gap_monthly) > 0,
    };
  }

  async setSponsorshipStatus(id, status, ctx) {
    if (!['active', 'paused'].includes(status)) {
      throw new OrphanError("অবস্থা 'active' বা 'paused' হতে পারে। শেষ করতে endSponsorship ব্যবহার করুন।");
    }
    const [r] = await this.pool.query(
      `UPDATE sponsorships SET status=? WHERE id=? AND status <> 'ended'`, [status, id]);
    if (!r.affectedRows) throw new OrphanError('স্পনসরশিপ পাওয়া যায়নি বা আগেই শেষ হয়েছে।');
    await this._audit('sponsorship', id, 'status', { status }, ctx);
    return { id: Number(id), status };
  }

  /** দাতা-শিশুর সরাসরি যোগাযোগ — ডিফল্টে বন্ধ, খুলতে লিখিত সিদ্ধান্ত ও মুহতামিমের অনুমোদন */
  async setDirectContact(id, allow, note, ctx) {
    if (allow && (ROLE_RANK[ctx && ctx.role] || 0) < ROLE_RANK.principal) {
      throw new OrphanError('সরাসরি যোগাযোগের অনুমতি শুধু মুহতামিম দিতে পারেন।');
    }
    if (allow && !(note || '').trim()) {
      throw new OrphanError('অনুমতির কারণ লিখিতভাবে রাখতে হবে।');
    }
    await this.pool.query(
      `UPDATE sponsorships SET allow_direct_contact=?, contact_note=? WHERE id=?`,
      [allow ? 1 : 0, allow ? note.trim() : null, id]);
    await this._audit('sponsorship', id, 'direct_contact', { allow: !!allow }, ctx, note);
    return { id: Number(id), allow_direct_contact: !!allow };
  }

  async logVisit(p, ctx) {
    const errors = [];
    if (!p.orphan_id) errors.push('শিশু নির্বাচন করুন।');
    if (!(p.visitor_name || '').trim()) errors.push('সাক্ষাৎকারীর নাম লিখুন।');
    if (!p.mediated_by && !(ctx && ctx.userId)) errors.push('কে উপস্থিত ছিলেন, তা লিখতে হবে।');
    if (errors.length) throw new OrphanError(errors);
    const [r] = await this.pool.query(
      `INSERT INTO orphan_visits
         (orphan_id, donor_id, visitor_name, visit_date, mediated_by, purpose_bn, notes_bn)
       VALUES (?,?,?,?,?,?,?)`,
      [p.orphan_id, p.donor_id || null, p.visitor_name.trim(),
       p.visit_date || new Date().toISOString().slice(0, 10),
       p.mediated_by || ctx.userId, p.purpose_bn || null, p.notes_bn || null]);
    await this._audit('orphan', p.orphan_id, 'visit', { visitor: p.visitor_name }, ctx);
    return { id: r.insertId };
  }

  // =================================================================
  // প্রগ্রেস রিপোর্ট
  // =================================================================
  async createReport(p, ctx) {
    const errors = [];
    if (!p.orphan_id) errors.push('শিশু নির্বাচন করুন।');
    if (!(p.period_label || '').trim()) errors.push('সময়কালের নাম লিখুন (যেমন জুলাই–সেপ্টেম্বর ২০২৬)।');
    if (!p.period_start || !p.period_end) errors.push('সময়কালের শুরু ও শেষ তারিখ দিন।');
    if (p.attendance_pct != null && (p.attendance_pct < 0 || p.attendance_pct > 100)) {
      errors.push('উপস্থিতির হার ০ থেকে ১০০ এর মধ্যে হবে।');
    }
    if (errors.length) throw new OrphanError(errors);
    try {
      const [r] = await this.pool.query(
        `INSERT INTO orphan_progress_reports
           (orphan_id, period_label, period_start, period_end, attendance_pct,
            exam_result_bn, hifz_progress_bn, health_note_bn, teacher_comment_bn,
            photo_path, child_letter_path, prepared_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [p.orphan_id, p.period_label.trim(), p.period_start, p.period_end,
         p.attendance_pct != null ? p.attendance_pct : null,
         p.exam_result_bn || null, p.hifz_progress_bn || null,
         p.health_note_bn || null, p.teacher_comment_bn || null,
         p.photo_path || null, p.child_letter_path || null, ctx && ctx.userId || null]);
      await this._audit('orphan_report', r.insertId, 'create',
        { orphan_id: p.orphan_id, period: p.period_label }, ctx);
      return { id: r.insertId, status: 'draft' };
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        throw new OrphanError('এই সময়কালের রিপোর্ট আগেই তৈরি করা হয়েছে।');
      }
      throw e;
    }
  }

  /** প্রকাশ করলেই দাতা দেখতে পাবেন, আর স্পনসরশিপে পাঠানোর তারিখ বসে */
  async publishReport(id, ctx) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[rep]] = await conn.query(
        `SELECT * FROM orphan_progress_reports WHERE id = ? FOR UPDATE`, [id]);
      if (!rep) throw new OrphanError('রিপোর্ট পাওয়া যায়নি।');
      if (rep.status === 'published') throw new OrphanError('এটি আগেই প্রকাশিত।');

      await conn.query(
        `UPDATE orphan_progress_reports SET status='published', published_at=NOW() WHERE id=?`, [id]);
      const [u] = await conn.query(
        `UPDATE sponsorships SET last_report_sent = ?
          WHERE orphan_id = ? AND status IN ('active','paused')`,
        [rep.period_end, rep.orphan_id]);
      await conn.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, after_json, user_id)
         VALUES ('orphan_report', ?, 'publish', ?, ?)`,
        [id, JSON.stringify({ sponsors_notified: u.affectedRows }), ctx && ctx.userId || null]);
      await conn.commit();
      return { id: Number(id), status: 'published', sponsors_notified: u.affectedRows };
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  /** কোন স্পনসরদের রিপোর্ট পাঠানোর সময় হয়েছে */
  async reportsDue(dateStr) {
    const date = dateStr || new Date().toISOString().slice(0, 10);
    const [rows] = await this.pool.query(
      `SELECT sp.id AS sponsorship_id, sp.sponsorship_code, sp.report_frequency,
              sp.last_report_sent, sp.start_date, sp.monthly_amount,
              o.id AS orphan_id, o.orphan_code, o.full_name AS orphan_name, o.class_name,
              d.id AS donor_id, d.name AS donor_name, d.mobile, d.preferred_contact,
              d.allow_contact,
              TIMESTAMPDIFF(MONTH, COALESCE(sp.last_report_sent, sp.start_date), ?) AS months_elapsed,
              CASE sp.report_frequency WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3
                   WHEN 'half_yearly' THEN 6 ELSE 12 END AS freq_months
         FROM sponsorships sp
         JOIN orphans o ON o.id = sp.orphan_id
         JOIN donors d ON d.id = sp.donor_id
        WHERE sp.status = 'active'
          AND TIMESTAMPDIFF(MONTH, COALESCE(sp.last_report_sent, sp.start_date), ?) >=
              CASE sp.report_frequency WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3
                   WHEN 'half_yearly' THEN 6 ELSE 12 END
        ORDER BY months_elapsed DESC`, [date, date]);
    return { date, rows };
  }

  /** স্পনসরশিপের টাকা এ মাসে এসেছে কি না */
  async paymentsDue(dateStr) {
    const date = dateStr || new Date().toISOString().slice(0, 10);
    const [rows] = await this.pool.query(
      `SELECT sp.id AS sponsorship_id, sp.sponsorship_code, sp.monthly_amount,
              o.orphan_code, o.full_name AS orphan_name,
              d.id AS donor_id, d.name AS donor_name, d.mobile,
              d.preferred_contact, d.allow_contact
         FROM sponsorships sp
         JOIN orphans o ON o.id = sp.orphan_id
         JOIN donors d ON d.id = sp.donor_id
        WHERE sp.status = 'active' AND sp.start_date <= ?
          AND NOT EXISTS (
            SELECT 1 FROM receipts r
             WHERE r.sponsorship_id = sp.id AND r.status = 'issued'
               AND YEAR(r.receipt_date) = YEAR(?) AND MONTH(r.receipt_date) = MONTH(?))
        ORDER BY sp.monthly_amount DESC`, [date, date, date]);
    const total = rows.reduce((s, r) => s + Number(r.monthly_amount), 0);
    return { date, rows, expected_total: total };
  }

  /** বিভাগের সামগ্রিক চিত্র */
  async overview() {
    const [[o]] = await this.pool.query(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN verification_status='verified' THEN 1 ELSE 0 END) verified,
              SUM(CASE WHEN verification_status='pending' THEN 1 ELSE 0 END) pending,
              SUM(CASE WHEN sponsor_count = 0 THEN 1 ELSE 0 END) unsponsored,
              COALESCE(SUM(monthly_need),0) need_total,
              COALESCE(SUM(covered_monthly),0) covered_total,
              -- গুরুত্বপূর্ণ: মোট ঘাটতি = প্রতি শিশুর ঘাটতির যোগফল।
              -- এক শিশুতে প্রয়োজনের বেশি এলে তা অন্য শিশুর ঘাটতি পূরণ করে না,
              -- তাই (মোট প্রয়োজন − মোট কভারেজ) দিয়ে ঘাটতি মাপা ভুল হবে।
              COALESCE(SUM(gap_monthly),0) gap_total,
              COALESCE(SUM(GREATEST(covered_monthly - monthly_need, 0)),0) over_covered_total
         FROM v_orphan_summary WHERE status='active'`);
    const [[s]] = await this.pool.query(
      `SELECT COUNT(*) active_sponsorships, COUNT(DISTINCT donor_id) sponsors
         FROM sponsorships WHERE status='active'`);
    return { ...o, ...s };
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

module.exports = OrphanService;
module.exports.OrphanError = OrphanError;
module.exports.ORPHAN_STATUS_BN = ORPHAN_STATUS_BN;
module.exports.FREQ_BN = FREQ_BN;
module.exports.FREQ_MONTHS = FREQ_MONTHS;

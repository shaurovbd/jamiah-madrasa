-- =====================================================================
--  এতিম স্পনসর বিভাগ — স্কিমা
--  পূর্বশর্ত: 01–06
--
--  গোপনীয়তার নীতি এই স্কিমাতেই গাঁথা:
--   · অভিভাবকের নাম/মোবাইল/ঠিকানা, মৃত্যুর কাগজ — এগুলো প্রাতিষ্ঠানিক তথ্য।
--     দাতার কাছে কখনো যায় না। donor-facing প্রক্ষেপণ শুধু অনুমোদিত ঘর নেয়।
--   · ছবি ব্যবহারের সম্মতি তিন স্তরে: none / sponsor_only / public।
--     সম্মতি না থাকলে ছবি কোথাও দেখানো হয় না।
--   · দাতা-শিশুর সরাসরি যোগাযোগ ডিফল্টে বন্ধ (allow_direct_contact = 0)।
--     সাক্ষাৎ হলে প্রতিষ্ঠানের মধ্যস্থতায়, লগ রেখে।
-- =====================================================================
SET NAMES utf8mb4;

DROP TABLE IF EXISTS orphan_visits;
DROP TABLE IF EXISTS orphan_progress_reports;
DROP TABLE IF EXISTS orphan_documents;
DROP TABLE IF EXISTS sponsorships;
DROP TABLE IF EXISTS orphans;

-- ---------------------------------------------------------------------
-- ১. এতিম শিক্ষার্থীর নথি
-- ---------------------------------------------------------------------
CREATE TABLE orphans (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  orphan_code   VARCHAR(20) NULL,                 -- 'ORF-0001'
  -- আপনার বিদ্যমান students টেবিলের আইডি। আলাদা মডিউল, তাই FK দেওয়া হয়নি।
  student_id    BIGINT UNSIGNED NULL,

  -- ---- নাম ও দাতাকে কী দেখানো হবে ----
  full_name     VARCHAR(150) NOT NULL,            -- প্রাতিষ্ঠানিক
  display_name  VARCHAR(150) NULL,                -- দাতাকে দেখানোর জন্য (খালি হলে নিয়ম অনুযায়ী বসে)
  name_display  ENUM('full','first_only','code_only') NOT NULL DEFAULT 'first_only',

  date_of_birth DATE NULL,
  gender        ENUM('male','female') NOT NULL DEFAULT 'male',
  orphan_status ENUM('father_deceased','mother_deceased','both_deceased',
                     'abandoned','extreme_poverty') NOT NULL,

  -- ---- পারিবারিক তথ্য: প্রাতিষ্ঠানিক, দাতার কাছে যায় না ----
  father_name       VARCHAR(150) NULL,
  father_death_date DATE NULL,
  mother_name       VARCHAR(150) NULL,
  mother_death_date DATE NULL,
  guardian_name     VARCHAR(150) NULL,
  guardian_relation VARCHAR(80)  NULL,
  guardian_mobile   VARCHAR(30)  NULL,
  guardian_address  VARCHAR(255) NULL,
  thana             VARCHAR(80)  NULL,
  district          VARCHAR(80)  NULL,            -- জেলা পর্যন্ত দাতাকে দেখানো যায়
  sibling_count     TINYINT UNSIGNED NULL,

  -- ---- পড়াশোনা ----
  enrolled_date  DATE NULL,
  class_name     VARCHAR(80) NULL,
  cost_center_id INT UNSIGNED NULL,               -- Hifz / Nazera / Maktab / Kitab

  -- ---- মাসিক প্রয়োজন ----
  need_food      DECIMAL(10,2) NOT NULL DEFAULT 0,
  need_lodging   DECIMAL(10,2) NOT NULL DEFAULT 0,
  need_clothing  DECIMAL(10,2) NOT NULL DEFAULT 0,
  need_books     DECIMAL(10,2) NOT NULL DEFAULT 0,
  need_medical   DECIMAL(10,2) NOT NULL DEFAULT 0,
  need_other     DECIMAL(10,2) NOT NULL DEFAULT 0,
  monthly_need   DECIMAL(10,2) AS (need_food + need_lodging + need_clothing
                                   + need_books + need_medical + need_other) STORED,

  -- ---- ছবি ও সম্মতি ----
  photo_path    VARCHAR(500) NULL,
  photo_consent ENUM('none','sponsor_only','public') NOT NULL DEFAULT 'none',
  consent_by    VARCHAR(150) NULL,                -- কে সম্মতি দিয়েছেন (অভিভাবক/মুহতামিম)
  consent_date  DATE NULL,
  consent_note  VARCHAR(255) NULL,

  -- ---- যাচাই ----
  verification_status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  verified_by   INT UNSIGNED NULL,
  verified_at   DATETIME NULL,
  reject_reason VARCHAR(255) NULL,

  -- ---- দাতাকে দেখানো যায় এমন সাধারণ তথ্য ----
  health_note_bn  VARCHAR(255) NULL,
  special_needs_bn VARCHAR(255) NULL,

  status      ENUM('active','graduated','left','deceased') NOT NULL DEFAULT 'active',
  status_note VARCHAR(255) NULL,
  notes_bn    TEXT NULL,                          -- প্রাতিষ্ঠানিক নোট
  created_by  INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_orphan_code (orphan_code),
  KEY ix_orphan_status (status, verification_status),
  KEY ix_orphan_student (student_id),
  KEY ix_orphan_cc (cost_center_id),
  CONSTRAINT fk_orphan_cc FOREIGN KEY (cost_center_id) REFERENCES cost_centers (id),
  CONSTRAINT chk_orphan_consent CHECK (photo_consent = 'none' OR consent_by IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ২. স্পনসরশিপ — এক দাতা ↔ এক শিশু, বা কয়েকজন মিলে এক শিশু
-- ---------------------------------------------------------------------
CREATE TABLE sponsorships (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sponsorship_code VARCHAR(20) NULL,              -- 'SPN-00001'
  orphan_id      BIGINT UNSIGNED NOT NULL,
  donor_id       BIGINT UNSIGNED NOT NULL,
  monthly_amount DECIMAL(10,2) NOT NULL,
  start_date     DATE NOT NULL,
  end_date       DATE NULL,
  status         ENUM('active','paused','ended') NOT NULL DEFAULT 'active',
  end_reason     VARCHAR(255) NULL,
  report_frequency ENUM('monthly','quarterly','half_yearly','yearly')
                   NOT NULL DEFAULT 'quarterly',
  last_report_sent DATE NULL,
  -- দাতা-শিশুর সরাসরি যোগাযোগ ডিফল্টে বন্ধ; খুলতে হলে লিখিত সিদ্ধান্ত লাগে
  allow_direct_contact TINYINT(1) NOT NULL DEFAULT 0,
  contact_note   VARCHAR(255) NULL,
  note_bn        VARCHAR(255) NULL,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sponsorship_code (sponsorship_code),
  KEY ix_spn_orphan (orphan_id, status),
  KEY ix_spn_donor (donor_id, status),
  CONSTRAINT fk_spn_orphan FOREIGN KEY (orphan_id) REFERENCES orphans (id),
  CONSTRAINT fk_spn_donor  FOREIGN KEY (donor_id)  REFERENCES donors (id),
  CONSTRAINT chk_spn_amount CHECK (monthly_amount > 0),
  CONSTRAINT chk_spn_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT chk_spn_contact CHECK (allow_direct_contact = 0 OR contact_note IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৩. যাচাইয়ের কাগজ — is_sensitive = 1 হলে দাতার কাছে কখনো যায় না
-- ---------------------------------------------------------------------
CREATE TABLE orphan_documents (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  orphan_id   BIGINT UNSIGNED NOT NULL,
  doc_type    ENUM('death_certificate','birth_certificate','chairman_certificate',
                   'guardian_nid','photo','consent_form','other') NOT NULL,
  file_path   VARCHAR(500) NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(100) NULL,
  file_size   INT UNSIGNED NULL,
  is_sensitive TINYINT(1) NOT NULL DEFAULT 1,
  note_bn     VARCHAR(255) NULL,
  uploaded_by INT UNSIGNED NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_doc_orphan (orphan_id, doc_type),
  CONSTRAINT fk_doc_orphan FOREIGN KEY (orphan_id) REFERENCES orphans (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৪. প্রগ্রেস রিপোর্ট — দাতাকে পাঠানোর জন্য
--    এখানে যা লেখা হয় তার সবই দাতা দেখবেন, তাই ব্যক্তিগত তথ্য লেখা যাবে না
-- ---------------------------------------------------------------------
CREATE TABLE orphan_progress_reports (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  orphan_id      BIGINT UNSIGNED NOT NULL,
  period_label   VARCHAR(80) NOT NULL,            -- 'জুলাই–সেপ্টেম্বর ২০২৬'
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  attendance_pct DECIMAL(5,2) NULL,
  exam_result_bn   VARCHAR(255) NULL,
  hifz_progress_bn VARCHAR(255) NULL,             -- কত পারা মুখস্থ
  health_note_bn   VARCHAR(255) NULL,
  teacher_comment_bn TEXT NULL,
  photo_path       VARCHAR(500) NULL,
  child_letter_path VARCHAR(500) NULL,            -- শিশুর হাতে লেখা চিঠির স্ক্যান
  status         ENUM('draft','published') NOT NULL DEFAULT 'draft',
  prepared_by    INT UNSIGNED NULL,
  prepared_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at   DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_report_period (orphan_id, period_start, period_end),
  KEY ix_report_orphan (orphan_id, status),
  CONSTRAINT fk_report_orphan FOREIGN KEY (orphan_id) REFERENCES orphans (id) ON DELETE CASCADE,
  CONSTRAINT chk_report_period CHECK (period_end >= period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৫. সাক্ষাতের লগ — দাতা-শিশুর দেখা সবসময় প্রতিষ্ঠানের মধ্যস্থতায়
-- ---------------------------------------------------------------------
CREATE TABLE orphan_visits (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  orphan_id    BIGINT UNSIGNED NOT NULL,
  donor_id     BIGINT UNSIGNED NULL,
  visitor_name VARCHAR(150) NOT NULL,
  visit_date   DATE NOT NULL,
  mediated_by  INT UNSIGNED NOT NULL,             -- যে কর্মচারী উপস্থিত ছিলেন
  purpose_bn   VARCHAR(255) NULL,
  notes_bn     TEXT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_visit_orphan (orphan_id, visit_date),
  CONSTRAINT fk_visit_orphan FOREIGN KEY (orphan_id) REFERENCES orphans (id) ON DELETE CASCADE,
  CONSTRAINT fk_visit_donor  FOREIGN KEY (donor_id)  REFERENCES donors (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৬. রশিদ ও মাসিক পরিকল্পনার সাথে জোড়া
-- ---------------------------------------------------------------------
ALTER TABLE receipts
  ADD CONSTRAINT fk_rc_sponsorship FOREIGN KEY (sponsorship_id) REFERENCES sponsorships (id);
ALTER TABLE recurring_plans
  ADD CONSTRAINT fk_rec_sponsorship FOREIGN KEY (sponsorship_id) REFERENCES sponsorships (id);

-- =====================================================================
--  ভিউ
-- =====================================================================

-- এতিমের সারসংক্ষেপ: প্রয়োজন বনাম কভারেজ
DROP VIEW IF EXISTS v_orphan_summary;
CREATE VIEW v_orphan_summary AS
SELECT
  o.id AS orphan_id, o.orphan_code, o.full_name, o.display_name, o.name_display,
  o.student_id, o.date_of_birth, o.gender, o.orphan_status, o.district,
  o.class_name, cc.code AS department_code, cc.name_bn AS department_name,
  o.monthly_need, o.photo_consent, o.photo_path,
  o.verification_status, o.status, o.health_note_bn, o.special_needs_bn,
  o.enrolled_date,
  CASE WHEN o.date_of_birth IS NULL THEN NULL
       ELSE TIMESTAMPDIFF(YEAR, o.date_of_birth, CURDATE()) END AS age_years,
  COALESCE(s.sponsor_count, 0) AS sponsor_count,
  COALESCE(s.covered, 0) AS covered_monthly,
  GREATEST(o.monthly_need - COALESCE(s.covered, 0), 0) AS gap_monthly,
  CASE WHEN o.monthly_need > 0
       THEN ROUND(100 * COALESCE(s.covered, 0) / o.monthly_need, 1) ELSE NULL END AS coverage_pct,
  COALESCE(r.received_total, 0) AS received_total,
  r.last_payment_date,
  rep.last_report_period, rep.last_report_end,
  CASE WHEN rep.last_report_end IS NULL THEN NULL
       ELSE TIMESTAMPDIFF(MONTH, rep.last_report_end, CURDATE()) END AS months_since_report
FROM orphans o
LEFT JOIN cost_centers cc ON cc.id = o.cost_center_id
LEFT JOIN (
  SELECT orphan_id, COUNT(*) AS sponsor_count, SUM(monthly_amount) AS covered
    FROM sponsorships WHERE status = 'active' GROUP BY orphan_id
) s ON s.orphan_id = o.id
LEFT JOIN (
  SELECT sp.orphan_id, SUM(rc.amount) AS received_total, MAX(rc.receipt_date) AS last_payment_date
    FROM receipts rc JOIN sponsorships sp ON sp.id = rc.sponsorship_id
   WHERE rc.status = 'issued' GROUP BY sp.orphan_id
) r ON r.orphan_id = o.id
LEFT JOIN (
  SELECT p1.orphan_id, p1.period_label AS last_report_period, p1.period_end AS last_report_end
    FROM orphan_progress_reports p1
    JOIN (SELECT orphan_id, MAX(period_end) AS mx FROM orphan_progress_reports
           WHERE status = 'published' GROUP BY orphan_id) p2
      ON p2.orphan_id = p1.orphan_id AND p2.mx = p1.period_end
   WHERE p1.status = 'published'
) rep ON rep.orphan_id = o.id;

-- স্পনসরশিপের অবস্থা
DROP VIEW IF EXISTS v_sponsorship_status;
CREATE VIEW v_sponsorship_status AS
SELECT
  sp.id AS sponsorship_id, sp.sponsorship_code, sp.status, sp.monthly_amount,
  sp.start_date, sp.end_date, sp.end_reason, sp.report_frequency,
  sp.last_report_sent, sp.allow_direct_contact, sp.note_bn,
  sp.orphan_id, o.orphan_code, o.full_name AS orphan_full_name,
  o.display_name, o.name_display, o.class_name, o.monthly_need,
  sp.donor_id, d.donor_code, d.name AS donor_name, d.mobile AS donor_mobile,
  d.preferred_contact, d.allow_contact,
  COALESCE(r.received, 0) AS received_total,
  r.last_payment_date,
  TIMESTAMPDIFF(MONTH, sp.start_date, COALESCE(sp.end_date, CURDATE())) AS months_running,
  CASE WHEN sp.last_report_sent IS NULL THEN NULL
       ELSE TIMESTAMPDIFF(MONTH, sp.last_report_sent, CURDATE()) END AS months_since_report
FROM sponsorships sp
JOIN orphans o ON o.id = sp.orphan_id
JOIN donors d ON d.id = sp.donor_id
LEFT JOIN (
  SELECT sponsorship_id, SUM(amount) AS received, MAX(receipt_date) AS last_payment_date
    FROM receipts WHERE status = 'issued' AND sponsorship_id IS NOT NULL
   GROUP BY sponsorship_id
) r ON r.sponsorship_id = sp.id;

-- অসম্পৃক্ত পুল — যাদের এখনো স্পনসর নেই বা ঘাটতি আছে
DROP VIEW IF EXISTS v_unsponsored_pool;
CREATE VIEW v_unsponsored_pool AS
SELECT * FROM v_orphan_summary
 WHERE status = 'active' AND verification_status = 'verified'
   AND (coverage_pct IS NULL OR coverage_pct < 100);

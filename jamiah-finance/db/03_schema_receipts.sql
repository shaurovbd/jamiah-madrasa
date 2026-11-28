-- =====================================================================
--  রশিদ ব্যবস্থাপনা — স্কিমা
--  পূর্বশর্ত: 01_schema.sql (ভাউচার লেয়ার)
--  চালানোর নিয়ম:  mysql -u root -p jamiah < 03_schema_receipts.sql
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- ১. রশিদের ধরন — প্রতিটির নিজস্ব সিরিজ, ফান্ড ও আয়ের খাত
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS receipt_books;
DROP TABLE IF EXISTS receipts;
DROP TABLE IF EXISTS receipt_sequences;
DROP TABLE IF EXISTS receipt_types;

CREATE TABLE receipt_types (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code               VARCHAR(10)  NOT NULL,      -- FEE, ZAK, DON …
  name_bn            VARCHAR(120) NOT NULL,
  name_en            VARCHAR(120) NULL,
  prefix             VARCHAR(10)  NOT NULL,      -- রশিদ নম্বরের উপসর্গ
  default_fund_id    INT UNSIGNED NOT NULL,
  -- জমার বিপরীত দিক: আয়ের খাত (৪xxx) বা প্রাপ্য কমানো (১২০১ বাকি ফি)
  default_credit_account_id INT UNSIGNED NOT NULL,
  requires_student   TINYINT(1) NOT NULL DEFAULT 0,
  requires_payer     TINYINT(1) NOT NULL DEFAULT 1,
  allow_fund_change  TINYINT(1) NOT NULL DEFAULT 0,  -- কারণিক ফান্ড বদলাতে পারবে?
  note_bn            TEXT NULL,
  is_active          TINYINT(1) NOT NULL DEFAULT 1,
  sort_order         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rt_code (code),
  UNIQUE KEY uq_rt_prefix (prefix),
  CONSTRAINT fk_rt_fund    FOREIGN KEY (default_fund_id) REFERENCES funds (id),
  CONSTRAINT fk_rt_credit  FOREIGN KEY (default_credit_account_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ২. রশিদ নম্বর সিরিজ — ধরন ও আর্থিক বছর অনুযায়ী, গ্যাপলেস
-- ---------------------------------------------------------------------
CREATE TABLE receipt_sequences (
  receipt_type_id INT UNSIGNED NOT NULL,
  fiscal_year_id  INT UNSIGNED NOT NULL,
  year_token      VARCHAR(10) NOT NULL,
  last_no         INT UNSIGNED NOT NULL DEFAULT 0,
  padding         TINYINT UNSIGNED NOT NULL DEFAULT 5,
  PRIMARY KEY (receipt_type_id, fiscal_year_id),
  CONSTRAINT fk_rs_type FOREIGN KEY (receipt_type_id) REFERENCES receipt_types (id) ON DELETE CASCADE,
  CONSTRAINT fk_rs_fy   FOREIGN KEY (fiscal_year_id)  REFERENCES fiscal_years (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৩. রশিদ
--    প্রতিটি রশিদের সাথে ঠিক একটি জমা ভাউচার (RV) — একই লেনদেনে তৈরি।
--    রশিদ কখনো মুছে ফেলা হয় না; ভুল হলে 'void' করা হয় আর ভাউচার রিভার্স হয়।
-- ---------------------------------------------------------------------
CREATE TABLE receipts (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt_no       VARCHAR(30) NOT NULL,          -- 'ZAK-2026-00042'
  receipt_type_id  INT UNSIGNED NOT NULL,
  receipt_date     DATE NOT NULL,
  fiscal_period_id INT UNSIGNED NOT NULL,

  -- যে দিয়েছে
  payer_name       VARCHAR(150) NULL,
  payer_mobile     VARCHAR(30)  NULL,
  payer_address    VARCHAR(255) NULL,
  student_id       BIGINT UNSIGNED NULL,
  donor_id         BIGINT UNSIGNED NULL,
  sponsorship_id   BIGINT UNSIGNED NULL,

  -- হিসাবের দিক
  fund_id            INT UNSIGNED NOT NULL,
  credit_account_id  INT UNSIGNED NOT NULL,       -- আয় বা প্রাপ্য
  cash_account_id    INT UNSIGNED NOT NULL,       -- যেখানে টাকা ঢুকল
  cost_center_id     INT UNSIGNED NULL,

  amount           DECIMAL(14,2) NOT NULL,
  amount_in_words  VARCHAR(400) NOT NULL,         -- ইস্যুর সময়ের কথা, সংরক্ষিত
  payment_method   ENUM('cash','bank','bkash','nagad','rocket','cheque') NOT NULL DEFAULT 'cash',
  instrument_no    VARCHAR(50) NULL,
  instrument_date  DATE NULL,
  purpose_bn       VARCHAR(255) NULL,

  -- যাচাই (QR)
  verify_token     CHAR(32) NOT NULL,

  -- ম্যানুয়াল বইয়ের রশিদ হলে
  book_id          BIGINT UNSIGNED NULL,
  manual_no        VARCHAR(30) NULL,

  voucher_id       BIGINT UNSIGNED NOT NULL,
  status           ENUM('issued','void') NOT NULL DEFAULT 'issued',
  void_reason      VARCHAR(255) NULL,
  voided_by        INT UNSIGNED NULL,
  voided_at        DATETIME NULL,
  reversal_voucher_id BIGINT UNSIGNED NULL,

  print_count      INT UNSIGNED NOT NULL DEFAULT 0,
  issued_by        INT UNSIGNED NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_receipt_no (receipt_no),
  UNIQUE KEY uq_verify_token (verify_token),
  KEY ix_receipt_date (receipt_date, status),
  KEY ix_receipt_student (student_id),
  KEY ix_receipt_donor (donor_id),
  KEY ix_receipt_type (receipt_type_id, receipt_date),
  KEY ix_receipt_mobile (payer_mobile),
  CONSTRAINT fk_rc_type   FOREIGN KEY (receipt_type_id) REFERENCES receipt_types (id),
  CONSTRAINT fk_rc_period FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods (id),
  CONSTRAINT fk_rc_fund   FOREIGN KEY (fund_id) REFERENCES funds (id),
  CONSTRAINT fk_rc_credit FOREIGN KEY (credit_account_id) REFERENCES accounts (id),
  CONSTRAINT fk_rc_cash   FOREIGN KEY (cash_account_id) REFERENCES accounts (id),
  CONSTRAINT fk_rc_cc     FOREIGN KEY (cost_center_id) REFERENCES cost_centers (id),
  CONSTRAINT fk_rc_voucher FOREIGN KEY (voucher_id) REFERENCES vouchers (id),
  CONSTRAINT fk_rc_reversal FOREIGN KEY (reversal_voucher_id) REFERENCES vouchers (id),
  CONSTRAINT chk_rc_amount CHECK (amount > 0),
  CONSTRAINT chk_rc_void CHECK (status <> 'void' OR void_reason IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৪. ম্যানুয়াল রশিদ বই — মাঠপর্যায়ের কলেক্টরদের জন্য
--    কোন কর্মচারীকে কোন বই (নম্বর ১০০১–১১০০) দেওয়া হলো, কত ব্যবহার হলো, ফেরত এল কি না
-- ---------------------------------------------------------------------
CREATE TABLE receipt_books (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  book_no         VARCHAR(20) NOT NULL,
  receipt_type_id INT UNSIGNED NULL,
  from_no         INT UNSIGNED NOT NULL,
  to_no           INT UNSIGNED NOT NULL,
  issued_to       INT UNSIGNED NULL,            -- কর্মচারী/স্টাফ আইডি
  issued_to_name  VARCHAR(150) NULL,
  issued_at       DATE NULL,
  returned_at     DATE NULL,
  used_count      INT UNSIGNED NOT NULL DEFAULT 0,
  status          ENUM('in_store','issued','returned','lost') NOT NULL DEFAULT 'in_store',
  note_bn         VARCHAR(255) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_book_no (book_no),
  KEY ix_book_staff (issued_to),
  CONSTRAINT fk_rb_type FOREIGN KEY (receipt_type_id) REFERENCES receipt_types (id),
  CONSTRAINT chk_rb_range CHECK (to_no >= from_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE receipts
  ADD CONSTRAINT fk_rc_book FOREIGN KEY (book_id) REFERENCES receipt_books (id);

-- ভাউচার থেকে রশিদে ফেরত যাওয়ার পথ
ALTER TABLE vouchers
  ADD CONSTRAINT fk_voucher_receipt FOREIGN KEY (receipt_id) REFERENCES receipts (id);

-- =====================================================================
--  ভিউ
-- =====================================================================

-- রশিদের তালিকা, নামসহ (তালিকা পেজের ভিত্তি)
DROP VIEW IF EXISTS v_receipt_list;
CREATE VIEW v_receipt_list AS
SELECT
  r.id, r.receipt_no, r.receipt_date, r.status,
  rt.code AS type_code, rt.name_bn AS type_name,
  r.payer_name, r.payer_mobile, r.student_id, r.donor_id,
  f.code AS fund_code, f.name_bn AS fund_name,
  ca.code AS cash_code, ca.name_bn AS cash_name,
  ia.code AS credit_code, ia.name_bn AS credit_name,
  r.amount, r.payment_method, r.instrument_no, r.purpose_bn,
  r.verify_token, r.print_count,
  v.voucher_no, v.status AS voucher_status,
  r.issued_by, r.created_at, r.void_reason, r.voided_at
FROM receipts r
JOIN receipt_types rt ON rt.id = r.receipt_type_id
JOIN funds f ON f.id = r.fund_id
JOIN accounts ca ON ca.id = r.cash_account_id
JOIN accounts ia ON ia.id = r.credit_account_id
JOIN vouchers v ON v.id = r.voucher_id;

-- দৈনিক সংগ্রহ — ধরন অনুযায়ী (বাতিল বাদ)
DROP VIEW IF EXISTS v_receipt_daily;
CREATE VIEW v_receipt_daily AS
SELECT
  r.receipt_date,
  rt.code AS type_code, rt.name_bn AS type_name,
  f.code AS fund_code,
  COUNT(*) AS receipt_count,
  SUM(r.amount) AS total_amount
FROM receipts r
JOIN receipt_types rt ON rt.id = r.receipt_type_id
JOIN funds f ON f.id = r.fund_id
WHERE r.status = 'issued'
GROUP BY r.receipt_date, rt.code, rt.name_bn, f.code;

-- পরিশোধ মাধ্যম অনুযায়ী দৈনিক সংগ্রহ (ক্যাশ মিলানোর জন্য)
DROP VIEW IF EXISTS v_receipt_by_method;
CREATE VIEW v_receipt_by_method AS
SELECT
  r.receipt_date, r.payment_method,
  a.code AS cash_code, a.name_bn AS cash_name,
  COUNT(*) AS receipt_count, SUM(r.amount) AS total_amount
FROM receipts r
JOIN accounts a ON a.id = r.cash_account_id
WHERE r.status = 'issued'
GROUP BY r.receipt_date, r.payment_method, a.code, a.name_bn;

-- =====================================================================
--  Jamiah Scholars International — হিসাব ও অর্থ বিভাগ
--  ফাইল ০১: স্কিমা (Chart of Accounts + Fund + Voucher)
--  ডায়ালেক্ট: MySQL 8.0.16+ / MariaDB 10.5+   ENGINE=InnoDB
--  চালানোর নিয়ম:  mysql -u root -p jamiah < 01_schema.sql
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- ১. চার্ট অফ অ্যাকাউন্টস
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS accounts;
CREATE TABLE accounts (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(20)  NOT NULL,
  name_bn         VARCHAR(150) NOT NULL,
  name_en         VARCHAR(150) NULL,
  parent_id       INT UNSIGNED NULL,
  account_class   ENUM('asset','liability','fund','income','expense') NOT NULL,
  account_subtype ENUM('cash','bank','mobile_banking','receivable','payable',
                       'fixed_asset','contra_asset','inventory','prepaid',
                       'fund_balance','other') NOT NULL DEFAULT 'other',
  normal_side     ENUM('debit','credit') NOT NULL,
  -- is_group = শিরোনাম হিসাব, এতে সরাসরি এন্ট্রি দেওয়া যাবে না
  is_group        TINYINT(1) NOT NULL DEFAULT 0,
  is_postable     TINYINT(1) NOT NULL DEFAULT 1,
  is_cash_like    TINYINT(1) NOT NULL DEFAULT 0,   -- ক্যাশবুকে দেখাবে
  requires_fund   TINYINT(1) NOT NULL DEFAULT 1,
  requires_party  TINYINT(1) NOT NULL DEFAULT 0,   -- শিক্ষার্থী/দাতা/স্টাফ বাধ্যতামূলক
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounts_code (code),
  KEY ix_accounts_parent (parent_id),
  KEY ix_accounts_class (account_class, is_active),
  CONSTRAINT fk_accounts_parent FOREIGN KEY (parent_id)
    REFERENCES accounts (id),
  -- গ্রুপ হিসাবে পোস্ট করা যাবে না
  CONSTRAINT chk_accounts_group CHECK (is_group = 0 OR is_postable = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ২. ফান্ড (যাকাত, সদকা, এতিম, নির্মাণ, ওয়াকফ …)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS funds;
CREATE TABLE funds (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code               VARCHAR(10)  NOT NULL,
  name_bn            VARCHAR(120) NOT NULL,
  name_en            VARCHAR(120) NULL,
  fund_type          ENUM('unrestricted','restricted','endowment')
                       NOT NULL DEFAULT 'restricted',
  balance_account_id INT UNSIGNED NOT NULL,      -- ৩xxx ফান্ড ব্যালেন্স হিসাব
  allow_negative     TINYINT(1) NOT NULL DEFAULT 0,
  corpus_protected   TINYINT(1) NOT NULL DEFAULT 0,  -- ওয়াকফ: মূল টাকা ব্যয় নিষিদ্ধ
  requires_approval_by ENUM('accountant','chief_accountant','principal','committee')
                       NOT NULL DEFAULT 'chief_accountant',
  expiry_date        DATE NULL,                  -- ফিতরা ইত্যাদি সময়বদ্ধ ফান্ড
  note_bn            TEXT NULL,
  is_active          TINYINT(1) NOT NULL DEFAULT 1,
  sort_order         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_funds_code (code),
  UNIQUE KEY uq_funds_balance_account (balance_account_id),
  CONSTRAINT fk_funds_balance_account FOREIGN KEY (balance_account_id)
    REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৩. ফান্ড × হিসাব বিধিনিষেধ  (যাকাতের শরীয়তসম্মত ব্যয় নিয়ন্ত্রণ)
--    rule='allow' সারি থাকলে → হোয়াইটলিস্ট মোড (তালিকার বাইরে সব নিষিদ্ধ)
--    rule='block' সারি → সর্বদা নিষিদ্ধ
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS fund_account_rules;
CREATE TABLE fund_account_rules (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  fund_id    INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  rule       ENUM('allow','block') NOT NULL,
  note_bn    VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fund_account_rule (fund_id, account_id, rule),
  CONSTRAINT fk_far_fund    FOREIGN KEY (fund_id)    REFERENCES funds (id)    ON DELETE CASCADE,
  CONSTRAINT fk_far_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৪. কস্ট সেন্টার  (Hifz / Nazera / Maktab / Kitab / Hostel …)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS cost_centers;
CREATE TABLE cost_centers (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(20)  NOT NULL,
  name_bn    VARCHAR(120) NOT NULL,
  name_en    VARCHAR(120) NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cost_centers_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৫. আর্থিক বছর ও মাসিক পিরিয়ড লক
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS fiscal_years;
CREATE TABLE fiscal_years (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(20) NOT NULL,          -- '2026-2027'
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  status     ENUM('open','closed') NOT NULL DEFAULT 'open',
  closed_by  INT UNSIGNED NULL,
  closed_at  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fiscal_years_name (name),
  CONSTRAINT chk_fy_range CHECK (end_date > start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS fiscal_periods;
CREATE TABLE fiscal_periods (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  fiscal_year_id INT UNSIGNED NOT NULL,
  period_no      TINYINT UNSIGNED NOT NULL,   -- ১..১২
  label          VARCHAR(30) NOT NULL,        -- 'নভেম্বর ২০২৬'
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  status         ENUM('open','locked') NOT NULL DEFAULT 'open',
  locked_by      INT UNSIGNED NULL,
  locked_at      DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_period (fiscal_year_id, period_no),
  KEY ix_period_dates (start_date, end_date),
  CONSTRAINT fk_period_fy FOREIGN KEY (fiscal_year_id)
    REFERENCES fiscal_years (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৬. ভাউচার নম্বর সিরিজ  (গ্যাপলেস — লেনদেনের ভেতরে FOR UPDATE করে বাড়ানো হয়)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS voucher_sequences;
CREATE TABLE voucher_sequences (
  voucher_type   ENUM('RV','PV','JV','CV','FT') NOT NULL,
  fiscal_year_id INT UNSIGNED NOT NULL,
  prefix         VARCHAR(10) NOT NULL,
  year_token     VARCHAR(10) NOT NULL,     -- '2026'
  last_no        INT UNSIGNED NOT NULL DEFAULT 0,
  padding        TINYINT UNSIGNED NOT NULL DEFAULT 5,
  PRIMARY KEY (voucher_type, fiscal_year_id),
  CONSTRAINT fk_seq_fy FOREIGN KEY (fiscal_year_id)
    REFERENCES fiscal_years (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৭. ভাউচার হেডার
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS vouchers;
CREATE TABLE vouchers (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_no       VARCHAR(30) NOT NULL,            -- 'PV-2026-00413'
  voucher_type     ENUM('RV','PV','JV','CV','FT') NOT NULL,
  voucher_date     DATE NOT NULL,
  fiscal_period_id INT UNSIGNED NOT NULL,
  narration_bn     TEXT NULL,
  party_type       ENUM('student','staff','donor','supplier','other') NULL,
  party_id         BIGINT UNSIGNED NULL,
  payment_method   ENUM('cash','bank','bkash','nagad','rocket','cheque','adjustment') NULL,
  instrument_no    VARCHAR(50) NULL,                -- চেক / TrxID
  instrument_date  DATE NULL,
  total_debit      DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_credit     DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- দ্রষ্টব্য: 'reversed' কোনো status নয়। রিভার্স করা ভাউচার 'posted' থেকেই যায়,
  -- নইলে সে খতিয়ান থেকে উড়ে যেত আর রিভার্সালটি একা জের উল্টে দিত।
  status           ENUM('draft','pending','approved','posted','rejected')
                     NOT NULL DEFAULT 'draft',
  reject_reason    VARCHAR(255) NULL,
  receipt_id       BIGINT UNSIGNED NULL,            -- রশিদ মডিউলের সাথে লিংক
  reversal_of_id   BIGINT UNSIGNED NULL,            -- কোন ভাউচারের বিপরীত
  reversed_at      DATETIME NULL,                   -- মূল ভাউচারে বসে: কখন রিভার্স হলো
  reversed_by_voucher_id BIGINT UNSIGNED NULL,      -- কোন রিভার্সাল ভাউচার দিয়ে
  source_module    VARCHAR(40) NOT NULL DEFAULT 'manual',
  source_ref_id    BIGINT UNSIGNED NULL,
  fatwa_override   TINYINT(1) NOT NULL DEFAULT 0,   -- ফান্ড বিধিনিষেধ অতিক্রম
  fatwa_note       TEXT NULL,                       -- লিখিত কারণ (override হলে বাধ্যতামূলক)
  created_by       INT UNSIGNED NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by      INT UNSIGNED NULL,
  approved_at      DATETIME NULL,
  posted_by        INT UNSIGNED NULL,
  posted_at        DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_voucher_no (voucher_no),
  KEY ix_voucher_date (voucher_date, status),
  KEY ix_voucher_period (fiscal_period_id),
  KEY ix_voucher_party (party_type, party_id),
  KEY ix_voucher_source (source_module, source_ref_id),
  KEY ix_voucher_status (status),
  CONSTRAINT fk_voucher_period FOREIGN KEY (fiscal_period_id)
    REFERENCES fiscal_periods (id),
  CONSTRAINT fk_voucher_reversal FOREIGN KEY (reversal_of_id)
    REFERENCES vouchers (id),
  CONSTRAINT fk_voucher_reversed_by FOREIGN KEY (reversed_by_voucher_id)
    REFERENCES vouchers (id),
  CONSTRAINT chk_voucher_balanced
    CHECK (status NOT IN ('posted','approved') OR total_debit = total_credit),
  CONSTRAINT chk_voucher_override
    CHECK (fatwa_override = 0 OR fatwa_note IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৮. ভাউচার লাইন  — আসল ডাবল-এন্ট্রি এখানে
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS voucher_lines;
CREATE TABLE voucher_lines (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_id     BIGINT UNSIGNED NOT NULL,
  line_no        SMALLINT UNSIGNED NOT NULL,
  account_id     INT UNSIGNED NOT NULL,
  fund_id        INT UNSIGNED NOT NULL,            -- বাধ্যতামূলক
  cost_center_id INT UNSIGNED NULL,
  debit          DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit         DECIMAL(14,2) NOT NULL DEFAULT 0,
  party_type     ENUM('student','staff','donor','supplier','other') NULL,
  party_id       BIGINT UNSIGNED NULL,
  student_id     BIGINT UNSIGNED NULL,             -- শিক্ষার্থী লেজার
  sponsorship_id BIGINT UNSIGNED NULL,             -- এতিম স্পনসরশিপ
  line_narration VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_line_no (voucher_id, line_no),
  KEY ix_line_account (account_id),
  KEY ix_line_fund (fund_id),
  KEY ix_line_student (student_id),
  KEY ix_line_party (party_type, party_id),
  CONSTRAINT fk_line_voucher FOREIGN KEY (voucher_id)
    REFERENCES vouchers (id) ON DELETE CASCADE,
  CONSTRAINT fk_line_account FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_line_fund    FOREIGN KEY (fund_id)    REFERENCES funds (id),
  CONSTRAINT fk_line_cc      FOREIGN KEY (cost_center_id) REFERENCES cost_centers (id),
  -- একটি লাইনে ডেবিট বা ক্রেডিট — একদিকই
  CONSTRAINT chk_line_one_side CHECK (debit = 0 OR credit = 0),
  CONSTRAINT chk_line_positive CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT chk_line_nonzero  CHECK (debit > 0 OR credit > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৯. সংযুক্তি
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS voucher_attachments;
CREATE TABLE voucher_attachments (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_id  BIGINT UNSIGNED NOT NULL,
  file_path   VARCHAR(500) NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(100) NULL,
  file_size   INT UNSIGNED NULL,
  uploaded_by INT UNSIGNED NOT NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_att_voucher (voucher_id),
  CONSTRAINT fk_att_voucher FOREIGN KEY (voucher_id)
    REFERENCES vouchers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ১০. প্রারম্ভিক জের (Opening Balance)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS opening_balances;
CREATE TABLE opening_balances (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fiscal_year_id INT UNSIGNED NOT NULL,
  account_id     INT UNSIGNED NOT NULL,
  fund_id        INT UNSIGNED NOT NULL,
  debit          DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit         DECIMAL(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ob (fiscal_year_id, account_id, fund_id),
  CONSTRAINT fk_ob_fy      FOREIGN KEY (fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE,
  CONSTRAINT fk_ob_account FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_ob_fund    FOREIGN KEY (fund_id)    REFERENCES funds (id),
  CONSTRAINT chk_ob_one_side CHECK (debit = 0 OR credit = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ১১. অডিট লগ (অপরিবর্তনীয় — শুধু INSERT)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS audit_logs;
CREATE TABLE audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(50) NOT NULL,       -- 'voucher', 'account', 'fund'
  entity_id   BIGINT UNSIGNED NULL,
  action      VARCHAR(40)  NOT NULL,      -- 'create','approve','post','reverse','lock'
  before_json JSON NULL,
  after_json  JSON NULL,
  reason      VARCHAR(500) NULL,
  user_id     INT UNSIGNED NULL,
  ip_address  VARCHAR(45) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_entity (entity_type, entity_id),
  KEY ix_audit_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
--  ভিউ — রিপোর্টের ভিত্তি (শুধু status='posted' গণনা করে)
-- =====================================================================

-- গুরুত্বপূর্ণ: পোস্ট-ফিল্টার অবশ্যই সাব-কোয়েরির ভেতরে INNER JOIN দিয়ে হতে হবে।
-- LEFT JOIN vouchers ... AND status='posted' লিখলে অপোস্টেড লাইনও যোগ হয়ে যায়
-- (শর্তটি লাইন বাদ দেয় না, শুধু v কে NULL করে) — তাই নিচের কাঠামো।

-- হিসাব × ফান্ড ভিত্তিক জের
DROP VIEW IF EXISTS v_account_fund_balance;
CREATE VIEW v_account_fund_balance AS
SELECT
  vl.account_id,
  a.code    AS account_code,
  a.name_bn AS account_name,
  a.account_class,
  vl.fund_id,
  f.code    AS fund_code,
  f.name_bn AS fund_name,
  SUM(vl.debit)  AS total_debit,
  SUM(vl.credit) AS total_credit,
  SUM(vl.debit - vl.credit) AS net_debit
FROM voucher_lines vl
JOIN vouchers v ON v.id = vl.voucher_id AND v.status = 'posted'
JOIN accounts a ON a.id = vl.account_id
JOIN funds    f ON f.id = vl.fund_id
GROUP BY vl.account_id, a.code, a.name_bn, a.account_class,
         vl.fund_id, f.code, f.name_bn;

-- রেওয়ামিল (Trial Balance)
DROP VIEW IF EXISTS v_trial_balance;
CREATE VIEW v_trial_balance AS
SELECT
  a.id AS account_id, a.code, a.name_bn, a.account_class, a.normal_side,
  COALESCE(x.total_debit, 0)  AS total_debit,
  COALESCE(x.total_credit, 0) AS total_credit,
  CASE WHEN COALESCE(x.net, 0) > 0 THEN x.net ELSE 0 END  AS balance_debit,
  CASE WHEN COALESCE(x.net, 0) < 0 THEN -x.net ELSE 0 END AS balance_credit
FROM accounts a
LEFT JOIN (
  SELECT vl.account_id,
         SUM(vl.debit)  AS total_debit,
         SUM(vl.credit) AS total_credit,
         SUM(vl.debit - vl.credit) AS net
    FROM voucher_lines vl
    JOIN vouchers v ON v.id = vl.voucher_id AND v.status = 'posted'
   GROUP BY vl.account_id
) x ON x.account_id = a.id
WHERE a.is_group = 0;

-- ফান্ডের ব্যবহারযোগ্য জের
--   আয় ক্রেডিট → বাড়ে | ব্যয় ডেবিট → কমে | ফান্ড ব্যালেন্স ক্রেডিট (জের/ট্রান্সফার) → বাড়ে
--   তিনটিই (credit - debit) সূত্রে মিলে যায়
DROP VIEW IF EXISTS v_fund_available;
CREATE VIEW v_fund_available AS
SELECT
  f.id AS fund_id, f.code, f.name_bn, f.fund_type,
  f.allow_negative, f.corpus_protected, f.expiry_date,
  COALESCE(x.available_balance, 0) AS available_balance,
  COALESCE(x.total_received, 0)    AS total_received,
  COALESCE(x.total_spent, 0)       AS total_spent
FROM funds f
LEFT JOIN (
  SELECT vl.fund_id,
         SUM(CASE WHEN a.account_class IN ('income','expense','fund')
                  THEN vl.credit - vl.debit ELSE 0 END) AS available_balance,
         SUM(CASE WHEN a.account_class = 'income'
                  THEN vl.credit - vl.debit ELSE 0 END) AS total_received,
         SUM(CASE WHEN a.account_class = 'expense'
                  THEN vl.debit - vl.credit ELSE 0 END) AS total_spent
    FROM voucher_lines vl
    JOIN vouchers v ON v.id = vl.voucher_id AND v.status = 'posted'
    JOIN accounts a ON a.id = vl.account_id
   GROUP BY vl.fund_id
) x ON x.fund_id = f.id;

-- নগদ ও ব্যাংক জের (ক্যাশ পজিশন)
DROP VIEW IF EXISTS v_cash_position;
CREATE VIEW v_cash_position AS
SELECT
  a.id AS account_id, a.code, a.name_bn, a.account_subtype,
  COALESCE(x.balance, 0) AS balance
FROM accounts a
LEFT JOIN (
  SELECT vl.account_id, SUM(vl.debit - vl.credit) AS balance
    FROM voucher_lines vl
    JOIN vouchers v ON v.id = vl.voucher_id AND v.status = 'posted'
   GROUP BY vl.account_id
) x ON x.account_id = a.id
WHERE a.is_cash_like = 1 AND a.is_active = 1;

-- ফান্ড × নগদ হিসাব: ব্যাংকে থাকা টাকার কোন অংশ কোন ফান্ডের
DROP VIEW IF EXISTS v_fund_cash_split;
CREATE VIEW v_fund_cash_split AS
SELECT
  f.code AS fund_code, f.name_bn AS fund_name,
  a.code AS account_code, a.name_bn AS account_name,
  SUM(vl.debit - vl.credit) AS balance
FROM voucher_lines vl
JOIN vouchers v ON v.id = vl.voucher_id AND v.status = 'posted'
JOIN accounts a ON a.id = vl.account_id AND a.is_cash_like = 1
JOIN funds    f ON f.id = vl.fund_id
GROUP BY f.code, f.name_bn, a.code, a.name_bn
HAVING SUM(vl.debit - vl.credit) <> 0;

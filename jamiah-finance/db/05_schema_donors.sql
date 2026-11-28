-- =====================================================================
--  স্পনসর ও অনুদান বিভাগ — স্কিমা
--  পূর্বশর্ত: 01, 02, 03, 04
--  চালানোর নিয়ম:  mysql -u root -p jamiah < 05_schema_donors.sql
-- =====================================================================
SET NAMES utf8mb4;

DROP TABLE IF EXISTS recurring_plans;
DROP TABLE IF EXISTS pledges;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS donors;

-- ---------------------------------------------------------------------
-- ১. দাতা — শুধু টাকার খাতা নয়, একটি হালকা CRM
-- ---------------------------------------------------------------------
CREATE TABLE donors (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  donor_code     VARCHAR(20) NULL,              -- 'DNR-00001', ইনসার্টের পর বসে
  name           VARCHAR(150) NOT NULL,
  donor_type     ENUM('individual','organization') NOT NULL DEFAULT 'individual',
  mobile         VARCHAR(30)  NULL,             -- থাকলে অদ্বিতীয় — এটাই চেনার চাবি
  email          VARCHAR(150) NULL,
  address        VARCHAR(255) NULL,
  thana          VARCHAR(80)  NULL,
  district       VARCHAR(80)  NULL,
  country        VARCHAR(80)  NOT NULL DEFAULT 'বাংলাদেশ',
  is_expatriate  TINYINT(1) NOT NULL DEFAULT 0, -- প্রবাসী দাতা
  source_bn      VARCHAR(150) NULL,             -- পরিচয়ের সূত্র কে
  preferred_contact ENUM('sms','whatsapp','call','email','none') NOT NULL DEFAULT 'sms',
  language       ENUM('bn','en') NOT NULL DEFAULT 'bn',
  recognition_tier VARCHAR(60) NULL,            -- জীবনসদস্য, পৃষ্ঠপোষক …
  notes_bn       TEXT NULL,
  allow_contact  TINYINT(1) NOT NULL DEFAULT 1, -- যোগাযোগ করতে চান না বললে 0
  merged_into_id BIGINT UNSIGNED NULL,          -- ডুপ্লিকেট একীভূত হলে
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_donor_code (donor_code),
  UNIQUE KEY uq_donor_mobile (mobile),          -- MySQL-এ একাধিক NULL চলে
  KEY ix_donor_name (name),
  KEY ix_donor_area (district, thana),
  KEY ix_donor_country (country, is_expatriate),
  CONSTRAINT fk_donor_merged FOREIGN KEY (merged_into_id) REFERENCES donors (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ২. প্রচারাভিযান — লক্ষ্য বনাম সংগ্রহ
-- ---------------------------------------------------------------------
CREATE TABLE campaigns (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(30) NOT NULL,
  title_bn       VARCHAR(200) NOT NULL,
  description_bn TEXT NULL,
  fund_id        INT UNSIGNED NOT NULL,
  receipt_type_id INT UNSIGNED NULL,            -- ডিফল্ট রশিদের ধরন
  target_amount  DECIMAL(14,2) NOT NULL DEFAULT 0,
  start_date     DATE NULL,
  end_date       DATE NULL,
  is_public      TINYINT(1) NOT NULL DEFAULT 0, -- ওয়েবসাইটে দেখানো যাবে কি
  status         ENUM('draft','active','closed') NOT NULL DEFAULT 'active',
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_code (code),
  KEY ix_campaign_status (status, end_date),
  CONSTRAINT fk_camp_fund FOREIGN KEY (fund_id) REFERENCES funds (id),
  CONSTRAINT fk_camp_rtype FOREIGN KEY (receipt_type_id) REFERENCES receipt_types (id),
  CONSTRAINT chk_camp_target CHECK (target_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৩. প্রতিশ্রুতি (Pledge) — কেউ ৫০ হাজার বলেছেন, ২০ হাজার দিয়েছেন
--    বাকি ৩০ হাজারের ফলো-আপ এখান থেকেই আসে
-- ---------------------------------------------------------------------
CREATE TABLE pledges (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  donor_id     BIGINT UNSIGNED NOT NULL,
  campaign_id  BIGINT UNSIGNED NULL,
  fund_id      INT UNSIGNED NOT NULL,
  amount       DECIMAL(14,2) NOT NULL,
  pledged_date DATE NOT NULL,
  due_date     DATE NULL,
  purpose_bn   VARCHAR(255) NULL,
  status       ENUM('open','partial','fulfilled','cancelled') NOT NULL DEFAULT 'open',
  cancel_reason VARCHAR(255) NULL,
  last_reminded_at DATE NULL,
  reminder_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by   INT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_pledge_donor (donor_id, status),
  KEY ix_pledge_due (status, due_date),
  CONSTRAINT fk_pledge_donor FOREIGN KEY (donor_id) REFERENCES donors (id),
  CONSTRAINT fk_pledge_camp FOREIGN KEY (campaign_id) REFERENCES campaigns (id),
  CONSTRAINT fk_pledge_fund FOREIGN KEY (fund_id) REFERENCES funds (id),
  CONSTRAINT chk_pledge_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৪. মাসিক নিয়মিত দাতা
-- ---------------------------------------------------------------------
CREATE TABLE recurring_plans (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  donor_id        BIGINT UNSIGNED NOT NULL,
  receipt_type_id INT UNSIGNED NOT NULL,
  fund_id         INT UNSIGNED NOT NULL,
  campaign_id     BIGINT UNSIGNED NULL,
  sponsorship_id  BIGINT UNSIGNED NULL,          -- এতিম স্পনসরশিপ হলে
  amount          DECIMAL(14,2) NOT NULL,
  day_of_month    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  start_date      DATE NOT NULL,
  end_date        DATE NULL,
  status          ENUM('active','paused','ended') NOT NULL DEFAULT 'active',
  note_bn         VARCHAR(255) NULL,
  created_by      INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_rec_donor (donor_id, status),
  KEY ix_rec_status (status, day_of_month),
  CONSTRAINT fk_rec_donor FOREIGN KEY (donor_id) REFERENCES donors (id),
  CONSTRAINT fk_rec_rtype FOREIGN KEY (receipt_type_id) REFERENCES receipt_types (id),
  CONSTRAINT fk_rec_fund  FOREIGN KEY (fund_id) REFERENCES funds (id),
  CONSTRAINT fk_rec_camp  FOREIGN KEY (campaign_id) REFERENCES campaigns (id),
  CONSTRAINT chk_rec_amount CHECK (amount > 0),
  CONSTRAINT chk_rec_day CHECK (day_of_month BETWEEN 1 AND 28)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ৫. রশিদের সাথে জোড়া
-- ---------------------------------------------------------------------
ALTER TABLE receipts
  ADD COLUMN campaign_id BIGINT UNSIGNED NULL AFTER donor_id,
  ADD COLUMN pledge_id   BIGINT UNSIGNED NULL AFTER campaign_id,
  ADD COLUMN recurring_plan_id BIGINT UNSIGNED NULL AFTER pledge_id,
  ADD KEY ix_receipt_campaign (campaign_id),
  ADD KEY ix_receipt_pledge (pledge_id),
  ADD CONSTRAINT fk_rc_donor    FOREIGN KEY (donor_id)    REFERENCES donors (id),
  ADD CONSTRAINT fk_rc_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns (id),
  ADD CONSTRAINT fk_rc_pledge   FOREIGN KEY (pledge_id)   REFERENCES pledges (id),
  ADD CONSTRAINT fk_rc_recurring FOREIGN KEY (recurring_plan_id) REFERENCES recurring_plans (id);

-- =====================================================================
--  ভিউ
-- =====================================================================

-- দাতার সারসংক্ষেপ — তালিকা, প্রোফাইল ও নিষ্ক্রিয় দাতার রিপোর্টের ভিত্তি
DROP VIEW IF EXISTS v_donor_summary;
CREATE VIEW v_donor_summary AS
SELECT
  d.id AS donor_id, d.donor_code, d.name, d.donor_type, d.mobile, d.email,
  d.thana, d.district, d.country, d.is_expatriate, d.recognition_tier,
  d.preferred_contact, d.allow_contact, d.is_active, d.merged_into_id,
  COALESCE(x.gift_count, 0)  AS gift_count,
  COALESCE(x.total_given, 0) AS total_given,
  x.first_gift_date, x.last_gift_date,
  CASE WHEN x.last_gift_date IS NULL THEN NULL
       ELSE TIMESTAMPDIFF(MONTH, x.last_gift_date, CURDATE()) END AS months_since_last,
  COALESCE(p.open_pledged, 0) AS open_pledged,
  COALESCE(rp.active_plans, 0) AS active_plans
FROM donors d
LEFT JOIN (
  SELECT donor_id, COUNT(*) AS gift_count, SUM(amount) AS total_given,
         MIN(receipt_date) AS first_gift_date, MAX(receipt_date) AS last_gift_date
    FROM receipts WHERE status = 'issued' AND donor_id IS NOT NULL
   GROUP BY donor_id
) x ON x.donor_id = d.id
LEFT JOIN (
  SELECT donor_id, SUM(amount) AS open_pledged
    FROM pledges WHERE status IN ('open','partial') GROUP BY donor_id
) p ON p.donor_id = d.id
LEFT JOIN (
  SELECT donor_id, COUNT(*) AS active_plans
    FROM recurring_plans WHERE status = 'active' GROUP BY donor_id
) rp ON rp.donor_id = d.id;

-- প্রচারাভিযানের অগ্রগতি
DROP VIEW IF EXISTS v_campaign_progress;
CREATE VIEW v_campaign_progress AS
SELECT
  c.id AS campaign_id, c.code, c.title_bn, c.description_bn, c.status, c.is_public,
  c.target_amount, c.start_date, c.end_date,
  f.code AS fund_code, f.name_bn AS fund_name,
  COALESCE(r.raised, 0) AS raised,
  COALESCE(r.receipt_count, 0) AS receipt_count,
  COALESCE(r.donor_count, 0) AS donor_count,
  GREATEST(c.target_amount - COALESCE(r.raised, 0), 0) AS remaining,
  CASE WHEN c.target_amount > 0
       THEN ROUND(100 * COALESCE(r.raised, 0) / c.target_amount, 1) ELSE NULL END AS pct,
  COALESCE(pl.pledged_open, 0) AS pledged_open,
  CASE WHEN c.end_date IS NULL THEN NULL
       ELSE DATEDIFF(c.end_date, CURDATE()) END AS days_left
FROM campaigns c
JOIN funds f ON f.id = c.fund_id
LEFT JOIN (
  SELECT campaign_id, SUM(amount) AS raised, COUNT(*) AS receipt_count,
         COUNT(DISTINCT donor_id) AS donor_count
    FROM receipts WHERE status = 'issued' AND campaign_id IS NOT NULL
   GROUP BY campaign_id
) r ON r.campaign_id = c.id
LEFT JOIN (
  SELECT campaign_id, SUM(amount) AS pledged_open
    FROM pledges WHERE status IN ('open','partial') AND campaign_id IS NOT NULL
   GROUP BY campaign_id
) pl ON pl.campaign_id = c.id;

-- প্রতিশ্রুতির অবস্থা — কত দেওয়ার কথা, কত এসেছে, কত বাকি
DROP VIEW IF EXISTS v_pledge_status;
CREATE VIEW v_pledge_status AS
SELECT
  p.id AS pledge_id, p.donor_id, d.donor_code, d.name AS donor_name,
  d.mobile, d.preferred_contact, d.allow_contact,
  p.campaign_id, c.title_bn AS campaign_title,
  f.code AS fund_code, f.name_bn AS fund_name,
  p.amount, p.pledged_date, p.due_date, p.purpose_bn, p.status,
  p.last_reminded_at, p.reminder_count,
  COALESCE(r.received, 0) AS received,
  GREATEST(p.amount - COALESCE(r.received, 0), 0) AS outstanding,
  CASE WHEN p.due_date IS NULL THEN NULL
       ELSE DATEDIFF(p.due_date, CURDATE()) END AS days_to_due
FROM pledges p
JOIN donors d ON d.id = p.donor_id
JOIN funds f ON f.id = p.fund_id
LEFT JOIN campaigns c ON c.id = p.campaign_id
LEFT JOIN (
  SELECT pledge_id, SUM(amount) AS received
    FROM receipts WHERE status = 'issued' AND pledge_id IS NOT NULL
   GROUP BY pledge_id
) r ON r.pledge_id = p.id;

-- মাস-ওয়ারি অনুদান — গত বছরের একই মাসের সাথে তুলনার জন্য
DROP VIEW IF EXISTS v_donation_monthly;
CREATE VIEW v_donation_monthly AS
SELECT
  YEAR(r.receipt_date) AS yr, MONTH(r.receipt_date) AS mn,
  rt.code AS type_code, rt.name_bn AS type_name,
  COUNT(*) AS receipt_count,
  COUNT(DISTINCT r.donor_id) AS donor_count,
  SUM(r.amount) AS total_amount
FROM receipts r
JOIN receipt_types rt ON rt.id = r.receipt_type_id
WHERE r.status = 'issued'
GROUP BY YEAR(r.receipt_date), MONTH(r.receipt_date), rt.code, rt.name_bn;

-- এলাকাভিত্তিক সংগ্রহ
DROP VIEW IF EXISTS v_donation_by_area;
CREATE VIEW v_donation_by_area AS
SELECT
  COALESCE(d.district, 'অজানা') AS district,
  COALESCE(d.country, 'বাংলাদেশ') AS country,
  d.is_expatriate,
  COUNT(DISTINCT d.id) AS donor_count,
  COUNT(r.id) AS receipt_count,
  COALESCE(SUM(r.amount), 0) AS total_amount
FROM donors d
LEFT JOIN receipts r ON r.donor_id = d.id AND r.status = 'issued'
GROUP BY COALESCE(d.district, 'অজানা'), COALESCE(d.country, 'বাংলাদেশ'), d.is_expatriate;

-- ---------------------------------------------------------------------
-- ৬. কোন ধরনের রশিদে দাতা রেকর্ড রাখা হবে
--    শিক্ষার্থী ফি ও ঋণ ফেরতে দাতা রাখার মানে নেই — তাতে CRM ভরে যেত
-- ---------------------------------------------------------------------
ALTER TABLE receipt_types
  ADD COLUMN links_donor TINYINT(1) NOT NULL DEFAULT 0 AFTER requires_payer;

UPDATE receipt_types SET links_donor = 1
 WHERE code IN ('ZAK','FIT','DON','ORP','CON','QUR','WAQ','IFT');

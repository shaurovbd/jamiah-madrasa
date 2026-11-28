-- =====================================================================
--  রশিদের ধরন ও নম্বর সিরিজ
--  পূর্বশর্ত: 02_seed_chart_of_accounts.sql, 03_schema_receipts.sql
-- =====================================================================
SET NAMES utf8mb4;

INSERT INTO receipt_types
  (code, name_bn, name_en, prefix, default_fund_id, default_credit_account_id,
   requires_student, requires_payer, allow_fund_change, note_bn, sort_order)
VALUES
('FEE', 'শিক্ষার্থী ফি', 'Student Fee', 'FEE',
  (SELECT id FROM funds WHERE code='GEN'),
  (SELECT id FROM accounts WHERE code='1201'),
  1, 1, 0,
  'বাকি ফি হিসাব কমে। মাসিক ইনভয়েস তৈরি করা না থাকলে জের ঋণাত্মক দেখাবে — আগে ইনভয়েস করুন।', 1),

('ZAK', 'যাকাত', 'Zakat', 'ZAK',
  (SELECT id FROM funds WHERE code='ZAK'),
  (SELECT id FROM accounts WHERE code='4201'),
  0, 1, 0,
  'যাকাত ফান্ডে যাবে। এর ব্যয় শুধু শরীয়তসম্মত খাতে — সিস্টেমই আটকাবে।', 2),

('FIT', 'ফিতরা', 'Fitra', 'FIT',
  (SELECT id FROM funds WHERE code='FIT'),
  (SELECT id FROM accounts WHERE code='4202'),
  0, 1, 0,
  'ঈদের আগেই বিতরণযোগ্য। ফান্ডের expiry_date প্রতি বছর হালনাগাদ করুন।', 3),

('DON', 'সদকা ও সাধারণ অনুদান', 'Sadaqah & Donation', 'DON',
  (SELECT id FROM funds WHERE code='SAD'),
  (SELECT id FROM accounts WHERE code='4203'),
  0, 1, 1,
  'দাতা নির্দিষ্ট খাত বললে ফান্ড বদলে দিন।', 4),

('ORP', 'এতিম স্পনসরশিপ', 'Orphan Sponsorship', 'ORP',
  (SELECT id FROM funds WHERE code='ORP'),
  (SELECT id FROM accounts WHERE code='4205'),
  0, 1, 0,
  'নির্দিষ্ট এতিমের স্পনসরশিপ হলে sponsorship_id দিন।', 5),

('CON', 'নির্মাণ প্রকল্প', 'Construction Project', 'CON',
  (SELECT id FROM funds WHERE code='CON'),
  (SELECT id FROM accounts WHERE code='4206'),
  0, 1, 0,
  'ভবন ও স্থাপনার নির্দিষ্ট অনুদান।', 6),

('QUR', 'কুরবানি চামড়া', 'Qurbani Hide', 'QUR',
  (SELECT id FROM funds WHERE code='QUR'),
  (SELECT id FROM accounts WHERE code='4207'),
  0, 0, 0,
  'চামড়া বিক্রয়ের অর্থ। ক্রেতার নাম payer_name এ।', 7),

('WAQ', 'ওয়াকফ', 'Waqf', 'WAQ',
  (SELECT id FROM funds WHERE code='WAQ'),
  (SELECT id FROM accounts WHERE code='4208'),
  0, 1, 0,
  'কর্পাস সুরক্ষিত — মূল টাকা কখনো ব্যয় হবে না।', 8),

('IFT', 'ইফতার ও খাবার স্পনসর', 'Iftar & Meal Sponsor', 'IFT',
  (SELECT id FROM funds WHERE code='SAD'),
  (SELECT id FROM accounts WHERE code='4209'),
  0, 1, 0,
  'রমজানে দৈনিক ইফতার স্পনসর — তারিখ purpose_bn এ লিখুন।', 9),

('LON', 'ঋণ ফেরত গ্রহণ', 'Loan Repayment Received', 'LON',
  (SELECT id FROM funds WHERE code='GEN'),
  (SELECT id FROM accounts WHERE code='1203'),
  0, 1, 0,
  'স্টাফ ঋণ/অগ্রিম ফেরত। পক্ষ হিসেবে স্টাফ আইডি বাধ্যতামূলক।', 10);

-- প্রতিটি খোলা আর্থিক বছরের জন্য সব ধরনের সিরিজ
INSERT INTO receipt_sequences (receipt_type_id, fiscal_year_id, year_token, last_no, padding)
SELECT rt.id, fy.id, YEAR(fy.start_date), 0, 5
  FROM receipt_types rt
  CROSS JOIN fiscal_years fy
 WHERE fy.status = 'open';

-- নমুনা রশিদ বই (মাঠ কলেক্টরদের জন্য)
INSERT INTO receipt_books (book_no, receipt_type_id, from_no, to_no, status, note_bn) VALUES
('BK-001', (SELECT id FROM receipt_types WHERE code='DON'), 1001, 1100, 'in_store', 'ছাপানো বই — অনুদান'),
('BK-002', (SELECT id FROM receipt_types WHERE code='DON'), 1101, 1200, 'in_store', 'ছাপানো বই — অনুদান'),
('BK-003', (SELECT id FROM receipt_types WHERE code='ZAK'), 2001, 2100, 'in_store', 'ছাপানো বই — যাকাত');

SELECT code, name_bn, prefix FROM receipt_types ORDER BY sort_order;
SELECT COUNT(*) AS সিরিজ FROM receipt_sequences;

-- =====================================================================
--  Jamiah Scholars International — হিসাব ও অর্থ বিভাগ
--  ফাইল ০২: চার্ট অফ অ্যাকাউন্টস + ফান্ড + কস্ট সেন্টার + আর্থিক বছর
--  চালানোর নিয়ম:  mysql -u root -p jamiah < 02_seed_chart_of_accounts.sql
--  পূর্বশর্ত: 01_schema.sql চালানো থাকতে হবে
-- =====================================================================

SET NAMES utf8mb4;

-- ---------- আর্থিক বছর এখানে বদলান (মাদরাসার নিয়ম অনুযায়ী) ----------
SET @fy_name  = '2026';
SET @fy_start = '2026-01-01';
SET @fy_end   = '2026-12-31';
-- ---------------------------------------------------------------------

-- =====================================================================
-- ১. চার্ট অফ অ্যাকাউন্টস
--    parent_code দিয়ে ট্রি গড়া হয়, পরে id-তে রূপান্তর হয়
-- =====================================================================
DROP TEMPORARY TABLE IF EXISTS _coa_stage;
CREATE TEMPORARY TABLE _coa_stage (
  code VARCHAR(20) PRIMARY KEY,
  parent_code VARCHAR(20) NULL,
  name_bn VARCHAR(150), name_en VARCHAR(150),
  account_class VARCHAR(20), account_subtype VARCHAR(20), normal_side VARCHAR(10),
  is_group TINYINT, is_cash_like TINYINT, requires_party TINYINT, sort_order INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO _coa_stage
 (code, parent_code, name_bn, name_en, account_class, account_subtype, normal_side,
  is_group, is_cash_like, requires_party, sort_order) VALUES
-- ===================== ১০০০ সম্পদ =====================
('1000', NULL,  'সম্পদ','Assets','asset','other','debit',1,0,0,1000),
('1100','1000', 'নগদ ও ব্যাংক','Cash & Bank','asset','other','debit',1,0,0,1100),
('1101','1100', 'প্রধান ক্যাশ (অফিস)','Main Cash','asset','cash','debit',0,1,0,1101),
('1102','1100', 'কারণিকের হাতে নগদ','Clerk Cash in Hand','asset','cash','debit',0,1,0,1102),
('1103','1100', 'মাঠ কলেক্টরের হাতে নগদ','Field Collector Cash','asset','cash','debit',0,1,0,1103),
('1111','1100', 'ইসলামী ব্যাংক — চলতি হিসাব','Bank Current A/C','asset','bank','debit',0,1,0,1111),
('1112','1100', 'ব্যাংক — সঞ্চয়ী হিসাব','Bank Savings A/C','asset','bank','debit',0,1,0,1112),
('1121','1100', 'বিকাশ (মার্চেন্ট)','bKash Merchant','asset','mobile_banking','debit',0,1,0,1121),
('1122','1100', 'নগদ (মার্চেন্ট)','Nagad Merchant','asset','mobile_banking','debit',0,1,0,1122),
('1123','1100', 'রকেট','Rocket','asset','mobile_banking','debit',0,1,0,1123),
('1200','1000', 'প্রাপ্য','Receivables','asset','other','debit',1,0,0,1200),
('1201','1200', 'শিক্ষার্থী বাকি ফি','Student Fee Receivable','asset','receivable','debit',0,0,1,1201),
('1202','1200', 'স্পনসর প্রতিশ্রুত বাকি','Sponsor Pledge Receivable','asset','receivable','debit',0,0,1,1202),
('1203','1200', 'স্টাফ ঋণ ও অগ্রিম','Staff Loan & Advance','asset','receivable','debit',0,0,1,1203),
('1204','1200', 'অন্যান্য পাওনা','Other Receivable','asset','receivable','debit',0,0,1,1204),
('1300','1000', 'অগ্রিম প্রদান','Prepaid & Advances','asset','other','debit',1,0,0,1300),
('1301','1300', 'অগ্রিম ভাড়া','Prepaid Rent','asset','prepaid','debit',0,0,0,1301),
('1302','1300', 'সরবরাহকারীকে অগ্রিম','Advance to Supplier','asset','prepaid','debit',0,0,1,1302),
('1400','1000', 'স্থায়ী সম্পদ','Fixed Assets','asset','other','debit',1,0,0,1400),
('1401','1400', 'জমি','Land','asset','fixed_asset','debit',0,0,0,1401),
('1402','1400', 'ভবন ও নির্মাণ','Building & Construction','asset','fixed_asset','debit',0,0,0,1402),
('1403','1400', 'আসবাবপত্র','Furniture & Fixtures','asset','fixed_asset','debit',0,0,0,1403),
('1404','1400', 'বৈদ্যুতিক সরঞ্জাম','Electrical Equipment','asset','fixed_asset','debit',0,0,0,1404),
('1405','1400', 'কম্পিউটার ও আইটি','Computer & IT','asset','fixed_asset','debit',0,0,0,1405),
('1406','1400', 'লাইব্রেরি কিতাব (সম্পদ)','Library Books','asset','fixed_asset','debit',0,0,0,1406),
('1407','1400', 'যানবাহন','Vehicles','asset','fixed_asset','debit',0,0,0,1407),
('1450','1400', 'পুঞ্জীভূত অবচয়','Accumulated Depreciation','asset','contra_asset','credit',0,0,0,1450),
('1500','1000', 'মজুদ','Inventory','asset','other','debit',1,0,0,1500),
('1501','1500', 'খাদ্য মজুদ','Food Stock','asset','inventory','debit',0,0,0,1501),
('1502','1500', 'কিতাব ও শিক্ষা উপকরণ মজুদ','Book & Material Stock','asset','inventory','debit',0,0,0,1502),
-- ===================== ২০০০ দায় =====================
('2000', NULL,  'দায়','Liabilities','liability','other','credit',1,0,0,2000),
('2100','2000', 'চলতি দায়','Current Liabilities','liability','other','credit',1,0,0,2100),
('2101','2100', 'পরিশোধযোগ্য বেতন','Salary Payable','liability','payable','credit',0,0,1,2101),
('2102','2100', 'সরবরাহকারীর বাকি','Supplier Payable','liability','payable','credit',0,0,1,2102),
('2103','2100', 'বকেয়া বিল (বিদ্যুৎ, গ্যাস, পানি)','Utility Bills Payable','liability','payable','credit',0,0,0,2103),
('2200','2000', 'গৃহীত ঋণ (কর্জে হাসানা)','Loans Received','liability','other','credit',1,0,0,2200),
('2201','2200', 'গৃহীত ঋণ — ব্যক্তি/দাতা','Loan from Individual','liability','payable','credit',0,0,1,2201),
('2202','2200', 'গৃহীত ঋণ — প্রতিষ্ঠান','Loan from Institution','liability','payable','credit',0,0,1,2202),
('2300','2000', 'অগ্রিম গৃহীত','Advance Received','liability','other','credit',1,0,0,2300),
('2301','2300', 'শিক্ষার্থীর অগ্রিম জমা ফি','Student Advance Fee','liability','payable','credit',0,0,1,2301),
('2302','2300', 'শিক্ষার্থীর জামানত','Student Security Deposit','liability','payable','credit',0,0,1,2302),
-- ===================== ৩০০০ ফান্ড ব্যালেন্স =====================
('3000', NULL,  'ফান্ড ব্যালেন্স','Fund Balances','fund','other','credit',1,0,0,3000),
('3101','3000', 'সাধারণ ফান্ড ব্যালেন্স','General Fund Balance','fund','fund_balance','credit',0,0,0,3101),
('3102','3000', 'যাকাত ফান্ড ব্যালেন্স','Zakat Fund Balance','fund','fund_balance','credit',0,0,0,3102),
('3103','3000', 'সদকা/লিল্লাহ ফান্ড ব্যালেন্স','Sadaqah Fund Balance','fund','fund_balance','credit',0,0,0,3103),
('3104','3000', 'এতিম ফান্ড ব্যালেন্স','Orphan Fund Balance','fund','fund_balance','credit',0,0,0,3104),
('3105','3000', 'নির্মাণ ফান্ড ব্যালেন্স','Construction Fund Balance','fund','fund_balance','credit',0,0,0,3105),
('3106','3000', 'ওয়াকফ ফান্ড ব্যালেন্স','Waqf Endowment Balance','fund','fund_balance','credit',0,0,0,3106),
('3107','3000', 'ফিতরা ফান্ড ব্যালেন্স','Fitra Fund Balance','fund','fund_balance','credit',0,0,0,3107),
('3108','3000', 'কুরবানি চামড়া ফান্ড ব্যালেন্স','Qurbani Hide Fund Balance','fund','fund_balance','credit',0,0,0,3108),
('3199','3000', 'বছর-সমাপনী উদ্বৃত্ত/ঘাটতি','Year-end Surplus/Deficit','fund','fund_balance','credit',0,0,0,3199),
-- ===================== ৪০০০ আয় =====================
('4000', NULL,  'আয়','Income','income','other','credit',1,0,0,4000),
('4100','4000', 'শিক্ষার্থী ফি আয়','Student Fee Income','income','other','credit',1,0,0,4100),
('4101','4100', 'ভর্তি ফি','Admission Fee','income','other','credit',0,0,0,4101),
('4102','4100', 'মাসিক বেতন/শিক্ষা ফি','Monthly Tuition Fee','income','other','credit',0,0,0,4102),
('4103','4100', 'আবাসিক ফি (সিট)','Hostel Seat Fee','income','other','credit',0,0,0,4103),
('4104','4100', 'খোরাকি/খাবার ফি','Food Fee','income','other','credit',0,0,0,4104),
('4105','4100', 'পরীক্ষা ফি','Exam Fee','income','other','credit',0,0,0,4105),
('4106','4100', 'কিতাব ও উপকরণ বিক্রয়','Book & Material Sales','income','other','credit',0,0,0,4106),
('4107','4100', 'লাইব্রেরি জরিমানা','Library Fine','income','other','credit',0,0,0,4107),
('4108','4100', 'অন্যান্য শিক্ষার্থী ফি','Other Student Fee','income','other','credit',0,0,0,4108),
('4200','4000', 'অনুদান ও যাকাত আয়','Donation & Zakat Income','income','other','credit',1,0,0,4200),
('4201','4200', 'যাকাত আদায়','Zakat Received','income','other','credit',0,0,0,4201),
('4202','4200', 'ফিতরা আদায়','Fitra Received','income','other','credit',0,0,0,4202),
('4203','4200', 'সদকা/লিল্লাহ অনুদান','Sadaqah Received','income','other','credit',0,0,0,4203),
('4204','4200', 'সাধারণ অনুদান','General Donation','income','other','credit',0,0,0,4204),
('4205','4200', 'এতিম স্পনসরশিপ আদায়','Orphan Sponsorship Received','income','other','credit',0,0,0,4205),
('4206','4200', 'নির্দিষ্ট প্রকল্প অনুদান','Project-specific Donation','income','other','credit',0,0,0,4206),
('4207','4200', 'কুরবানি চামড়া বিক্রয়','Qurbani Hide Sales','income','other','credit',0,0,0,4207),
('4208','4200', 'ওয়াকফ গ্রহণ','Waqf Received','income','other','credit',0,0,0,4208),
('4209','4200', 'ইফতার/খাবার স্পনসর','Iftar & Meal Sponsor','income','other','credit',0,0,0,4209),
('4300','4000', 'অন্যান্য আয়','Other Income','income','other','credit',1,0,0,4300),
('4301','4300', 'ভাড়া আয়','Rental Income','income','other','credit',0,0,0,4301),
('4302','4300', 'ইমামত ও খিদমত আয়','Imamat & Services Income','income','other','credit',0,0,0,4302),
('4399','4300', 'বিবিধ আয়','Miscellaneous Income','income','other','credit',0,0,0,4399),
-- ===================== ৫০০০ ব্যয় =====================
('5000', NULL,  'ব্যয়','Expenses','expense','other','debit',1,0,0,5000),
('5100','5000', 'বেতন ও সম্মানী','Salary & Honorarium','expense','other','debit',1,0,0,5100),
('5101','5100', 'শিক্ষক বেতন','Teacher Salary','expense','other','debit',0,0,0,5101),
('5102','5100', 'কর্মচারী বেতন','Staff Salary','expense','other','debit',0,0,0,5102),
('5103','5100', 'ভাতা ও বোনাস','Allowance & Bonus','expense','other','debit',0,0,0,5103),
('5104','5100', 'অতিথি শিক্ষক ও মেহমান সম্মানী','Guest Honorarium','expense','other','debit',0,0,0,5104),
('5200','5000', 'শিক্ষার্থী কল্যাণ','Student Welfare','expense','other','debit',1,0,0,5200),
('5201','5200', 'শিক্ষার্থীদের খাবার','Student Food','expense','other','debit',0,0,0,5201),
('5202','5200', 'শিক্ষার্থী চিকিৎসা','Student Medical','expense','other','debit',0,0,0,5202),
('5203','5200', 'শিক্ষার্থী পোশাক','Student Clothing','expense','other','debit',0,0,0,5203),
('5204','5200', 'কিতাব ও শিক্ষা উপকরণ','Books & Materials','expense','other','debit',0,0,0,5204),
('5205','5200', 'এতিম শিক্ষার্থী বিশেষ ব্যয়','Orphan Special Expense','expense','other','debit',0,0,0,5205),
('5206','5200', 'বৃত্তি ও ফি মাফ','Scholarship & Fee Waiver','expense','other','debit',0,0,0,5206),
('5300','5000', 'ইউটিলিটি ও স্থাপনা','Utilities & Premises','expense','other','debit',1,0,0,5300),
('5301','5300', 'বিদ্যুৎ বিল','Electricity','expense','other','debit',0,0,0,5301),
('5302','5300', 'পানি ও গ্যাস','Water & Gas','expense','other','debit',0,0,0,5302),
('5303','5300', 'ইন্টারনেট ও মোবাইল','Internet & Mobile','expense','other','debit',0,0,0,5303),
('5304','5300', 'ভবন ভাড়া','Building Rent','expense','other','debit',0,0,0,5304),
('5305','5300', 'মেরামত ও রক্ষণাবেক্ষণ','Repair & Maintenance','expense','other','debit',0,0,0,5305),
('5306','5300', 'পরিচ্ছন্নতা সামগ্রী','Cleaning Supplies','expense','other','debit',0,0,0,5306),
('5400','5000', 'প্রশাসনিক ব্যয়','Administrative','expense','other','debit',1,0,0,5400),
('5401','5400', 'অফিস স্টেশনারি ও প্রিন্টিং','Stationery & Printing','expense','other','debit',0,0,0,5401),
('5402','5400', 'পরিবহন ও যাতায়াত','Transport & Travel','expense','other','debit',0,0,0,5402),
('5403','5400', 'ব্যাংক ও মোবাইল ব্যাংকিং চার্জ','Bank & MFS Charges','expense','other','debit',0,0,0,5403),
('5404','5400', 'আইটি ও সফটওয়্যার','IT & Software','expense','other','debit',0,0,0,5404),
('5405','5400', 'প্রচার ও দাওয়াতি ব্যয়','Publicity & Dawah','expense','other','debit',0,0,0,5405),
('5500','5000', 'একাডেমিক ও অনুষ্ঠান','Academic & Events','expense','other','debit',1,0,0,5500),
('5501','5500', 'অনুষ্ঠান (জলসা, খতমে বুখারী)','Events & Jalsa','expense','other','debit',0,0,0,5501),
('5502','5500', 'পরীক্ষা পরিচালনা ব্যয়','Exam Conduct Expense','expense','other','debit',0,0,0,5502),
('5600','5000', 'অবচয়','Depreciation','expense','other','debit',1,0,0,5600),
('5601','5600', 'অবচয় ব্যয়','Depreciation Expense','expense','other','debit',0,0,0,5601),
('5700','5000', 'নির্মাণ ব্যয়','Construction','expense','other','debit',1,0,0,5700),
('5701','5700', 'নির্মাণ ব্যয় (রাজস্ব)','Construction Expense','expense','other','debit',0,0,0,5701),
('5900','5000', 'বিবিধ','Miscellaneous','expense','other','debit',1,0,0,5900),
('5999','5900', 'বিবিধ ব্যয়','Miscellaneous Expense','expense','other','debit',0,0,0,5999);

-- স্টেজিং → accounts
INSERT INTO accounts
 (code, name_bn, name_en, account_class, account_subtype, normal_side,
  is_group, is_postable, is_cash_like, requires_fund, requires_party, is_active, sort_order)
SELECT code, name_bn, name_en, account_class, account_subtype, normal_side,
       is_group,
       CASE WHEN is_group = 1 THEN 0 ELSE 1 END,
       is_cash_like, 1, requires_party, 1, sort_order
FROM _coa_stage
ORDER BY code;

-- parent_code → parent_id
DROP TEMPORARY TABLE IF EXISTS _code_map;
CREATE TEMPORARY TABLE _code_map (
  code VARCHAR(20) PRIMARY KEY, id INT UNSIGNED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO _code_map (code, id) SELECT code, id FROM accounts;

UPDATE accounts a
  JOIN _coa_stage s ON s.code = a.code
  JOIN _code_map  m ON m.code = s.parent_code
SET a.parent_id = m.id
WHERE s.parent_code IS NOT NULL;

DROP TEMPORARY TABLE _coa_stage;
DROP TEMPORARY TABLE _code_map;

-- =====================================================================
-- ২. ফান্ড
-- =====================================================================
INSERT INTO funds
 (code, name_bn, name_en, fund_type, balance_account_id,
  allow_negative, corpus_protected, requires_approval_by, expiry_date, note_bn, sort_order) VALUES
('GEN','সাধারণ ফান্ড','General Fund','unrestricted',
   (SELECT id FROM accounts WHERE code='3101'), 0,0,'chief_accountant',NULL,
   'অনির্দিষ্ট দান ও ফি আয়। যেকোনো বৈধ খাতে ব্যয়যোগ্য।',1),
('ZAK','যাকাত ফান্ড','Zakat Fund','restricted',
   (SELECT id FROM accounts WHERE code='3102'), 0,0,'principal',NULL,
   'শরীয়তসম্মত ৮ খাত। শুধু হোয়াইটলিস্টেড খাতে ব্যয়যোগ্য; মুহতামিমের অনুমোদন বাধ্যতামূলক।',2),
('SAD','সদকা ও লিল্লাহ ফান্ড','Sadaqah Fund','restricted',
   (SELECT id FROM accounts WHERE code='3103'), 0,0,'chief_accountant',NULL,
   'নফল সদকা — প্রতিষ্ঠানের সার্বিক কল্যাণে ব্যয়যোগ্য।',3),
('ORP','এতিম ফান্ড','Orphan Fund','restricted',
   (SELECT id FROM accounts WHERE code='3104'), 0,0,'principal',NULL,
   'এতিম স্পনসরশিপ আদায়। শুধু এতিম শিক্ষার্থীদের ব্যয়ে।',4),
('CON','নির্মাণ ফান্ড','Construction Fund','restricted',
   (SELECT id FROM accounts WHERE code='3105'), 0,0,'committee',NULL,
   'নির্দিষ্ট প্রকল্প — ভবন, আসবাব, স্থাপনা।',5),
('WAQ','ওয়াকফ ফান্ড','Waqf Endowment','endowment',
   (SELECT id FROM accounts WHERE code='3106'), 0,1,'committee',NULL,
   'কর্পাস সুরক্ষিত — মূল টাকা কখনো ব্যয় হবে না, শুধু আয় ব্যয়যোগ্য।',6),
('FIT','ফিতরা ফান্ড','Fitra Fund','restricted',
   (SELECT id FROM accounts WHERE code='3107'), 0,0,'principal',NULL,
   'ঈদের আগেই বিতরণ করতে হয় — expiry_date প্রতি বছর হালনাগাদ করুন।',7),
('QUR','কুরবানি চামড়া ফান্ড','Qurbani Hide Fund','restricted',
   (SELECT id FROM accounts WHERE code='3108'), 0,0,'principal',NULL,
   'চামড়ার মূল্য — গরিব ও এতিম শিক্ষার্থীদের কল্যাণে।',8);

-- =====================================================================
-- ৩. ফান্ড বিধিনিষেধ
--    'allow' সারি থাকলে সেই ফান্ড হোয়াইটলিস্ট মোডে চলে:
--    তালিকার বাইরের কোনো ব্যয় হিসাবে এন্ট্রি দেওয়া যাবে না
-- =====================================================================

-- যাকাত: শুধু সরাসরি দরিদ্র/এতিমের মালিকানায় পৌঁছানো খাত
INSERT INTO fund_account_rules (fund_id, account_id, rule, note_bn)
SELECT f.id, a.id, 'allow', 'যাকাতের শরীয়তসম্মত ব্যয় খাত'
FROM funds f JOIN accounts a ON a.code IN ('5201','5202','5203','5204','5205','5206')
WHERE f.code = 'ZAK';

-- যাকাত: স্পষ্ট নিষেধ (হোয়াইটলিস্টের পরেও বার্তা স্পষ্ট রাখার জন্য)
INSERT INTO fund_account_rules (fund_id, account_id, rule, note_bn)
SELECT f.id, a.id, 'block', 'যাকাতের টাকা প্রতিষ্ঠানের পরিচালন ব্যয়ে ব্যয়যোগ্য নয়'
FROM funds f JOIN accounts a ON a.code IN
  ('5101','5102','5103','5104','5301','5302','5303','5304','5305','5306',
   '5401','5402','5403','5404','5405','5501','5601','5701')
WHERE f.code = 'ZAK';

-- ফিতরা: সরাসরি দরিদ্রের ভোগে
INSERT INTO fund_account_rules (fund_id, account_id, rule, note_bn)
SELECT f.id, a.id, 'allow', 'ফিতরার ব্যয় খাত'
FROM funds f JOIN accounts a ON a.code IN ('5201','5202','5203','5206')
WHERE f.code = 'FIT';

-- এতিম ফান্ড
INSERT INTO fund_account_rules (fund_id, account_id, rule, note_bn)
SELECT f.id, a.id, 'allow', 'এতিম শিক্ষার্থীর ব্যয় খাত'
FROM funds f JOIN accounts a ON a.code IN
  ('5201','5202','5203','5204','5205','5206','5402')
WHERE f.code = 'ORP';

-- কুরবানি চামড়া
INSERT INTO fund_account_rules (fund_id, account_id, rule, note_bn)
SELECT f.id, a.id, 'allow', 'চামড়ার অর্থের ব্যয় খাত'
FROM funds f JOIN accounts a ON a.code IN ('5201','5202','5203','5204','5205','5206')
WHERE f.code = 'QUR';

-- নির্মাণ ফান্ড: নির্মাণ ও মূলধনী সম্পদ
INSERT INTO fund_account_rules (fund_id, account_id, rule, note_bn)
SELECT f.id, a.id, 'allow', 'নির্মাণ প্রকল্পের ব্যয় খাত'
FROM funds f JOIN accounts a ON a.code IN
  ('5701','5305','1402','1403','1404','1401')
WHERE f.code = 'CON';

-- =====================================================================
-- ৪. কস্ট সেন্টার (বিভাগ)
-- =====================================================================
INSERT INTO cost_centers (code, name_bn, name_en, sort_order) VALUES
('HIFZ',   'হিফজুল কুরআন',      'Hifzul Qur''an', 1),
('NAZERA', 'নাজেরা',            'Nazera',         2),
('MAKTAB', 'মক্তব',             'Maktab',         3),
('KITAB',  'কিতাব (আলিম কোর্স)','Kitab (Alim)',   4),
('HOSTEL', 'আবাসিক/হোস্টেল',    'Hostel',         5),
('LIBRARY','লাইব্রেরি',         'Library',        6),
('ADMIN',  'প্রশাসন',           'Administration', 7);

-- =====================================================================
-- ৫. আর্থিক বছর ও ১২টি মাসিক পিরিয়ড
-- =====================================================================
INSERT INTO fiscal_years (name, start_date, end_date, status)
VALUES (@fy_name, @fy_start, @fy_end, 'open');
SET @fy_id = LAST_INSERT_ID();

INSERT INTO fiscal_periods (fiscal_year_id, period_no, label, start_date, end_date, status)
WITH RECURSIVE months (n, d) AS (
  SELECT 1, DATE(@fy_start)
  UNION ALL
  SELECT n + 1, DATE_ADD(d, INTERVAL 1 MONTH) FROM months WHERE n < 12
)
SELECT @fy_id, n,
  CONCAT(
    ELT(MONTH(d),'জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন',
                 'জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'),
    ' ', YEAR(d)),
  d,
  LAST_DAY(d),
  'open'
FROM months;

-- =====================================================================
-- ৬. ভাউচার নম্বর সিরিজ
-- =====================================================================
INSERT INTO voucher_sequences (voucher_type, fiscal_year_id, prefix, year_token, last_no, padding) VALUES
('RV', @fy_id, 'RV', YEAR(@fy_start), 0, 5),
('PV', @fy_id, 'PV', YEAR(@fy_start), 0, 5),
('JV', @fy_id, 'JV', YEAR(@fy_start), 0, 5),
('CV', @fy_id, 'CV', YEAR(@fy_start), 0, 5),
('FT', @fy_id, 'FT', YEAR(@fy_start), 0, 5);

-- =====================================================================
-- যাচাই
-- =====================================================================
SELECT account_class, COUNT(*) AS হিসাব_সংখ্যা FROM accounts GROUP BY account_class;
SELECT COUNT(*) AS ফান্ড FROM funds;
SELECT COUNT(*) AS বিধিনিষেধ FROM fund_account_rules;
SELECT COUNT(*) AS পিরিয়ড FROM fiscal_periods;

-- =====================================================================
--  নমুনা প্রচারাভিযান (ইচ্ছে হলে বাদ দিতে পারেন)
-- =====================================================================
SET NAMES utf8mb4;

INSERT INTO campaigns (code, title_bn, description_bn, fund_id, receipt_type_id,
                       target_amount, start_date, end_date, is_public, status) VALUES
('BUILD-2026', 'নতুন দ্বিতল ভবন নির্মাণ',
 'শিক্ষার্থীদের জন্য ৬টি নতুন শ্রেণিকক্ষ ও একটি লাইব্রেরি।',
 (SELECT id FROM funds WHERE code='CON'),
 (SELECT id FROM receipt_types WHERE code='CON'),
 5000000, '2026-01-01', '2026-12-31', 1, 'active'),

('IFTAR-1447', 'রমজান ১৪৪৭ — ইফতার স্পনসর',
 'প্রতিদিন ২৫০ জন শিক্ষার্থীর ইফতার। এক দিনের স্পনসর ১২,০০০ টাকা।',
 (SELECT id FROM funds WHERE code='SAD'),
 (SELECT id FROM receipt_types WHERE code='IFT'),
 360000, '2026-02-18', '2026-03-19', 1, 'active'),

('WINTER-2026', 'শীতবস্ত্র বিতরণ',
 'এতিম ও দরিদ্র শিক্ষার্থীদের জন্য কম্বল ও শীতের পোশাক।',
 (SELECT id FROM funds WHERE code='ORP'),
 (SELECT id FROM receipt_types WHERE code='ORP'),
 250000, '2026-11-01', '2027-01-31', 1, 'active');

SELECT code, title_bn, target_amount FROM campaigns ORDER BY id;

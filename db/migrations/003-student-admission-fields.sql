-- 003-student-admission-fields.sql
-- Adds the admission-form fields described in the add-student spec.
-- Safe to re-run: duplicate-column / duplicate-key errors are skipped by db/migrate.js.

-- 1. Admission basics
ALTER TABLE students ADD COLUMN admission_type ENUM('new','old') NOT NULL DEFAULT 'new' AFTER admission_no;
ALTER TABLE students ADD COLUMN student_type ENUM('residential','non_residential','day_care') NOT NULL DEFAULT 'non_residential' AFTER admission_type;

-- 2. Personal and previous schooling
ALTER TABLE students ADD COLUMN is_orphan TINYINT(1) NOT NULL DEFAULT 0 AFTER gender;
ALTER TABLE students ADD COLUMN birth_reg_no VARCHAR(40) NULL AFTER dob;
ALTER TABLE students ADD COLUMN madrasa_id_no VARCHAR(40) NULL AFTER birth_reg_no;
ALTER TABLE students ADD COLUMN fingerprint_id VARCHAR(40) NULL AFTER madrasa_id_no;
ALTER TABLE students ADD COLUMN prev_madrasa VARCHAR(200) NULL AFTER fingerprint_id;
ALTER TABLE students ADD COLUMN prev_class VARCHAR(120) NULL AFTER prev_madrasa;
ALTER TABLE students ADD COLUMN prev_result VARCHAR(120) NULL AFTER prev_class;

-- 3. Split address (the old flat address column is kept and still filled)
ALTER TABLE students ADD COLUMN addr_village VARCHAR(120) NULL AFTER address;
ALTER TABLE students ADD COLUMN addr_post VARCHAR(120) NULL AFTER addr_village;
ALTER TABLE students ADD COLUMN addr_thana VARCHAR(120) NULL AFTER addr_post;
ALTER TABLE students ADD COLUMN addr_district VARCHAR(120) NULL AFTER addr_thana;

-- 4. Guardians
ALTER TABLE students ADD COLUMN guardian_relation VARCHAR(80) NULL AFTER guardian_name;
ALTER TABLE students ADD COLUMN guardian_nid VARCHAR(40) NULL AFTER guardian_phone;
ALTER TABLE students ADD COLUMN guardian2_name VARCHAR(140) NULL AFTER guardian_nid;
ALTER TABLE students ADD COLUMN guardian2_phone VARCHAR(40) NULL AFTER guardian2_name;
ALTER TABLE students ADD COLUMN guardian3_name VARCHAR(140) NULL AFTER guardian2_phone;
ALTER TABLE students ADD COLUMN guardian3_phone VARCHAR(40) NULL AFTER guardian3_name;

-- 5. Admission money (filled by stage 2)
ALTER TABLE students ADD COLUMN monthly_fee_discount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER status;
ALTER TABLE students ADD COLUMN admission_fee DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER monthly_fee_discount;
ALTER TABLE students ADD COLUMN admission_fee_discount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER admission_fee;
ALTER TABLE students ADD COLUMN admission_due DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER admission_fee_discount;
ALTER TABLE students ADD COLUMN admission_paid DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER admission_due;

-- 6. Lookups used by attendance devices and fee-month logic
ALTER TABLE students ADD INDEX idx_student_fingerprint (fingerprint_id);
ALTER TABLE students ADD INDEX idx_student_admission_date (admission_date);

-- 7. Carry the old boolean over to the new three-way type
UPDATE students SET student_type = 'residential' WHERE is_resident = 1;

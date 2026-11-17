-- Migration: full admission application form (6 steps, Bangla + English)
-- Run once on an existing database:  npm run migrate
-- Fresh installs get these columns from schema.sql already.

ALTER TABLE admissions
  MODIFY gender ENUM('male','female','other') NOT NULL DEFAULT 'male';

ALTER TABLE admissions
  ADD COLUMN name_en            VARCHAR(160) NULL AFTER name,
  ADD COLUMN nationality        VARCHAR(80)  NULL AFTER dob,
  ADD COLUMN student_mobile     VARCHAR(40)  NULL AFTER nationality,
  ADD COLUMN department_key     VARCHAR(40)  NULL AFTER department_id,
  ADD COLUMN campus             VARCHAR(40)  NULL AFTER department_key,
  ADD COLUMN father_mobile      VARCHAR(40)  NULL AFTER father_name,
  ADD COLUMN father_profession  VARCHAR(120) NULL AFTER father_mobile,
  ADD COLUMN father_income      VARCHAR(60)  NULL AFTER father_profession,
  ADD COLUMN mother_mobile      VARCHAR(40)  NULL AFTER mother_name,
  ADD COLUMN guardian_name      VARCHAR(140) NULL AFTER guardian_phone,
  ADD COLUMN guardian_relation  VARCHAR(80)  NULL AFTER guardian_name,
  ADD COLUMN guardian_address   VARCHAR(255) NULL AFTER guardian_relation,
  ADD COLUMN present_house      VARCHAR(120) NULL AFTER address,
  ADD COLUMN present_moholla    VARCHAR(120) NULL AFTER present_house,
  ADD COLUMN present_thana      VARCHAR(120) NULL AFTER present_moholla,
  ADD COLUMN present_district   VARCHAR(120) NULL AFTER present_thana,
  ADD COLUMN permanent_village  VARCHAR(120) NULL AFTER present_district,
  ADD COLUMN permanent_post     VARCHAR(120) NULL AFTER permanent_village,
  ADD COLUMN permanent_thana    VARCHAR(120) NULL AFTER permanent_post,
  ADD COLUMN permanent_district VARCHAR(120) NULL AFTER permanent_thana,
  ADD COLUMN prev_class         VARCHAR(120) NULL AFTER previous_institution,
  ADD COLUMN target_class       VARCHAR(120) NULL AFTER prev_class;

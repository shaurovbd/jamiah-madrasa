-- Three more panel roles, next to admin / teacher / accountant / librarian:
--
--   principal     মুহতামিম — sees everything except user accounts and settings
--   office        অফিস সহকারী — admissions, students, staff, website content; no money
--   hifz_teacher  হিফজ উস্তাদ — students, routine, attendance and Hifz progress
--
-- Only widens the list: every existing account keeps its role. What each role
-- may open is defined in lib/roles.js.

ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','principal','accountant','office','teacher','hifz_teacher','librarian')
  NOT NULL DEFAULT 'teacher';

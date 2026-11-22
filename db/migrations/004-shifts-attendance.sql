-- Shifts (সকাল / দিবা) and teacher attendance.
--
-- Three parts:
--   1. A `shifts` table holding the bell window and the lateness rules, created
--      and seeded with the two shifts the madrasa already runs.
--   2. `shift_id` on classes, students, staff and attendance. A class carries
--      the default; a student may override it (same class, different sitting);
--      the attendance row keeps the shift it was taken under, so a student who
--      moves shift mid-month does not rewrite last month's report.
--   3. `staff_attendance`, deliberately separate from `attendance`. Teachers
--      have no class or section, and they do have arrival and departure times
--      and a leave type, so sharing one table would mean half-empty columns on
--      both sides.

CREATE TABLE IF NOT EXISTS shifts (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(60)  NOT NULL,
  code          VARCHAR(10)  NOT NULL,
  start_time    TIME         NOT NULL,
  end_time      TIME         NOT NULL,
  -- Minutes after start_time that still count as on time.
  grace_minutes INT          NOT NULL DEFAULT 10,
  -- Minutes after start_time beyond which an arrival is only half a day.
  half_day_after INT         NOT NULL DEFAULT 90,
  -- Weekly holiday as day numbers, 0 = Sunday … 6 = Saturday, e.g. "5" or "5,6".
  weekly_off    VARCHAR(20)  NOT NULL DEFAULT '5',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order    INT          NOT NULL DEFAULT 0,
  UNIQUE KEY uq_shift_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seeded only while the table is still empty, so re-running the migrations
-- never duplicates these rows or undoes the office's edits to them.
-- Seeding is left to 005-shift-entry-exit.sql: on a fresh database this
-- table already has the four entry/exit columns, while on an upgraded one it
-- still has the old three at this point, and one INSERT cannot suit both.

/* --------------------------------------------------- shift_id references */

ALTER TABLE classes ADD COLUMN shift_id INT NULL AFTER department_id;
ALTER TABLE classes ADD CONSTRAINT fk_class_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

ALTER TABLE students ADD COLUMN shift_id INT NULL AFTER section_id;
ALTER TABLE students ADD CONSTRAINT fk_student_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
CREATE INDEX idx_student_shift ON students (shift_id);

ALTER TABLE staff ADD COLUMN shift_id INT NULL AFTER department_id;
ALTER TABLE staff ADD CONSTRAINT fk_staff_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

ALTER TABLE attendance ADD COLUMN shift_id INT NULL AFTER section_id;
ALTER TABLE attendance ADD CONSTRAINT fk_att_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

/* ------------------------------------------------------ staff attendance */

CREATE TABLE IF NOT EXISTS staff_attendance (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  staff_id   INT NOT NULL,
  shift_id   INT NULL,
  adate      DATE NOT NULL,
  status     ENUM('present','absent','late','half_day','leave') NOT NULL DEFAULT 'present',
  in_time    TIME NULL,
  out_time   TIME NULL,
  -- Only meaningful when status = 'leave'; month-end payroll reads it.
  leave_type ENUM('casual','sick','earned','unpaid','maternity','official') NULL,
  -- Who covered the classes, when someone did.
  substitute_id INT NULL,
  remarks    VARCHAR(200) NULL,
  taken_by   INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_staff_att (staff_id, adate),
  CONSTRAINT fk_satt_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  CONSTRAINT fk_satt_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
  CONSTRAINT fk_satt_sub   FOREIGN KEY (substitute_id) REFERENCES staff(id) ON DELETE SET NULL,
  CONSTRAINT fk_satt_user  FOREIGN KEY (taken_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_satt_date (adate, shift_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

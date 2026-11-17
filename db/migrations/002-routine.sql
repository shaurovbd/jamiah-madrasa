-- Weekly class routine (ক্লাস রুটিন)
-- Two tables: the bell times (periods) shared by the whole madrasa, and one
-- row per filled slot in a class's weekly grid.

CREATE TABLE IF NOT EXISTS routine_periods (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(60)  NOT NULL,
  start_time  TIME         NOT NULL,
  end_time    TIME         NOT NULL,
  is_break    TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order  INT          NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS routine_entries (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  academic_year_id INT NULL,
  class_id         INT NOT NULL,
  section_id       INT NULL,
  period_id        INT NOT NULL,
  day_of_week      TINYINT NOT NULL,
  subject_id       INT NULL,
  teacher_id       INT NULL,
  room             VARCHAR(60) NULL,
  note             VARCHAR(255) NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_routine_year    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL,
  CONSTRAINT fk_routine_class   FOREIGN KEY (class_id)   REFERENCES classes(id)         ON DELETE CASCADE,
  CONSTRAINT fk_routine_section FOREIGN KEY (section_id) REFERENCES sections(id)        ON DELETE CASCADE,
  CONSTRAINT fk_routine_period  FOREIGN KEY (period_id)  REFERENCES routine_periods(id) ON DELETE CASCADE,
  CONSTRAINT fk_routine_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)        ON DELETE SET NULL,
  CONSTRAINT fk_routine_teacher FOREIGN KEY (teacher_id) REFERENCES staff(id)           ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_routine_slot ON routine_entries (class_id, section_id, day_of_week, period_id);

CREATE INDEX idx_routine_teacher_slot ON routine_entries (teacher_id, day_of_week, period_id);

-- Starter bell times, inserted only while the table is still empty, so running
-- the migrations again never duplicates them or undoes the office's edits.
INSERT INTO routine_periods (name, start_time, end_time, is_break, sort_order)
SELECT * FROM (
            SELECT '১ম ঘণ্টা'      AS name, '08:00:00' AS start_time, '08:45:00' AS end_time, 0 AS is_break, 1 AS sort_order
  UNION ALL SELECT '২য় ঘণ্টা',      '08:45:00', '09:30:00', 0, 2
  UNION ALL SELECT '৩য় ঘণ্টা',      '09:30:00', '10:15:00', 0, 3
  UNION ALL SELECT 'বিরতি',          '10:15:00', '10:45:00', 1, 4
  UNION ALL SELECT '৪র্থ ঘণ্টা',     '10:45:00', '11:30:00', 0, 5
  UNION ALL SELECT '৫ম ঘণ্টা',      '11:30:00', '12:15:00', 0, 6
  UNION ALL SELECT 'যোহরের নামায',   '12:15:00', '13:00:00', 1, 7
  UNION ALL SELECT '৬ষ্ঠ ঘণ্টা',     '13:00:00', '13:45:00', 0, 8
  UNION ALL SELECT '৭ম ঘণ্টা',      '13:45:00', '14:30:00', 0, 9
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM routine_periods LIMIT 1) AS existing);

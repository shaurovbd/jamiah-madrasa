-- Shifts move from "one start, one end, a grace period" to the four clock
-- times the office actually works with:
--
--   entry_start – entry_end   the window in which arriving is on time
--   exit_start  – exit_end    the window in which leaving is on time
--
-- Two reasons for the change. The office writes these as times, not as a
-- number of minutes, so a grace period made them do arithmetic to answer
-- "until when may they arrive". And there was no way at all to say when the
-- day ends: a single end time cannot tell an early departure from an ordinary
-- one. The windows are also what a fingerprint reader needs later, to decide
-- which shift a punch belongs to, so the shape is settled now rather than
-- changed again once the device is wired in.
--
-- grace_minutes disappears into entry_end (the grace is simply
-- entry_end minus entry_start), so there is only ever one source of truth.
-- half_day_after stays, counted in minutes after entry_start.

ALTER TABLE shifts ADD COLUMN entry_start TIME NULL AFTER code;
ALTER TABLE shifts ADD COLUMN entry_end   TIME NULL AFTER entry_start;
ALTER TABLE shifts ADD COLUMN exit_start  TIME NULL AFTER entry_end;
ALTER TABLE shifts ADD COLUMN exit_end    TIME NULL AFTER exit_start;

-- Carry existing rows over from the old columns.
--
-- This has to cope with two different databases. One upgraded through 004
-- still has start_time, end_time and grace_minutes to copy from. One created
-- fresh from schema.sql never had them, and naming them would fail with
-- "unknown column" and stop the whole run. So the copy is built as text and
-- executed only where those columns exist.
--
-- The old end time becomes the start of the exit window, with half an hour
-- after it to leave, which is the shape of the office's own timings. Both are
-- editable on the shift page afterwards.
SET @has_old := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shifts' AND COLUMN_NAME = 'start_time'
);

SET @copy := IF(@has_old > 0,
  'UPDATE shifts SET entry_start = COALESCE(entry_start, start_time), entry_end = COALESCE(entry_end, ADDTIME(start_time, SEC_TO_TIME(GREATEST(grace_minutes, 0) * 60))), exit_start = COALESCE(exit_start, end_time), exit_end = COALESCE(exit_end, ADDTIME(end_time, SEC_TO_TIME(1800))) WHERE entry_start IS NULL OR entry_end IS NULL OR exit_start IS NULL OR exit_end IS NULL',
  'DO 0'
);

PREPARE copy_times FROM @copy;

EXECUTE copy_times;

DEALLOCATE PREPARE copy_times;

-- A row with nothing to copy from gets the morning timings rather than NULLs,
-- so the NOT NULL below cannot fail on it.
UPDATE shifts SET entry_start = '07:30:00' WHERE entry_start IS NULL;
UPDATE shifts SET entry_end   = '07:40:00' WHERE entry_end IS NULL;
UPDATE shifts SET exit_start  = '11:30:00' WHERE exit_start IS NULL;
UPDATE shifts SET exit_end    = '12:00:00' WHERE exit_end IS NULL;

ALTER TABLE shifts MODIFY COLUMN entry_start TIME NOT NULL;
ALTER TABLE shifts MODIFY COLUMN entry_end   TIME NOT NULL;
ALTER TABLE shifts MODIFY COLUMN exit_start  TIME NOT NULL;
ALTER TABLE shifts MODIFY COLUMN exit_end    TIME NOT NULL;

-- Now that the values are safely in the new columns the old ones go, so no
-- screen can read a stale start time or a grace period that disagrees with
-- entry_end. Dropping a column that is already gone is reported as
-- "already applied" and skipped.
ALTER TABLE shifts DROP COLUMN start_time;

ALTER TABLE shifts DROP COLUMN end_time;

ALTER TABLE shifts DROP COLUMN grace_minutes;

-- The starter shifts, seeded only while the table is still empty, so running
-- the migrations again never duplicates them or undoes the office's edits.
-- This lives here rather than in 004 because only now is the table the same
-- shape on a fresh database and on an upgraded one.
INSERT INTO shifts (name, code, entry_start, entry_end, exit_start, exit_end, half_day_after, weekly_off, is_active, sort_order)
SELECT * FROM (
            SELECT 'সকাল' AS name, 'M' AS code,
                   '07:30:00' AS entry_start, '07:40:00' AS entry_end,
                   '11:30:00' AS exit_start, '12:00:00' AS exit_end,
                   90 AS half_day_after, '5' AS weekly_off, 1 AS is_active, 1 AS sort_order
  UNION ALL SELECT 'দিবা', 'D', '12:00:00', '12:10:00', '16:30:00', '17:00:00', 90, '5', 1, 2
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM shifts LIMIT 1) AS existing);

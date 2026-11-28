-- Guardian portal (/parent): one sign-in per guardian mobile number.
--
-- A guardian signs in with their mobile number and a 6-digit PIN the office
-- gives them (printed slip or SMS). They see every active student whose
-- guardian_phone is that number. Only a hash of the PIN is kept; five wrong
-- tries lock the number for 15 minutes.

CREATE TABLE IF NOT EXISTS guardian_accounts (
  phone          VARCHAR(20) NOT NULL PRIMARY KEY,
  pin_hash       VARCHAR(100) NOT NULL,
  failed_count   INT NOT NULL DEFAULT 0,
  locked_until   DATETIME NULL,
  last_login     DATETIME NULL,
  created_by     INT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

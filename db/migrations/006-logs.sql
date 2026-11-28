-- Logs: three tables behind Settings → Logs (/admin/logs).
--
--   activity_logs  who changed what in the management panel
--   login_logs     every sign-in, failed sign-in and sign-out
--   error_logs     every server error (HTTP 500) the app caught
--
-- Rows are only ever inserted. Nothing in the app updates or deletes an
-- activity row; login and error rows are pruned by age (lib/activity-log.js).
-- user_name / username are copied in so a row still reads correctly after the
-- account is renamed or deleted, which is also why there are no foreign keys.

CREATE TABLE IF NOT EXISTS activity_logs (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NULL,
  user_name    VARCHAR(120) NULL,
  user_role    VARCHAR(30) NULL,
  method       VARCHAR(10) NOT NULL,
  action       VARCHAR(40) NOT NULL,
  module       VARCHAR(40) NOT NULL,
  record_id    VARCHAR(40) NULL,
  record_label VARCHAR(190) NULL,
  path         VARCHAR(255) NOT NULL,
  details      TEXT NULL,
  ip_address   VARCHAR(45) NULL,
  user_agent   VARCHAR(255) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_act_created (created_at),
  KEY idx_act_user (user_id, created_at),
  KEY idx_act_module (module, record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS login_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NULL,
  username    VARCHAR(60) NULL,
  event       ENUM('login','failed','logout') NOT NULL,
  reason      VARCHAR(30) NULL,
  ip_address  VARCHAR(45) NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_login_created (created_at),
  KEY idx_login_ip (ip_address, created_at),
  KEY idx_login_user (username, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS error_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  status      SMALLINT NOT NULL DEFAULT 500,
  method      VARCHAR(10) NULL,
  path        VARCHAR(255) NULL,
  message     VARCHAR(1000) NULL,
  stack       TEXT NULL,
  user_id     INT NULL,
  user_name   VARCHAR(120) NULL,
  ip_address  VARCHAR(45) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_err_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

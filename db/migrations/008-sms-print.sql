-- SMS to guardians, and a register of issued certificates.
--
--   sms_batches        one row per "send": who sent what kind, how many went
--   sms_logs           one row per message, with the gateway's answer
--   issued_documents   testimonials, transfer certificates and Hifz
--                      certificates, each with its own serial number
--
-- Nothing existing is changed.

CREATE TABLE IF NOT EXISTS sms_batches (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  kind         VARCHAR(30) NOT NULL,
  title        VARCHAR(190) NULL,
  provider     VARCHAR(20) NOT NULL,
  total        INT NOT NULL DEFAULT 0,
  sent         INT NOT NULL DEFAULT 0,
  failed       INT NOT NULL DEFAULT 0,
  created_by   INT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at  DATETIME NULL,
  KEY idx_smsb_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sms_logs (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id        INT NOT NULL,
  phone           VARCHAR(20) NOT NULL,
  recipient_name  VARCHAR(140) NULL,
  student_id      INT NULL,
  staff_id        INT NULL,
  message         TEXT NOT NULL,
  parts           TINYINT NOT NULL DEFAULT 1,
  status          ENUM('queued','sent','failed','test') NOT NULL DEFAULT 'queued',
  response        VARCHAR(500) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at         DATETIME NULL,
  KEY idx_smsl_batch (batch_id, status),
  KEY idx_smsl_student (student_id),
  KEY idx_smsl_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS issued_documents (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  doc_type    ENUM('testimonial','tc','hifz') NOT NULL,
  serial_no   VARCHAR(30) NOT NULL UNIQUE,
  student_id  INT NOT NULL,
  lang        VARCHAR(5) NOT NULL DEFAULT 'bn',
  data        TEXT NULL,
  issued_by   INT NULL,
  issued_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_doc_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

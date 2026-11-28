-- Payroll and leave.
--
--   payroll_runs     one per month: draft while being checked, then finalised
--   payslips         one per staff member per run
--   staff_advances   money given ahead of salary, recovered from payslips
--   leave_requests   staff apply, the principal decides; an approved request
--                    is written into staff_attendance as 'leave' days
--
-- Paying salaries and giving advances post vouchers in the finance ledger
-- (jamiah_finance), so they go through its approval, period and cash checks.

CREATE TABLE IF NOT EXISTS payroll_runs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  period        VARCHAR(7) NOT NULL UNIQUE,
  status        ENUM('draft','final') NOT NULL DEFAULT 'draft',
  note          VARCHAR(255) NULL,
  created_by    INT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_by  INT NULL,
  finalized_at  DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payslips (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  run_id             INT NOT NULL,
  staff_id           INT NOT NULL,
  expense_head       ENUM('teacher','staff') NOT NULL DEFAULT 'staff',
  basic              DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowance          DECIMAL(12,2) NOT NULL DEFAULT 0,
  bonus              DECIMAL(12,2) NOT NULL DEFAULT 0,
  days_in_month      TINYINT NOT NULL DEFAULT 30,
  absent_days        DECIMAL(5,1) NOT NULL DEFAULT 0,
  unpaid_leave_days  DECIMAL(5,1) NOT NULL DEFAULT 0,
  late_days          INT NOT NULL DEFAULT 0,
  absence_deduction  DECIMAL(12,2) NOT NULL DEFAULT 0,
  advance_deduction  DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_deduction    DECIMAL(12,2) NOT NULL DEFAULT 0,
  net                DECIMAL(12,2) NOT NULL DEFAULT 0,
  note               VARCHAR(255) NULL,
  status             ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
  paid_on            DATE NULL,
  voucher_id         INT NULL,
  voucher_no         VARCHAR(40) NULL,
  UNIQUE KEY uq_payslip (run_id, staff_id),
  KEY idx_payslip_staff (staff_id),
  CONSTRAINT fk_payslip_run FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_payslip_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS staff_advances (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  staff_id             INT NOT NULL,
  amount               DECIMAL(12,2) NOT NULL,
  monthly_installment  DECIMAL(12,2) NOT NULL,
  recovered            DECIMAL(12,2) NOT NULL DEFAULT 0,
  given_on             DATE NOT NULL,
  note                 VARCHAR(255) NULL,
  voucher_no           VARCHAR(40) NULL,
  created_by           INT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_adv_staff (staff_id),
  CONSTRAINT fk_adv_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS leave_requests (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  staff_id       INT NOT NULL,
  leave_type     ENUM('casual','sick','earned','unpaid','maternity','official') NOT NULL DEFAULT 'casual',
  from_date      DATE NOT NULL,
  to_date        DATE NOT NULL,
  days           INT NOT NULL DEFAULT 1,
  reason         VARCHAR(500) NULL,
  status         ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  requested_by   INT NULL,
  decided_by     INT NULL,
  decided_at     DATETIME NULL,
  decision_note  VARCHAR(255) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_leave_staff (staff_id, from_date),
  KEY idx_leave_status (status),
  CONSTRAINT fk_leave_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

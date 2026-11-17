-- Jamiah Scholars International - Madrasa Management System
-- MySQL / MariaDB schema. Safe to run repeatedly.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS settings (
  skey        VARCHAR(64) PRIMARY KEY,
  svalue      TEXT,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  username      VARCHAR(60) NOT NULL UNIQUE,
  email         VARCHAR(160),
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','teacher','accountant','librarian') NOT NULL DEFAULT 'teacher',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  last_login    DATETIME NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS academic_years (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(40) NOT NULL UNIQUE,
  start_date DATE NULL,
  end_date   DATE NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS departments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(140) NOT NULL UNIQUE,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS staff (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  staff_no      VARCHAR(30) NOT NULL UNIQUE,
  name          VARCHAR(140) NOT NULL,
  designation   VARCHAR(120),
  department_id INT NULL,
  qualification VARCHAR(200),
  phone         VARCHAR(40),
  email         VARCHAR(160),
  address       VARCHAR(255),
  photo         VARCHAR(255),
  join_date     DATE NULL,
  salary        DECIMAL(12,2) NOT NULL DEFAULT 0,
  status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
  user_id       INT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_staff_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_staff_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS classes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NULL,
  name          VARCHAR(100) NOT NULL,
  level         INT NOT NULL DEFAULT 0,
  sort_order    INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_class_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sections (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  class_id   INT NOT NULL,
  name       VARCHAR(60) NOT NULL,
  capacity   INT NOT NULL DEFAULT 40,
  teacher_id INT NULL,
  CONSTRAINT fk_section_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_section_teacher FOREIGN KEY (teacher_id) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subjects (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  class_id    INT NOT NULL,
  name        VARCHAR(140) NOT NULL,
  code        VARCHAR(30),
  full_marks  INT NOT NULL DEFAULT 100,
  pass_marks  INT NOT NULL DEFAULT 33,
  teacher_id  INT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_subject_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_subject_teacher FOREIGN KEY (teacher_id) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS students (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  admission_no        VARCHAR(30) NOT NULL UNIQUE,
  roll_no             VARCHAR(20),
  name                VARCHAR(140) NOT NULL,
  father_name         VARCHAR(140),
  mother_name         VARCHAR(140),
  guardian_name       VARCHAR(140),
  guardian_phone      VARCHAR(40),
  dob                 DATE NULL,
  gender              ENUM('male','female') NOT NULL DEFAULT 'male',
  blood_group         VARCHAR(10),
  address             VARCHAR(255),
  photo               VARCHAR(255),
  department_id       INT NULL,
  class_id            INT NULL,
  section_id          INT NULL,
  academic_year_id    INT NULL,
  admission_date      DATE NULL,
  is_resident         TINYINT(1) NOT NULL DEFAULT 0,
  hifz_para_completed INT NOT NULL DEFAULT 0,
  status              ENUM('active','passed','left') NOT NULL DEFAULT 'active',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_student_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_student_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
  CONSTRAINT fk_student_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL,
  CONSTRAINT fk_student_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL,
  INDEX idx_student_class (class_id, section_id),
  INDEX idx_student_roll (roll_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admissions (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  application_no      VARCHAR(30) NOT NULL UNIQUE,
  name                VARCHAR(140) NOT NULL,
  father_name         VARCHAR(140),
  mother_name         VARCHAR(140),
  guardian_phone      VARCHAR(40) NOT NULL,
  email               VARCHAR(160),
  dob                 DATE NULL,
  gender              ENUM('male','female') NOT NULL DEFAULT 'male',
  address             VARCHAR(255),
  previous_institution VARCHAR(200),
  department_id       INT NULL,
  class_id            INT NULL,
  note                TEXT,
  status              ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  student_id          INT NULL,
  applied_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at        DATETIME NULL,
  CONSTRAINT fk_adm_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_adm_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
  CONSTRAINT fk_adm_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attendance (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  class_id   INT NULL,
  section_id INT NULL,
  adate      DATE NOT NULL,
  status     ENUM('present','absent','late','leave') NOT NULL DEFAULT 'present',
  remarks    VARCHAR(200),
  taken_by   INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_att (student_id, adate),
  CONSTRAINT fk_att_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  INDEX idx_att_date (adate, class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS exams (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(140) NOT NULL,
  academic_year_id INT NULL,
  start_date       DATE NULL,
  end_date         DATE NULL,
  is_published     TINYINT(1) NOT NULL DEFAULT 0,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_exam_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS exam_marks (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  exam_id    INT NOT NULL,
  student_id INT NOT NULL,
  subject_id INT NOT NULL,
  marks      DECIMAL(6,2) NOT NULL DEFAULT 0,
  is_absent  TINYINT(1) NOT NULL DEFAULT 0,
  entered_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mark (exam_id, student_id, subject_id),
  CONSTRAINT fk_mark_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_mark_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_mark_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hifz_progress (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  student_id    INT NOT NULL,
  pdate         DATE NOT NULL,
  sabak_surah   VARCHAR(80),
  sabak_from    VARCHAR(40),
  sabak_to      VARCHAR(40),
  sabak_lines   INT NOT NULL DEFAULT 0,
  sabqi_para    VARCHAR(40),
  manzil_para   VARCHAR(40),
  rating        ENUM('excellent','good','average','weak') NOT NULL DEFAULT 'good',
  teacher_id    INT NULL,
  remarks       VARCHAR(255),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hifz (student_id, pdate),
  CONSTRAINT fk_hifz_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_hifz_teacher FOREIGN KEY (teacher_id) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fee_heads (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(120) NOT NULL,
  ftype     ENUM('monthly','one_time','annual') NOT NULL DEFAULT 'monthly',
  amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fee_structures (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  class_id    INT NOT NULL,
  fee_head_id INT NOT NULL,
  amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_struct (class_id, fee_head_id),
  CONSTRAINT fk_fs_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_fs_head FOREIGN KEY (fee_head_id) REFERENCES fee_heads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fee_invoices (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no   VARCHAR(30) NOT NULL UNIQUE,
  student_id   INT NOT NULL,
  period       VARCHAR(7) NOT NULL,
  issue_date   DATE NOT NULL,
  due_date     DATE NULL,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  status       ENUM('unpaid','partial','paid') NOT NULL DEFAULT 'unpaid',
  note         VARCHAR(255),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_period (student_id, period),
  CONSTRAINT fk_inv_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  INDEX idx_inv_status (status, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fee_invoice_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id  INT NOT NULL,
  fee_head_id INT NULL,
  description VARCHAR(160) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_item_invoice FOREIGN KEY (invoice_id) REFERENCES fee_invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_head FOREIGN KEY (fee_head_id) REFERENCES fee_heads(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fee_payments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  receipt_no  VARCHAR(30) NOT NULL UNIQUE,
  invoice_id  INT NOT NULL,
  student_id  INT NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  method      ENUM('cash','bank','mobile','other') NOT NULL DEFAULT 'cash',
  paid_on     DATE NOT NULL,
  received_by INT NULL,
  note        VARCHAR(255),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pay_invoice FOREIGN KEY (invoice_id) REFERENCES fee_invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_pay_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  INDEX idx_pay_date (paid_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ledger_categories (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(120) NOT NULL,
  ctype ENUM('income','expense') NOT NULL DEFAULT 'expense'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  edate       DATE NOT NULL,
  category_id INT NULL,
  etype       ENUM('income','expense') NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  description VARCHAR(255),
  reference   VARCHAR(80),
  created_by  INT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ledger_cat FOREIGN KEY (category_id) REFERENCES ledger_categories(id) ON DELETE SET NULL,
  INDEX idx_ledger_date (edate, etype)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS books (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  book_no          VARCHAR(40) NOT NULL UNIQUE,
  title            VARCHAR(200) NOT NULL,
  author           VARCHAR(160),
  publisher        VARCHAR(160),
  category         VARCHAR(100),
  shelf            VARCHAR(60),
  total_copies     INT NOT NULL DEFAULT 1,
  available_copies INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS book_issues (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  book_id     INT NOT NULL,
  student_id  INT NULL,
  staff_id    INT NULL,
  issue_date  DATE NOT NULL,
  due_date    DATE NOT NULL,
  return_date DATE NULL,
  fine        DECIMAL(10,2) NOT NULL DEFAULT 0,
  status      ENUM('issued','returned','lost') NOT NULL DEFAULT 'issued',
  CONSTRAINT fk_issue_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  CONSTRAINT fk_issue_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
  CONSTRAINT fk_issue_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hostel_rooms (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  room_no     VARCHAR(30) NOT NULL UNIQUE,
  block       VARCHAR(60),
  capacity    INT NOT NULL DEFAULT 4,
  monthly_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes       VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hostel_allocations (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  room_id       INT NOT NULL,
  student_id    INT NOT NULL,
  allocated_on  DATE NOT NULL,
  vacated_on    DATE NULL,
  status        ENUM('active','vacated') NOT NULL DEFAULT 'active',
  CONSTRAINT fk_alloc_room FOREIGN KEY (room_id) REFERENCES hostel_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_alloc_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notices (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  title        VARCHAR(200) NOT NULL,
  slug         VARCHAR(220) NOT NULL UNIQUE,
  body         MEDIUMTEXT,
  category     VARCHAR(80) DEFAULT 'General',
  attachment   VARCHAR(255),
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  published_at DATE NULL,
  created_by   INT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS events (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  title        VARCHAR(200) NOT NULL,
  slug         VARCHAR(220) NOT NULL UNIQUE,
  description  MEDIUMTEXT,
  event_date   DATE NOT NULL,
  end_date     DATE NULL,
  location     VARCHAR(160),
  image        VARCHAR(255),
  is_published TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gallery (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(160),
  album      VARCHAR(100) DEFAULT 'Campus',
  image      VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pages (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(120) NOT NULL UNIQUE,
  title        VARCHAR(200) NOT NULL,
  body         MEDIUMTEXT,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS contact_messages (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(140) NOT NULL,
  email      VARCHAR(160),
  phone      VARCHAR(40),
  subject    VARCHAR(200),
  message    TEXT NOT NULL,
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

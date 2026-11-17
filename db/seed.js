'use strict';
/**
 * Seeds reference data (settings, admin user, departments, classes, fee heads).
 * Safe to run repeatedly: existing rows are left alone.
 * Set SEED_DEMO=1 to also create sample students, staff and notices.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function seedSettings() {
  const defaults = {
    site_name: 'Jamiah Scholars International',
    site_short: 'Jamiah Scholars',
    tagline: 'Rooted in Revelation, Reaching for Excellence',
    established: '2015',
    address: 'Dhaka, Bangladesh',
    phone: '+880 1700-000000',
    email: 'info@jamiahscholarsinternational.com',
    currency: 'BDT',
    currency_symbol: 'Tk',
    facebook: '',
    youtube: '',
    principal_name: '',
    principal_message: 'Welcome to Jamiah Scholars International, where classical Islamic scholarship meets contemporary academic rigour. Our students memorise the Qur’an, study the sacred sciences, and grow into people of character who serve their communities with knowledge and sincerity.',
    about_intro: 'Jamiah Scholars International is an Islamic educational institution offering Hifzul Qur’an, Nazera, Maktab and the full Kitab syllabus alongside essential general education.',
    result_notice: 'Enter your roll number and select the examination to view your result.'
  };
  for (const [k, v] of Object.entries(defaults)) {
    await db.run('INSERT IGNORE INTO settings (skey, svalue) VALUES (?, ?)', [k, v]);
  }
}

async function seedAdmin() {
  const existing = await db.one('SELECT id FROM users WHERE username = ?', ['admin']);
  if (existing) return console.log('- admin user already exists, left unchanged');
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe@2026';
  const hash = await bcrypt.hash(password, 10);
  await db.run(
    'INSERT INTO users (name, username, email, password_hash, role) VALUES (?,?,?,?,?)',
    ['Administrator', 'admin', process.env.ADMIN_EMAIL || 'admin@jamiahscholarsinternational.com', hash, 'admin']
  );
  console.log('- admin user created (username: admin). Change the password after first login.');
}

async function seedAcademics() {
  const yearName = String(new Date().getFullYear());
  let year = await db.one('SELECT id FROM academic_years WHERE name = ?', [yearName]);
  if (!year) {
    const r = await db.run(
      'INSERT INTO academic_years (name, start_date, end_date, is_current) VALUES (?,?,?,1)',
      [yearName, `${yearName}-01-01`, `${yearName}-12-31`]
    );
    year = { id: r.insertId };
  }

  const departments = [
    { name: 'Hifzul Qur’an', description: 'Full memorisation of the Holy Qur’an with tajweed, under one-to-one supervision of qualified huffaz.', order: 1,
      classes: ['Hifz Year 1', 'Hifz Year 2', 'Hifz Year 3'] },
    { name: 'Nazera', description: 'Fluent and correct recitation of the Qur’an with the rules of tajweed, preparing students for hifz.', order: 2,
      classes: ['Nazera Beginner', 'Nazera Advanced'] },
    { name: 'Maktab', description: 'Foundational Islamic education for young children: Qaidah, basic aqeedah, du‘a and Islamic manners.', order: 3,
      classes: ['Maktab 1', 'Maktab 2'] },
    { name: 'Kitab (Alim Course)', description: 'The classical dars-e-nizami syllabus: Arabic grammar, fiqh, hadith, tafsir and usul, alongside general education.', order: 4,
      classes: ['Ibtidaiyyah', 'Mutawassitah', 'Thanawiyyah', 'Aliyah', 'Fazilah'] }
  ];

  for (const d of departments) {
    let dept = await db.one('SELECT id FROM departments WHERE slug = ?', [slug(d.name)]);
    if (!dept) {
      const r = await db.run(
        'INSERT INTO departments (name, slug, description, sort_order) VALUES (?,?,?,?)',
        [d.name, slug(d.name), d.description, d.order]
      );
      dept = { id: r.insertId };
    }
    let level = 1;
    for (const cname of d.classes) {
      const exists = await db.one('SELECT id FROM classes WHERE name = ? AND department_id = ?', [cname, dept.id]);
      if (!exists) {
        const cr = await db.run(
          'INSERT INTO classes (department_id, name, level, sort_order) VALUES (?,?,?,?)',
          [dept.id, cname, level, level]
        );
        await db.run('INSERT INTO sections (class_id, name, capacity) VALUES (?,?,?)', [cr.insertId, 'A', 40]);
      }
      level++;
    }
  }
  return year.id;
}

async function seedSubjects() {
  const count = await db.scalar('SELECT COUNT(*) AS c FROM subjects');
  if (count > 0) return;
  const classes = await db.query('SELECT c.id, c.name, d.name AS dept FROM classes c LEFT JOIN departments d ON d.id = c.department_id');
  const bySyllabus = {
    'Hifzul Qur’an': ['Hifz (Memorisation)', 'Tajweed', 'Daily Du‘a', 'Islamic Manners'],
    'Nazera': ['Nazera Recitation', 'Tajweed', 'Qaidah', 'Masnoon Du‘a'],
    'Maktab': ['Noorani Qaidah', 'Basic Aqeedah', 'Du‘a and Sunnah', 'Handwriting'],
    'Kitab (Alim Course)': ['Arabic Grammar (Nahw)', 'Arabic Morphology (Sarf)', 'Fiqh', 'Hadith', 'Tafsir', 'Aqeedah', 'Bangla', 'English', 'Mathematics']
  };
  for (const c of classes) {
    const subjects = bySyllabus[c.dept] || ['Qur’an', 'Islamic Studies', 'Language', 'Mathematics'];
    let i = 1;
    for (const s of subjects) {
      await db.run(
        'INSERT INTO subjects (class_id, name, code, full_marks, pass_marks, sort_order) VALUES (?,?,?,?,?,?)',
        [c.id, s, `${String(c.id).padStart(2, '0')}${String(i).padStart(2, '0')}`, 100, 33, i]
      );
      i++;
    }
  }
}

async function seedFinance() {
  const heads = [
    ['Tuition Fee', 'monthly', 800],
    ['Hostel Fee', 'monthly', 2500],
    ['Food Fee', 'monthly', 3000],
    ['Admission Fee', 'one_time', 2000],
    ['Exam Fee', 'annual', 500],
    ['Library Fee', 'annual', 300]
  ];
  for (const [name, ftype, amount] of heads) {
    const exists = await db.one('SELECT id FROM fee_heads WHERE name = ?', [name]);
    if (!exists) await db.run('INSERT INTO fee_heads (name, ftype, amount) VALUES (?,?,?)', [name, ftype, amount]);
  }

  const cats = [
    ['Tuition Income', 'income'], ['Donation / Sadaqah', 'income'], ['Zakat Fund', 'income'], ['Other Income', 'income'],
    ['Salaries', 'expense'], ['Food and Kitchen', 'expense'], ['Utilities', 'expense'],
    ['Maintenance', 'expense'], ['Books and Stationery', 'expense'], ['Other Expense', 'expense']
  ];
  for (const [name, ctype] of cats) {
    const exists = await db.one('SELECT id FROM ledger_categories WHERE name = ?', [name]);
    if (!exists) await db.run('INSERT INTO ledger_categories (name, ctype) VALUES (?,?)', [name, ctype]);
  }

  // Default fee structure: tuition for every class.
  const tuition = await db.one('SELECT id, amount FROM fee_heads WHERE name = ?', ['Tuition Fee']);
  if (tuition) {
    const classes = await db.query('SELECT id FROM classes');
    for (const c of classes) {
      await db.run(
        'INSERT IGNORE INTO fee_structures (class_id, fee_head_id, amount) VALUES (?,?,?)',
        [c.id, tuition.id, tuition.amount]
      );
    }
  }
}

async function seedPages() {
  const pages = [
    ['about', 'About Us', 'Jamiah Scholars International was founded to nurture a generation that carries the Qur’an in its heart and serves society with knowledge, integrity and compassion. Our campus brings together experienced huffaz, qualified ulama and dedicated general-subject teachers under one roof.'],
    ['mission', 'Mission and Vision', 'Our mission is to provide an education in which the sacred sciences and the essential skills of modern life reinforce one another, so that our graduates are grounded in revelation and capable in the world.'],
    ['facilities', 'Facilities', 'Purpose-built classrooms, a dedicated hifz hall, a reference library, a residential hostel with supervised study hours, a hygienic kitchen and dining hall, and open space for sport and recreation.']
  ];
  for (const [s, t, b] of pages) {
    await db.run('INSERT IGNORE INTO pages (slug, title, body) VALUES (?,?,?)', [s, t, b]);
  }

  const rooms = [['A-101', 'Block A', 6], ['A-102', 'Block A', 6], ['B-201', 'Block B', 4], ['B-202', 'Block B', 4]];
  for (const [no, block, cap] of rooms) {
    await db.run('INSERT IGNORE INTO hostel_rooms (room_no, block, capacity, monthly_fee) VALUES (?,?,?,?)', [no, block, cap, 2500]);
  }
}

async function seedDemo() {
  if (process.env.SEED_DEMO !== '1') return;
  const already = await db.scalar('SELECT COUNT(*) AS c FROM students');
  if (already > 0) return console.log('- demo data skipped (students already present)');

  const dept = await db.one('SELECT id FROM departments ORDER BY sort_order LIMIT 1');
  const klass = await db.one('SELECT id FROM classes WHERE department_id = ? ORDER BY level LIMIT 1', [dept.id]);
  const section = await db.one('SELECT id FROM sections WHERE class_id = ? LIMIT 1', [klass.id]);
  const year = await db.one('SELECT id FROM academic_years WHERE is_current = 1 LIMIT 1');

  const staffRows = [
    ['Mufti Abdullah Rahman', 'Principal', 'Dars-e-Nizami, Ifta'],
    ['Hafiz Ismail Hossain', 'Hifz Teacher', 'Hifzul Qur’an, Qira’at'],
    ['Maulana Yusuf Ali', 'Senior Teacher', 'Dars-e-Nizami'],
    ['Mr. Rafiqul Islam', 'English Teacher', 'MA in English']
  ];
  let sn = 1;
  for (const [name, designation, qual] of staffRows) {
    await db.run(
      'INSERT INTO staff (staff_no, name, designation, department_id, qualification, phone, join_date, salary) VALUES (?,?,?,?,?,?,?,?)',
      [`STF-${String(sn).padStart(3, '0')}`, name, designation, dept.id, qual, '+8801700000' + String(sn).padStart(2, '0'), '2024-01-01', 25000]
    );
    sn++;
  }

  const names = ['Abdullah Al Mamun', 'Muhammad Ibrahim', 'Ahmad Hasan', 'Bilal Uddin', 'Omar Faruk',
                 'Zakaria Hossain', 'Yusuf Khan', 'Hamza Rahman', 'Talha Ahmed', 'Suhaib Karim'];
  let i = 1;
  for (const name of names) {
    await db.run(
      `INSERT INTO students (admission_no, roll_no, name, father_name, guardian_phone, dob, gender,
         address, department_id, class_id, section_id, academic_year_id, admission_date, is_resident)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`ADM-2026-${String(i).padStart(4, '0')}`, String(i), name, 'Md. Abdul Karim', '+88017120000' + String(i).padStart(2, '0'),
       '2012-03-15', 'male', 'Dhaka, Bangladesh', dept.id, klass.id, section.id, year ? year.id : null,
       '2026-01-10', i % 2 === 0 ? 1 : 0]
    );
    i++;
  }

  const notices = [
    ['Annual Examination Schedule Published', 'The schedule for the annual examination has been published. Students should collect their seat plan from the office.', 'Examination'],
    ['Admission Open for the New Session', 'Admission is now open for Hifz, Nazera, Maktab and Kitab departments. Apply online or visit the campus office.', 'Admission'],
    ['Weekly Holiday Change Notice', 'From next month the weekly holiday will be observed on Friday only. Classes will run as usual on other days.', 'General']
  ];
  for (const [title, body, cat] of notices) {
    await db.run(
      'INSERT IGNORE INTO notices (title, slug, body, category, published_at) VALUES (?,?,?,?,CURDATE())',
      [title, slug(title), body, cat]
    );
  }

  const events = [
    ['Annual Hifz Completion Ceremony', 'Celebrating students who have completed the memorisation of the Holy Qur’an this year.', '2026-12-20', 'Main Hall'],
    ['Inter-Department Qira’at Competition', 'A recitation competition across all departments, with prizes for the top three reciters.', '2026-12-05', 'Campus Auditorium']
  ];
  for (const [title, desc, date, loc] of events) {
    await db.run(
      'INSERT IGNORE INTO events (title, slug, description, event_date, location) VALUES (?,?,?,?,?)',
      [title, slug(title), desc, date, loc]
    );
  }
  console.log('- demo students, staff, notices and events created');
}

(async () => {
  try {
    await seedSettings();
    await seedAdmin();
    await seedAcademics();
    await seedSubjects();
    await seedFinance();
    await seedPages();
    await seedDemo();
    console.log('Seed complete.');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
})();

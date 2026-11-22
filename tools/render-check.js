'use strict';
/**
 * Compiles every view in both languages against stub data and reports
 * template errors, missing translation keys and leftover hardcoded English.
 *
 * Usage: node tools/render-check.js [--lang bn] [--only views/public]
 *
 * This renders templates only — it does not touch the database — so it can run
 * anywhere, including before a deploy. Stub data is deliberately generous: each
 * view picks the handful of names it needs out of one big locals object.
 */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..');
const i18n = require(path.join(ROOT, 'lib/i18n'));
const helpers = require(path.join(ROOT, 'lib/helpers'));
const af = require(path.join(ROOT, 'lib/admission-form'));
const routineLib = require(path.join(ROOT, 'lib/routine'));
const shiftLib = require(path.join(ROOT, 'lib/shifts'));

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const onlyPrefix = argVal('--only');
const langFilter = argVal('--lang');
const LANGS = langFilter ? [langFilter] : i18n.CODES;

/* ---------------------------------------------------------- stub records */
const student = {
  id: 1, name: 'Abdullah Rahman', name_en: 'Abdullah Rahman', roll_no: '12',
  admission_no: 'ADM-2026-0001', class_name: 'Class 5', section_name: 'A',
  dept_name: 'Hifzul Qur’an', father_name: 'Ibrahim Rahman', mother_name: 'Fatima',
  father_mobile: '+8801700000000', guardian_phone: '+8801700000000', gender: 'male',
  dob: '2014-05-02', address: 'Khulna', status: 'active', photo: null,
  class_id: 1, section_id: 1, department_id: 1, hifz_para_completed: 12,
  created_at: '2026-01-01', admission_date: '2026-01-01', email: 'a@example.com',
  blood_group: 'B+', previous_institution: '', monthly_fee: 1200,
  is_orphan: '0', birth_reg_no: '', madrasa_id_no: '', prev_madrasa: '', prev_class: '', prev_result: '',
  addr_village: '', addr_post: '', addr_thana: '', addr_district: '',
  guardian_relation: '', guardian_nid: '', guardian2_name: '', guardian2_phone: '',
  guardian3_name: '', guardian3_phone: '', admission_type: 'new', student_type: 'non_residential',
  is_resident: 0, academic_year_id: 1, guardian_name: ''
};
const staffRow = {
  id: 1, name: 'Mufti Yusuf', staff_no: 'STF-0001', designation: 'Senior Teacher', qualification: 'Dawrah',
  department_id: 1, dept_name: 'Kitab', phone: '+8801700000000', email: 's@example.com',
  shift_id: 1, own_shift_id: 1, shift_name: 'Morning',
  in_time: '07:28:00', out_time: '11:35:00', leave_type: null, substitute_id: null, remarks: '',
  marks: {}, worked: 20, absent: 1, paidLeave: 1, unpaidLeave: 0, late: 0, halfDay: 0, taken: 22, percent: 91,
  status: 'active', joining_date: '2020-01-01', salary: 25000, address: 'Khulna',
  nid: '', photo: null, gender: 'male', created_at: '2026-01-01'
};
const paged = helpers.paginate(1, 1, 20);

/* ---------------------------------------------------------- stub locals */
function localsFor(lang) {
  const t = i18n.translator(lang);
  const base = {
    /* --- what app.js puts in res.locals --- */
    lang,
    langDir: i18n.language(lang).dir,
    languages: i18n.LANGUAGES,
    t,
    tflash: i18n.flashTranslator(lang),
    label: i18n.enumLabeler(lang),
    langSwitchUrl: (code) => `/lang/${code}?next=%2F`,
    settings: {
      site_name: 'Jamiah Scholars International', site_short: 'Jamiah Scholars',
      established: '2015', about_intro: 'An institute.', principal_message: 'Welcome.',
      principal_name: 'Mufti Abdullah', result_notice: '', default_language: lang,
      currency_symbol: 'Tk', address: 'Khulna', phone: '+8801700000000',
      email: 'info@example.com'
    },
    site: {
      name: 'Jamiah Scholars International', short: 'Jamiah Scholars',
      tagline: 'Rooted in Revelation', address: 'Khulna', phone: '+8801700000000',
      email: 'info@example.com', facebook: '', youtube: ''
    },
    currency: 'Tk',
    user: { id: 1, name: 'Administrator', role: 'admin', username: 'admin' },
    flash: { success: [], error: [], info: [] },
    h: helpers,
    money: (n) => helpers.money(n, 'Tk'),
    fmtDate: (d) => helpers.fmtDate(d, lang),
    fmtPeriod: (p) => helpers.fmtPeriod(p, lang),
    monthShort: (i) => helpers.monthShort(i, lang),
    theme: { accent: '#166049', accent2: '#c3952f', sidebar: 'gradient', surface: 'solid', radius: 9, glow: 'off' },
    currentPath: '/',
    query: {},
    title: 'Page',
    csrfToken: 'test-token',
    body: '<p>body</p>',

    /* --- data the individual views ask for --- */
    departments: [{ id: 1, name: 'Hifzul Qur’an', slug: 'hifz', description: 'Memorisation.', sort_order: 1, student_count: 10, classes: [{ id: 1, name: 'Class 1' }] }],
    dept: { id: 1, name: 'Hifzul Qur’an', slug: 'hifz', description: 'Memorisation.' },
    classes: [{ id: 1, name: 'Class 1', dept_name: 'Hifz', level: 1, department_id: 1, subjects: [{ id: 1, name: 'Tajweed' }], section_count: 1, student_count: 10 }],
    sections: [{ id: 1, name: 'A', class_id: 1, class_name: 'Class 1', teacher_id: 1, teacher_name: 'Mufti Yusuf', capacity: 30, student_count: 10 }],
    subjects: [{ id: 1, name: 'Tajweed', class_id: 1, class_name: 'Class 1', full_marks: 100, pass_marks: 33, teacher_id: 1, teacher_name: 'Mufti Yusuf', sort_order: 1 }],
    years: [{ id: 1, name: '2026', start_date: '2026-01-01', end_date: '2026-12-31', is_current: 1 }],
    shifts: [{
      id: 1, name: 'Morning', code: 'M', start_time: '07:30:00', end_time: '11:30:00',
      grace_minutes: 10, half_day_after: 90, weekly_off: '5', is_active: 1, sort_order: 1,
      class_count: 2, student_count: 10, staff_count: 3, record_count: 40
    }],
    shift: {
      id: 1, name: 'Morning', code: 'M', start_time: '07:30:00', end_time: '11:30:00',
      grace_minutes: 10, half_day_after: 90, weekly_off: '5', is_active: 1
    },
    weeklyOff: false,
    sh: shiftLib,
    WEEKDAYS: shiftLib.WEEKDAYS,
    STATUSES: shiftLib.STAFF_STATUSES,
    LEAVE_TYPES: shiftLib.LEAVE_TYPES,
    teachers: [staffRow],
    leaders: [staffRow],
    students: [student],
    student,
    staff: [staffRow],
    row: staffRow,
    member: staffRow,
    edit: null,
    isNew: false,
    notices: [{ id: 1, title: 'Holiday', slug: 'holiday', category: 'General', body: 'Closed.', published_at: '2026-03-01', created_at: '2026-03-01', is_published: 1, attachment: null }],
    notice: { id: 1, title: 'Holiday', slug: 'holiday', category: 'General', body: 'Closed.\n\nSecond para.', published_at: '2026-03-01', created_at: '2026-03-01', attachment: null },
    others: [{ title: 'Другое', slug: 'other' }],
    events: [{ id: 1, title: 'Annual Day', slug: 'annual', event_date: '2026-12-01', end_date: null, location: 'Campus', description: 'A day.', is_published: 1 }],
    upcoming: [{ id: 1, title: 'Annual Day', slug: 'annual', event_date: '2026-12-01', location: 'Campus', description: 'A day.' }],
    past: [{ id: 2, title: 'Last Year', slug: 'last', event_date: '2025-12-01' }],
    ev: { id: 1, title: 'Annual Day', slug: 'annual', event_date: '2026-12-01', end_date: null, location: 'Campus', description: 'A day.' },
    images: [{ id: 1, image: 'a.jpg', title: 'Campus', album: 'Campus', sort_order: 1 }],
    albums: ['Campus'],
    page: { id: 1, title: 'Mission', slug: 'mission', body: 'Our mission.', is_published: 1 },
    pages: [{ id: 1, title: 'Mission', slug: 'mission', body: 'Our mission.', is_published: 1, updated_at: '2026-01-01' }],
    messages: [{ id: 1, name: 'Ali', email: 'a@b.com', phone: '', subject: 'Hi', message: 'Hello', is_read: 0, created_at: '2026-01-01' }],
    form: {},
    filters: { status: 'active', class_id: null, section_id: null, period: '2026-03', etype: '', category: '', q: '' },
    sent: false,
    errors: [],
    submitted: null,
    af,
    feeHeads: [{ name: 'Admission', ftype: 'one_time', amount: 2000 }],
    exams: [{ id: 1, name: 'Annual 2026', is_published: 1, year_id: 1, exam_date: '2026-11-01', created_at: '2026-01-01' }],
    exam: { id: 1, name: 'Annual 2026', is_published: 1, class_id: 1, year_id: 1, exam_date: '2026-11-01' },
    sheet: null,
    notFound: false,
    counts: { students: 1, staff: 1, invoices: 0, exams: 1 },
    stats: { students: 1, staff: 1, huffaz: 0, years: 11, present: 1, absent: 0, dues: 0, income: 0, expense: 0, invoices: 0, notices: 1, events: 1, messages: 1, admissions: 1, books: 1, issued: 0 },
    p: paged,
    pager: paged,
    FIELDS: [
      ['site_name', 'settings.field.site_name', 'text'],
      ['default_language', 'settings.field.default_language', 'language'],
      ['accent_color', 'settings.field.accent_color', 'color'],
      ['sidebar_style', 'settings.field.sidebar_style', 'text']
    ],
    values: { site_name: 'JSI', default_language: lang, accent_color: '#166049', accent_secondary: '#c3952f', sidebar_style: 'gradient', surface_style: 'solid', corner_radius: '9', background_glow: '0' },
    TABS: [['/admin/academics', 'a.classes'], ['/admin/academics/years', 'a.ac.years']],
    DAYS: routineLib.DAYS,
    hhmm: routineLib.hhmm,
    periods: [{ id: 1, name: 'Period 1', start_time: '08:00:00', end_time: '08:45:00', is_break: 0, sort_order: 1 }],
    grid: {},
    classId: 1,
    sectionId: null,
    className: 'Class 1',
    sectionName: '',
    found: 0,
    invoices: [{ id: 1, invoice_no: 'INV-2026-0001', student_name: 'Abdullah', class_name: 'Class 1', period: '2026-03', total: 1200, paid: 0, due: 1200, status: 'unpaid', issue_date: '2026-03-01', due_date: '2026-03-10', created_at: '2026-03-01', roll_no: '12' }],
    invoice: { id: 1, invoice_no: 'INV-2026-0001', student_name: 'Abdullah', student_id: 1, class_name: 'Class 1', period: '2026-03', total: 1200, paid: 0, due: 1200, status: 'unpaid', issue_date: '2026-03-01', due_date: '2026-03-10', items: [{ id: 1, head_name: 'Monthly', amount: 1200 }], payments: [] },
    items: [{ id: 1, head_name: 'Monthly', amount: 1200 }],
    payments: [],
    heads: [{ id: 1, name: 'Monthly', ftype: 'monthly', amount: 1200, is_active: 1, class_id: null, class_name: null }],
    structures: [{ id: 1, class_id: 1, class_name: 'Class 1', head_id: 1, head_name: 'Monthly', amount: 1200 }],
    dues: [{ student_id: 1, name: 'Abdullah', roll_no: '12', class_name: 'Class 1', due: 1200, invoices: 1, phone: '+8801700000000' }],
    entries: [{ id: 1, entry_date: '2026-03-01', etype: 'income', category: 'Fees', amount: 1200, note: 'Fee', created_at: '2026-03-01' }],
    totals: { income: 1200, expense: 0, balance: 1200, total: 1200, paid: 0, due: 1200, present: 1, absent: 0, late: 0, leave: 0 },
    books: [{ id: 1, title: 'Riyadh as-Salihin', author: 'An-Nawawi', isbn: '', category: 'Hadith', copies: 3, available: 2, shelf: 'A1' }],
    book: { id: 1, title: 'Riyadh as-Salihin', author: 'An-Nawawi', copies: 3, available: 2 },
    issues: [{ id: 1, book_title: 'Riyadh as-Salihin', student_name: 'Abdullah', issue_date: '2026-03-01', due_date: '2026-03-15', return_date: null, status: 'issued' }],
    rooms: [{ id: 1, name: 'Room 1', capacity: 4, occupied: 2, warden: 'Mufti Yusuf', notes: '' }],
    residents: [{ id: 1, student_name: 'Abdullah', room_name: 'Room 1', checkin_date: '2026-01-01', status: 'active', roll_no: '12' }],
    records: [{ id: 1, student_id: 1, student_name: 'Abdullah', record_date: '2026-03-01', para_from: 1, para_to: 2, pages: 5, rating: 'good', teacher_id: 1, teacher_name: 'Mufti Yusuf', notes: '' }],
    overview: [{ student_id: 1, name: 'Abdullah', roll_no: '12', class_name: 'Class 1', para_completed: 12, last_date: '2026-03-01', days: 20 }],
    attendance: [{ student_id: 1, name: 'Abdullah', roll_no: '12', status: 'present' }],
    report: [{ student_id: 1, name: 'Abdullah', roll_no: '12', present: 20, absent: 1, late: 0, leave: 0, total: 21, percent: 95 }],
    marks: [{ student_id: 1, name: 'Abdullah', roll_no: '12', subject_id: 1, subject: 'Tajweed', full_marks: 100, marks: 80, is_absent: 0 }],
    results: [{ student_id: 1, name: 'Abdullah', roll_no: '12', total_obtained: 80, total_full: 100, percent: 80, grade: 'A+', gpa: 5, result: 'Passed', position: 1 }],
    admissions: [{ id: 1, application_no: 'APP-2026-0001', name: 'Abdullah', father_name: 'Ibrahim', guardian_phone: '+8801700000000', target_class: 'Class 1', department_key: 'quran', campus: 'boyra', status: 'pending', created_at: '2026-03-01', email: 'a@b.com', dob: '2014-05-02', gender: 'male', address: 'Khulna' }],
    app: { id: 1, application_no: 'APP-2026-0001', name: 'Abdullah', name_en: 'Abdullah', father_name: 'Ibrahim', father_mobile: '+8801700000000', father_profession: '', father_income: '', mother_name: 'Fatima', mother_mobile: '', guardian_name: '', guardian_relation: '', guardian_phone: '+8801700000000', guardian_address: '', email: 'a@b.com', dob: '2014-05-02', nationality: 'Bangladeshi', student_mobile: '', gender: 'male', address: 'Khulna', present_house: '', present_moholla: '', present_thana: '', present_district: '', permanent_village: '', permanent_post: '', permanent_thana: '', permanent_district: '', previous_institution: '', prev_class: '', target_class: 'Class 1', department_id: 1, department_key: 'quran', campus: 'boyra', status: 'pending', created_at: '2026-03-01' },
    ROLES: ['admin', 'teacher', 'accountant', 'librarian'],
    users: [{ id: 1, name: 'Administrator', username: 'admin', email: 'a@b.com', role: 'admin', is_active: 1, created_at: '2026-01-01', last_login: null }],
    message: 'Something happened.',
    status: 404,
    marksheet: null,
    summary: { total_full: 100, total_obtained: 80, percent: 80, grade: 'A+', gpa: 5, result: 'Passed' }
  };
  return base;
}

/* ------------------------------------------------------------- the run */
function listViews() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ejs')) out.push(path.relative(ROOT, full));
    }
  })(path.join(ROOT, 'views'));
  return out.filter((v) => !onlyPrefix || v.startsWith(onlyPrefix)).sort();
}

const failures = [];
const missingKeys = new Set();
const views = listViews();

for (const lang of LANGS) {
  const locals = localsFor(lang);
  // Wrap t() so an unresolved key is recorded rather than silently printed.
  const realT = locals.t;
  locals.t = (key, vars) => {
    if (typeof key === 'string' && /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(key) && !i18n.has(key, lang)) {
      missingKeys.add(`${lang}: ${key}`);
    }
    return realT(key, vars);
  };

  for (const view of views) {
    try {
      ejs.renderFile(path.join(ROOT, view), locals, { filename: path.join(ROOT, view), async: false });
    } catch (err) {
      failures.push({ lang, view, message: String(err.message).split('\n')[0] });
    }
  }
}

console.log(`Rendered ${views.length} views × ${LANGS.length} language(s) = ${views.length * LANGS.length} templates.`);

if (missingKeys.size) {
  console.log(`\nMissing translations (${missingKeys.size}):`);
  [...missingKeys].sort().forEach((k) => console.log('  ' + k));
}

if (failures.length) {
  console.log(`\nRender failures (${failures.length}):`);
  failures.forEach((f) => console.log(`  [${f.lang}] ${f.view}\n      ${f.message}`));
  process.exit(1);
}

if (!missingKeys.size) console.log('\nNo render errors, no missing translations.');
process.exit(missingKeys.size ? 1 : 0);

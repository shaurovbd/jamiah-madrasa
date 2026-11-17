'use strict';
/**
 * Content and validation rules for the public admission form
 * (views/public/admission.ejs).
 *
 * Edit the Bangla/English text here — the form, the validator and the
 * admin screens all read from this one file.
 */

/* The six department cards on step 2.
   `deptSlug` links a card to a row in the `departments` table when one
   exists, so an approved application still carries a department_id.
   Leave it null for courses that have no department record yet. */
const DEPARTMENTS = [
  {
    key: 'quran',
    deptSlug: 'hifzul-qur-an',
    icon: 'book',
    title: 'কুরআন ডিপার্টমেন্ট',
    items: [
      'প্রাক-হিফজ (কায়দা, আমপারা)',
      'স্বতন্ত্র নাযেরা + আমিনুল হিফজ',
      'পার্টটাইম ও ফুলটাইম হিফজ',
      'আন্তর্জাতিক প্রতিযোগিতা বিভাগ'
    ]
  },
  {
    key: 'general',
    deptSlug: null,
    icon: 'globe',
    title: 'জেনারেল বিভাগ',
    items: [
      'ইংলিশ মিডিয়াম (প্লে-নবম)',
      'বাংলা মাধ্যম (প্রথম-নবম)',
      'ইংলিশ ভার্সন (0-5 Level)',
      'Spoken English (Basic to Advanced)'
    ]
  },
  {
    key: 'kitab',
    deptSlug: 'kitab-alim-course',
    icon: 'scroll',
    title: 'কিতাব বিভাগ',
    items: [
      'মাদানী নেসাব (১ম থেকে ৫ম বর্ষ)',
      'এবতেদায়ী থেকে কুদুরী (বেফাক বোর্ড)',
      'নিবন্ধিত শিক্ষক আধুনিকায়ন প্রশিক্ষণ'
    ]
  },
  {
    key: 'islamic_school',
    deptSlug: 'maktab',
    icon: 'child',
    title: 'ইসলামিক স্কুল (কিন্ডার গার্ডেন)',
    items: [
      'শিশুর প্রাথমিক পাঠ (হাতে খড়ি)',
      'প্লে-কেজি, নার্সারি, শিশু থেকে ৫ম শ্রেণী'
    ]
  },
  {
    key: 'special',
    deptSlug: null,
    icon: 'star',
    title: 'স্পেশাল কোর্সসমূহ',
    items: [
      '‘ভোলা কুরআন ইয়াদ’ বিশেষ ব্যবস্থা',
      'মাকামাত ভিত্তিক কিরাত ও নাশিদ চর্চা',
      'মার্শাল আর্ট ও আত্মরক্ষা কৌশল'
    ]
  },
  {
    key: 'computer',
    deptSlug: null,
    icon: 'monitor',
    title: 'কম্পিউটার-কারিগরী প্রশিক্ষণ',
    items: [
      'বেসিক থেকে অ্যাডভান্সড আইসিটি কোর্স',
      'ব্যাবহারিক কম্পিউটার ল্যাব সুবিধা'
    ]
  }
];

/* The two campus cards on step 2. */
const CAMPUSES = [
  {
    key: 'boyra',
    title: 'বয়রা বাজার ক্যাম্পাস',
    desc: 'মুজগুন্নী মেইন রোড, বয়রা বাজার মোড়, সোনাডাঙ্গা, খুলনা।'
  },
  {
    key: 'nirala',
    title: 'নিরালা ক্যাম্পাস',
    desc: '১৮৯, নিরালা আ/এ, রোড নং-১, খুলনা।'
  }
];

/* The six steps, used for the stepper at the top of the form. */
const STEPS = [
  { n: '১', label: 'শিক্ষার্থী' },
  { n: '২', label: 'বিভাগ ও ক্যাম্পাস' },
  { n: '৩', label: 'পিতা-মাতা' },
  { n: '৪', label: 'অভিভাবক' },
  { n: '৫', label: 'ঠিকানা' },
  { n: '৬', label: 'শিক্ষাগত তথ্য' }
];

const GENDERS = [
  { value: 'male', label: 'পুরুষ' },
  { value: 'female', label: 'মহিলা' },
  { value: 'other', label: 'অন্যান্য' }
];

const deptLabel = (key) => (DEPARTMENTS.find((d) => d.key === key) || {}).title || '';
const campusLabel = (key) => (CAMPUSES.find((c) => c.key === key) || {}).title || '';

/** Fields the applicant must fill in, in step order, with Bangla messages. */
const REQUIRED = [
  { field: 'full_name_bn', step: 1, message: 'শিক্ষার্থীর নাম (বাংলা) লিখুন।' },
  { field: 'dob', step: 1, message: 'জন্ম তারিখ দিন।' },
  { field: 'email', step: 1, message: 'ইমেইল ঠিকানা দিন। / Please enter your email address.' },
  { field: 'department', step: 2, message: 'একটি বিভাগ নির্বাচন করুন।' },
  { field: 'campus', step: 2, message: 'একটি ক্যাম্পাস নির্বাচন করুন।' },
  { field: 'father_name', step: 3, message: 'পিতার নাম লিখুন।' },
  { field: 'father_mobile', step: 3, message: 'পিতার মোবাইল নম্বর দিন।' }
];

/**
 * Checks a submitted body. Returns an array of Bangla error messages —
 * empty when the application is good to save.
 */
function validate(body) {
  const b = body || {};
  const errors = [];

  REQUIRED.forEach((r) => {
    if (!String(b[r.field] || '').trim()) errors.push(r.message);
  });

  const email = String(b.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('ইমেইল ঠিকানাটি সঠিক নয়। / That email address is not valid.');
  }

  const dept = String(b.department || '').trim();
  if (dept && !DEPARTMENTS.some((d) => d.key === dept)) {
    errors.push('বিভাগ নির্বাচনটি সঠিক নয়।');
  }

  const campus = String(b.campus || '').trim();
  if (campus && !CAMPUSES.some((c) => c.key === campus)) {
    errors.push('ক্যাম্পাস নির্বাচনটি সঠিক নয়।');
  }

  if (!String(b.guardian_mobile || b.father_mobile || '').trim()) {
    errors.push('অন্তত একটি যোগাযোগের মোবাইল নম্বর প্রয়োজন।');
  }

  return errors;
}

/** Joins the present-address parts into the single `address` column. */
function presentAddress(b) {
  return [b.present_house, b.present_moholla, b.present_thana, b.present_district]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 255) || null;
}

/** Joins the permanent-address parts for display. */
function permanentAddress(row) {
  return [row.permanent_village, row.permanent_post, row.permanent_thana, row.permanent_district]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(', ');
}

module.exports = {
  DEPARTMENTS, CAMPUSES, STEPS, GENDERS, REQUIRED,
  deptLabel, campusLabel, validate, presentAddress, permanentAddress
};

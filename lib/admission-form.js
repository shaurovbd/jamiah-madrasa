'use strict';
/**
 * Content and validation rules for the public admission form
 * (views/public/admission.ejs).
 *
 * Edit the Bangla/English text here — the form, the validator and the
 * admin screens all read from this one file.
 *
 * Every piece of visible text carries both languages: `title`/`titleEn`,
 * `items`/`itemsEn`, and so on. The form used to print both at once; now that
 * the site has a language switcher, call `forLang(lang)` and render the single
 * resolved set. The Bangla fields stay the unsuffixed ones so that the admin
 * screens and stored records, which have always shown Bangla, are unchanged.
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
    titleEn: 'Qur’an Department',
    items: [
      'প্রাক-হিফজ (কায়দা, আমপারা)',
      'স্বতন্ত্র নাযেরা + আমিনুল হিফজ',
      'পার্টটাইম ও ফুলটাইম হিফজ',
      'আন্তর্জাতিক প্রতিযোগিতা বিভাগ'
    ],
    itemsEn: [
      'Pre-Hifz (Qaida, Ampara)',
      'Dedicated Nazera + Aminul Hifz',
      'Part-time and full-time Hifz',
      'International competition wing'
    ]
  },
  {
    key: 'general',
    deptSlug: null,
    icon: 'globe',
    title: 'জেনারেল বিভাগ',
    titleEn: 'General Department',
    items: [
      'ইংলিশ মিডিয়াম (প্লে-নবম)',
      'বাংলা মাধ্যম (প্রথম-নবম)',
      'ইংলিশ ভার্সন (0-5 Level)',
      'Spoken English (Basic to Advanced)'
    ],
    itemsEn: [
      'English Medium (Play to Class 9)',
      'Bangla Medium (Class 1 to 9)',
      'English Version (0–5 Level)',
      'Spoken English (Basic to Advanced)'
    ]
  },
  {
    key: 'kitab',
    deptSlug: 'kitab-alim-course',
    icon: 'scroll',
    title: 'কিতাব বিভাগ',
    titleEn: 'Kitab Department',
    items: [
      'মাদানী নেসাব (১ম থেকে ৫ম বর্ষ)',
      'এবতেদায়ী থেকে কুদুরী (বেফাক বোর্ড)',
      'নিবন্ধিত শিক্ষক আধুনিকায়ন প্রশিক্ষণ'
    ],
    itemsEn: [
      'Madani Nisab (Year 1 to 5)',
      'Ibtedaiyah to Quduri (Befaq Board)',
      'Modernisation training for registered teachers'
    ]
  },
  {
    key: 'islamic_school',
    deptSlug: 'maktab',
    icon: 'child',
    title: 'ইসলামিক স্কুল (কিন্ডার গার্ডেন)',
    titleEn: 'Islamic School (Kindergarten)',
    items: [
      'শিশুর প্রাথমিক পাঠ (হাতে খড়ি)',
      'প্লে-কেজি, নার্সারি, শিশু থেকে ৫ম শ্রেণী'
    ],
    itemsEn: [
      'A child’s very first lessons',
      'Play, KG and Nursery through Class 5'
    ]
  },
  {
    key: 'special',
    deptSlug: null,
    icon: 'star',
    title: 'স্পেশাল কোর্সসমূহ',
    titleEn: 'Special Courses',
    items: [
      '‘ভোলা কুরআন ইয়াদ’ বিশেষ ব্যবস্থা',
      'মাকামাত ভিত্তিক কিরাত ও নাশিদ চর্চা',
      'মার্শাল আর্ট ও আত্মরক্ষা কৌশল'
    ],
    itemsEn: [
      '“Bhola Qur’an Iyad” revision programme',
      'Maqamat-based Qira’at and Nashid practice',
      'Martial arts and self-defence'
    ]
  },
  {
    key: 'computer',
    deptSlug: null,
    icon: 'monitor',
    title: 'কম্পিউটার-কারিগরী প্রশিক্ষণ',
    titleEn: 'Computer & Technical Training',
    items: [
      'বেসিক থেকে অ্যাডভান্সড আইসিটি কোর্স',
      'ব্যাবহারিক কম্পিউটার ল্যাব সুবিধা'
    ],
    itemsEn: [
      'Basic to advanced ICT courses',
      'Hands-on computer lab'
    ]
  }
];

/* The two campus cards on step 2. */
const CAMPUSES = [
  {
    key: 'boyra',
    title: 'বয়রা বাজার ক্যাম্পাস',
    titleEn: 'Boyra Bazar Campus',
    desc: 'মুজগুন্নী মেইন রোড, বয়রা বাজার মোড়, সোনাডাঙ্গা, খুলনা।',
    descEn: 'Mujgunni Main Road, Boyra Bazar Mor, Sonadanga, Khulna.'
  },
  {
    key: 'nirala',
    title: 'নিরালা ক্যাম্পাস',
    titleEn: 'Nirala Campus',
    desc: '১৮৯, নিরালা আ/এ, রোড নং-১, খুলনা।',
    descEn: '189, Nirala R/A, Road No. 1, Khulna.'
  }
];

/* The six steps, used for the stepper at the top of the form.
   `n` is the Bangla numeral, `nEn` the Latin one. */
const STEPS = [
  { n: '১', nEn: '1', label: 'শিক্ষার্থী',          labelEn: 'Student' },
  { n: '২', nEn: '2', label: 'বিভাগ ও ক্যাম্পাস',   labelEn: 'Department & Campus' },
  { n: '৩', nEn: '3', label: 'পিতা-মাতা',           labelEn: 'Parents' },
  { n: '৪', nEn: '4', label: 'অভিভাবক',             labelEn: 'Guardian' },
  { n: '৫', nEn: '5', label: 'ঠিকানা',              labelEn: 'Address' },
  { n: '৬', nEn: '6', label: 'শিক্ষাগত তথ্য',       labelEn: 'Academic' }
];

const GENDERS = [
  { value: 'male',   label: 'পুরুষ',    labelEn: 'Male' },
  { value: 'female', label: 'মহিলা',   labelEn: 'Female' },
  { value: 'other',  label: 'অন্যান্য', labelEn: 'Other' }
];

const deptLabel = (key) => (DEPARTMENTS.find((d) => d.key === key) || {}).title || '';
const campusLabel = (key) => (CAMPUSES.find((c) => c.key === key) || {}).title || '';

/**
 * Fields the applicant must fill in, in step order.
 *
 * `key` is a translation key rather than a finished sentence, because the same
 * list is checked on the server and the message has to come back in whichever
 * language the applicant is filling the form in. `message` is kept as the
 * Bangla fallback for any caller that has no translator to hand.
 */
const REQUIRED = [
  { field: 'full_name_bn',  step: 1, key: 'admission.err.name',           message: 'শিক্ষার্থীর নাম (বাংলা) লিখুন।' },
  { field: 'dob',           step: 1, key: 'admission.err.dob',            message: 'জন্ম তারিখ দিন।' },
  { field: 'email',         step: 1, key: 'admission.err.email',          message: 'ইমেইল ঠিকানা দিন।' },
  { field: 'department',    step: 2, key: 'admission.err.department',     message: 'একটি বিভাগ নির্বাচন করুন।' },
  { field: 'campus',        step: 2, key: 'admission.err.campus',         message: 'একটি ক্যাম্পাস নির্বাচন করুন।' },
  { field: 'father_name',   step: 3, key: 'admission.err.father_name',    message: 'পিতার নাম লিখুন।' },
  { field: 'father_mobile', step: 3, key: 'admission.err.father_mobile',  message: 'পিতার মোবাইল নম্বর দিন।' }
];

/**
 * Checks a submitted body. Returns an array of translation keys — empty when
 * the application is good to save. The caller renders each through t().
 */
function validate(body) {
  const b = body || {};
  const errors = [];

  REQUIRED.forEach((r) => {
    if (!String(b[r.field] || '').trim()) errors.push(r.key);
  });

  const email = String(b.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('admission.err.email_invalid');
  }

  const dept = String(b.department || '').trim();
  if (dept && !DEPARTMENTS.some((d) => d.key === dept)) {
    errors.push('admission.err.department_invalid');
  }

  const campus = String(b.campus || '').trim();
  if (campus && !CAMPUSES.some((c) => c.key === campus)) {
    errors.push('admission.err.campus_invalid');
  }

  if (!String(b.guardian_mobile || b.father_mobile || '').trim()) {
    errors.push('admission.err.any_mobile');
  }

  return errors;
}

/**
 * The same content with one language resolved, ready for the view: each card,
 * step and option gets a plain `title`, `items`, `desc`, `label` and `n` in the
 * requested language. The view then never has to ask which language it is in.
 */
function forLang(lang) {
  const bn = lang !== 'en';
  const pick = (bnValue, enValue) => (bn ? bnValue : (enValue || bnValue));
  return {
    DEPARTMENTS: DEPARTMENTS.map((d) => ({
      key: d.key,
      icon: d.icon,
      title: pick(d.title, d.titleEn),
      items: pick(d.items, d.itemsEn)
    })),
    CAMPUSES: CAMPUSES.map((c) => ({
      key: c.key,
      title: pick(c.title, c.titleEn),
      desc: pick(c.desc, c.descEn)
    })),
    STEPS: STEPS.map((s) => ({
      n: pick(s.n, s.nEn),
      label: pick(s.label, s.labelEn)
    })),
    GENDERS: GENDERS.map((g) => ({
      value: g.value,
      label: pick(g.label, g.labelEn)
    }))
  };
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
  deptLabel, campusLabel, validate, forLang, presentAddress, permanentAddress
};

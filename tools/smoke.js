'use strict';
/**
 * Walks the running site in both languages and checks what actually came back.
 *
 *   node app.js &
 *   node tools/smoke.js [http://127.0.0.1:3000] [admin-username] [admin-password]
 *
 * For every page, in English and in Bangla, it checks:
 *   - the HTTP status,
 *   - that <html lang> matches the language asked for,
 *   - that a Bangla page actually contains Bengali text,
 *   - that no untranslated key (e.g. "a.fee.billed") leaked into the output,
 *   - that the language switcher is present and points at the other language.
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const USER = process.argv[3] || 'admin';
const PASS = process.argv[4] || process.env.ADMIN_PASSWORD || 'ChangeMe@2026';

const PUBLIC_PAGES = [
  '/', '/about', '/departments', '/notices', '/events', '/gallery',
  '/contact', '/admission', '/results', '/routine', '/no-such-page'
];

const ADMIN_PAGES = [
  '/admin', '/admin/students', '/admin/students/new', '/admin/staff', '/admin/staff/new',
  '/admin/admissions', '/admin/academics/departments', '/admin/academics/classes',
  '/admin/academics/sections', '/admin/academics/subjects', '/admin/academics/shifts',
  '/admin/academics/years',
  '/admin/routine/classes', '/admin/routine/periods', '/admin/routine/teachers',
  '/admin/attendance', '/admin/attendance/report',
  '/admin/attendance/staff', '/admin/attendance/staff/report', '/admin/exams', '/admin/hifz',
  '/admin/hifz/overview', '/admin/fees', '/admin/fees/structure', '/admin/fees/generate',
  '/admin/fees/dues', '/admin/ledger', '/admin/library', '/admin/library/issues',
  '/admin/hostel', '/admin/notices', '/admin/events', '/admin/gallery',
  '/admin/pages', '/admin/messages', '/admin/users', '/admin/settings'
];

const BENGALI = /[ঀ-৿]/;
// A key that reached the page instead of its translation: dotted lowercase
// token sitting in text, not inside a URL, attribute or file name.
const LEAKED_KEY = /(?:^|[\s>(])((?:common|nav|footer|admin|settings|results|routine|admission|notices|notice|events|event|gallery|contact|home|about|departments|department|auth|error|enum|pager|lang|crumb|site|role|a|f)\.[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*)(?=[\s<),.]|$)/g;

let jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function get(path, { redirect = 'manual' } = {}) {
  const res = await fetch(BASE + path, {
    redirect,
    headers: jar.size ? { cookie: cookieHeader() } : {}
  });
  storeCookies(res);
  const body = await res.text();
  return { status: res.status, location: res.headers.get('location'), body };
}

async function post(path, fields) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(jar.size ? { cookie: cookieHeader() } : {})
    },
    body: new URLSearchParams(fields).toString()
  });
  storeCookies(res);
  const body = await res.text();
  return { status: res.status, location: res.headers.get('location'), body };
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

const failures = [];
const leaks = new Map();

function check(lang, path, r) {
  const label = `[${lang}] ${path}`;
  const expectStatus = path === '/no-such-page' ? 404 : 200;
  if (r.status !== expectStatus) {
    failures.push(`${label}: HTTP ${r.status} (expected ${expectStatus})`);
    return;
  }
  const langAttr = (r.body.match(/<html lang="([a-z-]+)"/) || [])[1];
  if (langAttr !== lang) failures.push(`${label}: <html lang="${langAttr}">, expected "${lang}"`);

  if (lang === 'bn' && !BENGALI.test(r.body)) failures.push(`${label}: no Bengali text on the page`);
  if (lang === 'en') {
    // English pages legitimately contain Bangla in stored content (the demo
    // notices, the institution's own name), so this is not checked here.
  }

  // Switcher present and offering the other language.
  const other = lang === 'en' ? 'bn' : 'en';
  if (!r.body.includes(`/lang/${other}`)) {
    failures.push(`${label}: no switcher link to /lang/${other}`);
  }

  // Untranslated keys reaching the page.
  const text = r.body
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (const m of text.matchAll(LEAKED_KEY)) {
    const key = m[1];
    if (/\.(js|css|html|png|jpg|jpeg|svg|webp|gif|ico|json|pdf)$/.test(key)) continue;
    if (!leaks.has(key)) leaks.set(key, label);
  }
}

(async () => {
  for (const lang of ['en', 'bn']) {
    jar = new Map();
    await get(`/lang/${lang}?next=%2F`);

    for (const p of PUBLIC_PAGES) check(lang, p, await get(p));

    // Sign in, then walk the management panel in the same language.
    const loginPage = await get('/admin');
    const csrf = csrfFrom(loginPage.body) || csrfFrom((await get('/login')).body);
    const login = await post('/login', { _csrf: csrf, username: USER, password: PASS });
    if (login.status !== 302) {
      failures.push(`[${lang}] /login: HTTP ${login.status} — admin pages not checked`);
      continue;
    }
    for (const p of ADMIN_PAGES) check(lang, p, await get(p));
    await get('/logout');
  }

  const total = (PUBLIC_PAGES.length + ADMIN_PAGES.length) * 2;
  console.log(`Checked ${total} page loads (${PUBLIC_PAGES.length} public + ${ADMIN_PAGES.length} admin, in 2 languages).`);

  if (leaks.size) {
    console.log(`\nUntranslated keys visible on pages (${leaks.size}):`);
    for (const [k, where] of leaks) console.log(`  ${k}   first seen ${where}`);
  }
  if (failures.length) {
    console.log(`\nFailures (${failures.length}):`);
    failures.forEach((f) => console.log('  ' + f));
  }
  if (!failures.length && !leaks.size) console.log('\nAll pages load correctly in both languages.');
  process.exit(failures.length || leaks.size ? 1 : 0);
})();

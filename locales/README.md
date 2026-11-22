# Interface languages

The site and the management panel both read in English or Bangla. A visitor or
staff member picks with the toggle in the header; whoever has not picked yet
gets the institution's default, set on **Settings → Default language**.

## Where the text lives

`en.json` and `bn.json` hold every interface string, keyed by a flat dotted
name. The two files must hold the same keys.

```json
"nav.notices": "Notices"
"a.fee.total_due": "Total due"
```

Key prefixes, so a string is easy to find:

| Prefix | What it covers |
|---|---|
| `common.` | words reused everywhere — Name, Date, Save, Delete |
| `nav.` `footer.` `crumb.` | public site navigation and footer |
| `home.` `about.` `departments.` `notices.` `events.` `gallery.` `contact.` `results.` `routine.` `admission.` | one public page each |
| `admin.` | the management panel's sidebar, groups and page names |
| `a.` | the management screens, then the area: `a.fee.`, `a.stu.`, `a.hifz.` … |
| `f.` | flash messages ("Department added.") |
| `enum.` | values stored in the database — invoice status, Hifz rating, roles |
| `settings.` `auth.` `error.` `pager.` `lang.` | the Settings form, sign-in, error pages, paging, the switcher |

## Adding or changing a string

1. Add the key to **both** `en.json` and `bn.json`.
2. Use it in the view as `<%= t('your.key') %>`.
3. Run `node tools/i18n-audit.js`. It fails if a key is missing from one file,
   if a value is empty, or if the two languages disagree about placeholders.

A key with no Bangla value falls back to English rather than rendering blank, so
a half-finished translation never leaves a hole in a page — but the audit will
tell you about it.

### Strings with values in them

Write `%{name}` placeholders, and pass the values in. Never build a sentence by
concatenating translated fragments: Bangla and English order clauses
differently, and Bangla has no plural `-s`.

```js
// en: "Attendance saved for %{count} student(s) on %{date}."
// bn: "%{date} তারিখে %{count} জন শিক্ষার্থীর উপস্থিতি সংরক্ষিত হয়েছে।"
t('f.att.saved', { count: saved, date: fmtDate(date) })
```

### Flash messages

A flash is written, the browser is redirected, and only then is the message
rendered — possibly in another language. So flash the key, not the text:

```js
req.flash('success', 'f.ac.dept_added');                                  // no values
req.flash('success', i18n.pack('f.stu.added', { name: student.name }));   // with values
```

The layout runs each entry through `tflash()`, which also passes literal text
through unchanged, so older code that flashed an English sentence still works.

### Values stored in the database

ENUM columns (`invoices.status`, `hifz_records.rating`, `users.role` …) are
rendered with `label()`, which looks up `enum.<column-ish>.<value>`:

```ejs
<%= label('status', invoice.status) %>
<%= label('rating', entry.rating) %>
```

A value with no key falls back to the stored string, so adding an ENUM member in
SQL cannot break a page — add the `enum.` keys when you add the member.

### Dates

Use the language-aware helpers in locals, not `h.fmtDate` directly, so months
read `মার্চ` rather than `Mar`:

```ejs
<%= fmtDate(notice.published_at) %>
<%= fmtPeriod(invoice.period) %>
<%= monthShort(date.getMonth()) %>
```

## What is *not* translated

Content staff type into the database — notice and event titles and bodies,
page text, department names, class and subject names — shows exactly as it was
entered, in both languages. Making that content bilingual would mean adding
`title_bn` / `body_bn` columns and a second set of inputs in the editors.

Numerals stay Latin (`2026`, `1,200`) in both languages, so roll numbers,
invoice numbers and amounts never read differently from the printed record.
Bangla month names are used; Bangla digits (০১২৩) are not.

## Checks

```sh
node tools/render-check.js   # compiles every view in both languages
node tools/i18n-audit.js     # key and placeholder parity between the files
node tools/smoke.js          # walks the running site, signed in and out
```

`smoke.js` needs the app running and takes the base URL and admin credentials:

```sh
node tools/smoke.js http://127.0.0.1:3000 admin 'your-password'
```

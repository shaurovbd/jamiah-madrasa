# Jamiah Scholars International

Public website and school management system for Jamiah Scholars International,
built to run on cPanel shared hosting with the "Setup Node.js App" (Phusion Passenger) tool.

- **Stack:** Node.js 18+ · Express 4 · EJS · MySQL / MariaDB
- **No build step.** Server-rendered pages, plain CSS, no bundler.
- **Pure-JS dependencies only**, so `npm install` works on cPanel without a compiler.

---

## What it does

### Public website
| Page | Address |
| --- | --- |
| Home, with departments, notices and events | `/` |
| About, mission and facilities | `/about` |
| Departments and their syllabus | `/departments` |
| Notices | `/notices` |
| Events | `/events` |
| Photo gallery | `/gallery` |
| Online admission application | `/admission` |
| Examination result lookup by roll number | `/results` |
| Contact form | `/contact` |
| Free-form pages managed in the panel | `/page/<address>` |

### Management panel (`/admin`)
- **Students** — records, photographs, guardians, enrolment, status, full profile with attendance, results, fees, Hifz and hostel
- **Admissions** — applications from the website, approve to create the student record, or reject
- **Staff** — teachers and staff, designations, departments, salaries
- **Academic structure** — departments, classes, sections, subjects, academic years
- **Attendance** — daily roster marking and a month-by-month class report
- **Exams** — examinations, subject-by-subject marks entry, merit lists, printable marksheets, publish to the website
- **Hifz progress** — daily sabak, sabqi and manzil with ratings, plus para-completed tracking
- **Fees** — fee heads, class fee structures, monthly invoice generation, collection with printable receipts, discounts, dues report
- **Income & expense** — a simple ledger with categories and a monthly summary
- **Library** — catalogue, issue and return, fines
- **Hostel** — rooms, capacity and allocations
- **Website content** — notices, events, gallery, pages, contact messages
- **System** — users and roles, institution settings

### Roles
| Role | Can reach |
| --- | --- |
| `admin` | Everything, including users, settings and website content |
| `teacher` | Students, staff list, academic structure, attendance, exams, Hifz |
| `accountant` | Students, admissions, staff list, fees, ledger, hostel |
| `librarian` | Library catalogue and loans |

---

## Local development

```bash
npm install
cp .env.example .env     # then fill in the database details
npm run setup            # creates the tables and seeds reference data
npm start                # http://localhost:3000
```

`npm run setup` applies `db/schema.sql` and then `db/seed.js`. It is safe to run again:
existing rows are left alone. Set `SEED_DEMO=1` to also create sample students and notices.

The seed creates one account, username `admin`, using the password in `ADMIN_PASSWORD`.
Change it from **Users → Change my password** after the first sign-in.

---

## Deploying on cPanel

See [DEPLOY.md](DEPLOY.md) for the full walkthrough. In short:

1. **MySQL Database Wizard** — create the database and user, grant all privileges.
2. **Git Version Control** — clone this repository into `~/jamiah-madrasa`.
3. **Setup Node.js App** — Node 20, application root `jamiah-madrasa`, startup file `app.js`.
4. Add the environment variables listed in `.env.example`.
5. **Run NPM Install**, then run `npm run setup` from the app's virtual environment.
6. Restart the application.

---

## Layout

```
app.js                 Express app: middleware, sessions, CSRF, routes, error pages
config/db.js           MySQL pool and query helpers
db/schema.sql          Every table
db/setup.js            Applies the schema, then seeds
db/seed.js             Settings, admin user, departments, classes, fee heads
lib/helpers.js         Dates, money, grades, pagination, form-key parsing
lib/results.js         Marksheet and merit-list calculation
lib/settings.js        Cached institution settings
lib/upload.js          Image and document uploads
middleware/auth.js     Sign-in and role gates
routes/public.js       The website
routes/auth.js         Sign in and out
routes/admin/          One file per management module
views/                 EJS templates; layouts/public and layouts/admin
public/css/            style.css (website) and admin.css (panel)
public/uploads/        Uploaded photographs and attachments (not in git)
```

### Two things worth knowing before you change the code

**Bulk-edit grids name their inputs `field[id<N>]`, not `field[<N>]`.** A purely numeric
key is parsed as an array index and the array is then compacted, which silently renumbers
every row. `h.idFromKey()` reads the id back out. This affects attendance, marks entry,
Hifz entry and the fee structure form.

**Forms send `_method` to stand in for PUT and DELETE.** `method-override` is configured
with a function that reads the parsed body; passing it a plain string would read the query
string instead and every edit and delete would fall through to a 404.

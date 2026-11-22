# Deploying on cPanel

Written for `jamiahscholarsinternational.com`, cPanel with "Setup Node.js App"
(CloudLinux / Phusion Passenger), MySQL and Git Version Control.

---

## 1. Create the database

cPanel → **Database Wizard** (or MySQL Databases).

1. Database name: `madrasa` → cPanel stores it as `jamiah_madrasa`.
2. Create a user, for example `madrasauser` → stored as `jamiah_madrasauser`.
   Use a long generated password and keep it to hand.
3. Grant that user **ALL PRIVILEGES** on the database.

Note the three full values: database name, username, password.

---

## 2. Clone the repository

cPanel → **Git™ Version Control** → *Create*.

| Field | Value |
| --- | --- |
| Clone a Repository | on |
| Clone URL | the repository's SSH or HTTPS URL |
| Repository Path | `/home/jamiah/jamiah-madrasa` |
| Repository Name | `jamiah-madrasa` |

For a **private** repository over SSH, first add cPanel's public key to GitHub as a deploy
key: cPanel → **SSH Access → Manage SSH Keys → Generate a New Key**, then *View/Download*
the public key and add it under the repository's **Settings → Deploy keys** on GitHub.

Later updates: push to GitHub, then **Manage → Update from Remote** in cPanel, and restart
the Node.js app. If the update adds a file to `db/migrations/`, run `npm run migrate` before
restarting — see *Updating an existing install* below.

---

## 3. Create the Node.js application

cPanel → **Setup Node.js App** → *Create Application*.

| Field | Value |
| --- | --- |
| Node.js version | **20.x** (18.x also works) |
| Application mode | Production |
| Application root | `jamiah-madrasa` |
| Application URL | `jamiahscholarsinternational.com` |
| Application startup file | `app.js` |

Leave the port alone — Passenger assigns it and the app reads `process.env.PORT`.

---

## 4. Environment variables

Still on the Node.js App screen, add each of these:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_NAME` | `jamiah_madrasa` |
| `DB_USER` | `jamiah_madrasauser` |
| `DB_PASSWORD` | the password from step 1 |
| `SESSION_SECRET` | a long random string of your own |
| `COOKIE_SECURE` | `1` |
| `ADMIN_PASSWORD` | the first password for the `admin` account |
| `ADMIN_EMAIL` | `admin@jamiahscholarsinternational.com` |
| `SEED_DEMO` | `0` |
| `WELLKNOWN_DIR` | `/home/jamiah/public_html/.well-known` |

`WELLKNOWN_DIR` matters because the app owns the document root: cPanel's AutoSSL
proves domain control by fetching `http://<domain>/.well-known/acme-challenge/...`,
and without this the app would answer those requests with a 404 and certificate
renewal would quietly start failing.

`ADMIN_PASSWORD` is read once, when the seed first runs. Change the password in the panel
afterwards and the variable stops mattering.

Save, then click **Run NPM Install**.

---

## 5. Create the tables

On the Node.js App screen, copy the **"Enter to the virtual environment"** command shown at
the top. Open **Terminal** (or SSH in), paste that command, then:

```bash
cd ~/jamiah-madrasa
npm run setup
```

You should see `Schema applied.` followed by `Seed complete.`

No terminal available? Import `db/schema.sql` through **phpMyAdmin → Import** instead, then
visit the site once and create the admin user with a row in `users` — the terminal route is
much easier, so ask your host to enable it if it is hidden.

---

## 6. Start it

Back on the Node.js App screen, press **Restart**. Then check:

- `https://jamiahscholarsinternational.com/` — the website
- `https://jamiahscholarsinternational.com/healthz` — should return `{"ok":true,...}`
- `https://jamiahscholarsinternational.com/admin` — sign in as `admin`

### First things to do in the panel
1. **Users → Change my password.**
2. **Settings** — institution name, address, phone, email, principal's message.
3. **Classes & Subjects** — adjust the seeded departments, classes and subjects.
4. **Classes & Subjects → Shifts** — check the two seeded shifts (সকাল and দিবা): their
   timings, the grace period, the half-day cut-off and the weekly holiday. Then set each
   class's shift on the **Classes** tab, because student attendance and the teacher
   lateness rules both read it.
5. **Staff** — set each teacher's shift, so teacher attendance judges arrivals against the
   right timings.
6. **Fee Setup** — fee heads and the amount each class pays.
7. **Students** — add students, or approve them through **Admissions**.

---

## Updating an existing install

`npm run setup` is for a new, empty database: it applies `schema.sql`, which creates tables
but never alters existing ones. On a site that already holds data, the schema changes live in
`db/migrations/`, and those are applied by `npm run migrate`. Nothing applies them for you —
not the git update, not a restart.

So, for every update:

1. cPanel → **Git™ Version Control → Manage → Update from Remote**.
2. **Setup Node.js App → Run NPM Install** (only if `package.json` changed).
3. Open **Terminal**, enter the virtual environment, then:
   ```bash
   cd ~/jamiah-madrasa
   npm run migrate
   ```
   It prints each statement as `ok` or `skip  already applied`. Running it twice is safe, and
   a run that stops halfway can simply be run again.
4. **Restart** the Node.js app.

Migrating before the restart matters: Passenger keeps serving the old code until you restart,
so the database is ready by the time the new code first sees it.

Skipping step 3 breaks the pages that use the new tables — they return 500 and the browser
shows "We're sorry, something went wrong", while the rest of the site looks fine. If that
happens, run the migration and restart; nothing is lost.

---

## Routine jobs

| Task | Where |
| --- | --- |
| Monthly fee invoices | Fees → Generate invoices (safe to run twice; it skips students already billed) |
| Publish exam results | Exams → open the exam → Publish results |
| Backups | cPanel → JetBackup / Backup Wizard. Back up the database **and** `public/uploads/` |

---

## Troubleshooting

**502 or "We're sorry, something went wrong"** — open `stderr.log` in the application root
through File Manager. Almost always a wrong `DB_*` value, or `npm install` not yet run.

**Styles missing** — Passenger should serve `public/` directly; Express also serves it.
Check that the clone actually contains `public/css/style.css`.

**Signed out immediately** — `SESSION_SECRET` must be set, and `COOKIE_SECURE=1` requires
the site to be served over HTTPS. The site has a valid certificate, so keep it at `1`.

**Uploads disappear after an update** — `public/uploads/` is excluded from git on purpose, so
a Git update never touches it. Back it up separately.

**Database connection limit** — lower `DB_POOL` (default 5) if the host is strict.

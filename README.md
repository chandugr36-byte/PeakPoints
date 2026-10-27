# PeakPoints Learning Portal

A web-based learning platform for PeakPoints Technical Solutions Pvt Ltd.

**Home page**: company logo, photo background, and a **Login** menu at the top right with
**Admin Login** and **Intern Login**.

**Admin** can: post courses (with lessons), create multiple-choice tests, create intern
accounts, assign interns to courses, see every intern's test results,
**allow a re-test** for an intern, **import / export courses and tests**, and
**issue an internship completion certificate** to eligible interns.

**Intern** can: log in, see only the courses assigned to them, read lessons, and take each
test **once**, with an instant score and a review of right/wrong answers. An intern cannot
retake a test unless the admin allows it.

Re-test rules
- Admin: Courses -> (course) -> test -> "Results" (or Interns -> (intern)) -> **Allow re-test**.
- The permission works once: after the intern submits the re-test it is used up. The admin can
  also cancel it before the intern starts. All attempts are kept in the results list.

Import / export (Admin -> Courses, a course page, or a test page)
- **Courses (.json)**: "Export all courses" or "Export this course" saves lessons, tests and questions
  (no interns, passwords or results). "Import courses" adds the courses in such a file as NEW courses, so
  nothing existing is ever overwritten - it can be used to move content between servers or keep backups.
- **Tests**: export a course's tests or a single test as .json; import .json tests into any course.
- **Questions (.csv)**: export a test's questions to Excel, edit, and import them back (or write a new sheet
  from the template: columns `question, option1, option2, option3, option4, correct` where `correct` is 1-4).
  A .csv import into a course creates one new test; on a test page it adds the rows to that test.
- In .json files `correct` is the 0-based position of the right option (0 = first option).

Admin password
- **Change it**: Admin -> My account -> Change password (asks for the current password).
- **Forgot it**: Admin Login -> "Forgot password?" -> a one-time link (valid 60 minutes) is emailed to the admin's
  address.   This needs SMTP settings in `.env` (see `.env.example`); without them no email is sent and the app logs a startup warning.
  Intern passwords are reset by an admin (Interns -> intern -> Reset password).

Internship completion certificate
- Admin -> Interns -> (intern) -> **Internship completion certificate**. An intern is *eligible* when they are
  assigned to at least one course with tests and have passed every test in their assigned courses. Enter the
  name to print and the internship start / end dates, then **Issue certificate**. (Tick "Issue anyway" to
  override the eligibility check.) Each certificate gets a unique number such as `PP-INT-2026-0001`.
- Open it with **View / print**, then use **Print / Save as PDF** (paper size 297 x 198 mm, margins "None").
- The intern sees a "View / print certificate" button on their own dashboard. **Revoke certificate** removes it.

Tech: Node.js + Express, server-rendered pages (EJS), SQLite database (one file), bcrypt password hashing.

---------------------------------------------------------------------
## 1. Run on your own PC first (Windows / Mac / Linux)

1. Install Node.js 20 or newer: https://nodejs.org
2. Copy `.env.example` to `.env` and set `SMTP_HOST`, `SMTP_PORT`, and `SMTP_SECURE` using the
   values from your email provider. Set `SMTP_USER` and `SMTP_PASS` if your provider requires
   authentication. `SMTP_FROM` can be left blank to use `SMTP_USER`, or set to a sender address
   allowed by your provider. `BASE_URL` must be the public address where the portal is reachable.
   The example is set to Gmail / Google Workspace (`smtp.gmail.com`); for Gmail, use an App Password
   rather than your normal password. Enter the app password without spaces. The sender defaults to
   `SMTP_USER`; that mailbox must be permitted to send mail through your Google account.
   Keep `.env` private and never commit it.
3. Open a terminal in this folder and run:

       npm install
       npm start

4. Open http://localhost:3000

There are no demo users or sample data. On first start one admin account is created:

| Login type    | Email                                        | Password     |
|---------------|----------------------------------------------|--------------|
| Admin Login   | devaraju@peakpoints-technicalsolutions.com   | Devaraju_401 |

**Change this password after the first login** (Admin -> My account). Admin accounts only work on Admin Login,
intern accounts (created by the admin) only on Intern Login. Older databases are cleaned automatically: the
old demo accounts (admin@example.com, intern@example.com) and the sample course are removed on start-up.

Try it: click Login (top right) -> Admin Login, then Courses -> create a course -> add lessons -> create a test and
questions -> Interns -> create an intern -> assign the course. Then log in as that intern.

---------------------------------------------------------------------
## 2. Launch under your domain (e.g. https://learn.yourdomain.com)

You need: a small Linux server (VPS) with a public IP, and a domain you control.
Any VPS works (DigitalOcean, Hetzner, AWS Lightsail, Azure VM...). 1 GB RAM is enough.

1. **DNS**: at your domain provider, create an `A` record:
   `learn.yourdomain.com  ->  <your server's public IP>`
2. **Install Docker** on the server: https://docs.docker.com/engine/install/
3. **Copy this folder** to the server (scp, git, or zip upload).
4. **Configure**:

       cp .env.example .env
       nano .env        # set DOMAIN, BASE_URL, SESSION_SECRET and the SMTP_* email settings
                    # (delete any old ADMIN_EMAIL / ADMIN_PASSWORD lines - see the note below)

   Generate a secret with: `openssl rand -hex 32`
5. **Open ports 80 and 443** in the server firewall / cloud security group.
6. **Start**:

       docker compose up -d --build

Caddy (included) obtains and renews a free HTTPS certificate automatically.
Visit https://learn.yourdomain.com, click Login -> Admin Login and sign in with the admin account above.
After changing SMTP values in `.env`, recreate the app container so Docker reloads them:

       docker compose up -d --force-recreate app

Notes
- The admin account is created on start-up only if it does not exist yet; it is never overwritten, so a changed or
  reset password survives restarts. Use the in-app password change / reset instead of editing `.env`.
- If your existing `.env` still has `ADMIN_EMAIL=admin@example.com` (the old demo admin), remove those ADMIN_* lines.
- Data lives in the Docker volume `lh_data` (SQLite file `/data/learninghub.db`).
  Back it up regularly, e.g.
  `docker compose cp app:/data/learninghub.db ./backup-$(date +%F).db`
- Update the app: upload new files, then `docker compose up -d --build`.
- View logs: `docker compose logs -f app`

### Render free + Backblaze B2 backup (data survives restarts)
Render's free plan wipes the disk on every restart/redeploy/idle spin-down. The app stores everything in one SQLite
file, so `start.sh` + `litestream.yml` (Litestream) copy that file to a Backblaze B2 bucket every few seconds and
restore it automatically when the service starts.
1. Backblaze: create an account -> **Buckets -> Create a Bucket** (Private). Note the bucket name and its **Endpoint**
   (e.g. `s3.us-west-004.backblazeb2.com`).
2. **Application Keys -> Add a New Application Key**: limit it to that bucket, access "Read and Write". Copy the
   **keyID** and **applicationKey** (shown only once).
3. On Render set `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`, `LITESTREAM_ACCESS_KEY_ID` (= keyID),
   `LITESTREAM_SECRET_ACCESS_KEY` (= applicationKey), plus `SESSION_SECRET` and `COOKIE_SECURE=true`.
With `LITESTREAM_BUCKET` empty the app runs normally with no backup (local PC / VPS with a persistent volume).
Any other S3-compatible bucket (R2, S3, Supabase) works with the same variables.

### No-Docker alternative
Any Node host works (Azure App Service, Render, Railway, a VPS with pm2 + nginx). Run `npm install && npm start`,
set the environment variables from `.env.example` plus `COOKIE_SECURE=true`, keep the database file on a
persistent disk (`DB_PATH`), and point your domain at it with HTTPS.

---------------------------------------------------------------------
## Project layout

    server.js          app setup, login/logout, security (CSRF, sessions)
    db.js              SQLite schema, clean-up of old demo data, first admin account
    mailer.js          sends email (password reset links) over SMTP
    certs.js           certificate eligibility + formatting helpers
    routes/admin.js    admin: courses, lessons, tests, questions, interns, assignments, results, my account
    routes/transfer.js admin: import / export of courses and tests (JSON, CSV)
    routes/certificates.js  admin: issue / update / revoke / view certificates
    routes/auth.js     forgot-password and reset-password pages
    routes/intern.js  intern: my courses, lessons, take test, results
    views/             pages (EJS templates)
    public/            CSS, JS, logo and background images (public/img)

## Security built in
bcrypt password hashing, signed httpOnly session cookies, CSRF tokens on every form, login rate limiting,
all user content HTML-escaped, role checks on every admin/intern route, interns can only open
courses/tests assigned to them, security headers (CSP, X-Frame-Options).

## Ideas for next steps
Higher-resolution background photos, edit lessons, file uploads / video hosting, timed tests, random question order, email
invites, intern self-registration, CSV export of results, Postgres for many users.

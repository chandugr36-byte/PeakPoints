# PeakPoints Learning Portal

A web-based learning platform for PeakPoints Technical Solutions Pvt Ltd.

**Home page**: company logo, photo background, and a **Login** menu at the top right with
**Admin Login** and **Intern Login**.

**Admin** can: post courses (with lessons), create multiple-choice tests, create intern
accounts, assign interns to courses, see every intern's test results, and
**allow a re-test** for an intern.

**Intern** can: log in, see only the courses assigned to them, read lessons, and take each
test **once**, with an instant score and a review of right/wrong answers. An intern cannot
retake a test unless the admin allows it.

Re-test rules
- Admin: Courses -> (course) -> test -> "Results" (or Interns -> (intern)) -> **Allow re-test**.
- The permission works once: after the intern submits the re-test it is used up. The admin can
  also cancel it before the intern starts. All attempts are kept in the results list.

Tech: Node.js + Express, server-rendered pages (EJS), SQLite database (one file), bcrypt password hashing.

---------------------------------------------------------------------
## 1. Run on your own PC first (Windows / Mac / Linux)

1. Install Node.js 20 or newer: https://nodejs.org
2. Open a terminal in this folder and run:

       npm install
       npm start

3. Open http://localhost:3000

Demo logins (created automatically on first start):

| Login type    | Email               | Password   |
|---------------|---------------------|------------|
| Admin Login   | admin@example.com   | admin123   |
| Intern Login | intern@example.com | intern123 |

(Admin accounts only work on Admin Login, intern accounts only on Intern Login.)

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
       nano .env        # set DOMAIN, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD

   Generate a secret with: `openssl rand -hex 32`
5. **Open ports 80 and 443** in the server firewall / cloud security group.
6. **Start**:

       docker compose up -d --build

Caddy (included) obtains and renews a free HTTPS certificate automatically.
Visit https://learn.yourdomain.com, click Login -> Admin Login and use the ADMIN_EMAIL / ADMIN_PASSWORD from `.env`.

Notes
- The admin account is created on the FIRST start only. Changing ADMIN_* later does not change it.
- Data lives in the Docker volume `lh_data` (SQLite file `/data/learninghub.db`).
  Back it up regularly, e.g.
  `docker compose cp app:/data/learninghub.db ./backup-$(date +%F).db`
- Update the app: upload new files, then `docker compose up -d --build`.
- View logs: `docker compose logs -f app`

### No-Docker alternative
Any Node host works (Azure App Service, Render, Railway, a VPS with pm2 + nginx). Run `npm install && npm start`,
set the environment variables from `.env.example` plus `COOKIE_SECURE=true`, keep the database file on a
persistent disk (`DB_PATH`), and point your domain at it with HTTPS.

---------------------------------------------------------------------
## Project layout

    server.js          app setup, login/logout, security (CSRF, sessions)
    db.js              SQLite schema + first-run seed data
    routes/admin.js    admin: courses, lessons, tests, questions, interns, assignments, results
    routes/intern.js  intern: my courses, lessons, take test, results
    views/             pages (EJS templates)
    public/            CSS, JS, logo and background images (public/img)

## Security built in
bcrypt password hashing, signed httpOnly session cookies, CSRF tokens on every form, login rate limiting,
all user content HTML-escaped, role checks on every admin/intern route, interns can only open
courses/tests assigned to them, security headers (CSP, X-Frame-Options).

## Ideas for next steps
Higher-resolution background photos, edit lessons, file uploads / video hosting, timed tests, random question order, certificates, email
invites and password reset, intern self-registration, CSV export of results, Postgres for many users.

require('dotenv').config();

const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const mailer = require('./mailer');

try {
  if (mailer.getSmtpConfig()) {
    console.log('SMTP mail configuration loaded.');
  } else {
    console.warn('SMTP is not configured. Password reset emails will not be sent; set SMTP_* values in .env.');
  }
} catch (error) {
  console.error('Invalid SMTP configuration:', error.message);
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);            // we run behind a reverse proxy (Caddy) in production
app.disable('x-powered-by');

let secret = process.env.SESSION_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: SESSION_SECRET not set. Logins will reset on every restart.');
}

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; form-action 'self'",
  });
  next();
});

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(cookieSession({
  name: 'lh',
  keys: [secret],
  maxAge: 8 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
}));

// Per-request context: current user, CSRF token, flash message, helpers
app.use((req, res, next) => {
  req.user = req.session.uid
    ? db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(req.session.uid)
    : null;
  if (req.session.uid && !req.user) req.session = {};       // account was deleted -> drop login
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.user = req.user;
  res.locals.csrf = req.session.csrf;
  res.locals.csrfField = () => `<input type="hidden" name="_csrf" value="${res.locals.csrf}">`;
  res.locals.flash = req.session && req.session.flash;
  if (req.session) req.session.flash = null;
  res.locals.fmt = (s) => (s ? String(s).slice(0, 16) + ' UTC' : '');
  next();
});

// CSRF check for every POST
app.use((req, res, next) => {
  // File uploads (multipart) cannot carry the token in the body, so it may also arrive as ?_csrf=...
  const sent = (req.body && req.body._csrf) || req.query._csrf;
  if (req.method === 'POST' && (!req.session || sent !== req.session.csrf)) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Session expired. Please go back, refresh and try again.' });
  }
  next();
});

// URL key -> role stored in the database (interns are stored with role 'student' internally)
const DB_ROLE = { admin: 'admin', intern: 'student' };

const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.redirect('/login/' + role);
  if (req.user.role !== DB_ROLE[role]) return res.status(403).render('error', { title: 'Forbidden', message: 'You do not have access to this page.' });
  next();
};

// ---- Login / logout (with a simple brute-force limiter) ----
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) { attempts.set(ip, { count: 0, reset: now + 15 * 60 * 1000 }); return false; }
  return a.count >= 10;
}

app.get('/', (req, res) => {
  if (!req.user) return res.render('home', { title: 'Welcome' });
  res.redirect(req.user.role === 'admin' ? '/admin' : '/intern');
});

// Login is split by role: /login/admin and /login/intern
const LOGIN_TITLES = { admin: 'Admin Login', intern: 'Intern Login' };

app.get('/login', (req, res) => res.redirect('/'));

app.get('/login/:role', (req, res) => {
  const role = req.params.role;
  if (!LOGIN_TITLES[role]) return res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
  if (req.user) return res.redirect('/');
  res.render('login', { title: LOGIN_TITLES[role], role, heading: LOGIN_TITLES[role] });
});

app.post('/login/:role', (req, res) => {
  const role = req.params.role;
  if (!LOGIN_TITLES[role]) return res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
  const page = { title: LOGIN_TITLES[role], role, heading: LOGIN_TITLES[role] };

  if (tooMany(req.ip)) {
    return res.status(429).render('login', { ...page, error: 'Too many attempts. Try again in 15 minutes.' });
  }
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // The account must exist, match this login type, and have the right password.
  if (!u || u.role !== DB_ROLE[role] || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    attempts.get(req.ip).count++;
    return res.status(401).render('login', { ...page, error: 'Invalid email or password for this login type.' });
  }
  req.session = { uid: u.id, csrf: crypto.randomBytes(16).toString('hex') };
  res.redirect('/');
});

app.post('/logout', (req, res) => { req.session = null; res.redirect('/'); });

app.use('/', require('./routes/auth'));
app.use('/admin', requireRole('admin'), require('./routes/admin'));
app.use('/intern', requireRole('intern'), require('./routes/intern'));

app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`PeakPoints running on http://localhost:${port}`));

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { sendMail, baseUrl } = require('../mailer');
const router = express.Router();

const TOKEN_MINUTES = 60;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };

// Small in-memory limiter: max 5 reset requests per IP per 15 minutes
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) { hits.set(ip, { count: 1, reset: now + 15 * 60 * 1000 }); return false; }
  h.count++;
  return h.count > 5;
}

// ---- Step 1: ask for a reset link (administrators only) ----
router.get('/forgot-password', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('forgot', { title: 'Forgot password', sent: false });
});

router.post('/forgot-password', (req, res) => {
  if (limited(req.ip)) {
    return res.status(429).render('forgot', { title: 'Forgot password', sent: false, error: 'Too many requests. Please try again in 15 minutes.' });
  }
  const email = String(req.body.email || '').trim().toLowerCase();
  const admin = db.prepare("SELECT id, name, email FROM users WHERE email=? AND role='admin'").get(email);

  if (admin) {
    db.prepare('DELETE FROM password_resets WHERE expires_at < ? OR used = 1').run(Date.now());
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)')
      .run(admin.id, sha256(token), Date.now() + TOKEN_MINUTES * 60 * 1000);
    const link = baseUrl() + '/reset-password/' + token;
    // Fire and forget, so the response time does not reveal whether the account exists.
    sendMail({
      to: admin.email,
      subject: 'Reset your PeakPoints admin password',
      text: 'Hello ' + admin.name + ',\n\n' +
        'We received a request to reset the password of your PeakPoints admin account.\n' +
        'Open this link to choose a new password (valid for ' + TOKEN_MINUTES + ' minutes, one use only):\n\n' +
        link + '\n\n' +
        'If you did not ask for this, you can ignore this email - your password stays the same.\n',
    }).catch((e) => console.error('Could not send reset email:', e.message));
  }
  // Same answer whether or not the address belongs to an admin.
  res.render('forgot', { title: 'Forgot password', sent: true });
});

// ---- Step 2: open the link and choose a new password ----
function findToken(token) {
  return db.prepare('SELECT * FROM password_resets WHERE token_hash=? AND used=0 AND expires_at > ?')
    .get(sha256(String(token)), Date.now());
}
const badLink = (res) => res.status(400).render('error', {
  title: 'Link not valid',
  message: 'This password reset link is invalid or has expired. Please request a new one from the Admin Login page.',
});

router.get('/reset-password/:token', (req, res) => {
  if (!findToken(req.params.token)) return badLink(res);
  res.render('reset', { title: 'Choose a new password', token: req.params.token });
});

router.post('/reset-password/:token', (req, res) => {
  const row = findToken(req.params.token);
  if (!row) return badLink(res);
  const pw = String(req.body.password || '');
  if (pw.length < 8) {
    return res.status(400).render('reset', { title: 'Choose a new password', token: req.params.token, error: 'Password must be at least 8 characters.' });
  }
  if (pw !== String(req.body.confirm || '')) {
    return res.status(400).render('reset', { title: 'Choose a new password', token: req.params.token, error: 'The two passwords do not match.' });
  }
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash=? WHERE id=? AND role='admin'").run(bcrypt.hashSync(pw, 10), row.user_id);
    db.prepare('UPDATE password_resets SET used=1 WHERE user_id=?').run(row.user_id);   // kills every other open link too
  })();
  req.session = { csrf: crypto.randomBytes(16).toString('hex') };
  flash(req, 'ok', 'Password changed. Please log in with your new password.');
  res.redirect('/login/admin');
});

module.exports = router;

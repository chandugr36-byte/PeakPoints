// Admin: issue / update / revoke / view internship completion certificates (mounted inside the admin router)
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { eligibility, todayLocal, validDate, view } = require('../certs');
const router = express.Router();

const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const int = (v) => Number.parseInt(v, 10);
const txt = (v, max) => String(v ?? '').trim().slice(0, max);

router.post('/interns/:id/certificate', (req, res) => {
  const id = int(req.params.id);
  const back = '/admin/interns/' + id;
  const intern = db.prepare("SELECT id,name FROM users WHERE id=? AND role='student'").get(id);
  if (!intern) return res.status(404).render('error', { title: 'Not found', message: 'That intern was not found.' });

  const name = txt(req.body.cert_name, 100);
  const start = txt(req.body.period_start, 10), end = txt(req.body.period_end, 10);
  if (!name) { flash(req, 'error', 'Enter the name to print on the certificate.'); return res.redirect(back); }
  if (!validDate(start) || !validDate(end) || start > end) {
    flash(req, 'error', 'Enter a valid internship start date and end date (start must not be after end).');
    return res.redirect(back);
  }
  const el = eligibility(id);
  if (!el.eligible && req.body.override !== '1') {
    flash(req, 'error', 'This intern is not eligible yet (' + el.reason + ') Tick "Issue anyway" to override.');
    return res.redirect(back);
  }

  const existing = db.prepare('SELECT id FROM certificates WHERE user_id=?').get(id);
  if (existing) {
    db.prepare('UPDATE certificates SET intern_name=?, period_start=?, period_end=? WHERE id=?').run(name, start, end, existing.id);
    flash(req, 'ok', 'Certificate details updated.');
  } else {
    db.transaction(() => {
      const issueDate = todayLocal();
      const tmp = 'tmp-' + crypto.randomBytes(6).toString('hex');
      const rowId = db.prepare('INSERT INTO certificates (user_id,cert_no,intern_name,period_start,period_end,issue_date,issued_by) VALUES (?,?,?,?,?,?,?)')
        .run(id, tmp, name, start, end, issueDate, req.user.id).lastInsertRowid;
      // number comes from the row id, so a revoked number is never handed out again
      db.prepare('UPDATE certificates SET cert_no=? WHERE id=?')
        .run('PP-INT-' + issueDate.slice(0, 4) + '-' + String(rowId).padStart(4, '0'), rowId);
    })();
    flash(req, 'ok', 'Certificate issued. The intern can now see it on their dashboard.');
  }
  res.redirect(back);
});

router.post('/interns/:id/certificate/revoke', (req, res) => {
  const id = int(req.params.id);
  db.prepare('DELETE FROM certificates WHERE user_id=?').run(id);
  flash(req, 'ok', 'Certificate revoked.');
  res.redirect('/admin/interns/' + id);
});

router.get('/certificates/:id', (req, res) => {
  const cert = db.prepare('SELECT * FROM certificates WHERE id=?').get(int(req.params.id));
  if (!cert) return res.status(404).render('error', { title: 'Not found', message: 'That certificate was not found.' });
  res.render('certificate', { title: 'Certificate ' + cert.cert_no, c: view(cert), backUrl: '/admin/interns/' + cert.user_id });
});

module.exports = router;

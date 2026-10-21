const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();
router.use(require('./transfer'));
router.use(require('./certificates'));
const { eligibility } = require('../certs');

const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const txt = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
const int = (v) => Number.parseInt(v, 10);
const ids = (v) => [].concat(v ?? []).map(int).filter(Number.isInteger);
const notFound = (res) => res.status(404).render('error', { title: 'Not found', message: 'That item was not found.' });

// ---------- Dashboard ----------
router.get('/', (req, res) => {
  const count = (sql) => db.prepare(sql).get().c;
  const stats = {
    interns: count("SELECT COUNT(*) c FROM users WHERE role='student'"),
    courses: count('SELECT COUNT(*) c FROM courses'),
    tests: count('SELECT COUNT(*) c FROM tests'),
    attempts: count('SELECT COUNT(*) c FROM attempts'),
  };
  const recent = db.prepare(`
    SELECT a.*, u.name intern, t.title test, t.id test_id FROM attempts a
    JOIN users u ON u.id=a.user_id JOIN tests t ON t.id=a.test_id
    ORDER BY a.id DESC LIMIT 10`).all();
  res.render('admin/dashboard', { title: 'Admin', stats, recent });
});

// ---------- Courses ----------
router.get('/courses', (req, res) => {
  const courses = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM lessons WHERE course_id=c.id) lessons,
      (SELECT COUNT(*) FROM tests WHERE course_id=c.id) tests,
      (SELECT COUNT(*) FROM enrollments WHERE course_id=c.id) interns
    FROM courses c ORDER BY c.id DESC`).all();
  res.render('admin/courses', { title: 'Courses', courses });
});

router.post('/courses', (req, res) => {
  const title = txt(req.body.title, 200);
  if (!title) { flash(req, 'error', 'Course title is required.'); return res.redirect('/admin/courses'); }
  const r = db.prepare('INSERT INTO courses (title,description) VALUES (?,?)').run(title, txt(req.body.description, 2000));
  flash(req, 'ok', 'Course created. Now add lessons, tests and assign interns.');
  res.redirect('/admin/courses/' + r.lastInsertRowid);
});

router.get('/courses/:id', (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(int(req.params.id));
  if (!course) return notFound(res);
  const lessons = db.prepare('SELECT * FROM lessons WHERE course_id=? ORDER BY position,id').all(course.id);
  const tests = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM questions WHERE test_id=t.id) questions
                            FROM tests t WHERE course_id=? ORDER BY id`).all(course.id);
  const interns = db.prepare(`
    SELECT u.id,u.name,u.email,
      EXISTS(SELECT 1 FROM enrollments e WHERE e.user_id=u.id AND e.course_id=?) enrolled
    FROM users u WHERE u.role='student' ORDER BY u.name`).all(course.id);
  res.render('admin/course', { title: course.title, course, lessons, tests, interns });
});

router.post('/courses/:id', (req, res) => {
  const id = int(req.params.id);
  const title = txt(req.body.title, 200);
  if (!title) { flash(req, 'error', 'Title is required.'); return res.redirect('/admin/courses/' + id); }
  db.prepare('UPDATE courses SET title=?, description=? WHERE id=?').run(title, txt(req.body.description, 2000), id);
  flash(req, 'ok', 'Course updated.');
  res.redirect('/admin/courses/' + id);
});

router.post('/courses/:id/delete', (req, res) => {
  db.prepare('DELETE FROM courses WHERE id=?').run(int(req.params.id));
  flash(req, 'ok', 'Course deleted.');
  res.redirect('/admin/courses');
});

router.post('/courses/:id/lessons', (req, res) => {
  const id = int(req.params.id);
  const title = txt(req.body.title, 200);
  let video = txt(req.body.video_url, 500);
  if (video && !/^https?:\/\//i.test(video)) video = '';
  if (!title) { flash(req, 'error', 'Lesson title is required.'); return res.redirect('/admin/courses/' + id); }
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM lessons WHERE course_id=?').get(id).p;
  db.prepare('INSERT INTO lessons (course_id,position,title,content,video_url) VALUES (?,?,?,?,?)')
    .run(id, pos, title, txt(req.body.content, 20000), video);
  flash(req, 'ok', 'Lesson added.');
  res.redirect('/admin/courses/' + id);
});

router.post('/lessons/:id/delete', (req, res) => {
  const l = db.prepare('SELECT course_id FROM lessons WHERE id=?').get(int(req.params.id));
  if (!l) return notFound(res);
  db.prepare('DELETE FROM lessons WHERE id=?').run(int(req.params.id));
  flash(req, 'ok', 'Lesson deleted.');
  res.redirect('/admin/courses/' + l.course_id);
});

// Assign interns to a course (checkbox list on the course page)
router.post('/courses/:id/assign', (req, res) => {
  const id = int(req.params.id);
  const chosen = new Set(ids(req.body.intern_ids));
  const valid = db.prepare("SELECT id FROM users WHERE role='student'").all().map((r) => r.id);
  db.transaction(() => {
    for (const sid of valid) {
      if (chosen.has(sid)) db.prepare('INSERT OR IGNORE INTO enrollments (user_id,course_id) VALUES (?,?)').run(sid, id);
      else db.prepare('DELETE FROM enrollments WHERE user_id=? AND course_id=?').run(sid, id);
    }
  })();
  flash(req, 'ok', 'Intern assignments saved.');
  res.redirect('/admin/courses/' + id);
});

// ---------- Tests ----------
router.post('/courses/:id/tests', (req, res) => {
  const id = int(req.params.id);
  const title = txt(req.body.title, 200);
  const pass = Math.min(100, Math.max(0, int(req.body.pass_mark) || 50));
  if (!title) { flash(req, 'error', 'Test title is required.'); return res.redirect('/admin/courses/' + id); }
  const r = db.prepare('INSERT INTO tests (course_id,title,pass_mark) VALUES (?,?,?)').run(id, title, pass);
  flash(req, 'ok', 'Test created. Add questions below.');
  res.redirect('/admin/tests/' + r.lastInsertRowid);
});

router.get('/tests/:id', (req, res) => {
  const test = db.prepare('SELECT t.*, c.title course_title FROM tests t JOIN courses c ON c.id=t.course_id WHERE t.id=?').get(int(req.params.id));
  if (!test) return notFound(res);
  const questions = db.prepare('SELECT * FROM questions WHERE test_id=? ORDER BY id').all(test.id)
    .map((q) => ({ ...q, options: JSON.parse(q.options) }));
  res.render('admin/test', { title: test.title, test, questions });
});

router.post('/tests/:id', (req, res) => {
  const id = int(req.params.id);
  const title = txt(req.body.title, 200);
  const pass = Math.min(100, Math.max(0, int(req.body.pass_mark) || 50));
  if (title) db.prepare('UPDATE tests SET title=?, pass_mark=? WHERE id=?').run(title, pass, id);
  flash(req, 'ok', 'Test updated.');
  res.redirect('/admin/tests/' + id);
});

router.post('/tests/:id/delete', (req, res) => {
  const t = db.prepare('SELECT course_id FROM tests WHERE id=?').get(int(req.params.id));
  if (!t) return notFound(res);
  db.prepare('DELETE FROM tests WHERE id=?').run(int(req.params.id));
  flash(req, 'ok', 'Test deleted.');
  res.redirect('/admin/courses/' + t.course_id);
});

router.post('/tests/:id/questions', (req, res) => {
  const id = int(req.params.id);
  const text = txt(req.body.text, 1000);
  const correctInput = int(req.body.correct) - 1;            // form sends 1..4
  const options = [];
  let correct = -1;
  [1, 2, 3, 4].forEach((n, i) => {
    const o = txt(req.body['option' + n], 300);
    if (o) { if (i === correctInput) correct = options.length; options.push(o); }
  });
  if (!text || options.length < 2 || correct < 0) {
    flash(req, 'error', 'Enter the question, at least 2 options, and mark a correct option that is not empty.');
    return res.redirect('/admin/tests/' + id);
  }
  db.prepare('INSERT INTO questions (test_id,text,options,correct) VALUES (?,?,?,?)').run(id, text, JSON.stringify(options), correct);
  flash(req, 'ok', 'Question added.');
  res.redirect('/admin/tests/' + id);
});

router.post('/questions/:id/delete', (req, res) => {
  const q = db.prepare('SELECT test_id FROM questions WHERE id=?').get(int(req.params.id));
  if (!q) return notFound(res);
  db.prepare('DELETE FROM questions WHERE id=?').run(int(req.params.id));
  flash(req, 'ok', 'Question deleted.');
  res.redirect('/admin/tests/' + q.test_id);
});

router.get('/tests/:id/results', (req, res) => {
  const test = db.prepare('SELECT * FROM tests WHERE id=?').get(int(req.params.id));
  if (!test) return notFound(res);
  const rows = db.prepare(`
    SELECT a.*, u.name, u.email,
      (a.id = (SELECT MAX(id) FROM attempts WHERE user_id=a.user_id AND test_id=a.test_id)) is_latest,
      EXISTS(SELECT 1 FROM retest_grants g WHERE g.user_id=a.user_id AND g.test_id=a.test_id) has_grant
    FROM attempts a JOIN users u ON u.id=a.user_id
    WHERE a.test_id=? ORDER BY a.id DESC`).all(test.id);
  res.render('admin/results', { title: 'Results', test, rows });
});

// Allow / cancel a re-test for one intern (interns cannot retake on their own)
const backTo = (req, testId, userId) => (req.body.back === 'intern' ? '/admin/interns/' + userId : '/admin/tests/' + testId + '/results');

router.post('/tests/:id/retest', (req, res) => {
  const testId = int(req.params.id), userId = int(req.body.user_id);
  const taken = db.prepare('SELECT 1 FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.user_id=? AND a.test_id=? AND u.role=\'student\'').get(userId, testId);
  if (!taken) { flash(req, 'error', 'That intern has not taken this test yet.'); return res.redirect(backTo(req, testId, userId)); }
  db.prepare('INSERT OR IGNORE INTO retest_grants (user_id,test_id) VALUES (?,?)').run(userId, testId);
  flash(req, 'ok', 'Re-test allowed. The intern can now retake this test once.');
  res.redirect(backTo(req, testId, userId));
});

router.post('/tests/:id/retest/cancel', (req, res) => {
  const testId = int(req.params.id), userId = int(req.body.user_id);
  db.prepare('DELETE FROM retest_grants WHERE user_id=? AND test_id=?').run(userId, testId);
  flash(req, 'ok', 'Re-test permission removed.');
  res.redirect(backTo(req, testId, userId));
});

// ---------- Interns ----------
router.get('/interns', (req, res) => {
  const interns = db.prepare(`
    SELECT u.*, (SELECT COUNT(*) FROM enrollments WHERE user_id=u.id) courses,
                (SELECT COUNT(*) FROM attempts WHERE user_id=u.id) attempts
    FROM users u WHERE role='student' ORDER BY name`).all();
  const certs = new Map(db.prepare('SELECT user_id, id FROM certificates').all().map((c) => [c.user_id, c.id]));
  interns.forEach((i) => { i.eligible = eligibility(i.id).eligible; i.cert_id = certs.get(i.id) || null; });
  res.render('admin/interns', { title: 'Interns', interns });
});

router.post('/interns', (req, res) => {
  const name = txt(req.body.name, 100);
  const email = txt(req.body.email, 200).toLowerCase();
  const pw = String(req.body.password || '');
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || pw.length < 8) {
    flash(req, 'error', 'Enter a name, a valid email and a password of at least 8 characters.');
    return res.redirect('/admin/interns');
  }
  try {
    const r = db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'student')")
      .run(name, email, bcrypt.hashSync(pw, 10));
    flash(req, 'ok', 'Intern created. Now assign courses.');
    res.redirect('/admin/interns/' + r.lastInsertRowid);
  } catch (e) {
    flash(req, 'error', 'That email is already registered.');
    res.redirect('/admin/interns');
  }
});

router.get('/interns/:id', (req, res) => {
  const intern = db.prepare("SELECT id,name,email,created_at FROM users WHERE id=? AND role='student'").get(int(req.params.id));
  if (!intern) return notFound(res);
  const courses = db.prepare(`SELECT c.id,c.title,
      EXISTS(SELECT 1 FROM enrollments e WHERE e.user_id=? AND e.course_id=c.id) enrolled
      FROM courses c ORDER BY c.title`).all(intern.id);
  const attempts = db.prepare(`
    SELECT a.*, t.title test,
      (a.id = (SELECT MAX(id) FROM attempts WHERE user_id=a.user_id AND test_id=a.test_id)) is_latest,
      EXISTS(SELECT 1 FROM retest_grants g WHERE g.user_id=a.user_id AND g.test_id=a.test_id) has_grant
    FROM attempts a JOIN tests t ON t.id=a.test_id
    WHERE a.user_id=? ORDER BY a.id DESC`).all(intern.id);
  const certificate = db.prepare('SELECT * FROM certificates WHERE user_id=?').get(intern.id) || null;
  res.render('admin/intern', {
    title: intern.name, intern, courses, attempts,
    el: eligibility(intern.id), certificate, certDefaults: { start: String(intern.created_at).slice(0, 10), end: require('../certs').todayLocal() },
  });
});

router.post('/interns/:id/courses', (req, res) => {
  const id = int(req.params.id);
  const chosen = new Set(ids(req.body.course_ids));
  db.transaction(() => {
    for (const c of db.prepare('SELECT id FROM courses').all()) {
      if (chosen.has(c.id)) db.prepare('INSERT OR IGNORE INTO enrollments (user_id,course_id) VALUES (?,?)').run(id, c.id);
      else db.prepare('DELETE FROM enrollments WHERE user_id=? AND course_id=?').run(id, c.id);
    }
  })();
  flash(req, 'ok', 'Course assignments saved.');
  res.redirect('/admin/interns/' + id);
});

router.post('/interns/:id/password', (req, res) => {
  const id = int(req.params.id);
  const pw = String(req.body.password || '');
  if (pw.length < 8) { flash(req, 'error', 'Password must be at least 8 characters.'); return res.redirect('/admin/interns/' + id); }
  db.prepare("UPDATE users SET password_hash=? WHERE id=? AND role='student'").run(bcrypt.hashSync(pw, 10), id);
  flash(req, 'ok', 'Password updated.');
  res.redirect('/admin/interns/' + id);
});

router.post('/interns/:id/delete', (req, res) => {
  db.prepare("DELETE FROM users WHERE id=? AND role='student'").run(int(req.params.id));
  flash(req, 'ok', 'Intern deleted.');
  res.redirect('/admin/interns');
});

// ---------- My account: change own password with the old password ----------
router.get('/account', (req, res) => res.render('admin/account', { title: 'My account' }));

router.post('/account/password', (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const cur = String(req.body.current || ''), pw = String(req.body.password || ''), again = String(req.body.confirm || '');
  if (!bcrypt.compareSync(cur, me.password_hash)) { flash(req, 'error', 'Your current password is not correct.'); return res.redirect('/admin/account'); }
  if (pw.length < 8) { flash(req, 'error', 'The new password must be at least 8 characters.'); return res.redirect('/admin/account'); }
  if (pw !== again) { flash(req, 'error', 'The two new passwords do not match.'); return res.redirect('/admin/account'); }
  if (pw === cur) { flash(req, 'error', 'The new password must be different from the current one.'); return res.redirect('/admin/account'); }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(pw, 10), me.id);
  db.prepare('UPDATE password_resets SET used=1 WHERE user_id=?').run(me.id);
  flash(req, 'ok', 'Password changed.');
  res.redirect('/admin/account');
});

module.exports = router;

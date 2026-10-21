const express = require('express');
const db = require('../db');
const router = express.Router();
const certs = require('../certs');

const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const notFound = (res) => res.status(404).render('error', { title: 'Not found', message: 'That item was not found, or has not been assigned to you.' });
const int = (v) => Number.parseInt(v, 10);
const enrolled = (userId, courseId) =>
  !!db.prepare('SELECT 1 FROM enrollments WHERE user_id=? AND course_id=?').get(userId, courseId);

// An intern may take a test once. After that only if the admin has granted a re-test.
const hasAttempt = (u, t) => !!db.prepare('SELECT 1 FROM attempts WHERE user_id=? AND test_id=?').get(u, t);
const hasGrant = (u, t) => !!db.prepare('SELECT 1 FROM retest_grants WHERE user_id=? AND test_id=?').get(u, t);
const canTake = (u, t) => !hasAttempt(u, t) || hasGrant(u, t);

// My courses
router.get('/', (req, res) => {
  const courses = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM lessons WHERE course_id=c.id) lessons,
      (SELECT COUNT(*) FROM tests WHERE course_id=c.id) tests,
      (SELECT COUNT(DISTINCT a.test_id) FROM attempts a JOIN tests t ON t.id=a.test_id
         WHERE a.user_id=? AND t.course_id=c.id AND a.passed=1) passed
    FROM enrollments e JOIN courses c ON c.id=e.course_id
    WHERE e.user_id=? ORDER BY e.assigned_at DESC`).all(req.user.id, req.user.id);
  const certificate = db.prepare('SELECT id, cert_no FROM certificates WHERE user_id=?').get(req.user.id) || null;
  res.render('intern/dashboard', { title: 'My courses', courses, certificate });

});

// My internship completion certificate (only if the admin has issued one)
router.get('/certificate', (req, res) => {
  const cert = db.prepare('SELECT * FROM certificates WHERE user_id=?').get(req.user.id);
  if (!cert) return notFound(res);
  res.render('certificate', { title: 'Certificate ' + cert.cert_no, c: certs.view(cert), backUrl: '/intern' });
});

// One course: lessons + tests
router.get('/courses/:id', (req, res) => {
  const id = int(req.params.id);
  if (!enrolled(req.user.id, id)) return notFound(res);
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(id);
  const lessons = db.prepare('SELECT * FROM lessons WHERE course_id=? ORDER BY position,id').all(id);
  const u = req.user.id;
  const tests = db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM questions WHERE test_id=t.id) questions,
      (SELECT MAX(ROUND(100.0*score/total)) FROM attempts WHERE user_id=? AND test_id=t.id) best,
      (SELECT MAX(passed) FROM attempts WHERE user_id=? AND test_id=t.id) passed,
      (SELECT MAX(id) FROM attempts WHERE user_id=? AND test_id=t.id) last_attempt,
      EXISTS(SELECT 1 FROM attempts WHERE user_id=? AND test_id=t.id) attempted,
      EXISTS(SELECT 1 FROM retest_grants WHERE user_id=? AND test_id=t.id) retest
    FROM tests t WHERE t.course_id=? ORDER BY t.id`).all(u, u, u, u, u, id);
  res.render('intern/course', { title: course.title, course, lessons, tests });
});

// Take a test
function loadTest(req, res) {
  const test = db.prepare('SELECT * FROM tests WHERE id=?').get(int(req.params.id));
  if (!test || !enrolled(req.user.id, test.course_id)) { notFound(res); return null; }
  test.questions = db.prepare('SELECT * FROM questions WHERE test_id=? ORDER BY id').all(test.id)
    .map((q) => ({ ...q, options: JSON.parse(q.options) }));
  return test;
}

const alreadyTaken = (req, res, test) => {
  flash(req, 'error', 'You have already completed this test. Please ask your administrator if you need a re-test.');
  res.redirect('/intern/courses/' + test.course_id);
};

router.get('/tests/:id', (req, res) => {
  const test = loadTest(req, res);
  if (!test) return;
  if (!canTake(req.user.id, test.id)) return alreadyTaken(req, res, test);
  res.render('intern/take', { title: test.title, test, isRetest: hasAttempt(req.user.id, test.id) });
});

router.post('/tests/:id', (req, res) => {
  const test = loadTest(req, res);
  if (!test) return;
  if (!test.questions.length) return res.redirect('/intern/courses/' + test.course_id);

  const answers = {};
  let score = 0;
  for (const q of test.questions) {
    const a = int(req.body['q' + q.id]);
    answers[q.id] = Number.isInteger(a) ? a : -1;           // -1 = unanswered
    if (a === q.correct) score++;
  }
  const total = test.questions.length;
  const passed = Math.round((100 * score) / total) >= test.pass_mark ? 1 : 0;

  // Check permission and save atomically, so a double-click cannot create two attempts.
  const attemptId = db.transaction(() => {
    if (!canTake(req.user.id, test.id)) return null;
    const r = db.prepare('INSERT INTO attempts (user_id,test_id,score,total,passed,answers) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, test.id, score, total, passed, JSON.stringify(answers));
    db.prepare('DELETE FROM retest_grants WHERE user_id=? AND test_id=?').run(req.user.id, test.id);  // permission is single-use
    return r.lastInsertRowid;
  })();

  if (!attemptId) return alreadyTaken(req, res, test);
  res.redirect('/intern/attempts/' + attemptId);
});

// Result + answer review
router.get('/attempts/:id', (req, res) => {
  const attempt = db.prepare('SELECT * FROM attempts WHERE id=? AND user_id=?').get(int(req.params.id), req.user.id);
  if (!attempt) return notFound(res);
  const test = db.prepare('SELECT * FROM tests WHERE id=?').get(attempt.test_id);
  const answers = JSON.parse(attempt.answers);
  const questions = db.prepare('SELECT * FROM questions WHERE test_id=? ORDER BY id').all(test.id)
    .map((q) => ({ ...q, options: JSON.parse(q.options), chosen: answers[q.id] ?? -1 }));
  res.render('intern/result', {
    title: 'Result', attempt, test, questions,
    percent: Math.round((100 * attempt.score) / attempt.total),
    retestAllowed: hasGrant(req.user.id, test.id),
  });
});

module.exports = router;

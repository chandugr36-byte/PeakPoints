// Import / export of courses and tests (mounted inside the admin router).
//   JSON  - complete courses (lessons + tests + questions) or tests. Contains no intern data or results.
//   CSV   - the questions of ONE test, easy to edit in Excel / Google Sheets.
const express = require('express');
const multer = require('multer');
const db = require('../db');
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const int = (v) => Number.parseInt(v, 10);
const today = () => new Date().toISOString().slice(0, 10);
const slug = (s) => String(s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'export';
const notFound = (res) => res.status(404).render('error', { title: 'Not found', message: 'That item was not found.' });

const LIMITS = { courses: 200, lessons: 500, tests: 100, questions: 500 };

// ---------------- reading from the database ----------------
function loadQuestions(testId) {
  return db.prepare('SELECT text, options, correct FROM questions WHERE test_id=? ORDER BY id').all(testId)
    .map((q) => ({ text: q.text, options: JSON.parse(q.options), correct: q.correct }));
}
function loadTests(courseId) {
  return db.prepare('SELECT id, title, pass_mark FROM tests WHERE course_id=? ORDER BY id').all(courseId)
    .map((t) => ({ title: t.title, pass_mark: t.pass_mark, questions: loadQuestions(t.id) }));
}
function loadCourse(c) {
  return {
    title: c.title,
    description: c.description,
    lessons: db.prepare('SELECT title, content, video_url FROM lessons WHERE course_id=? ORDER BY position,id').all(c.id),
    tests: loadTests(c.id),
  };
}
function sendJson(res, filename, obj) {
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.send(JSON.stringify(obj, null, 2));
}

// ---------------- validation of imported data ----------------
const str = (v, max) => String(v ?? '').trim().slice(0, max);
function cleanQuestion(q, where) {
  const text = str(q && q.text, 1000);
  const options = (Array.isArray(q && q.options) ? q.options : []).map((o) => str(o, 300));
  const correct = Number(q && q.correct);
  if (!text) throw new Error(where + ': question text is empty.');
  if (options.length < 2 || options.length > 4 || options.some((o) => !o)) throw new Error(where + ': needs 2 to 4 non-empty options.');
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw new Error(where + ': "correct" must be the 0-based number of the right option.');
  return { text, options, correct };
}
function cleanTest(t, where) {
  const title = str(t && t.title, 200);
  if (!title) throw new Error(where + ': test title is empty.');
  const qs = Array.isArray(t.questions) ? t.questions : [];
  if (qs.length > LIMITS.questions) throw new Error(where + ': too many questions (max ' + LIMITS.questions + ').');
  const pm = Number(t.pass_mark);
  return {
    title,
    pass_mark: Number.isFinite(pm) ? Math.min(100, Math.max(0, Math.round(pm))) : 50,
    questions: qs.map((q, i) => cleanQuestion(q, where + ', question ' + (i + 1))),
  };
}
function cleanCourse(c, i) {
  const where = 'Course ' + (i + 1);
  const title = str(c && c.title, 200);
  if (!title) throw new Error(where + ': title is empty.');
  const lessons = Array.isArray(c.lessons) ? c.lessons : [];
  const tests = Array.isArray(c.tests) ? c.tests : [];
  if (lessons.length > LIMITS.lessons) throw new Error(where + ': too many lessons (max ' + LIMITS.lessons + ').');
  if (tests.length > LIMITS.tests) throw new Error(where + ': too many tests (max ' + LIMITS.tests + ').');
  return {
    title,
    description: str(c.description, 2000),
    lessons: lessons.map((l, j) => {
      const lt = str(l && l.title, 200);
      if (!lt) throw new Error(where + ', lesson ' + (j + 1) + ': title is empty.');
      let video = str(l.video_url, 500);
      if (video && !/^https?:\/\//i.test(video)) video = '';
      return { title: lt, content: str(l.content, 20000), video_url: video };
    }),
    tests: tests.map((t, j) => cleanTest(t, where + ', test ' + (j + 1))),
  };
}

function parseJsonFile(file) {
  let data;
  try { data = JSON.parse(file.buffer.toString('utf8').replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error('That file is not valid JSON.'); }
  return data;
}

// ---------------- CSV (questions of one test) ----------------
const CSV_HEAD = ['question', 'option1', 'option2', 'option3', 'option4', 'correct'];
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                       // stop spreadsheet formula injection
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(questions) {
  const lines = [CSV_HEAD.join(',')];
  for (const q of questions) {
    const row = [q.text, q.options[0], q.options[1], q.options[2] || '', q.options[3] || '', q.correct + 1];
    lines.push(row.map(csvCell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';                // BOM so Excel opens it as UTF-8
}
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}
function questionsFromCsv(file) {
  const rows = parseCsv(file.buffer.toString('utf8'));
  if (rows.length < 2) throw new Error('The CSV has no questions. Expected a header row and at least one question.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  if (col('question') < 0 || col('option1') < 0 || col('option2') < 0 || col('correct') < 0) {
    throw new Error('The CSV header must contain: ' + CSV_HEAD.join(', ') + '.');
  }
  const unformula = (s) => String(s ?? '').replace(/^'(?=[=+\-@\t\r])/, '');
  if (rows.length - 1 > LIMITS.questions) throw new Error('Too many questions (max ' + LIMITS.questions + ').');
  return rows.slice(1).map((r, i) => {
    const where = 'CSV row ' + (i + 2);
    const get = (n) => (col(n) >= 0 ? unformula(r[col(n)]).trim() : '');
    const all = [get('option1'), get('option2'), get('option3'), get('option4')];
    // keep the number the admin typed (1-4) pointing at the right option even if an earlier option is blank
    const typed = int(get('correct'));
    const options = []; let correct = -1;
    all.forEach((o, k) => { if (o) { if (k === typed - 1) correct = options.length; options.push(o); } });
    return cleanQuestion({ text: get('question'), options, correct: correct }, where);
  });
}

// ---------------- writing to the database ----------------
const insCourse = db.prepare('INSERT INTO courses (title,description) VALUES (?,?)');
const insLesson = db.prepare('INSERT INTO lessons (course_id,position,title,content,video_url) VALUES (?,?,?,?,?)');
const insTest = db.prepare('INSERT INTO tests (course_id,title,pass_mark) VALUES (?,?,?)');
const insQuestion = db.prepare('INSERT INTO questions (test_id,text,options,correct) VALUES (?,?,?,?)');
function saveTest(courseId, t) {
  const id = insTest.run(courseId, t.title, t.pass_mark).lastInsertRowid;
  t.questions.forEach((q) => insQuestion.run(id, q.text, JSON.stringify(q.options), q.correct));
  return t.questions.length;
}

// Wrap multer so upload problems become friendly messages
const withFile = (back) => (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      flash(req, 'error', err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB).' : 'Upload failed. Please try again.');
      return res.redirect(typeof back === 'function' ? back(req) : back);
    }
    if (!req.file) { flash(req, 'error', 'Please choose a file first.'); return res.redirect(typeof back === 'function' ? back(req) : back); }
    next();
  });
};

// =============== EXPORT ===============
router.get('/courses/export', (req, res) => {
  const courses = db.prepare('SELECT * FROM courses ORDER BY id').all().map(loadCourse);
  sendJson(res, 'peakpoints-all-courses-' + today() + '.json',
    { format: 'peakpoints-courses', version: 1, exported_at: new Date().toISOString(), courses });
});

router.get('/courses/:id/export', (req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(int(req.params.id));
  if (!c) return notFound(res);
  sendJson(res, 'peakpoints-course-' + slug(c.title) + '-' + today() + '.json',
    { format: 'peakpoints-courses', version: 1, exported_at: new Date().toISOString(), courses: [loadCourse(c)] });
});

router.get('/courses/:id/tests/export', (req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(int(req.params.id));
  if (!c) return notFound(res);
  sendJson(res, 'peakpoints-tests-' + slug(c.title) + '-' + today() + '.json',
    { format: 'peakpoints-tests', version: 1, exported_at: new Date().toISOString(), tests: loadTests(c.id) });
});

router.get('/tests/:id/export', (req, res) => {
  const t = db.prepare('SELECT * FROM tests WHERE id=?').get(int(req.params.id));
  if (!t) return notFound(res);
  const questions = loadQuestions(t.id);
  if (req.query.format === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="peakpoints-test-' + slug(t.title) + '-' + today() + '.csv"');
    return res.send(toCsv(questions));
  }
  sendJson(res, 'peakpoints-test-' + slug(t.title) + '-' + today() + '.json',
    { format: 'peakpoints-tests', version: 1, exported_at: new Date().toISOString(), tests: [{ title: t.title, pass_mark: t.pass_mark, questions }] });
});

// A ready-to-fill CSV template
router.get('/tests/template.csv', (req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="peakpoints-questions-template.csv"');
  res.send(toCsv([
    { text: 'Example: which is a primary colour?', options: ['Red', 'Green', 'Orange'], correct: 0 },
    { text: 'Example: 2 + 2 = ?', options: ['3', '4'], correct: 1 },
  ]));
});

// =============== IMPORT ===============
// Courses (JSON) -> always creates NEW courses, nothing existing is overwritten.
router.post('/courses/import', withFile('/admin/courses'), (req, res) => {
  try {
    const data = parseJsonFile(req.file);
    let list = Array.isArray(data) ? data : (data && data.courses) || (data && data.title ? [data] : null);
    if (!Array.isArray(list) || !list.length) throw new Error('No courses found in that file. Use a file exported from PeakPoints.');
    if (list.length > LIMITS.courses) throw new Error('Too many courses in one file (max ' + LIMITS.courses + ').');
    const courses = list.map(cleanCourse);

    let lessons = 0, tests = 0, questions = 0;
    db.transaction(() => {
      for (const c of courses) {
        const id = insCourse.run(c.title, c.description).lastInsertRowid;
        c.lessons.forEach((l, i) => { insLesson.run(id, i + 1, l.title, l.content, l.video_url); lessons++; });
        c.tests.forEach((t) => { questions += saveTest(id, t); tests++; });
      }
    })();
    flash(req, 'ok', 'Imported ' + courses.length + ' course(s): ' + lessons + ' lessons, ' + tests + ' tests, ' + questions + ' questions. Assign interns to them next.');
  } catch (e) {
    flash(req, 'error', 'Import failed - nothing was added. ' + e.message);
  }
  res.redirect('/admin/courses');
});

// Tests into an existing course: JSON (one or more tests) or CSV (one new test)
router.post('/courses/:id/tests/import', withFile((req) => '/admin/courses/' + int(req.params.id)), (req, res) => {
  const id = int(req.params.id);
  const back = '/admin/courses/' + id;
  if (!db.prepare('SELECT 1 FROM courses WHERE id=?').get(id)) return notFound(res);
  try {
    const isCsv = /\.csv$/i.test(req.file.originalname || '');
    let tests;
    if (isCsv) {
      const title = str(req.body.title, 200);
      if (!title) throw new Error('For a CSV file, please type a title for the new test.');
      const pm = int(req.body.pass_mark);
      tests = [{ title, pass_mark: Math.min(100, Math.max(0, Number.isInteger(pm) ? pm : 50)), questions: questionsFromCsv(req.file) }];
    } else {
      const data = parseJsonFile(req.file);
      const list = Array.isArray(data) ? data : (data && data.tests) || (data && data.title ? [data] : null);
      if (!Array.isArray(list) || !list.length) throw new Error('No tests found in that file. Use a file exported from PeakPoints.');
      if (list.length > LIMITS.tests) throw new Error('Too many tests in one file (max ' + LIMITS.tests + ').');
      tests = list.map((t, i) => cleanTest(t, 'Test ' + (i + 1)));
    }
    let questions = 0;
    db.transaction(() => { tests.forEach((t) => { questions += saveTest(id, t); }); })();
    flash(req, 'ok', 'Imported ' + tests.length + ' test(s) with ' + questions + ' questions.');
  } catch (e) {
    flash(req, 'error', 'Import failed - nothing was added. ' + e.message);
  }
  res.redirect(back);
});

// Questions (CSV or JSON) appended to an existing test
router.post('/tests/:id/questions/import', withFile((req) => '/admin/tests/' + int(req.params.id)), (req, res) => {
  const id = int(req.params.id);
  const back = '/admin/tests/' + id;
  if (!db.prepare('SELECT 1 FROM tests WHERE id=?').get(id)) return notFound(res);
  try {
    let qs;
    if (/\.csv$/i.test(req.file.originalname || '')) qs = questionsFromCsv(req.file);
    else {
      const data = parseJsonFile(req.file);
      const t = Array.isArray(data && data.tests) ? data.tests[0] : data;
      const list = Array.isArray(data) ? data : t && t.questions;
      if (!Array.isArray(list) || !list.length) throw new Error('No questions found in that file.');
      if (list.length > LIMITS.questions) throw new Error('Too many questions (max ' + LIMITS.questions + ').');
      qs = list.map((q, i) => cleanQuestion(q, 'Question ' + (i + 1)));
    }
    db.transaction(() => { qs.forEach((q) => insQuestion.run(id, q.text, JSON.stringify(q.options), q.correct)); })();
    flash(req, 'ok', 'Imported ' + qs.length + ' question(s).');
  } catch (e) {
    flash(req, 'error', 'Import failed - nothing was added. ' + e.message);
  }
  res.redirect(back);
});

module.exports = router;

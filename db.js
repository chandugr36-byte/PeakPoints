const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'learninghub.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','student')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS enrollments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, course_id)
);
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  pass_mark INTEGER NOT NULL DEFAULT 50
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  options TEXT NOT NULL,          -- JSON array of 2-4 strings
  correct INTEGER NOT NULL        -- 0-based index into options
);
-- A row here means the admin has allowed this intern to take this test once more.
-- It is deleted automatically when the intern submits the re-test.
CREATE TABLE IF NOT EXISTS retest_grants (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, test_id)
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  answers TEXT NOT NULL,          -- JSON {questionId: chosenIndex}
  taken_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function seed() {
  if (db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c) return;

  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('WARNING: using default admin password "admin123". Set ADMIN_PASSWORD in .env and change it.');
  }
  db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')").run(
    process.env.ADMIN_NAME || 'Administrator',
    (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase(),
    bcrypt.hashSync(adminPass, 10)
  );

  if (process.env.SEED_DEMO === 'false') return;

  // Demo data so you can try the app straight away (set SEED_DEMO=false to skip)
  const stu = db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'student')")
    .run('Demo Intern', 'intern@example.com', bcrypt.hashSync('intern123', 10)).lastInsertRowid;
  const course = db.prepare('INSERT INTO courses (title,description) VALUES (?,?)')
    .run('Study Skills 101', 'A short starter course on learning effectively.').lastInsertRowid;
  const lesson = db.prepare('INSERT INTO lessons (course_id,position,title,content) VALUES (?,?,?,?)');
  lesson.run(course, 1, 'Plan your study time',
    'Split your study into short blocks of 25-45 minutes with a 5-10 minute break in between.\nDecide beforehand what you will cover in each block.');
  lesson.run(course, 2, 'Active recall',
    'Instead of re-reading, close the book and try to write down everything you remember.\nTesting yourself is one of the most effective ways to learn.');
  db.prepare('INSERT INTO enrollments (user_id,course_id) VALUES (?,?)').run(stu, course);
  const test = db.prepare('INSERT INTO tests (course_id,title,pass_mark) VALUES (?,?,?)')
    .run(course, 'Study Skills Quiz', 60).lastInsertRowid;
  const q = db.prepare('INSERT INTO questions (test_id,text,options,correct) VALUES (?,?,?,?)');
  q.run(test, 'How long should a focused study block be?', JSON.stringify(['5 hours', '25-45 minutes', '1 minute']), 1);
  q.run(test, 'Which technique means testing yourself from memory?', JSON.stringify(['Passive re-reading', 'Highlighting', 'Active recall', 'Skimming']), 2);
  q.run(test, 'What should you do between study blocks?', JSON.stringify(['Take a short break', 'Keep going without rest']), 0);
}
seed();

module.exports = db;

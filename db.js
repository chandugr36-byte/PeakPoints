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
-- Password-reset links for admins. Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,     -- unix ms
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Internship completion certificates (one per intern).
CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  cert_no TEXT NOT NULL UNIQUE,
  intern_name TEXT NOT NULL,       -- name exactly as printed on the certificate
  period_start TEXT NOT NULL,      -- YYYY-MM-DD
  period_end TEXT NOT NULL,        -- YYYY-MM-DD
  issue_date TEXT NOT NULL,        -- YYYY-MM-DD
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// The first administrator. Override with ADMIN_* in .env if you ever need a different one.
const ADMIN_NAME = process.env.ADMIN_NAME || 'Devaraju';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'devaraju@peakpoints-technicalsolutions.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Devaraju_401';

function removeDummyData() {
  // Accounts and the sample course that older versions created automatically.
  db.prepare("DELETE FROM users WHERE email IN ('admin@example.com','intern@example.com')").run();
  db.prepare("DELETE FROM courses WHERE title='Study Skills 101' AND description='A short starter course on learning effectively.'").run();
}

function seedAdmin() {
  const existing = db.prepare('SELECT id, role FROM users WHERE email=?').get(ADMIN_EMAIL);
  if (existing) {
    if (existing.role !== 'admin') console.warn('WARNING: ' + ADMIN_EMAIL + ' exists but is not an admin account.');
    return;                                   // never overwrite: a changed/reset password must survive restarts
  }
  db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')")
    .run(ADMIN_NAME, ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10));
  console.log('Created admin account ' + ADMIN_EMAIL + ' - please change the password after first login.');
}

removeDummyData();
seedAdmin();

module.exports = db;

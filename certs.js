// Internship completion certificate helpers
const db = require('./db');

const TZ = process.env.CERT_TIMEZONE || 'Asia/Kolkata';   // the date printed as "Date of Issue"

// Eligible = assigned to at least one course that has tests, and has PASSED every one of those tests
// (a pass on any attempt counts, the same as the intern's own dashboard).
function eligibility(userId) {
  const rows = db.prepare(`
    SELECT t.id, MAX(a.passed) passed
    FROM enrollments e
    JOIN tests t ON t.course_id = e.course_id
    LEFT JOIN attempts a ON a.test_id = t.id AND a.user_id = e.user_id
    WHERE e.user_id = ? GROUP BY t.id`).all(userId);
  const total = rows.length;
  const passed = rows.filter((r) => r.passed === 1).length;
  const courses = db.prepare('SELECT COUNT(*) c FROM enrollments WHERE user_id=?').get(userId).c;
  let reason = '';
  if (!courses) reason = 'No courses are assigned to this intern yet.';
  else if (!total) reason = 'The assigned courses have no tests yet.';
  else if (passed < total) reason = 'Passed ' + passed + ' of ' + total + ' tests.';
  return { eligible: total > 0 && passed === total, total, passed, courses, reason };
}

const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());   // YYYY-MM-DD

const validDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const longDate = (s) => new Date(s + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function view(cert) {
  return {
    name: cert.intern_name,
    certNo: cert.cert_no,
    issued: longDate(cert.issue_date),
    period: longDate(cert.period_start) + ' to ' + longDate(cert.period_end),
  };
}

module.exports = { eligibility, todayLocal, validDate, longDate, view };

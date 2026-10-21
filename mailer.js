const nodemailer = require('nodemailer');

// Email is sent through any SMTP server (Gmail/Google Workspace, Microsoft 365, Zoho, SendGrid, ...).
// Configure SMTP_* in .env.
function getSmtpConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) return null;

  const rawPort = process.env.SMTP_PORT;
  const port = rawPort ? Number(rawPort) : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid port number.');
  }

  const rawSecure = process.env.SMTP_SECURE;
  if (rawSecure && !['true', 'false'].includes(rawSecure.toLowerCase())) {
    throw new Error('SMTP_SECURE must be either true or false.');
  }

  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '');
  if (!!user !== !!pass) {
    throw new Error('Set both SMTP_USER and SMTP_PASS, or leave both empty for an unauthenticated relay.');
  }

  const from = String(process.env.SMTP_FROM || user).trim();
  if (!from) {
    throw new Error('Set SMTP_FROM, or set SMTP_USER so it can be used as the sender address.');
  }

  return {
    host,
    port,
    secure: rawSecure ? rawSecure.toLowerCase() === 'true' : port === 465,
    auth: user ? { user, pass } : undefined,
    from,
  };
}

let transport;
function getTransport() {
  const config = getSmtpConfig();
  if (!config) {
    throw new Error('SMTP is not configured. Set SMTP_HOST and the other SMTP_* values in .env.');
  }
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }
  return transport;
}

async function sendMail({ to, subject, text }) {
  await getTransport().sendMail({
    from: getSmtpConfig().from,
    to, subject, text,
  });
  return { sent: true };
}

// Public address of the portal, used to build links inside emails.
function baseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  if (process.env.DOMAIN && !/yourdomain\.com$/i.test(process.env.DOMAIN)) return 'https://' + process.env.DOMAIN;
  return 'http://localhost:' + (process.env.PORT || 3000);
}

module.exports = { sendMail, baseUrl, getSmtpConfig };

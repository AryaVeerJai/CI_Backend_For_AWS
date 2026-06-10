const nodemailer = require('nodemailer');

async function sendEmail({ to, subject, html, text, attachments }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('Email service is not configured');
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,    
      pass: process.env.EMAIL_PASS     
    }
  });

  return transporter.sendMail({
    from: `"Carbon Platform" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    text,
    attachments
  });
}

module.exports = sendEmail;

'use strict';
const nodemailer = require('nodemailer');
const logger = require('./logger');

const isSmtpConfigured = !!(
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
);

let transporter = null;

if (isSmtpConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Generates the premium glassmorphism styled HTML wrapper for transaction emails.
 */
function getEmailTemplate(title, description, buttonText, buttonUrl, detailText) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${title}</title>
      <style>
        body {
          background-color: #0a0b10;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #e1e2eb;
          margin: 0;
          padding: 40px 20px;
        }
        .container {
          max-width: 500px;
          margin: 0 auto;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          padding: 40px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          text-align: center;
        }
        .logo {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.5px;
          background: linear-gradient(135deg, #7c4dff 0%, #2979ff 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 30px;
          display: inline-block;
        }
        h1 {
          font-size: 22px;
          font-weight: 700;
          color: #ffffff;
          margin: 0 0 16px 0;
        }
        p {
          font-size: 15px;
          line-height: 24px;
          color: #cbc3d7;
          margin: 0 0 32px 0;
        }
        .btn-gradient {
          display: inline-block;
          padding: 14px 32px;
          font-size: 15px;
          font-weight: 700;
          color: #ffffff !important;
          text-decoration: none;
          background: linear-gradient(135deg, #7c4dff 0%, #2979ff 100%);
          border-radius: 9999px;
          box-shadow: 0 8px 24px rgba(124, 77, 255, 0.25);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.06);
          margin: 32px 0;
        }
        .detail-text {
          font-size: 12px;
          line-height: 18px;
          color: #938f99;
          word-break: break-all;
        }
        .footer {
          margin-top: 30px;
          font-size: 11px;
          color: #505360;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">Persona Studio</div>
        <h1>${title}</h1>
        <p>${description}</p>
        <a href="${buttonUrl}" class="btn-gradient">${buttonText}</a>
        <div class="divider"></div>
        <div class="detail-text">
          ${detailText}<br>
          <a href="${buttonUrl}" style="color: #7c4dff; text-decoration: underline;">${buttonUrl}</a>
        </div>
        <div class="footer">
          Persona Studio &mdash; Built for the EAFIT Challenge.
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Send email using Nodemailer SMTP transporter, or fall back to mock logger output.
 */
async function sendMail({ to, subject, html, text }) {
  if (isSmtpConfigured && transporter) {
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || '"Persona Studio" <noreply@persona.studio>',
        to,
        subject,
        text,
        html,
      });
      logger.info(`Email successfully sent to: ${to}`);
    } catch (error) {
      logger.error(`Error sending email to ${to}:`, error);
      // Fallback
      logger.info(`\n📧 [SMTP Failure Fallback Log]\nTo: ${to}\nSubject: ${subject}\nLink/Text:\n${text}\n`);
    }
  } else {
    // Beautiful mock logging for standard local testing
    logger.info(`\n📧 [Mock Email Service] -------------------------------------`);
    logger.info(`To:      ${to}`);
    logger.info(`Subject: ${subject}`);
    logger.info(`Action Link:`);
    logger.info(`👉 ${text}`);
    logger.info(`-------------------------------------------------------------\n`);
  }
}

module.exports = {
  sendMail,
  getEmailTemplate,
};

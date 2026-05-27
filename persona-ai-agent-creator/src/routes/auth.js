'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');

const db        = require('../db/sqlite');
const logger    = require('../services/logger');
const { jwtSecret } = require('../config');
const { sendMail, getEmailTemplate } = require('../services/email');
const { authRateLimiter } = require('../middlewares/rateLimiter');
const router    = express.Router();

router.use(authRateLimiter);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.get('/register', (_req, res) => res.render('register', { error: null }));

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).render('register', { error: res.locals.t('validation.registerRequired') });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).render('register', { error: res.locals.t('validation.invalidEmail') });
  }
  if (db.find('users', u => u.email === email)) {
    return res.status(400).render('register', { error: res.locals.t('validation.registerExists') });
  }
  
  const hashedPassword = await bcrypt.hash(password, 10);
  const verificationToken = crypto.randomBytes(32).toString('hex');
  
  db.push('users', {
    id: crypto.randomBytes(16).toString('hex'),
    email,
    password: hashedPassword,
    name,
    is_verified: 0,
    verification_token: verificationToken,
  });

  const activationUrl = `${req.protocol}://${req.get('host')}/verify-email?token=${verificationToken}`;

  const html = getEmailTemplate(
    res.locals.t('auth.verifyPendingTitle') || 'Verify Your Email',
    res.locals.t('auth.verifyPendingSubtitle') || 'We have sent a verification link to your email address.',
    res.locals.t('auth.verifyAccountBtn') || 'Verify my account',
    activationUrl,
    'If the button does not work, copy and paste this link:'
  );
  await sendMail({ to: email, subject: res.locals.t('auth.verifyPendingTitle') || 'Verify Your Email', html, text: activationUrl });
  logger.info(`User registered (Verification Pending): ${email}`);
  res.render('verify-pending', { email, error: null, success: null });
});

router.get('/verify-pending', (req, res) => {
  const email = req.query.email || '';
  res.render('verify-pending', { email, error: null, success: null });
});

router.post('/resend-verification', async (req, res) => {
  const email = req.body.email || '';
  const user = db.find('users', u => u.email === email);
  
  if (!user) {
    return res.render('verify-pending', { email, error: res.locals.t('validation.invalidEmail'), success: null });
  }
  if (user.is_verified === 1) {
    return res.render('login', { error: null, success: res.locals.t('auth.verifySuccess') });
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  db.update('users', u => u.id === user.id, {
    verification_token: verificationToken,
  });

  const activationUrl = `${req.protocol}://${req.get('host')}/verify-email?token=${verificationToken}`;

  const html = getEmailTemplate(
    res.locals.t('auth.verifyPendingTitle') || 'Verify Your Email',
    res.locals.t('auth.verifyPendingSubtitle') || 'We have sent a verification link to your email address.',
    res.locals.t('auth.verifyAccountBtn') || 'Verify my account',
    activationUrl,
    'If the button does not work, copy and paste this link:'
  );
  await sendMail({ to: email, subject: res.locals.t('auth.verifyPendingTitle') || 'Verify Your Email', html, text: activationUrl });
  logger.info(`Verification link regenerated for: ${email}`);
  res.render('verify-pending', { email, error: null, success: res.locals.t('validation.verificationSent') });
});

router.get('/verify-email', async (req, res) => {
  const token = req.query.token || '';
  const user = db.find('users', u => u.verification_token === token);

  if (!user) {
    return res.render('login', { error: res.locals.t('validation.invalidResetToken'), success: null });
  }

  db.update('users', u => u.id === user.id, {
    is_verified: 1,
    verification_token: null,
  });

  const authToken = jwt.sign({ id: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: '24h' });
  res.cookie('authToken', authToken, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });

  logger.info(`User successfully verified and logged in: ${user.email}`);
  res.redirect('/bots');
});

router.get('/login', (_req, res) => res.render('login', { error: null, success: null }));

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.find('users', u => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    logger.warn(`Failed login attempt for: ${email}`);
    return res.status(401).render('login', { error: res.locals.t('validation.loginInvalid'), success: null });
  }

  if (user.is_verified === 0) {
    logger.warn(`Failed login attempt (email not verified) for: ${email}`);
    return res.render('verify-pending', { 
      email, 
      error: res.locals.t('validation.emailNotVerified'), 
      success: null 
    });
  }

  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: '24h' });
  res.cookie('authToken', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  logger.info(`User logged in: ${email}`);
  res.redirect('/bots');
});

router.get('/forgot-password', (_req, res) => res.render('forgot-password', { error: null, success: null }));

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).render('forgot-password', { error: res.locals.t('validation.invalidEmail'), success: null });
  }

  const user = db.find('users', u => u.email === email);
  if (user) {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = Date.now() + 3600000; // 1 hour

    db.update('users', u => u.id === user.id, {
      reset_token: resetToken,
      reset_token_expires: resetExpires,
    });

    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${resetToken}`;
    const html = getEmailTemplate(
      res.locals.t('auth.forgotPasswordTitle') || 'Recover Password',
      res.locals.t('auth.forgotPasswordSubtitle') || 'You requested a password reset. Click below to choose a new password.',
      res.locals.t('auth.resetLinkBtn') || 'Reset my password',
      resetUrl,
      'If the button does not work, copy and paste this link:'
    );
    await sendMail({ to: email, subject: res.locals.t('auth.forgotPasswordTitle') || 'Recover Password', html, text: resetUrl });

    logger.info(`Password reset link generated for user: ${email}`);
  } else {
    logger.info(`Password reset requested for non-existent email: ${email}`);
  }

  // Anti-enumeration: always show success message
  res.render('forgot-password', { error: null, success: res.locals.t('validation.forgotSent') });
});

router.get('/reset-password/:token', (req, res) => {
  const token = req.params.token;
  const user = db.find('users', u => u.reset_token === token && u.reset_token_expires > Date.now());

  if (!user) {
    return res.render('login', { error: res.locals.t('validation.invalidResetToken'), success: null });
  }

  res.render('reset-password', { token, error: null });
});

router.post('/reset-password/:token', async (req, res) => {
  const token = req.params.token;
  const { password } = req.body;

  if (!password || password.length < 8) {
    return res.status(400).render('reset-password', { token, error: res.locals.t('auth.passwordHint') });
  }

  const user = db.find('users', u => u.reset_token === token && u.reset_token_expires > Date.now());
  if (!user) {
    return res.render('login', { error: res.locals.t('validation.invalidResetToken'), success: null });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  db.update('users', u => u.id === user.id, {
    password: hashedPassword,
    reset_token: null,
    reset_token_expires: null,
  });

  logger.info(`Password successfully reset for user: ${user.email}`);
  res.render('login', { error: null, success: res.locals.t('validation.resetTokenSuccess') });
});

router.post('/logout', (_req, res) => {
  res.clearCookie('authToken');
  res.redirect('/login');
});

module.exports = router;

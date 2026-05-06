'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');

const db        = require('../db/sqlite');
const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
const router    = express.Router();

router.get('/register', (_req, res) => res.render('register', { error: null }));

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).render('register', { error: res.locals.t('validation.registerRequired') });
  }
  if (db.find('users', u => u.email === email)) {
    return res.status(400).render('register', { error: res.locals.t('validation.registerExists') });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = db.push('users', {
    id: crypto.randomBytes(16).toString('hex'),
    email,
    password: hashedPassword,
    name,
  });
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: '7d' });
  res.cookie('authToken', token, { httpOnly: true });
  res.redirect('/bots');
});

router.get('/login', (_req, res) => res.render('login', { error: null }));

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.find('users', u => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).render('login', { error: res.locals.t('validation.loginInvalid') });
  }
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: '7d' });
  res.cookie('authToken', token, { httpOnly: true });
  res.redirect('/bots');
});

router.post('/logout', (_req, res) => {
  res.clearCookie('authToken');
  res.redirect('/login');
});

module.exports = router;

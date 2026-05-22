'use strict';
const path       = require('path');
const crypto     = require('crypto');
const compression = require('compression');
const express    = require('express');
const cookieParser = require('cookie-parser');
const jwt        = require('jsonwebtoken');

const db           = require('./db/sqlite');
const logger       = require('./services/logger');
const { makeT }    = require('./services/i18n');
const { jwtSecret } = require('./config');
const authRoutes   = require('./routes/auth');
const botRoutes    = require('./routes/bots');

const PORT         = process.env.PORT       || 3000;
const uploadDir    = process.env.UPLOAD_DIR || './uploads';
const generatedDir = process.env.GENERATED_DIR || './generated';

const app = express();

// Enable compression for all responses
app.use(compression());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view cache', false);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
const STATIC_MAX_AGE = process.env.NODE_ENV === 'production' ? '7d' : '0';
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: STATIC_MAX_AGE }));
app.use('/uploads', express.static(path.resolve(uploadDir), { maxAge: '1d' }));

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrf(req, res, next) {
  let token = req.cookies['csrf-token'];
  if (!token) {
    token = generateCsrfToken();
    res.cookie('csrf-token', token, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  }
  res.locals.csrfToken = token;
  next();
}

function validateCsrf(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
  if (req.method !== 'POST') return next();
  const cookieToken = req.cookies['csrf-token'];
  const bodyToken   = (req.body && req.body._csrf) || (req.query && req.query._csrf) || req.headers['x-csrf-token'];
  if (!cookieToken || !bodyToken || cookieToken !== bodyToken) {
    return res.status(403).render('error', { message: 'Invalid or missing CSRF token', status: 403 });
  }
  next();
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use((req, res, next) => {
  let lang = req.cookies.lang;
  if (!lang) {
    const acceptLang = req.headers['accept-language'] || '';
    const match = acceptLang.match(/(es|en)/i);
    lang = match ? match[0].toLowerCase() : 'en'; // Fallback to 'en' to maintain test compatibility
    res.cookie('lang', lang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false, sameSite: 'lax' });
  } else {
    lang = lang === 'es' ? 'es' : 'en';
  }

  res.locals.t           = makeT(lang);
  res.locals.currentLang = lang;
  res.locals.currentUser = null;
  res.locals.canonicalUrl = `https://persona.team-f.teams.eafit.testnet.verana.network${req.originalUrl}`;

  const token = req.cookies.authToken;
  if (token) {
    try {
      res.locals.currentUser = jwt.verify(token, jwtSecret);
    } catch {
      res.clearCookie('authToken');
    }
  }
  next();
});

app.use(csrf);
app.use(validateCsrf);

app.get('/set-lang/:lang', (req, res) => {
  const lang = req.params.lang === 'es' ? 'es' : 'en';
  res.cookie('lang', lang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
  const ref = (req.headers.referer || '').trim();
  let redirectTo = '/';
  if (ref) {
    try {
      // Handle both relative and absolute URLs
      const url = ref.startsWith('/') ? new URL(ref, req.protocol + '://' + req.get('host')) : new URL(ref);
      // Only redirect to same-origin paths
      if (url.hostname === req.hostname) {
        redirectTo = url.pathname + url.search;
      }
    } catch (e) {
      // If URL parsing fails, use ref if it starts with /
      if (ref.startsWith('/') && !ref.includes('://') && ref.length < 2048) {
        redirectTo = ref;
      }
    }
  }
  res.redirect(redirectTo);
});

app.get('/', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');
  res.redirect('/bots');
});

app.use(authRoutes);

function requireAuth(req, res, next) {
  if (!res.locals.currentUser) return res.redirect('/login');
  next();
}

app.use('/bots', requireAuth, botRoutes);

app.use((_req, res) => {
  res.status(404).render('error', { message: 'Page not found', status: 404 });
});

app.use((err, _req, res, _next) => {
  logger.error(err);
  res.status(500).render('error', { message: 'Internal server error', status: 500 });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Persona Studio running on http://localhost:${PORT}`);
  });
}

module.exports = app;

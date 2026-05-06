'use strict';
const path       = require('path');
const express    = require('express');
const cookieParser = require('cookie-parser');
const jwt        = require('jsonwebtoken');

const db           = require('./db/sqlite');       // initialises DB & schema on require
const { makeT }    = require('./services/i18n');
const authRoutes   = require('./routes/auth');
const botRoutes    = require('./routes/bots');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT       || 3000;
const jwtSecret    = process.env.JWT_SECRET || 'dev-secret';
const uploadDir    = process.env.UPLOAD_DIR || './uploads';
const generatedDir = process.env.GENERATED_DIR || './generated';

const app = express();

// ─── View engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.resolve(uploadDir)));

// ─── i18n + auth context injected into every request ─────────────────────────
app.use((req, res, next) => {
  const lang = req.cookies.lang === 'es' ? 'es' : 'en';
  res.locals.t           = makeT(lang);
  res.locals.currentLang = lang;
  res.locals.currentUser = null;

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

// ─── Language toggle ──────────────────────────────────────────────────────────
app.get('/set-lang/:lang', (req, res) => {
  const lang = req.params.lang === 'es' ? 'es' : 'en';
  res.cookie('lang', lang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
  res.redirect(req.headers.referer || '/');
});

// ─── Public routes ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');
  res.redirect('/bots');
});

app.use(authRoutes);

// ─── Auth guard ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!res.locals.currentUser) return res.redirect('/login');
  next();
}

// ─── Protected routes ─────────────────────────────────────────────────────────
app.use('/bots', requireAuth, botRoutes);

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).render('error', { message: 'Page not found', status: 404 });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).render('error', { message: 'Internal server error', status: 500 });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Persona AI Agent Creator → http://localhost:${PORT}`);
  console.log(`📦  Database : SQLite → ${process.env.DATABASE_PATH || './data/database.sqlite'}`);
  console.log(`🌐  i18n     : en | es`);
});
'use strict';
const GoogleStrategy = require('passport-google-oauth20');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const db = require('../db/sqlite');
const { jwtSecret } = require('../config');

function initGoogleAuth(passport) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
    scope: ['profile', 'email'],
    state: true,
  }, (accessToken, refreshToken, profile, cb) => {
    const googleId = profile.id;
    const email = profile.emails?.[0]?.value || `${googleId}@google-user.local`;
    const name = profile.displayName || profile.name?.givenName || 'Google User';

    let user = db.find('users', u => u.google_id === googleId);

    if (!user) {
      user = db.find('users', u => u.email === email && u.email.endsWith('@google-user.local'));
      if (!user) {
        user = db.push('users', {
          id: crypto.randomBytes(16).toString('hex'),
          email,
          password: '',
          name,
          google_id: googleId,
        });
      } else {
        db.update('users', u => u.id === user.id, { google_id: googleId, name });
        user.google_id = googleId;
        user.name = name;
      }
    }

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: '7d' });
    return cb(null, { user, token });
  }));
}

module.exports = { initGoogleAuth };

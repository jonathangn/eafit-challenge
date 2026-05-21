'use strict';
const crypto = require('crypto');

const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.JWT_SECRET) {
  const logger = require('./services/logger');
  logger.warn('JWT_SECRET not set — using ephemeral random secret. Tokens will be invalidated on restart.');
}

module.exports = { jwtSecret };

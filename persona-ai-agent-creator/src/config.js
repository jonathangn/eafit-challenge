'use strict';
const path = require('path');
const crypto = require('crypto');

// Load environment variables from .env using Node's native process.loadEnvFile (v20.12+)
// Skip loading during tests to keep the testing environment isolated.
try {
  if (process.env.NODE_ENV !== 'test' && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(path.join(__dirname, '..', '.env'));
  }
} catch (err) {
  // Silently ignore if .env file is missing or has errors
}

const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.JWT_SECRET) {
  const logger = require('./services/logger');
  logger.warn('JWT_SECRET not set — using ephemeral random secret. Tokens will be invalidated on restart.');
}

module.exports = { jwtSecret };


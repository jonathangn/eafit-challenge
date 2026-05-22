'use strict';
const logger = require('../services/logger');

const authRateLimitWindowMs = 15 * 60 * 1000; // 15 minutes
const authRateLimitMax = 20; // Max 20 attempts per 15 minutes per IP
const authRateLimiterCache = new Map();

// Periodic cleanup task to prevent memory leaks from inactive IPs
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of authRateLimiterCache.entries()) {
    if (now > record.resetTime) {
      authRateLimiterCache.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Custom in-memory Rate Limiter middleware for authentication/sensitive routes.
 * Avoids extra third-party package dependencies while providing secure protection.
 */
function authRateLimiter(req, res, next) {
  // In test environment, bypass rate limiter to ensure unit/integration tests run smoothly.
  if (process.env.NODE_ENV === 'test') return next();

  // Try parsing the real client IP (e.g. behind proxy/load balancers)
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let record = authRateLimiterCache.get(ip);
  if (!record) {
    record = { count: 1, resetTime: now + authRateLimitWindowMs };
    authRateLimiterCache.set(ip, record);
  } else {
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + authRateLimitWindowMs;
    } else {
      record.count++;
    }
  }

  // Set standard RFC rate-limiting headers
  res.setHeader('X-RateLimit-Limit', authRateLimitMax);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, authRateLimitMax - record.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

  if (record.count > authRateLimitMax) {
    logger.warn(`Auth rate limit exceeded for IP: ${ip} on route ${req.originalUrl}`);
    
    // Choose appropriate translation helper or message based on current lang
    const t = res.locals.t;
    const msg = t ? t('auth.rateLimitExceeded') : 'Too many auth requests from this IP. Please try again in 15 minutes.';

    return res.status(429).render('error', {
      message: msg,
      status: 429
    });
  }

  next();
}

module.exports = {
  authRateLimiter,
  authRateLimiterCache
};

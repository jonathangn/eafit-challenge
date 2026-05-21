const path = require('path');
const fs = require('fs');
const request = require('supertest');

const TEST_DB = path.join(__dirname, '..', '..', 'data', 'test-security-suite.sqlite');

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = TEST_DB;
  process.env.JWT_SECRET = 'test-secret-security-suite';
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

afterAll(() => {
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

describe('Security Suite Integration Tests', () => {
  let app;
  let db;

  beforeAll(() => {
    delete require.cache[require.resolve('../db/sqlite')];
    delete require.cache[require.resolve('../routes/auth')];
    delete require.cache[require.resolve('../server')];
    app = require('../server');
    db = require('../db/sqlite');
  });

  describe('Email Verification Flow', () => {
    const email = 'verify-suite@test.com';
    const password = 'securepassword123';
    const name = 'Suite Tester';

    it('registers a user as unverified and redirects to verify-pending', async () => {
      const res = await request(app)
        .post('/register')
        .type('form')
        .send({ name, email, password });

      expect(res.status).toBe(200);
      expect(res.text).toContain('verify');

      // Verify DB state
      const user = db.find('users', u => u.email === email);
      expect(user).toBeTruthy();
      expect(user.is_verified).toBe(0);
      expect(user.verification_token).toBeDefined();
      expect(user.verification_token.length).toBeGreaterThan(10);
    });

    it('blocks login for unverified users and redirects to verify-pending', async () => {
      const res = await request(app)
        .post('/login')
        .type('form')
        .send({ email, password });

      // Should render verify-pending with email parameter
      expect(res.status).toBe(200);
      expect(res.text).toContain('Verify Your Email');
      expect(res.text).toContain('Your email is not verified yet');
    });

    it('successfully verifies email via verification token', async () => {
      const userBefore = db.find('users', u => u.email === email);
      const token = userBefore.verification_token;

      const res = await request(app)
        .get(`/verify-email?token=${token}`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/bots');

      // The auth cookie should be set
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'].some(c => c.includes('authToken'))).toBe(true);

      // Verify DB state updated
      const userAfter = db.find('users', u => u.email === email);
      expect(userAfter.is_verified).toBe(1);
      expect(userAfter.verification_token).toBeNull();
    });

    it('allows verified user to log in successfully', async () => {
      const res = await request(app)
        .post('/login')
        .type('form')
        .send({ email, password });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/bots');
      expect(res.headers['set-cookie']).toBeDefined();
    });
  });

  describe('Password Recovery and Reset Flow', () => {
    const email = 'reset-suite@test.com';
    const password = 'initialPassword123';
    const newPassword = 'brandNewPassword123';

    beforeAll(async () => {
      // Register and verify a user to prepare for reset
      await request(app)
        .post('/register')
        .type('form')
        .send({ name: 'Reset User', email, password });

      db.update('users', u => u.email === email, { is_verified: 1 });
    });

    it('renders the forgot-password page', async () => {
      const res = await request(app).get('/forgot-password');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Recover Password');
    });

    it('generates a password reset token and saves it to user', async () => {
      const res = await request(app)
        .post('/forgot-password')
        .type('form')
        .send({ email });

      expect(res.status).toBe(200);
      expect(res.text).toContain('A password reset link has been sent');

      const user = db.find('users', u => u.email === email);
      expect(user.reset_token).toBeTruthy();
      expect(user.reset_token_expires).toBeGreaterThan(Date.now());
    });

    it('renders the reset-password page for valid token', async () => {
      const user = db.find('users', u => u.email === email);
      const token = user.reset_token;

      const res = await request(app).get(`/reset-password/${token}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Reset Password');
    });

    it('renders login with error for invalid or expired token', async () => {
      const res = await request(app).get('/reset-password/invalid-token-123');
      expect(res.status).toBe(200); // Renders login Directly
      expect(res.text).toContain('The password reset link is invalid or has expired');
    });

    it('updates password and clears recovery tokens upon post', async () => {
      const user = db.find('users', u => u.email === email);
      const token = user.reset_token;

      const res = await request(app)
        .post(`/reset-password/${token}`)
        .type('form')
        .send({ password: newPassword });

      expect(res.status).toBe(200); // Renders login directly
      expect(res.text).toContain('Password updated successfully');

      // Verify db changes
      const updatedUser = db.find('users', u => u.email === email);
      expect(updatedUser.reset_token).toBeNull();
      expect(updatedUser.reset_token_expires).toBeNull();

      // Test login with the new password
      const loginRes = await request(app)
        .post('/login')
        .type('form')
        .send({ email, password: newPassword });

      expect(loginRes.status).toBe(302);
      expect(loginRes.headers.location).toBe('/bots');
    });
  });
});

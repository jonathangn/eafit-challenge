const path = require('path');
const fs = require('fs');
const request = require('supertest');

const TEST_DB = path.join(__dirname, '..', '..', 'data', 'test-auth.sqlite');

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = TEST_DB;
  process.env.JWT_SECRET = 'test-secret';
  // clean up leftovers
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

afterAll(() => {
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

describe('Auth routes', () => {
  let app;

  beforeAll(() => {
    // fresh app with test DB
    delete require.cache[require.resolve('../db/sqlite')];
    delete require.cache[require.resolve('../routes/auth')];
    delete require.cache[require.resolve('../server')];
    app = require('../server');
  });

  describe('GET /register', () => {
    it('renders the registration form', async () => {
      const res = await request(app).get('/register');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Create Account');
    });
  });

  describe('GET /login', () => {
    it('renders the login form', async () => {
      const res = await request(app).get('/login');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Login');
    });
  });

  describe('POST /register', () => {
    it('registers a new user and renders verify-pending page', async () => {
      const res = await request(app)
        .post('/register')
        .type('form')
        .send({ name: 'Test User', email: 'new@test.com', password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.text).toContain('verify');
    });

    it('renders verify-pending and does not set authToken cookie on registration', async () => {
      const res = await request(app)
        .post('/register')
        .type('form')
        .send({ name: 'Another User', email: 'another@test.com', password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.text).toContain('verify');
      const cookies = res.headers['set-cookie'] || [];
      expect(cookies.some(c => c.includes('authToken'))).toBe(false);
    });

    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/register')
        .type('form')
        .send({ email: '', password: '', name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects duplicate email', async () => {
      const res = await request(app)
        .post('/register')
        .type('form')
        .send({ name: 'Dup', email: 'new@test.com', password: 'password123' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /login', () => {
    beforeAll(() => {
      const db = require('../db/sqlite');
      db.update('users', u => u.email === 'new@test.com', { is_verified: 1 });
    });

    it('logs in with correct credentials', async () => {
      const res = await request(app)
        .post('/login')
        .type('form')
        .send({ email: 'new@test.com', password: 'password123' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/bots');
    });

    it('sets authToken cookie on login', async () => {
      const res = await request(app)
        .post('/login')
        .type('form')
        .send({ email: 'new@test.com', password: 'password123' });
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'].some(c => c.includes('authToken'))).toBe(true);
    });

    it('rejects wrong password', async () => {
      const res = await request(app)
        .post('/login')
        .type('form')
        .send({ email: 'new@test.com', password: 'wrongpassword' });
      expect(res.status).toBe(401);
    });

    it('rejects unknown email', async () => {
      const res = await request(app)
        .post('/login')
        .type('form')
        .send({ email: 'unknown@test.com', password: 'password123' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /logout', () => {
    it('clears authToken cookie and redirects', async () => {
      const res = await request(app).post('/logout');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
      // cookie cleared (max-age=0 or expired)
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some(c => c.includes('authToken=;'))).toBe(true);
    });
  });
});

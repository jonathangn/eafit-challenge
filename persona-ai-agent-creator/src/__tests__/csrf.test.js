const request = require('supertest');
const path = require('path');
const fs = require('fs');

const TEST_DB = path.join(__dirname, '..', '..', 'data', 'test-csrf.sqlite');

describe('CSRF Integration with Query Params & Headers', () => {
  let app;
  let originalEnv;

  beforeAll(() => {
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // Enable CSRF validation
    process.env.DATABASE_PATH = TEST_DB;
    process.env.JWT_SECRET = 'test-secret-csrf';
    for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
      try { fs.unlinkSync(f); } catch {}
    }

    // Clear require cache to ensure server.js is loaded with production env
    delete require.cache[require.resolve('../db/sqlite')];
    delete require.cache[require.resolve('../routes/auth')];
    delete require.cache[require.resolve('../routes/bots')];
    delete require.cache[require.resolve('../server')];
    app = require('../server');
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
    for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
      try { fs.unlinkSync(f); } catch {}
    }
  });

  it('should block POST request without CSRF token in production', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'some@test.com', password: 'password123' });
    expect(res.status).toBe(403);
    expect(res.text).toContain('Invalid or missing CSRF token');
  });

  it('should allow POST request with valid CSRF token in query parameters', async () => {
    // 1. Get the token from cookie
    const getRes = await request(app).get('/login');
    const cookies = getRes.headers['set-cookie'] || [];
    const csrfCookie = cookies.find(c => c.startsWith('csrf-token='));
    expect(csrfCookie).toBeDefined();

    const token = csrfCookie.split(';')[0].split('=')[1];
    
    // 2. Submit POST with CSRF token in query parameters
    const postRes = await request(app)
      .post(`/login?_csrf=${token}`)
      .set('Cookie', `csrf-token=${token}`)
      .type('form')
      .send({ email: 'some@test.com', password: 'password123' });

    // Since token is validated, it should proceed past CSRF (which might be invalid login, i.e. 400 or 200, but not 403)
    expect(postRes.status).not.toBe(403);
  });

  it('should allow POST request with valid CSRF token in X-CSRF-Token header', async () => {
    // 1. Get the token from cookie
    const getRes = await request(app).get('/login');
    const cookies = getRes.headers['set-cookie'] || [];
    const csrfCookie = cookies.find(c => c.startsWith('csrf-token='));
    expect(csrfCookie).toBeDefined();

    const token = csrfCookie.split(';')[0].split('=')[1];
    
    // 2. Submit POST with CSRF token in header
    const postRes = await request(app)
      .post('/login')
      .set('Cookie', `csrf-token=${token}`)
      .set('X-CSRF-Token', token)
      .type('form')
      .send({ email: 'some@test.com', password: 'password123' });

    // Since token is validated, it should proceed past CSRF (which might be invalid login, i.e. 400 or 200, but not 403)
    expect(postRes.status).not.toBe(403);
  });
});

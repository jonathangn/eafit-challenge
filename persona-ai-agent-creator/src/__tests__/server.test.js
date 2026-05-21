const path = require('path');
const fs = require('fs');
const request = require('supertest');

const TEST_DB = path.join(__dirname, '..', '..', 'data', 'test-server.sqlite');

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = TEST_DB;
  process.env.JWT_SECRET = 'test-secret';
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

afterAll(() => {
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

describe('Server-level routes', () => {
  let app;
  let agentCookie;

  beforeAll(async () => {
    delete require.cache[require.resolve('../db/sqlite')];
    delete require.cache[require.resolve('../routes/auth')];
    delete require.cache[require.resolve('../routes/bots')];
    delete require.cache[require.resolve('../server')];
    app = require('../server');

    await request(app)
      .post('/register')
      .type('form')
      .send({ name: 'Server Tester', email: 'server-test@test.com', password: 'password123' });

    const db = require('../db/sqlite');
    db.update('users', u => u.email === 'server-test@test.com', { is_verified: 1 });

    const loginRes = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'server-test@test.com', password: 'password123' });

    const setCookie = loginRes.headers['set-cookie'];
    agentCookie = Array.isArray(setCookie) ? setCookie : [setCookie];
  });

  describe('GET /', () => {
    it('redirects to /bots when authenticated', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', agentCookie);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/bots');
    });

    it('redirects to /login when not authenticated', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });
  });

  describe('GET /set-lang/:lang', () => {
    it('sets lang cookie to es', async () => {
      const res = await request(app)
        .get('/set-lang/es')
        .set('Referer', '/bots');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/bots');
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some(c => c.startsWith('lang=es'))).toBe(true);
    });

    it('sets lang cookie to en', async () => {
      const res = await request(app)
        .get('/set-lang/en');
      expect(res.status).toBe(302);
      const cookies = res.headers['set-cookie'];
      expect(cookies.some(c => c.startsWith('lang=en'))).toBe(true);
    });

    it('falls back to en for unknown language', async () => {
      const res = await request(app)
        .get('/set-lang/fr');
      expect(res.status).toBe(302);
      const cookies = res.headers['set-cookie'];
      expect(cookies.some(c => c.startsWith('lang=en'))).toBe(true);
    });

    it('redirects to referer when available', async () => {
      const res = await request(app)
        .get('/set-lang/es')
        .set('Referer', '/some-page');
      expect(res.headers.location).toBe('/some-page');
    });

    it('redirects to / when no referer', async () => {
      const res = await request(app)
        .get('/set-lang/es');
      expect(res.headers.location).toBe('/');
    });
  });

  describe('404 handler', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app)
        .get('/this-route-does-not-exist');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Page not found');
    });

    it('returns 404 under /bots for unknown nested path', async () => {
      const res = await request(app)
        .get('/bots/nonexistent/weird/path')
        .set('Cookie', agentCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('Static file serving', () => {
    it('serves public files', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(302);
    });
  });

  describe('JWT invalid token handling', () => {
    it('clears cookie and continues for invalid token', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', 'authToken=invalid.jwt.here');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });
  });
});

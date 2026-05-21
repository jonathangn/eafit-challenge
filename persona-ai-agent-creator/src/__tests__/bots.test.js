const path = require('path');
const fs = require('fs');
const request = require('supertest');

const TEST_DB = path.join(__dirname, '..', '..', 'data', 'test-bots.sqlite');

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

describe('Bots routes', () => {
  let app;
  let agentCookie;

  beforeAll(async () => {
    delete require.cache[require.resolve('../db/sqlite')];
    delete require.cache[require.resolve('../routes/auth')];
    delete require.cache[require.resolve('../routes/bots')];
    delete require.cache[require.resolve('../server')];
    app = require('../server');

    // Register a test user
    await request(app)
      .post('/register')
      .type('form')
      .send({ name: 'Bot Tester', email: 'bot-tester@test.com', password: 'password123' });

    // Verify the user directly in test DB
    const db = require('../db/sqlite');
    db.update('users', u => u.email === 'bot-tester@test.com', { is_verified: 1 });

    // Login to capture cookie
    const loginRes = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'bot-tester@test.com', password: 'password123' });

    const setCookie = loginRes.headers['set-cookie'];
    agentCookie = Array.isArray(setCookie) ? setCookie : [setCookie];
  });

  describe('GET /bots (list) — auth guard', () => {
    it('redirects to login when not authenticated', async () => {
      const res = await request(app).get('/bots');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('returns the bots list when authenticated', async () => {
      const res = await request(app)
        .get('/bots')
        .set('Cookie', agentCookie);
      expect(res.status).toBe(200);
      expect(res.text).toContain('My AI Bots');
    });

    it('shows empty state when no bots exist', async () => {
      const res = await request(app)
        .get('/bots')
        .set('Cookie', agentCookie);
      expect(res.status).toBe(200);
      expect(res.text).toContain('No bots yet');
    });
  });

  describe('GET /bots/new', () => {
    it('renders the creation form when authenticated', async () => {
      const res = await request(app)
        .get('/bots/new')
        .set('Cookie', agentCookie);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Who is your Agent?');
    });

    it('redirects when not authenticated', async () => {
      const res = await request(app).get('/bots/new');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });
  });

  describe('POST /bots (create)', () => {
    let createRes;

    it('creates a bot and redirects', async () => {
      createRes = await request(app)
        .post('/bots')
        .type('form')
        .set('Cookie', agentCookie)
        .send({
          personaName: 'Test Bot',
          personaProfession: 'Tester',
          personaDescription: 'A test bot',
          serviceName: 'test-bot-service',
          serviceDescription: 'Test service description',
          prompt: 'You are a test bot',
          photoUrl: '',
          minimumAge: '13',
          mcpServers: 'weather',
        });
      expect(createRes.status).toBe(302);
      expect(createRes.headers.location).toMatch(/^\/bots\//);
    });

    it('redirects to login when not authenticated', async () => {
      const res = await request(app)
        .post('/bots')
        .type('form')
        .send({ personaName: 'Bot', serviceName: 'Bot', prompt: 'test' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });
  });

  describe('GET /bots/:id (view)', () => {
    let botId;

    beforeAll(async () => {
      const res = await request(app)
        .get('/bots')
        .set('Cookie', agentCookie);
      const match = res.text.match(/\/bots\/([a-f0-9]+)">/);
      botId = match ? match[1] : null;
    });

    it('shows bot detail page', async () => {
      if (!botId) return; // skip if no bot found
      const res = await request(app)
        .get(`/bots/${botId}`)
        .set('Cookie', agentCookie);
      expect(res.status).toBe(200);
      expect(res.text).toContain('test-bot-service');
    });

    it('returns 404 for non-existent bot', async () => {
      const res = await request(app)
        .get('/bots/nonexistent-id-12345')
        .set('Cookie', agentCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /bots/:id/edit', () => {
    let botId;

    beforeAll(async () => {
      const res = await request(app)
        .get('/bots')
        .set('Cookie', agentCookie);
      const match = res.text.match(/\/bots\/([a-f0-9]+)">/);
      botId = match ? match[1] : null;
    });

    it('renders edit form', async () => {
      if (!botId) return;
      const res = await request(app)
        .get(`/bots/${botId}/edit`)
        .set('Cookie', agentCookie);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Edit Agent');
      expect(res.text).toContain('test-bot-service');
    });
  });

  describe('POST /bots/:id (update)', () => {
    let botId;

    beforeAll(async () => {
      // parse bot id from list page URL
      const res = await request(app)
        .get('/bots')
        .set('Cookie', agentCookie);
      const match = res.text.match(/\/bots\/([a-f0-9]+)\/edit"/);
      botId = match ? match[1] : null;
    });

    it('updates bot fields', async () => {
      if (!botId) return;
      const res = await request(app)
        .post(`/bots/${botId}`)
        .type('form')
        .set('Cookie', agentCookie)
        .send({
          personaName: 'Updated Bot',
          personaProfession: 'Updated Tester',
          personaDescription: 'An updated test bot',
          serviceName: 'updated-bot-service',
          serviceDescription: 'Updated description',
          prompt: 'You are an updated test bot',
          photoUrl: '',
          minimumAge: '18',
          mcpServers: ['weather', 'time'],
        });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`/bots/${botId}`);

      // verify the update persisted
      const viewRes = await request(app)
        .get(`/bots/${botId}`)
        .set('Cookie', agentCookie);
      expect(viewRes.text).toContain('updated-bot-service');
      expect(viewRes.text).toContain('Updated Bot');
    });
  });

  describe('POST /bots/:id/delete', () => {
    let botId;

    beforeAll(async () => {
      const res = await request(app)
        .get('/bots')
        .set('Cookie', agentCookie);
      const match = res.text.match(/\/bots\/([a-f0-9]+)\/delete/);
      botId = match ? match[1] : null;
    });

    it('deletes the bot and redirects to list', async () => {
      if (!botId) return;
      const res = await request(app)
        .post(`/bots/${botId}/delete`)
        .set('Cookie', agentCookie);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/bots?toast=deleted');

      const listRes = await request(app)
        .get('/bots')
        .set('Cookie', agentCookie);
      expect(listRes.text).toContain('No bots yet');
    });
  });

  describe('POST /bots/:id/publish (k8s disabled)', () => {
    let botId;

    beforeAll(async () => {
      // Create a fresh bot for publish testing
      const createRes = await request(app)
        .post('/bots')
        .type('form')
        .set('Cookie', agentCookie)
        .send({
          personaName: 'Publish Test Bot',
          personaProfession: 'Publisher',
          personaDescription: 'Testing publish',
          serviceName: 'publish-test-service',
          serviceDescription: 'Publish test',
          prompt: 'You are a publish test',
          photoUrl: '',
          minimumAge: '13',
          mcpServers: 'weather',
        });
      const location = createRes.headers.location;
      botId = location ? location.replace('/bots/', '') : null;
    });

    it('publishes a bot (pending manual apply) and redirects', async () => {
      if (!botId) return;
      const res = await request(app)
        .post(`/bots/${botId}/publish`)
        .set('Cookie', agentCookie);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain(`/bots/${botId}?toast=published`);
    });

    it('shows published status after publish', async () => {
      if (!botId) return;
      const res = await request(app)
        .get(`/bots/${botId}`)
        .set('Cookie', agentCookie);
      expect(res.text).toContain('pending_apply');
    });

    it('returns 404 for non-existent bot publish', async () => {
      const res = await request(app)
        .post('/bots/nonexistent-id/publish')
        .set('Cookie', agentCookie);
      expect(res.status).toBe(404);
    });

    it('redirects to login when not authenticated', async () => {
      const res = await request(app).post(`/bots/${botId || 'x'}/publish`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });
  });

  describe('POST /bots/:id/unpublish', () => {
    let botId;

    beforeAll(async () => {
      const createRes = await request(app)
        .post('/bots')
        .type('form')
        .set('Cookie', agentCookie)
        .send({
          personaName: 'Unpublish Test',
          personaProfession: 'Test',
          personaDescription: 'Testing unpublish',
          serviceName: 'unpublish-test-service',
          serviceDescription: 'Unpublish test',
          prompt: 'You are an unpublish test',
          photoUrl: '',
          minimumAge: '13',
        });
      const location = createRes.headers.location;
      botId = location ? location.replace('/bots/', '') : null;
      // Publish first so we can unpublish
      if (botId) {
        await request(app)
          .post(`/bots/${botId}/publish`)
          .set('Cookie', agentCookie);
      }
    });

    it('unpublishes a bot and redirects', async () => {
      if (!botId) return;
      const res = await request(app)
        .post(`/bots/${botId}/unpublish`)
        .set('Cookie', agentCookie);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain(`/bots/${botId}?toast=unpublished`);
    });

    it('shows draft status after unpublish', async () => {
      if (!botId) return;
      const res = await request(app)
        .get(`/bots/${botId}`)
        .set('Cookie', agentCookie);
      expect(res.text).toContain('draft');
    });

    it('returns 404 for non-existent bot unpublish', async () => {
      const res = await request(app)
        .post('/bots/nonexistent-id/unpublish')
        .set('Cookie', agentCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('Bot ownership isolation', () => {
    let secondaryCookie;

    beforeAll(async () => {
      await request(app)
        .post('/register')
        .type('form')
        .send({ name: 'Second User', email: 'second@test.com', password: 'password123' });

      const db = require('../db/sqlite');
      db.update('users', u => u.email === 'second@test.com', { is_verified: 1 });

      const loginRes = await request(app)
        .post('/login')
        .type('form')
        .send({ email: 'second@test.com', password: 'password123' });

      const setCookie = loginRes.headers['set-cookie'];
      secondaryCookie = Array.isArray(setCookie) ? setCookie : [setCookie];
    });

    it('secondary user does not see first users bots', async () => {
      const res = await request(app)
        .get('/bots')
        .set('Cookie', secondaryCookie);
      expect(res.status).toBe(200);
      expect(res.text).toContain('No bots yet');
    });
  });

  describe('POST /bots with edge cases', () => {
    it('creates a bot with MCP server as single string', async () => {
      const res = await request(app)
        .post('/bots')
        .type('form')
        .set('Cookie', agentCookie)
        .send({
          personaName: 'String Mcp Bot',
          personaProfession: 'Tester',
          personaDescription: 'Single MCP string test',
          serviceName: 'string-mcp-test',
          serviceDescription: 'Test',
          prompt: 'Test prompt',
          photoUrl: '',
          mcpServers: 'wikipedia',
        });
      expect(res.status).toBe(302);
    });

    it('creates a bot with multiple RAG URLs separated by newlines', async () => {
      const res = await request(app)
        .post('/bots')
        .type('form')
        .set('Cookie', agentCookie)
        .send({
          personaName: 'Rag Test',
          personaProfession: 'Tester',
          personaDescription: 'RAG URL test',
          serviceName: 'rag-url-test',
          serviceDescription: 'Test',
          prompt: 'Test prompt',
          photoUrl: '',
          ragUrls: 'https://example.com/doc1\nhttps://example.com/doc2\nhttps://example.com/doc3',
        });
      expect(res.status).toBe(302);
    });

    it('creates a bot with tone presets saved correctly and empty prompt', async () => {
      const res = await request(app)
        .post('/bots')
        .type('form')
        .set('Cookie', agentCookie)
        .send({
          personaName: 'Tone Test Bot',
          personaProfession: 'Actor',
          personaDescription: 'Expressive personality',
          serviceName: 'tone-test-service',
          serviceDescription: 'Test service',
          photoUrl: '',
          tones: 'friendly,creative',
        });
      expect(res.status).toBe(302);

      const db = require('../db/sqlite');
      const bot = db.find('bots', b => b.service_name === 'tone-test-service');
      expect(bot).toBeDefined();
      expect(Array.isArray(bot.tones)).toBe(true);
      expect(bot.tones).toContain('friendly');
      expect(bot.tones).toContain('creative');
      expect(bot.prompt).toBe('');
    });
  });
});

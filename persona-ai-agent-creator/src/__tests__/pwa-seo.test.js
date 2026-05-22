const path = require('path');
const fs = require('fs');
const request = require('supertest');

const TEST_DB = path.join(__dirname, '..', '..', 'data', 'test-pwa-seo.sqlite');

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

describe('PWA & Dynamic SEO Integration Tests', () => {
  let app;
  let db;

  beforeAll(async () => {
    // Clear cache and import clean server
    delete require.cache[require.resolve('../db/sqlite')];
    delete require.cache[require.resolve('../server')];
    
    app = require('../server');
    db = require('../db/sqlite');

    // Create a published bot and a draft bot for testing
    db.push('bots', {
      id: 'published-bot-123',
      user_id: 'test-user-id',
      slug: 'published-bot',
      service_name: 'Premium Consultant',
      service_description: 'An AI assistant for business growth.',
      persona_name: 'Sophia',
      persona_profession: 'Business Strategist',
      persona_description: 'Analytical, formal and expert planner.',
      prompt: 'Act as Sophia.',
      rag_urls: JSON.stringify(['https://example.com/docs']),
      mcp_servers: JSON.stringify(['memory', 'wikipedia']),
      publish_status: 'published',
      photo_url: '/uploads/sophia.png',
      theme_color: '#3c0091',
      minimum_age: 18,
      tones: JSON.stringify(['professional']),
      language: 'es',
      created_at: '2026-05-21T20:00:00Z',
      updated_at: '2026-05-21T21:00:00Z'
    });

    db.push('bots', {
      id: 'draft-bot-456',
      user_id: 'test-user-id',
      slug: 'draft-bot',
      service_name: 'Draft Assistant',
      service_description: 'Unpublished assistant.',
      persona_name: 'Drafty',
      persona_profession: 'Developer',
      persona_description: 'Works in drafts.',
      prompt: 'Act as Drafty.',
      rag_urls: '[]',
      mcp_servers: '[]',
      publish_status: 'draft',
      photo_url: '',
      theme_color: '',
      minimum_age: 1,
      tones: '[]',
      language: 'auto',
      created_at: '2026-05-21T20:00:00Z',
      updated_at: '2026-05-21T21:00:00Z'
    });
  });

  describe('1. Dynamic /sitemap.xml Generator', () => {
    it('returns compliant XML with Content-Type header', async () => {
      const res = await request(app)
        .get('/sitemap.xml')
        .expect('Content-Type', /xml/);
      
      expect(res.status).toBe(200);
      expect(res.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(res.text).toContain('<urlset');
    });

    it('contains standard static and application routes', async () => {
      const res = await request(app).get('/sitemap.xml');
      expect(res.text).toContain('https://persona.team-f.teams.eafit.testnet.verana.network/');
      expect(res.text).toContain('https://persona.team-f.teams.eafit.testnet.verana.network/login');
      expect(res.text).toContain('https://persona.team-f.teams.eafit.testnet.verana.network/register');
      expect(res.text).toContain('https://persona.team-f.teams.eafit.testnet.verana.network/bots');
    });

    it('dynamically includes published bots and excludes draft bots', async () => {
      const res = await request(app).get('/sitemap.xml');
      
      // Published bot should be present in the sitemap
      expect(res.text).toContain('https://persona.team-f.teams.eafit.testnet.verana.network/public-agents/published-bot-123');
      
      // Draft bot should NOT be present in the sitemap
      expect(res.text).not.toContain('https://persona.team-f.teams.eafit.testnet.verana.network/public-agents/draft-bot-456');
    });
  });

  describe('2. Public Showcase Route (/public-agents/:id)', () => {
    it('allows unauthenticated access for published bots and returns premium HTML details', async () => {
      const res = await request(app)
        .get('/public-agents/published-bot-123')
        .expect('Content-Type', /html/);
      
      expect(res.status).toBe(200);
      expect(res.text).toContain('Sophia');
      expect(res.text).toContain('Business Strategist');
      
      // Includes SEO structural schema (JSON-LD)
      expect(res.text).toContain('application/ld+json');
      expect(res.text).toContain('SoftwareApplication');
      expect(res.text).toContain('Sophia');

      // Includes active superpower cards
      expect(res.text).toContain('bolt');
    });

    it('returns 410 Gone with localized error page when the bot is unpublished/draft', async () => {
      const res = await request(app)
        .get('/public-agents/draft-bot-456')
        .expect('Content-Type', /html/);
      
      expect(res.status).toBe(410);
      expect(res.text).toContain('410');
      // Should show the customizable error page instead of standard express error
      expect(res.text).toContain('Go Home');
    });

    it('returns 404 Not Found for non-existent bot ID', async () => {
      const res = await request(app)
        .get('/public-agents/invalid-bot-999')
        .expect('Content-Type', /html/);
      
      expect(res.status).toBe(404);
      expect(res.text).toContain('404');
    });
  });

  describe('3. PWA Assets and Offline Capability', () => {
    it('serves manifest.json correctly', async () => {
      const res = await request(app)
        .get('/manifest.json')
        .expect('Content-Type', /json/);
      
      expect(res.status).toBe(200);
      expect(res.body.short_name).toBe('Persona AI');
      expect(res.body.icons).toBeDefined();
      expect(res.body.icons.length).toBe(2);
    });

    it('serves service worker sw.js correctly', async () => {
      const res = await request(app)
        .get('/sw.js')
        .expect('Content-Type', /javascript/);
      
      expect(res.status).toBe(200);
      expect(res.text).toContain('CACHE_NAME');
      expect(res.text).toContain('ASSETS_TO_CACHE');
    });

    it('serves the premium offline fallback page correctly', async () => {
      const res = await request(app)
        .get('/offline.html')
        .expect('Content-Type', /html/);
      
      expect(res.status).toBe(200);
      expect(res.text).toContain('Offline Mode');
      expect(res.text).toContain('Connection Lost');
    });

    it('serves modern SVG brand icons correctly', async () => {
      const res1 = await request(app)
        .get('/icons/icon.svg')
        .expect('Content-Type', /svg/);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .get('/icons/icon-maskable.svg')
        .expect('Content-Type', /svg/);
      expect(res2.status).toBe(200);
    });
  });

  describe('4. Performance and Caching Optimizations', () => {
    it('contains async web font loading preloads and noscript fallbacks', async () => {
      const res = await request(app).get('/login');
      expect(res.status).toBe(200);
      expect(res.text).toContain('rel="preload"');
      expect(res.text).toContain('as="style"');
      expect(res.text).toContain('onload="this.onload=null;this.rel=\'stylesheet\'"');
      expect(res.text).toContain('family=Material+Symbols+Outlined');
      expect(res.text).toContain('display=block');
    });

    it('injects assetVersion into CSS output link instead of dynamic timestamp', async () => {
      const res = await request(app).get('/login');
      // In test mode, it should be a numeric timestamp since process.env.NODE_ENV is 'test', which is not production
      expect(res.text).toMatch(/\/css\/output.css\?v=\d+/);
    });

    it('serves static assets with 1 year cache max-age in production environment', async () => {
      // Temporarily switch to production environment and reload server
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      delete require.cache[require.resolve('../server')];
      const prodApp = require('../server');

      const res = await request(prodApp).get('/manifest.json');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('max-age=31536000'); // 365 days

      // Restore test environment
      process.env.NODE_ENV = originalEnv;
      delete require.cache[require.resolve('../server')];
    });

    it('inlines CSS in production mode and falls back to standard link in test/dev modes', async () => {
      // 1. Test Mode (should use external link)
      const resTest = await request(app).get('/login');
      expect(resTest.text).toContain('href="/css/output.css?v=');
      expect(resTest.text).not.toContain('<style>html'); // Should not inline the stylesheet

      // 2. Production Mode (should inline the CSS)
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      delete require.cache[require.resolve('../server')];
      const prodApp = require('../server');

      const resProd = await request(prodApp).get('/login');
      expect(resProd.text).not.toContain('href="/css/output.css');
      expect(resProd.text).toContain('<style>');
      
      // Restore test environment
      process.env.NODE_ENV = originalEnv;
      delete require.cache[require.resolve('../server')];
    });
  });
});

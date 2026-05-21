const path = require('path');
const fs = require('fs');

const TEST_DB = path.join(__dirname, '..', '..', 'data', 'test.sqlite');

beforeAll(() => {
  process.env.DATABASE_PATH = TEST_DB;
  // clean up if leftover from a previous run
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch {}
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch {}
});

afterAll(() => {
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + '-wal'); } catch {}
  try { fs.unlinkSync(TEST_DB + '-shm'); } catch {}
});

describe('sqlite db module', () => {
  let db;

  beforeAll(() => {
    // reset cache so it re-initializes with the test DB path
    delete require.cache[require.resolve('../db/sqlite')];
    db = require('../db/sqlite');
  });

  it('exports find, filter, push, update, remove', () => {
    expect(db).toHaveProperty('find');
    expect(db).toHaveProperty('filter');
    expect(db).toHaveProperty('push');
    expect(db).toHaveProperty('update');
    expect(db).toHaveProperty('remove');
  });

  describe('push / find', () => {
    it('push inserts and find retrieves by predicate', () => {
      const item = db.push('users', {
        id: 'u1',
        email: 'test@test.com',
        name: 'Test User',
      });
      expect(item.id).toBe('u1');

      const found = db.find('users', u => u.email === 'test@test.com');
      expect(found).not.toBeNull();
      expect(found.name).toBe('Test User');
    });

    it('find returns null when no match', () => {
      const found = db.find('users', u => u.email === 'nope');
      expect(found).toBeNull();
    });
  });

  describe('filter', () => {
    beforeAll(() => {
      db.push('users', { id: 'u2', email: 'a@a.com', name: 'Alice' });
      db.push('users', { id: 'u3', email: 'b@b.com', name: 'Bob' });
    });

    it('returns all matching items', () => {
      const all = db.filter('users', () => true);
      expect(all.length).toBeGreaterThanOrEqual(3);
    });

    it('returns empty array when no match', () => {
      const res = db.filter('users', u => u.email === 'void');
      expect(res).toEqual([]);
    });
  });

  describe('update', () => {
    it('updates matching item', () => {
      db.update('users', u => u.id === 'u1', { name: 'Updated User' });
      const found = db.find('users', u => u.id === 'u1');
      expect(found.name).toBe('Updated User');
    });
  });

  describe('remove', () => {
    it('removes matching items and returns count', () => {
      const count = db.remove('users', u => u.id === 'u2');
      expect(count).toBe(1);
      const found = db.find('users', u => u.id === 'u2');
      expect(found).toBeNull();
    });
  });

  describe('JSON serialization', () => {
    it('stores and retrieves object columns', () => {
      db.push('bots', {
        id: 'b1',
        user_id: 'u1',
        slug: 'test-bot',
        service_name: 'Test',
        persona_name: 'Tester',
        persona_profession: 'Tester',
        persona_description: 'A test bot',
        prompt: 'You are a test',
        mcp_servers: ['github', 'weather'],
        rag_urls: ['https://example.com'],
        public_url: '',
        publish_status: 'draft',
        photo_url: '',
        minimum_age: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const bot = db.find('bots', b => b.id === 'b1');
      expect(bot).not.toBeNull();
      expect(Array.isArray(bot.mcp_servers)).toBe(true);
      expect(bot.mcp_servers).toContain('github');
      expect(bot.mcp_servers).toContain('weather');
      expect(Array.isArray(bot.rag_urls)).toBe(true);
      expect(bot.rag_urls).toContain('https://example.com');
    });

    it('stores and retrieves mcp_config object', () => {
      db.push('bots', {
        id: 'b2',
        user_id: 'u1',
        slug: 'mcp-config-test',
        service_name: 'MCP Config Test',
        persona_name: 'Config',
        persona_profession: 'Test',
        persona_description: 'Test mcp_config',
        prompt: 'Test',
        mcp_servers: [],
        rag_urls: [],
        mcp_config: { weather: { apiKey: 'test-key' } },
        public_url: '',
        publish_status: 'draft',
        photo_url: '',
        minimum_age: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      const bot = db.find('bots', b => b.id === 'b2');
      expect(bot.mcp_config).toBeDefined();
      expect(bot.mcp_config.weather.apiKey).toBe('test-key');
    });
  });

  describe('remove edge cases', () => {
    it('returns 0 when no items match', () => {
      const count = db.remove('users', u => u.id === 'nonexistent');
      expect(count).toBe(0);
    });

    it('removes from bot_versions collection', () => {
      db.push('bot_versions', { version_id: 'v1', bot_id: 'b1', created_at: 'now', yaml_config: 'test' });
      const count = db.remove('bot_versions', v => v.version_id === 'v1');
      expect(count).toBe(1);
    });
  });

  describe('update edge cases', () => {
    it('does not throw when no item matches', () => {
      expect(() => {
        db.update('users', u => u.id === 'nonexistent', { name: 'Noop' });
      }).not.toThrow();
    });
  });
});

const path = require('path');
const fs = require('fs');

const TEST_DB = path.join(__dirname, '..', '..', 'data', 'test-config.sqlite');

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = TEST_DB;
  process.env.JWT_SECRET = 'test-secret-for-config';
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

afterAll(() => {
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

describe('Config module', () => {
  let configModule;
  let originalJwtSecret;

  beforeAll(() => {
    originalJwtSecret = process.env.JWT_SECRET;
    delete require.cache[require.resolve('../config')];
    configModule = require('../config');
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalJwtSecret;
  });

  describe('jwtSecret', () => {
    it('exports jwtSecret', () => {
      expect(configModule).toHaveProperty('jwtSecret');
    });

    it('uses provided JWT_SECRET from environment', () => {
      expect(configModule.jwtSecret).toBe('test-secret-for-config');
    });

    it('generates random secret when JWT_SECRET not set', () => {
      delete process.env.JWT_SECRET;
      delete require.cache[require.resolve('../config')];
      const freshConfig = require('../config');
      expect(freshConfig.jwtSecret).toBeDefined();
      expect(typeof freshConfig.jwtSecret).toBe('string');
      expect(freshConfig.jwtSecret.length).toBeGreaterThan(30);
      
      // Restore
      process.env.JWT_SECRET = originalJwtSecret;
    });
  });

  describe('logger integration', () => {
    it('logger module exists at correct path', () => {
      const loggerPath = path.join(__dirname, '..', 'services', 'logger.js');
      expect(fs.existsSync(loggerPath)).toBe(true);
    });

    it('config.js can require logger without error', () => {
      expect(() => {
        delete require.cache[require.resolve('../config')];
        require('../config');
      }).not.toThrow();
    });
  });
});

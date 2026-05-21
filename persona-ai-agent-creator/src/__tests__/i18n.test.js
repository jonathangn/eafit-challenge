const fs = require('fs');
const path = require('path');
const { makeT } = require('../services/i18n');

const enPath = path.join(__dirname, '..', '..', 'locales', 'en.json');
const esPath = path.join(__dirname, '..', '..', 'locales', 'es.json');
const enLocale = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const esLocale = JSON.parse(fs.readFileSync(esPath, 'utf8'));

function flattenKeys(obj, prefix = '') {
  let keys = [];
  for (const k of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      keys = keys.concat(flattenKeys(obj[k], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe('i18n', () => {
  describe('locale file structure', () => {
    it('both locale files exist', () => {
      expect(fs.existsSync(enPath)).toBe(true);
      expect(fs.existsSync(esPath)).toBe(true);
    });

    it('ES has the same leaf keys as EN', () => {
      const enKeys = flattenKeys(enLocale);
      const esKeys = flattenKeys(esLocale);
      for (const key of enKeys) {
        expect(esKeys).toContain(key);
      }
    });

    it('EN and ES have the same top-level sections', () => {
      expect(Object.keys(esLocale).sort()).toEqual(Object.keys(enLocale).sort());
    });
  });

  describe('makeT("en")', () => {
    const t = makeT('en');

    it('returns translation for existing top-level key', () => {
      expect(t('common.appTitle')).toBe('Persona Studio');
    });

    it('returns translation for nested key', () => {
      expect(t('auth.loginTitle')).toBe('Login');
      expect(t('form.personaNameLabel')).toBe('Persona Name');
    });

    it('returns translation for deep nested key', () => {
      expect(t('mcp.memory.name')).toBe('Persistent Memory');
      expect(t('mcp.memory.description')).toMatch(/remember facts/);
    });

    it('returns the key itself when not found in any locale', () => {
      expect(t('nonexistent.key.here')).toBe('nonexistent.key.here');
    });

    it('returns the object when key is a prefix (not a leaf)', () => {
      const val = t('common');
      expect(typeof val).toBe('object');
      expect(val.appTitle).toBe('Persona Studio');
    });
  });

  describe('makeT("es")', () => {
    const t = makeT('es');

    it('returns Spanish translation', () => {
      expect(t('auth.loginTitle')).toBe('Iniciar sesión');
    });

    it('returns Spanish for common.appTitle', () => {
      expect(t('common.appTitle')).toBe('Persona Studio');
    });

    it('returns Spanish for MCP keys', () => {
      expect(t('mcp.memory.name')).toBe('Memoria Persistente');
    });
  });

  describe('makeT with unsupported language', () => {
    const t = makeT('fr');

    it('falls back to English', () => {
      expect(t('auth.loginTitle')).toBe('Login');
    });

    it('returns key for totally unknown keys', () => {
      expect(t('some.random.key')).toBe('some.random.key');
    });
  });

  describe('makeT edge cases', () => {
    it('handles empty string key', () => {
      const t = makeT('en');
      expect(t('')).toBe('');
    });

    it('handles null language by falling back to English', () => {
      const t = makeT(null);
      expect(t('auth.loginTitle')).toBe('Login');
    });

    it('handles undefined language by falling back to English', () => {
      const t = makeT(undefined);
      expect(t('auth.loginTitle')).toBe('Login');
    });
  });
});

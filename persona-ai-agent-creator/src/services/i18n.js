'use strict';
const fs   = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', '..', 'locales');
const translations = {};

for (const lang of ['en', 'es']) {
  try {
    translations[lang] = JSON.parse(
      fs.readFileSync(path.join(localesDir, `${lang}.json`), 'utf8')
    );
  } catch {
    translations[lang] = {};
  }
}

/**
 * Returns a translation function for the given language.
 * Keys use dot-notation: e.g. t('auth.loginTitle')
 * Falls back to English, then the raw key.
 */
function makeT(lang) {
  const dict = translations[lang] || translations['en'];
  return function t(key) {
    const parts = key.split('.');
    let val = dict;
    for (const p of parts) {
      if (val == null) return key;
      val = val[p];
    }
    if (val != null) return val;
    // fallback to English
    const en = translations['en'];
    if (en) {
      const fb = parts.reduce((o, p) => (o && o[p]), en);
      if (fb != null) return fb;
    }
    return key;
  };
}

module.exports = { makeT };

'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || './data/database.sqlite';

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

// Migrate existing databases: add columns that may not exist
try { sqlite.exec(`ALTER TABLE bots ADD COLUMN minimum_age INTEGER DEFAULT 1`); } catch {};
try { sqlite.exec(`ALTER TABLE bots ADD COLUMN tones TEXT`); } catch {};
try { sqlite.exec(`ALTER TABLE users ADD COLUMN google_id TEXT`); } catch {};
try { sqlite.exec(`ALTER TABLE bots ADD COLUMN mcp_config TEXT`); } catch {};
try { sqlite.exec(`ALTER TABLE bots ADD COLUMN theme_color TEXT`); } catch {};
try { sqlite.exec(`ALTER TABLE users ADD COLUMN reset_token TEXT`); } catch {};
try { sqlite.exec(`ALTER TABLE users ADD COLUMN reset_token_expires INTEGER`); } catch {};
try { sqlite.exec(`ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0`); } catch {};
try { sqlite.exec(`ALTER TABLE users ADD COLUMN verification_token TEXT`); } catch {};
try { sqlite.exec(`ALTER TABLE users RENAME COLUMN password_hash TO password`); } catch {};
try { sqlite.exec(`ALTER TABLE users ADD COLUMN name TEXT`); } catch {};
try { sqlite.exec(`ALTER TABLE bots ADD COLUMN language TEXT DEFAULT 'auto'`); } catch {};

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                   TEXT PRIMARY KEY,
    email                TEXT UNIQUE,
    password             TEXT,
    name                 TEXT,
    google_id            TEXT,
    reset_token          TEXT,
    reset_token_expires  INTEGER,
    is_verified          INTEGER DEFAULT 0,
    verification_token   TEXT
  );
  CREATE TABLE IF NOT EXISTS bots (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT,
    slug                TEXT UNIQUE,
    service_name        TEXT,
    service_description TEXT,
    persona_name        TEXT,
    persona_profession  TEXT,
    persona_description TEXT,
    prompt              TEXT,
    rag_urls            TEXT,
    mcp_servers         TEXT,
    mcp_config          TEXT,
    public_url          TEXT,
    publish_status      TEXT,
    photo_url           TEXT,
    theme_color         TEXT,
    minimum_age         INTEGER DEFAULT 1,
    tones               TEXT,
    language            TEXT DEFAULT 'auto',
    created_at          TEXT,
    updated_at          TEXT
  );
  CREATE TABLE IF NOT EXISTS bot_versions (
    version_id  TEXT PRIMARY KEY,
    bot_id      TEXT,
    created_at  TEXT,
    yaml_config TEXT
  );
  CREATE TABLE IF NOT EXISTS publish_runs (
    id         TEXT PRIMARY KEY,
    bot_id     TEXT,
    action     TEXT,
    status     TEXT,
    details    TEXT,
    created_at TEXT
  );
`);

/** Deserialize JSON columns stored as text */
function parseJsonCols(row) {
  if (row.mcp_servers && typeof row.mcp_servers === 'string') {
    try { row.mcp_servers = JSON.parse(row.mcp_servers); } catch { row.mcp_servers = []; }
  }
  if (row.rag_urls && typeof row.rag_urls === 'string') {
    try { row.rag_urls = JSON.parse(row.rag_urls); } catch { row.rag_urls = []; }
  }
  if (row.mcp_config && typeof row.mcp_config === 'string') {
    try { row.mcp_config = JSON.parse(row.mcp_config); } catch { row.mcp_config = {}; }
  }
  if (row.tones === undefined || row.tones === null) {
    row.tones = [];
  } else if (typeof row.tones === 'string') {
    try { row.tones = JSON.parse(row.tones); } catch { row.tones = []; }
  }
  if (row.success !== undefined) row.success = !!row.success;
  return row;
}

/** Serialize values for SQLite (objects → JSON, booleans → 0/1) */
function toSql(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

const db = {
  find(collection, predicate) {
    if (typeof predicate !== 'function') return null;
    return sqlite.prepare(`SELECT * FROM ${collection}`).all()
      .map(parseJsonCols).find(predicate) || null;
  },
  filter(collection, predicate) {
    return sqlite.prepare(`SELECT * FROM ${collection}`).all()
      .map(parseJsonCols).filter(predicate);
  },
  push(collection, item) {
    const cols  = Object.keys(item).join(', ');
    const ph    = Object.keys(item).map(() => '?').join(', ');
    const vals  = Object.values(item).map(toSql);
    sqlite.prepare(`INSERT INTO ${collection} (${cols}) VALUES (${ph})`).run(...vals);
    return item;
  },
  update(collection, predicate, updates) {
    const rows = sqlite.prepare(`SELECT * FROM ${collection}`).all().map(parseJsonCols);
    const idx  = rows.findIndex(predicate);
    if (idx === -1) return;
    const pkInfo = sqlite.prepare(`PRAGMA table_info(${collection})`).all().find(c => c.pk === 1);
    const idKey  = pkInfo ? pkInfo.name : 'id';
    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals      = Object.values(updates).map(toSql);
    sqlite.prepare(`UPDATE ${collection} SET ${setClause} WHERE ${idKey} = ?`)
      .run(...vals, rows[idx][idKey]);
  },
  remove(collection, predicate) {
    const rows = sqlite.prepare(`SELECT * FROM ${collection}`).all().map(parseJsonCols);
    const toRemove = rows.filter(predicate);
    const pkInfo = sqlite.prepare(`PRAGMA table_info(${collection})`).all().find(c => c.pk === 1);
    const idKey = pkInfo ? pkInfo.name : 'id';
    const del = sqlite.prepare(`DELETE FROM ${collection} WHERE ${idKey} = ?`);
    for (const row of toRemove) {
      del.run(row[idKey]);
    }
    return toRemove.length;
  }
};

module.exports = db;

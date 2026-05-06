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

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id       TEXT PRIMARY KEY,
    email    TEXT UNIQUE,
    password TEXT,
    name     TEXT
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
    const idKey    = collection === 'bot_versions' ? 'version_id' : 'id';
    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals      = Object.values(updates).map(toSql);
    sqlite.prepare(`UPDATE ${collection} SET ${setClause} WHERE ${idKey} = ?`)
      .run(...vals, rows[idx][idKey]);
  }
};

module.exports = db;

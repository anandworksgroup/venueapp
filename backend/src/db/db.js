import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let db;
const stmtCache = new Map();

export function openDb(file = config.dbPath) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return db;
}

export function closeDb() {
  if (db) db.close();
  db = undefined;
  stmtCache.clear();
}

function stmt(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = openDb().prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

// node:sqlite rejects `undefined` and booleans; normalise parameters.
const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

export const q = {
  get: (sql, ...p) => stmt(sql).get(...norm(p)),
  all: (sql, ...p) => stmt(sql).all(...norm(p)),
  run: (sql, ...p) => stmt(sql).run(...norm(p)),
  exec: (sql) => openDb().exec(sql),
};

/** Insert a row from a plain object. JSON-serialises arrays/objects. */
export function insert(table, row) {
  const keys = Object.keys(row);
  const vals = keys.map((k) => {
    const v = row[k];
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  });
  return q.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...vals);
}

/** Update columns by id. */
export function update(table, id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const vals = keys.map((k) => {
    const v = patch[k];
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  });
  return q.run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...vals, id);
}

let depth = 0;
/**
 * Run fn inside a write transaction. BEGIN IMMEDIATE takes the write lock up
 * front so concurrent processes serialise on inventory instead of racing.
 * Nested calls join the outer transaction.
 */
export function tx(fn) {
  if (depth > 0) return fn();
  openDb().exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const out = fn();
    openDb().exec('COMMIT');
    return out;
  } catch (e) {
    try { openDb().exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  } finally {
    depth--;
  }
}

export const parseJson = (s, fallback) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

export function getSetting(key, fallback) {
  const row = q.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? parseJson(row.value, fallback) : fallback;
}

export function setSetting(key, value) {
  q.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

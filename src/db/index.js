import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, '..', '..', 'data'));
export const UPLOAD_DIR = resolve(
  process.env.UPLOAD_DIR || join(__dirname, '..', '..', 'public', 'uploads')
);

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });

const dbFile = join(DATA_DIR, 'portfolio.db');
export const db = new DatabaseSync(dbFile);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');
db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));

/** Run a SELECT returning all rows. */
export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

/** Run a SELECT returning the first row or undefined. */
export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

/** Run an INSERT/UPDATE/DELETE. */
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

/** Wrap a function in a transaction. */
export function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

export const now = () => new Date().toISOString();

// Row-level migrations run once the schema is in place. The import is at the
// bottom on purpose: migrate.js reads the helpers defined above.
runMigrations();

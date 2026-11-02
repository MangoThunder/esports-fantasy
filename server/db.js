// Node database: built-in node:sqlite, stored in data.db.
// The GitHub Pages build swaps this file for web/db.js (same exports, runs in the browser).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA } from './schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const db = new DatabaseSync(process.env.DB_PATH || path.join(root, 'data.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec(SCHEMA);

/** Run fn inside a transaction. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Writes go straight to disk in Node, so there's nothing to flush. */
export function persist() {}

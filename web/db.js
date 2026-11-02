// Browser database for the GitHub Pages build: SQLite compiled to WebAssembly (sql.js),
// saved to localStorage. It mirrors the bits of node:sqlite that the server code uses,
// so routes.js, seed.js and sim.js run unchanged.
import { migrate } from './schema.js';

export const STORAGE_KEY = 'fragline.db';
const base = new URL('../vendor/', import.meta.url).href;

// sql-wasm.js is a classic script that defines window.initSqlJs.
await new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = base + 'sql-wasm.js';
  s.onload = resolve;
  s.onerror = () => reject(new Error('Could not load the database engine.'));
  document.head.appendChild(s);
});
const SQL = await window.initSqlJs({ locateFile: (f) => base + f });

function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return new SQL.Database(Uint8Array.from(atob(saved), (c) => c.charCodeAt(0)));
  } catch (e) {
    console.warn('Saved data could not be read, starting fresh.', e);
  }
  return new SQL.Database();
}

const raw = load();

const prepare = (sql) => ({
  all(...args) {
    const st = raw.prepare(sql);
    try {
      st.bind(args);
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    } finally { st.free(); }
  },
  get(...args) { return this.all(...args)[0]; },
  run(...args) {
    raw.run(sql, args);
    const [[lastInsertRowid]] = raw.exec('SELECT last_insert_rowid()')[0].values;
    return { lastInsertRowid, changes: raw.getRowsModified() };
  },
});

export const db = { prepare, exec: (sql) => raw.exec(sql) };
migrate(db); // wipes demo data saved by an older version of the app

export function tx(fn) {
  raw.exec('BEGIN');
  try {
    const r = fn();
    raw.exec('COMMIT');
    return r;
  } catch (e) {
    raw.exec('ROLLBACK');
    throw e;
  }
}

/** Save the whole database to localStorage (it's small: well under 1 MB). */
export function persist() {
  try {
    const bytes = raw.export();
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    localStorage.setItem(STORAGE_KEY, btoa(bin));
    raw.exec('PRAGMA foreign_keys = ON;'); // export() reopens the database and resets pragmas
  } catch (e) {
    console.warn('Could not save data in this browser.', e);
  }
}

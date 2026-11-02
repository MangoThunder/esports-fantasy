// SQLite schema, shared by the Node server and the in-browser (GitHub Pages) build.
// Bump SCHEMA_VERSION when the schema changes; older databases are wiped and re-seeded.
export const SCHEMA_VERSION = 2;

const TABLES = ['lineups', 'league_members', 'leagues', 'team_stats', 'player_stats', 'matches', 'weeks', 'players', 'teams', 'sessions', 'users'];

export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  tag TEXT NOT NULL,
  color TEXT NOT NULL,
  rank INTEGER NOT NULL,
  rating REAL NOT NULL,
  salary INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  game TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  handle TEXT NOT NULL,
  role TEXT,
  rating REAL NOT NULL,
  salary INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS weeks (
  id INTEGER PRIMARY KEY,
  game TEXT NOT NULL,
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','complete')),
  UNIQUE (game, number)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  team_a INTEGER NOT NULL REFERENCES teams(id),
  team_b INTEGER NOT NULL REFERENCES teams(id),
  winner_id INTEGER REFERENCES teams(id),
  maps_a INTEGER, maps_b INTEGER,
  detail TEXT            -- JSON: per-map scores
);
CREATE TABLE IF NOT EXISTS player_stats (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  stats TEXT NOT NULL,   -- JSON, keys depend on the game
  points REAL NOT NULL,
  PRIMARY KEY (match_id, player_id)
);
CREATE TABLE IF NOT EXISTS team_stats (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  stats TEXT NOT NULL,
  points REAL NOT NULL,
  PRIMARY KEY (match_id, team_id)
);

CREATE TABLE IF NOT EXISTS leagues (
  id INTEGER PRIMARY KEY,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS league_members (
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (league_id, user_id)
);
CREATE TABLE IF NOT EXISTS lineups (
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  slot TEXT NOT NULL,
  player_id INTEGER REFERENCES players(id),
  team_id INTEGER REFERENCES teams(id),
  PRIMARY KEY (league_id, user_id, week_id, slot)
);
`;

/** Create the schema, wiping any database from an older schema version. */
export function migrate(db) {
  const { user_version: v } = db.prepare('PRAGMA user_version').get();
  if (v !== SCHEMA_VERSION) {
    db.exec('PRAGMA foreign_keys = OFF;');
    for (const t of TABLES) db.exec(`DROP TABLE IF EXISTS ${t};`);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }
  db.exec(SCHEMA);
}

// SQLite schema, shared by the Node server and the in-browser (GitHub Pages) build.
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
  name TEXT NOT NULL,
  tag TEXT NOT NULL,
  color TEXT NOT NULL,
  rating REAL NOT NULL,
  salary INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  handle TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('TOP','JNG','MID','ADC','SUP')),
  rating REAL NOT NULL,
  salary INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS weeks (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','complete'))
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  week INTEGER NOT NULL REFERENCES weeks(id),
  team_a INTEGER NOT NULL REFERENCES teams(id),
  team_b INTEGER NOT NULL REFERENCES teams(id),
  winner_id INTEGER REFERENCES teams(id),
  duration_min INTEGER,
  kills_a INTEGER, kills_b INTEGER
);
CREATE TABLE IF NOT EXISTS player_stats (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  kills INTEGER NOT NULL, deaths INTEGER NOT NULL, assists INTEGER NOT NULL, cs INTEGER NOT NULL,
  points REAL NOT NULL,
  PRIMARY KEY (match_id, player_id)
);
CREATE TABLE IF NOT EXISTS team_stats (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  won INTEGER NOT NULL, towers INTEGER NOT NULL, dragons INTEGER NOT NULL, barons INTEGER NOT NULL,
  first_blood INTEGER NOT NULL,
  points REAL NOT NULL,
  PRIMARY KEY (match_id, team_id)
);

CREATE TABLE IF NOT EXISTS leagues (
  id INTEGER PRIMARY KEY,
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
  week INTEGER NOT NULL REFERENCES weeks(id),
  slot TEXT NOT NULL,
  player_id INTEGER REFERENCES players(id),
  team_id INTEGER REFERENCES teams(id),
  PRIMARY KEY (league_id, user_id, week, slot)
);
`;

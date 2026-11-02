// Plays a game's current week with the game's simulator, scores it, closes the week,
// and re-prices players. Replace with a real stats import when you have a data feed.
import { db, tx } from './db.js';
import { getGame } from './games/index.js';
import { scoreStats } from './games/tactical-shooter.js';

const round100 = (v) => Math.round(v / 100) * 100;

export function currentWeek(gameId) {
  return db.prepare("SELECT * FROM weeks WHERE game = ? AND status = 'open' ORDER BY number LIMIT 1").get(gameId) ?? null;
}

/** Move each player's salary part of the way toward what their scoring so far is worth. */
function reprice(gameId) {
  const rows = db.prepare(`
    SELECT p.id, p.salary, AVG(ps.points) AS fppg
    FROM players p JOIN player_stats ps ON ps.player_id = p.id
    WHERE p.game = ? GROUP BY p.id`).all(gameId);
  if (!rows.length) return;
  const meanPts = rows.reduce((s, r) => s + r.fppg, 0) / rows.length;
  const meanSal = rows.reduce((s, r) => s + r.salary, 0) / rows.length;
  const upd = db.prepare('UPDATE players SET salary = ? WHERE id = ?');
  for (const r of rows) {
    const target = meanSal * (r.fppg / meanPts);
    upd.run(Math.max(3500, Math.min(11500, round100(r.salary * 0.65 + target * 0.35))), r.id);
  }
}

/** Managers who didn't touch their lineup this week keep last week's, as the lineup locks. */
function carryOverLineups(gameId, week) {
  const missing = db.prepare(`
    SELECT lm.league_id, lm.user_id FROM league_members lm JOIN leagues l ON l.id = lm.league_id
    WHERE l.game = ? AND NOT EXISTS (
      SELECT 1 FROM lineups x WHERE x.league_id = lm.league_id AND x.user_id = lm.user_id AND x.week_id = ?)`).all(gameId, week.id);
  const prevWeek = db.prepare(`
    SELECT MAX(w.number) AS n FROM lineups l JOIN weeks w ON w.id = l.week_id
    WHERE l.league_id = ? AND l.user_id = ? AND w.number < ?`);
  const copy = db.prepare(`
    INSERT INTO lineups (league_id, user_id, week_id, slot, player_id, team_id)
    SELECT l.league_id, l.user_id, ?, l.slot, l.player_id, l.team_id FROM lineups l JOIN weeks w ON w.id = l.week_id
    WHERE l.league_id = ? AND l.user_id = ? AND w.game = ? AND w.number = ?`);
  for (const m of missing) {
    const n = prevWeek.get(m.league_id, m.user_id, week.number).n;
    if (n) copy.run(week.id, m.league_id, m.user_id, gameId, n);
  }
}

export function simulateCurrentWeek(gameId) {
  const game = getGame(gameId);
  const week = currentWeek(gameId);
  if (!week) {
    const err = new Error(`The ${game.name} season is over — no open weeks left.`);
    err.status = 400;
    throw err;
  }
  const team = (id) => db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  const roster = (id) => db.prepare('SELECT * FROM players WHERE team_id = ? ORDER BY id').all(id);
  const updMatch = db.prepare('UPDATE matches SET winner_id = ?, maps_a = ?, maps_b = ?, detail = ? WHERE id = ?');
  const insPS = db.prepare('INSERT INTO player_stats (match_id, player_id, stats, points) VALUES (?, ?, ?, ?)');
  const insTS = db.prepare('INSERT INTO team_stats (match_id, team_id, stats, points) VALUES (?, ?, ?, ?)');

  tx(() => {
    carryOverLineups(gameId, week);
    for (const m of db.prepare('SELECT * FROM matches WHERE week_id = ?').all(week.id)) {
      const A = team(m.team_a), B = team(m.team_b);
      const r = game.simulateSeries(A, roster(A.id), B, roster(B.id));
      for (const [pid, stats] of r.players) {
        insPS.run(m.id, pid, JSON.stringify(stats), scoreStats(stats, game.playerRules, game.playerBonuses));
      }
      insTS.run(m.id, A.id, JSON.stringify(r.teams.a), scoreStats(r.teams.a, game.teamRules, game.teamBonuses));
      insTS.run(m.id, B.id, JSON.stringify(r.teams.b), scoreStats(r.teams.b, game.teamRules, game.teamBonuses));
      updMatch.run(r.winnerId, r.mapsA, r.mapsB, JSON.stringify({ maps: r.maps }), m.id);
    }
    db.prepare("UPDATE weeks SET status = 'complete' WHERE id = ?").run(week.id);
    reprice(gameId);
  });
  return week.number;
}

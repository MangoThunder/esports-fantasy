// Seeds each registered game with its real teams and players (from server/games/data/)
// and a round-robin schedule of best-of-3 series, one per team per week.
import { db, tx } from './db.js';
import { GAMES } from './games/index.js';

const round100 = (v) => Math.round(v / 100) * 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Starting estimates only: after each week, player salaries move toward actual fantasy output.
export const teamRating = (rank) => 88 - (rank - 1) * 2;
export const playerSalary = (rating) => round100(clamp(4000 + (rating - 68) * 250, 3500, 11000));
const teamSalary = (rating) => round100(3000 + (rating - 70) * 150);

function seedGame(game) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM teams WHERE game = ?').get(game.id);
  if (n > 0) return;
  const stars = new Set(game.data.stars || []);

  tx(() => {
    const insTeam = db.prepare('INSERT INTO teams (game, name, tag, color, rank, rating, salary) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insPlayer = db.prepare('INSERT INTO players (game, team_id, handle, role, rating, salary) VALUES (?, ?, ?, ?, ?, ?)');
    const ids = [];
    for (const t of game.data.teams) {
      const rating = teamRating(t.rank);
      const teamId = Number(insTeam.run(game.id, t.name, t.tag, t.color, t.rank, rating, teamSalary(rating)).lastInsertRowid);
      ids.push(teamId);
      for (const p of t.players) {
        const handle = typeof p === 'string' ? p : p.nick;
        const pr = rating + (stars.has(handle) ? 6 : 0);
        insPlayer.run(game.id, teamId, handle, p.role ?? null, pr, playerSalary(pr));
      }
    }

    // Round-robin via the circle method (adds a bye if the team count is odd).
    const ring0 = ids.length % 2 ? [...ids, null] : ids;
    const rot = ring0.slice(1);
    const insWeek = db.prepare('INSERT INTO weeks (game, number) VALUES (?, ?)');
    const insMatch = db.prepare('INSERT INTO matches (week_id, team_a, team_b) VALUES (?, ?, ?)');
    for (let w = 1; w < ring0.length; w++) {
      const weekId = Number(insWeek.run(game.id, w).lastInsertRowid);
      const ring = [ring0[0], ...rot];
      for (let i = 0; i < ring.length / 2; i++) {
        const [a, b] = [ring[i], ring[ring.length - 1 - i]];
        if (a != null && b != null) insMatch.run(weekId, a, b);
      }
      rot.unshift(rot.pop());
    }
  });
}

export function seedIfEmpty() {
  for (const g of Object.values(GAMES)) seedGame(g);
}

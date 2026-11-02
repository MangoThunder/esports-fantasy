// Match simulator: a stand-in for a real esports stats feed.
// It "plays" every match in the current week, writes box scores and fantasy points,
// and closes the week. Replace with a provider import when you have real data.
import { db, tx } from './db.js';
import { playerPoints, teamPoints } from './scoring.js';

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// Split `total` events across players proportional to weights.
function distribute(total, weights) {
  const out = weights.map(() => 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < total; i++) {
    let r = Math.random() * sum;
    let k = 0;
    while (r > weights[k]) r -= weights[k++];
    out[k]++;
  }
  return out;
}

const KILL_SHARE = { TOP: 0.9, JNG: 1.0, MID: 1.3, ADC: 1.5, SUP: 0.25 };
const DEATH_SHARE = { TOP: 1.0, JNG: 1.0, MID: 1.0, ADC: 1.0, SUP: 1.2 };
const ASSIST_SHARE = { TOP: 0.8, JNG: 1.3, MID: 1.0, ADC: 0.9, SUP: 1.6 };
const CS_PER_MIN = { TOP: 7.6, JNG: 5.6, MID: 8.1, ADC: 8.8, SUP: 1.3 };

export function currentWeek() {
  return db.prepare("SELECT id FROM weeks WHERE status = 'open' ORDER BY id LIMIT 1").get()?.id ?? null;
}

export function simulateCurrentWeek() {
  const week = currentWeek();
  if (week == null) throw new Error('Season is over — no open weeks left.');

  const matches = db.prepare('SELECT * FROM matches WHERE week = ?').all(week);
  const teamById = (id) => db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  const rosterOf = (id) => db.prepare('SELECT * FROM players WHERE team_id = ? ORDER BY id').all(id);

  const updMatch = db.prepare('UPDATE matches SET winner_id = ?, duration_min = ?, kills_a = ?, kills_b = ? WHERE id = ?');
  const insPS = db.prepare('INSERT INTO player_stats (match_id, player_id, kills, deaths, assists, cs, points) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insTS = db.prepare('INSERT INTO team_stats (match_id, team_id, won, towers, dragons, barons, first_blood, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

  tx(() => {
    for (const m of matches) {
      const A = teamById(m.team_a), B = teamById(m.team_b);
      const ra = rosterOf(A.id), rb = rosterOf(B.id);
      const strength = (t, r) => t.rating * 0.5 + (r.reduce((s, p) => s + p.rating, 0) / r.length) * 0.5;
      const pA = 1 / (1 + Math.pow(10, (strength(B, rb) - strength(A, ra)) / 18));
      const aWins = Math.random() < pA;
      const duration = Math.round(Math.max(22, Math.min(45, 32 + gauss() * 5)));

      const killsW = randInt(14, 28), killsL = randInt(4, Math.max(5, killsW - 4));
      const [kA, kB] = aWins ? [killsW, killsL] : [killsL, killsW];
      const firstBloodA = Math.random() < (aWins ? 0.62 : 0.38);

      const side = (team, roster, won, kills, enemyKills, firstBlood) => {
        const kw = roster.map((p) => KILL_SHARE[p.role] * (p.rating / 75) ** 2);
        const dw = roster.map((p) => DEATH_SHARE[p.role] * (75 / p.rating));
        const aw = roster.map((p) => ASSIST_SHARE[p.role]);
        const K = distribute(kills, kw);
        const D = distribute(enemyKills, dw);
        const A = distribute(Math.round(kills * (1.6 + Math.random() * 0.6)), aw);
        roster.forEach((p, i) => {
          const cs = Math.max(0, Math.round(CS_PER_MIN[p.role] * duration * (0.85 + (p.rating - 50) / 300 + gauss() * 0.06)));
          const pts = playerPoints({ kills: K[i], deaths: D[i], assists: A[i], cs, won });
          insPS.run(m.id, p.id, K[i], D[i], A[i], cs, pts);
        });
        const towers = won ? randInt(7, 11) : randInt(0, 5);
        const dragons = won ? randInt(2, 4) : randInt(0, 2);
        const barons = won ? randInt(1, 2) : randInt(0, 1) * (Math.random() < 0.3 ? 1 : 0);
        const tp = teamPoints({ won, towers, dragons, barons, firstBlood, duration });
        insTS.run(m.id, team.id, won ? 1 : 0, towers, dragons, barons, firstBlood ? 1 : 0, tp);
      };

      side(A, ra, aWins, kA, kB, firstBloodA);
      side(B, rb, !aWins, kB, kA, !firstBloodA);
      updMatch.run(aWins ? A.id : B.id, duration, kA, kB, m.id);
    }
    db.prepare("UPDATE weeks SET status = 'complete' WHERE id = ?").run(week);
  });

  return week;
}

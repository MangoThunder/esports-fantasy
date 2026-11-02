// Seeds a fictional league: 8 teams, 40 players, a 7-week round-robin schedule.
// All names are invented. Swap this out for a real data provider later (see README).
import { db, tx } from './db.js';
import { ROLES } from './scoring.js';

const TEAMS = [
  ['Neon Vipers', 'NVP', '#22d3ee', 88],
  ['Crimson Tide Gaming', 'CTG', '#ef4444', 84],
  ['Arctic Owls', 'AOW', '#93c5fd', 80],
  ['Solar Flare', 'SLF', '#f59e0b', 77],
  ['Void Runners', 'VRN', '#a855f7', 73],
  ['Iron Lotus', 'ILT', '#10b981', 70],
  ['Static Kings', 'SKG', '#eab308', 66],
  ['Paper Tigers', 'PTG', '#f97316', 62],
];

const HANDLES = [
  'Kairo', 'Wisp', 'Zenith', 'Blitz', 'Mochi',
  'Rook', 'Fable', 'Quasar', 'Hex', 'Pebble',
  'Tundra', 'Shade', 'Vex', 'Nova', 'Lumen',
  'Ember', 'Gale', 'Pyre', 'Dash', 'Halo',
  'Grit', 'Specter', 'Orbit', 'Ricochet', 'Mint',
  'Bastion', 'Thorn', 'Cipher', 'Flicker', 'Sage',
  'Anvil', 'Jolt', 'Prism', 'Volt', 'Cuddles',
  'Boulder', 'Scrap', 'Glitch', 'Tempo', 'Biscuit',
];

// Deterministic pseudo-random so every fresh install gets the same roster.
let s = 1337;
const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round100 = (v) => Math.round(v / 100) * 100;
// Supports and top laners score fewer fantasy points, so they cost less.
const ROLE_PRICE = { TOP: 0.86, JNG: 1.04, MID: 1.02, ADC: 1.05, SUP: 0.86 };

export function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM teams').get();
  if (n > 0) return;

  tx(() => {
    const insTeam = db.prepare('INSERT INTO teams (name, tag, color, rating, salary) VALUES (?, ?, ?, ?, ?)');
    const insPlayer = db.prepare('INSERT INTO players (team_id, handle, role, rating, salary) VALUES (?, ?, ?, ?, ?)');

    TEAMS.forEach(([name, tag, color, rating], ti) => {
      const teamSalary = round100(2500 + (rating - 60) * 125);
      const { lastInsertRowid: teamId } = insTeam.run(name, tag, color, rating, teamSalary);
      ROLES.forEach((role, ri) => {
        const pr = clamp(rating + (rand() - 0.5) * 16, 50, 98);
        // Ratings 50-98 map to salaries roughly 3,500-11,500.
        const salary = round100((3500 + (pr - 50) * (8000 / 48)) * ROLE_PRICE[role]);
        insPlayer.run(Number(teamId), HANDLES[ti * 5 + ri], role, pr, salary);
      });
    });

    // Round-robin via the circle method: 8 teams -> 7 weeks x 4 matches.
    const ids = db.prepare('SELECT id FROM teams ORDER BY id').all().map((r) => r.id);
    const insWeek = db.prepare('INSERT INTO weeks (id) VALUES (?)');
    const insMatch = db.prepare('INSERT INTO matches (week, team_a, team_b) VALUES (?, ?, ?)');
    const rot = ids.slice(1);
    for (let w = 1; w <= ids.length - 1; w++) {
      insWeek.run(w);
      const ring = [ids[0], ...rot];
      for (let i = 0; i < ring.length / 2; i++) {
        insMatch.run(w, ring[i], ring[ring.length - 1 - i]);
      }
      rot.unshift(rot.pop());
    }
  });
}

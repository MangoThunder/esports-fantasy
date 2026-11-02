// The whole API, with no web framework. It runs in two places:
//   - Node: server/index.js wraps it in Express.
//   - Browser (GitHub Pages): public/transport.js is swapped for web/transport.js, which calls it directly.
import { db, tx } from './db.js';
import { randomHex, hashPassword, checkPassword } from './crypto.js';
import { seedIfEmpty } from './seed.js';
import { simulateCurrentWeek, currentWeek } from './sim.js';
import { GAMES, GAME_IDS, getGame, publicGame } from './games/index.js';

seedIfEmpty();

const ALLOW_SIM = globalThis.process?.env?.ALLOW_SIM !== '0';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

// ---------- routing ----------
const routes = [];
const on = (method, pattern, opts, fn) => {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, fn, auth: !!opts.auth });
};

/**
 * Handle one API request.
 * @param {{method: string, path: string, body?: object, query?: object, token?: string}} req
 *   path is relative to /api, e.g. "/leagues/3".
 * @returns {{status: number, data: object, token?: string|null}}
 *   token is set when the session changes: a new token on login, null on logout.
 */
export function handle({ method, path, body = {}, query = {}, token }) {
  const ctx = { body: body || {}, query, params: {}, token, user: null, newToken: undefined };
  ctx.user = token
    ? db.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token) ?? null
    : null;
  try {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
      if (r.auth && !ctx.user) throw new HttpError(401, 'Please log in.');
      const data = r.fn(ctx);
      return { status: 200, data, token: ctx.newToken };
    }
    throw new HttpError(404, 'Not found.');
  } catch (err) {
    if (!err.status) console.error(err);
    return { status: err.status || 500, data: { error: err.status ? err.message : 'Something went wrong.' } };
  }
}

// ---------- auth ----------
function startSession(ctx, userId) {
  const t = randomHex(32);
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(t, userId);
  ctx.newToken = t;
}

on('POST', '/register', (ctx) => {
  const { username, password } = ctx.body;
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username || '')) throw bad('Username must be 3–20 letters, numbers or _.');
  if (typeof password !== 'string' || password.length < 6) throw bad('Password must be at least 6 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('That username is taken.');
  const id = Number(db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run(username, hashPassword(password)).lastInsertRowid);
  startSession(ctx, id);
  return { id, username };
});

on('POST', '/login', (ctx) => {
  const { username, password } = ctx.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!u || !checkPassword(String(password || ''), u.pass_hash)) throw new HttpError(401, 'Wrong username or password.');
  startSession(ctx, u.id);
  return { id: u.id, username: u.username };
});

on('POST', '/logout', (ctx) => {
  if (ctx.token) db.prepare('DELETE FROM sessions WHERE token = ?').run(ctx.token);
  ctx.newToken = null;
  return { ok: true };
});

on('GET', '/me', (ctx) => ({ user: ctx.user, allowSim: ALLOW_SIM }));

// ---------- games ----------
const gameFrom = (ctx) => getGame(String(ctx.query.game || ctx.body.game || ''));
const totalWeeks = (gameId) => db.prepare('SELECT COUNT(*) AS n FROM weeks WHERE game = ?').get(gameId).n;
const completeWeeks = (gameId) => db.prepare("SELECT * FROM weeks WHERE game = ? AND status = 'complete' ORDER BY number").all(gameId);
const weekByNumber = (gameId, n) => db.prepare('SELECT * FROM weeks WHERE game = ? AND number = ?').get(gameId, n);

on('GET', '/games', () => GAME_IDS.map((id) => ({
  ...publicGame(GAMES[id]),
  currentWeek: currentWeek(id)?.number ?? null,
  totalWeeks: totalWeeks(id),
})));

// ---------- esports data ----------
function opponentsFor(week) {
  const map = {};
  if (!week) return map;
  for (const m of db.prepare('SELECT team_a, team_b FROM matches WHERE week_id = ?').all(week.id)) {
    map[m.team_a] = m.team_b;
    map[m.team_b] = m.team_a;
  }
  return map;
}

/** Average each numeric stat across rows of JSON stats. */
function averageStats(rows) {
  const sums = {};
  for (const r of rows) for (const [k, v] of Object.entries(JSON.parse(r.stats))) sums[k] = (sums[k] || 0) + v;
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v / rows.length]));
}

on('GET', '/players', (ctx) => {
  const game = gameFrom(ctx);
  const players = db.prepare(`
    SELECT p.id, p.handle, p.role, p.salary, p.team_id, t.name AS team_name, t.tag AS team_tag, t.color AS team_color
    FROM players p JOIN teams t ON t.id = p.team_id WHERE p.game = ? ORDER BY p.salary DESC, p.handle`).all(game.id);
  const stats = db.prepare(`
    SELECT ps.player_id, ps.stats, ps.points FROM player_stats ps JOIN players p ON p.id = ps.player_id WHERE p.game = ?`).all(game.id);
  const byPlayer = {};
  for (const s of stats) (byPlayer[s.player_id] ??= []).push(s);
  const opp = opponentsFor(currentWeek(game.id));
  const tags = Object.fromEntries(db.prepare('SELECT id, tag FROM teams WHERE game = ?').all(game.id).map((t) => [t.id, t.tag]));
  return players.map((p) => {
    const rows = byPlayer[p.id] || [];
    const total = rows.reduce((s, r) => s + r.points, 0);
    return {
      ...p,
      games: rows.length,
      total_pts: total,
      avg_pts: rows.length ? total / rows.length : 0,
      avg: rows.length ? averageStats(rows) : {},
      opponent: tags[opp[p.team_id]] || null,
    };
  });
});

on('GET', '/teams', (ctx) => {
  const game = gameFrom(ctx);
  const teams = db.prepare('SELECT id, name, tag, color, rank, salary FROM teams WHERE game = ? ORDER BY rank').all(game.id);
  const stats = db.prepare(`SELECT ts.team_id, ts.stats, ts.points FROM team_stats ts JOIN teams t ON t.id = ts.team_id WHERE t.game = ?`).all(game.id);
  const opp = opponentsFor(currentWeek(game.id));
  const tags = Object.fromEntries(teams.map((t) => [t.id, t.tag]));
  return teams.map((t) => {
    const rows = stats.filter((s) => s.team_id === t.id);
    const total = rows.reduce((s, r) => s + r.points, 0);
    const wins = rows.filter((r) => JSON.parse(r.stats).series_won).length;
    return { ...t, games: rows.length, wins, total_pts: total, avg_pts: rows.length ? total / rows.length : 0, opponent: tags[opp[t.id]] || null };
  });
});

const MATCH_SELECT = `
  SELECT m.*, w.number AS week, w.game,
         ta.name AS name_a, ta.tag AS tag_a, ta.color AS color_a, tb.name AS name_b, tb.tag AS tag_b, tb.color AS color_b
  FROM matches m JOIN weeks w ON w.id = m.week_id
  JOIN teams ta ON ta.id = m.team_a JOIN teams tb ON tb.id = m.team_b`;
const parseMatch = (m) => ({ ...m, detail: m.detail ? JSON.parse(m.detail) : null });

on('GET', '/schedule', (ctx) => {
  const game = gameFrom(ctx);
  const weeks = db.prepare('SELECT * FROM weeks WHERE game = ? ORDER BY number').all(game.id);
  const matches = db.prepare(`${MATCH_SELECT} WHERE w.game = ? ORDER BY m.id`).all(game.id).map(parseMatch);
  return weeks.map((w) => ({ number: w.number, status: w.status, matches: matches.filter((m) => m.week_id === w.id) }));
});

on('GET', '/matches/:id', (ctx) => {
  const m = db.prepare(`${MATCH_SELECT} WHERE m.id = ?`).get(Number(ctx.params.id));
  if (!m) throw new HttpError(404, 'Match not found.');
  const players = db.prepare(`
    SELECT ps.player_id, ps.stats, ps.points, p.handle, p.team_id FROM player_stats ps JOIN players p ON p.id = ps.player_id
    WHERE ps.match_id = ? ORDER BY ps.points DESC`).all(m.id).map((r) => ({ ...r, stats: JSON.parse(r.stats) }));
  const teams = db.prepare('SELECT * FROM team_stats WHERE match_id = ?').all(m.id).map((r) => ({ ...r, stats: JSON.parse(r.stats) }));
  return { ...parseMatch(m), players, teams };
});

// ---------- leagues ----------
const memberOf = (leagueId, userId) =>
  db.prepare('SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?').get(leagueId, userId);

function requireLeague(ctx) {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(Number(ctx.params.id));
  if (!league) throw new HttpError(404, 'League not found.');
  if (!memberOf(league.id, ctx.user.id)) throw new HttpError(403, 'You are not in this league.');
  return { league, game: getGame(league.game) };
}

const inviteCode = () => randomHex(3).toUpperCase();

/** Fantasy points scored in one week, by player id and by team id. */
function weekPoints(weekId) {
  const players = new Map(db.prepare(`
    SELECT ps.player_id AS id, SUM(ps.points) AS pts FROM player_stats ps JOIN matches m ON m.id = ps.match_id
    WHERE m.week_id = ? GROUP BY ps.player_id`).all(weekId).map((r) => [r.id, r.pts]));
  const teams = new Map(db.prepare(`
    SELECT ts.team_id AS id, SUM(ts.points) AS pts FROM team_stats ts JOIN matches m ON m.id = ts.match_id
    WHERE m.week_id = ? GROUP BY ts.team_id`).all(weekId).map((r) => [r.id, r.pts]));
  return { players, teams };
}

/** Points for one lineup slot in a completed week, including the slot's multiplier. */
function slotPoints(game, slot, row, pts) {
  const def = game.slots.find((s) => s.id === slot);
  const base = row.player_id ? pts.players.get(row.player_id) ?? 0 : pts.teams.get(row.team_id) ?? 0;
  return Math.round(base * (def?.multiplier ?? 1) * 100) / 100;
}

on('GET', '/leagues', { auth: true }, (ctx) => db.prepare(`
    SELECT l.id, l.game, l.name, l.invite_code, l.owner_id,
           (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) AS members
    FROM leagues l JOIN league_members lm ON lm.league_id = l.id
    WHERE lm.user_id = ? ORDER BY l.created_at DESC, l.id DESC`).all(ctx.user.id));

on('POST', '/leagues', { auth: true }, (ctx) => {
  const game = gameFrom(ctx);
  const name = String(ctx.body.name || '').trim();
  if (name.length < 2 || name.length > 40) throw bad('League name must be 2–40 characters.');
  const id = tx(() => {
    const leagueId = Number(db.prepare('INSERT INTO leagues (game, name, invite_code, owner_id) VALUES (?, ?, ?, ?)')
      .run(game.id, name, inviteCode(), ctx.user.id).lastInsertRowid);
    db.prepare('INSERT INTO league_members (league_id, user_id) VALUES (?, ?)').run(leagueId, ctx.user.id);
    return leagueId;
  });
  return { id };
});

on('POST', '/leagues/join', { auth: true }, (ctx) => {
  const code = String(ctx.body.code || '').trim().toUpperCase();
  const league = db.prepare('SELECT * FROM leagues WHERE invite_code = ?').get(code);
  if (!league) throw bad('No league with that invite code.');
  db.prepare('INSERT OR IGNORE INTO league_members (league_id, user_id) VALUES (?, ?)').run(league.id, ctx.user.id);
  return { id: league.id };
});

on('GET', '/leagues/:id', { auth: true }, (ctx) => {
  const { league, game } = requireLeague(ctx);
  const members = db.prepare(`
    SELECT u.id, u.username FROM league_members lm JOIN users u ON u.id = lm.user_id
    WHERE lm.league_id = ? ORDER BY lm.joined_at, u.id`).all(league.id);
  const done = completeWeeks(game.id);
  const cw = currentWeek(game.id);

  const scores = {}; // userId -> weekNumber -> points
  for (const w of done) {
    const pts = weekPoints(w.id);
    for (const r of db.prepare('SELECT * FROM lineups WHERE league_id = ? AND week_id = ?').all(league.id, w.id)) {
      ((scores[r.user_id] ??= {})[w.number] ??= 0);
      scores[r.user_id][w.number] += slotPoints(game, r.slot, r, pts);
    }
  }
  const setLineup = new Set(db.prepare('SELECT DISTINCT user_id FROM lineups WHERE league_id = ? AND week_id = ?')
    .all(league.id, cw?.id ?? -1).map((r) => r.user_id));

  const standings = members.map((m) => {
    const byWeek = Object.fromEntries(done.map((w) => [w.number, Math.round((scores[m.id]?.[w.number] ?? 0) * 100) / 100]));
    const total = Object.values(byWeek).reduce((a, b) => a + b, 0);
    const weekWins = done.filter((w) => {
      const best = Math.max(...members.map((o) => scores[o.id]?.[w.number] ?? 0));
      return best > 0 && (scores[m.id]?.[w.number] ?? 0) === best;
    }).length;
    return { ...m, byWeek, total: Math.round(total * 100) / 100, weekWins, lineupSet: setLineup.has(m.id) };
  }).sort((a, b) => b.total - a.total);

  return {
    ...league, isOwner: league.owner_id === ctx.user.id, members, standings,
    completeWeeks: done.map((w) => w.number), currentWeek: cw?.number ?? null, totalWeeks: totalWeeks(game.id),
  };
});

// Lineup for a week. Your own lineup is always visible; others' only after the week is complete.
on('GET', '/leagues/:id/lineup', { auth: true }, (ctx) => {
  const { league, game } = requireLeague(ctx);
  const cw = currentWeek(game.id);
  const week = ctx.query.week ? weekByNumber(game.id, Number(ctx.query.week)) : cw;
  if (!week) throw bad('Unknown week.');
  const userId = ctx.query.user ? Number(ctx.query.user) : ctx.user.id;
  if (userId !== ctx.user.id && week.status !== 'complete') throw new HttpError(403, 'Lineups are hidden until the week is complete.');

  const load = (weekId) => db.prepare('SELECT slot, player_id, team_id FROM lineups WHERE league_id = ? AND user_id = ? AND week_id = ?')
    .all(league.id, userId, weekId);
  let rows = load(week.id);
  let prefilledFrom = null;
  if (!rows.length && cw && week.id === cw.id && userId === ctx.user.id) {
    const prev = db.prepare(`
      SELECT w.id, w.number FROM lineups l JOIN weeks w ON w.id = l.week_id
      WHERE l.league_id = ? AND l.user_id = ? AND w.number < ? ORDER BY w.number DESC LIMIT 1`).get(league.id, userId, week.number);
    if (prev) { rows = load(prev.id); prefilledFrom = prev.number; }
  }
  const pts = week.status === 'complete' && !prefilledFrom ? weekPoints(week.id) : null;
  const slots = Object.fromEntries(rows.map((r) => [r.slot, {
    player_id: r.player_id, team_id: r.team_id, points: pts ? slotPoints(game, r.slot, r, pts) : null,
  }]));
  return { week: week.number, status: week.status, editable: !!cw && week.id === cw.id && userId === ctx.user.id, prefilledFrom, slots };
});

on('PUT', '/leagues/:id/lineup', { auth: true }, (ctx) => {
  const { league, game } = requireLeague(ctx);
  const week = currentWeek(game.id);
  if (!week) throw bad('The season is over.');
  const input = ctx.body.slots || {};
  const seen = new Set();
  const perTeam = {};
  let salary = 0;
  const rows = [];
  for (const slot of game.slots) {
    const id = input[slot.id];
    if (id == null || id === '') continue;
    const mult = slot.multiplier ?? 1;
    if (slot.kind === 'team') {
      const t = db.prepare('SELECT * FROM teams WHERE id = ? AND game = ?').get(Number(id), game.id);
      if (!t) throw bad('Unknown team.');
      salary += t.salary * mult;
      rows.push([slot.id, null, t.id]);
    } else {
      const p = db.prepare('SELECT * FROM players WHERE id = ? AND game = ?').get(Number(id), game.id);
      if (!p) throw bad(`Unknown player in the ${slot.label} slot.`);
      if (seen.has(p.id)) throw bad(`${p.handle} is in your lineup twice.`);
      seen.add(p.id);
      perTeam[p.team_id] = (perTeam[p.team_id] || 0) + 1;
      if (game.maxPerTeam && perTeam[p.team_id] > game.maxPerTeam) {
        const t = db.prepare('SELECT name FROM teams WHERE id = ?').get(p.team_id);
        throw bad(`You can pick at most ${game.maxPerTeam} players from ${t.name}.`);
      }
      salary += p.salary * mult;
      rows.push([slot.id, p.id, null]);
    }
  }
  salary = Math.round(salary);
  if (salary > game.salaryCap) throw bad(`Lineup costs $${salary.toLocaleString()} — over the $${game.salaryCap.toLocaleString()} cap.`);
  tx(() => {
    db.prepare('DELETE FROM lineups WHERE league_id = ? AND user_id = ? AND week_id = ?').run(league.id, ctx.user.id, week.id);
    const ins = db.prepare('INSERT INTO lineups (league_id, user_id, week_id, slot, player_id, team_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [slot, pid, tid] of rows) ins.run(league.id, ctx.user.id, week.id, slot, pid, tid);
  });
  return { ok: true, week: week.number, salary, filled: rows.length };
});

// ---------- dev: simulate matches ----------
// In production, weeks would be closed by a real stats import instead.
on('POST', '/admin/simulate', { auth: true }, (ctx) => {
  if (!ALLOW_SIM) throw new HttpError(403, 'Simulation is disabled.');
  const game = gameFrom(ctx);
  const played = simulateCurrentWeek(game.id);
  return { simulated: played, currentWeek: currentWeek(game.id)?.number ?? null };
});

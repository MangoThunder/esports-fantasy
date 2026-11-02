// The whole API, with no web framework. It runs in two places:
//   - Node: server/index.js wraps it in Express.
//   - Browser (GitHub Pages): public/transport.js is swapped for web/transport.js, which calls it directly.
import { db, tx } from './db.js';
import { randomHex, hashPassword, checkPassword } from './crypto.js';
import { seedIfEmpty } from './seed.js';
import { simulateCurrentWeek, currentWeek } from './sim.js';
import { SALARY_CAP, SLOTS, ROLES, PLAYER_RULES, TEAM_RULES } from './scoring.js';

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

on('GET', '/me', (ctx) => {
  const totalWeeks = db.prepare('SELECT COUNT(*) AS n FROM weeks').get().n;
  return { user: ctx.user, currentWeek: currentWeek(), totalWeeks, allowSim: ALLOW_SIM };
});

on('GET', '/rules', () => ({ SALARY_CAP, SLOTS, ROLES, PLAYER_RULES, TEAM_RULES }));

// ---------- esports data ----------
const WEEK_PLAYER_PTS = `
  SELECT m.week, ps.player_id, SUM(ps.points) AS pts
  FROM player_stats ps JOIN matches m ON m.id = ps.match_id GROUP BY m.week, ps.player_id`;
const WEEK_TEAM_PTS = `
  SELECT m.week, ts.team_id, SUM(ts.points) AS pts
  FROM team_stats ts JOIN matches m ON m.id = ts.match_id GROUP BY m.week, ts.team_id`;

function opponentsFor(week) {
  const map = {};
  if (week == null) return map;
  for (const m of db.prepare('SELECT team_a, team_b FROM matches WHERE week = ?').all(week)) {
    map[m.team_a] = m.team_b;
    map[m.team_b] = m.team_a;
  }
  return map;
}

on('GET', '/players', () => {
  const rows = db.prepare(`
    SELECT p.id, p.handle, p.role, p.salary, p.team_id, t.name AS team_name, t.tag AS team_tag, t.color AS team_color,
           COUNT(ps.match_id) AS games,
           COALESCE(SUM(ps.points), 0) AS total_pts,
           COALESCE(AVG(ps.points), 0) AS avg_pts,
           COALESCE(AVG(ps.kills), 0) AS avg_k, COALESCE(AVG(ps.deaths), 0) AS avg_d,
           COALESCE(AVG(ps.assists), 0) AS avg_a, COALESCE(AVG(ps.cs), 0) AS avg_cs
    FROM players p JOIN teams t ON t.id = p.team_id
    LEFT JOIN player_stats ps ON ps.player_id = p.id
    GROUP BY p.id ORDER BY p.salary DESC`).all();
  const opp = opponentsFor(currentWeek());
  const tags = Object.fromEntries(db.prepare('SELECT id, tag FROM teams').all().map((t) => [t.id, t.tag]));
  return rows.map((r) => ({ ...r, opponent: tags[opp[r.team_id]] || null }));
});

on('GET', '/teams', () => {
  const rows = db.prepare(`
    SELECT t.id, t.name, t.tag, t.color, t.salary,
           COUNT(ts.match_id) AS games, COALESCE(SUM(ts.won), 0) AS wins,
           COALESCE(AVG(ts.points), 0) AS avg_pts, COALESCE(SUM(ts.points), 0) AS total_pts
    FROM teams t LEFT JOIN team_stats ts ON ts.team_id = t.id
    GROUP BY t.id ORDER BY wins DESC, total_pts DESC`).all();
  const opp = opponentsFor(currentWeek());
  const tags = Object.fromEntries(rows.map((t) => [t.id, t.tag]));
  return rows.map((r) => ({ ...r, opponent: tags[opp[r.id]] || null }));
});

on('GET', '/schedule', () => {
  const weeks = db.prepare('SELECT * FROM weeks ORDER BY id').all();
  const matches = db.prepare(`
    SELECT m.*, ta.tag AS tag_a, ta.color AS color_a, tb.tag AS tag_b, tb.color AS color_b
    FROM matches m JOIN teams ta ON ta.id = m.team_a JOIN teams tb ON tb.id = m.team_b ORDER BY m.id`).all();
  return weeks.map((w) => ({ ...w, matches: matches.filter((m) => m.week === w.id) }));
});

on('GET', '/matches/:id', (ctx) => {
  const m = db.prepare(`
    SELECT m.*, ta.name AS name_a, ta.tag AS tag_a, ta.color AS color_a, tb.name AS name_b, tb.tag AS tag_b, tb.color AS color_b
    FROM matches m JOIN teams ta ON ta.id = m.team_a JOIN teams tb ON tb.id = m.team_b WHERE m.id = ?`).get(Number(ctx.params.id));
  if (!m) throw new HttpError(404, 'Match not found.');
  const players = db.prepare(`
    SELECT ps.*, p.handle, p.role, p.team_id FROM player_stats ps JOIN players p ON p.id = ps.player_id
    WHERE ps.match_id = ? ORDER BY p.team_id, p.id`).all(m.id);
  const teams = db.prepare('SELECT * FROM team_stats WHERE match_id = ?').all(m.id);
  return { ...m, players, teams };
});

// ---------- leagues ----------
const memberOf = (leagueId, userId) =>
  db.prepare('SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?').get(leagueId, userId);

function requireLeague(ctx) {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(Number(ctx.params.id));
  if (!league) throw new HttpError(404, 'League not found.');
  if (!memberOf(league.id, ctx.user.id)) throw new HttpError(403, 'You are not in this league.');
  return league;
}

const inviteCode = () => randomHex(3).toUpperCase();

on('GET', '/leagues', { auth: true }, (ctx) => db.prepare(`
    SELECT l.id, l.name, l.invite_code, l.owner_id,
           (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) AS members
    FROM leagues l JOIN league_members lm ON lm.league_id = l.id
    WHERE lm.user_id = ? ORDER BY l.created_at DESC, l.id DESC`).all(ctx.user.id));

on('POST', '/leagues', { auth: true }, (ctx) => {
  const name = String(ctx.body.name || '').trim();
  if (name.length < 2 || name.length > 40) throw bad('League name must be 2–40 characters.');
  const id = tx(() => {
    const leagueId = Number(db.prepare('INSERT INTO leagues (name, invite_code, owner_id) VALUES (?, ?, ?)')
      .run(name, inviteCode(), ctx.user.id).lastInsertRowid);
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
  const league = requireLeague(ctx);
  const members = db.prepare(`
    SELECT u.id, u.username FROM league_members lm JOIN users u ON u.id = lm.user_id
    WHERE lm.league_id = ? ORDER BY lm.joined_at`).all(league.id);
  const weekly = db.prepare(`
    WITH wpp AS (${WEEK_PLAYER_PTS}), wtp AS (${WEEK_TEAM_PTS})
    SELECT l.user_id, l.week, ROUND(SUM(COALESCE(wpp.pts, wtp.pts, 0)), 2) AS pts
    FROM lineups l
    JOIN weeks w ON w.id = l.week AND w.status = 'complete'
    LEFT JOIN wpp ON wpp.week = l.week AND wpp.player_id = l.player_id
    LEFT JOIN wtp ON wtp.week = l.week AND wtp.team_id = l.team_id
    WHERE l.league_id = ? GROUP BY l.user_id, l.week`).all(league.id);
  const completeWeeks = db.prepare("SELECT id FROM weeks WHERE status = 'complete' ORDER BY id").all().map((w) => w.id);
  const cw = currentWeek();
  const setLineup = new Set(db.prepare('SELECT DISTINCT user_id FROM lineups WHERE league_id = ? AND week = ?')
    .all(league.id, cw ?? -1).map((r) => r.user_id));

  const standings = members.map((m) => {
    const byWeek = Object.fromEntries(completeWeeks.map((w) => [w, 0]));
    for (const r of weekly) if (r.user_id === m.id) byWeek[r.week] = r.pts;
    const total = Object.values(byWeek).reduce((a, b) => a + b, 0);
    const weekWins = completeWeeks.filter((w) => {
      const best = Math.max(...members.map((o) => weekly.find((r) => r.user_id === o.id && r.week === w)?.pts ?? 0));
      return best > 0 && byWeek[w] === best;
    }).length;
    return { ...m, byWeek, total: Math.round(total * 100) / 100, weekWins, lineupSet: setLineup.has(m.id) };
  }).sort((a, b) => b.total - a.total);

  return { ...league, isOwner: league.owner_id === ctx.user.id, members, standings, completeWeeks, currentWeek: cw };
});

// Lineup for a week. Your own lineup is always visible; others' only after the week is complete.
on('GET', '/leagues/:id/lineup', { auth: true }, (ctx) => {
  const league = requireLeague(ctx);
  const cw = currentWeek();
  const week = ctx.query.week ? Number(ctx.query.week) : cw;
  const userId = ctx.query.user ? Number(ctx.query.user) : ctx.user.id;
  const weekRow = db.prepare('SELECT * FROM weeks WHERE id = ?').get(week);
  if (!weekRow) throw bad('Unknown week.');
  if (userId !== ctx.user.id && weekRow.status !== 'complete') throw new HttpError(403, 'Lineups are hidden until the week is complete.');

  const load = (w) => db.prepare('SELECT slot, player_id, team_id FROM lineups WHERE league_id = ? AND user_id = ? AND week = ?')
    .all(league.id, userId, w);
  let rows = load(week);
  let prefilledFrom = null;
  if (!rows.length && week === cw && userId === ctx.user.id) {
    const prev = db.prepare('SELECT MAX(week) AS w FROM lineups WHERE league_id = ? AND user_id = ? AND week < ?')
      .get(league.id, userId, week).w;
    if (prev) { rows = load(prev); prefilledFrom = prev; }
  }
  const pts = (r) => {
    if (weekRow.status !== 'complete' || prefilledFrom) return null;
    const q = r.player_id
      ? db.prepare('SELECT SUM(ps.points) AS p FROM player_stats ps JOIN matches m ON m.id = ps.match_id WHERE m.week = ? AND ps.player_id = ?').get(week, r.player_id)
      : db.prepare('SELECT SUM(ts.points) AS p FROM team_stats ts JOIN matches m ON m.id = ts.match_id WHERE m.week = ? AND ts.team_id = ?').get(week, r.team_id);
    return q.p ?? 0;
  };
  const slots = Object.fromEntries(rows.map((r) => [r.slot, { player_id: r.player_id, team_id: r.team_id, points: pts(r) }]));
  return { week, status: weekRow.status, editable: week === cw && userId === ctx.user.id, prefilledFrom, slots };
});

on('PUT', '/leagues/:id/lineup', { auth: true }, (ctx) => {
  const league = requireLeague(ctx);
  const week = currentWeek();
  if (week == null) throw bad('The season is over.');
  const input = ctx.body.slots || {};
  const seen = new Set();
  let salary = 0;
  const rows = [];
  for (const slot of SLOTS) {
    const id = input[slot];
    if (id == null || id === '') continue;
    if (slot === 'TEAM') {
      const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(Number(id));
      if (!t) throw bad('Unknown team.');
      salary += t.salary;
      rows.push([slot, null, t.id]);
    } else {
      const p = db.prepare('SELECT * FROM players WHERE id = ?').get(Number(id));
      if (!p) throw bad(`Unknown player in ${slot}.`);
      if (slot !== 'FLEX' && p.role !== slot) throw bad(`${p.handle} is a ${p.role}, not a ${slot}.`);
      if (seen.has(p.id)) throw bad(`${p.handle} is in your lineup twice.`);
      seen.add(p.id);
      salary += p.salary;
      rows.push([slot, p.id, null]);
    }
  }
  if (salary > SALARY_CAP) throw bad(`Lineup costs $${salary.toLocaleString()} — over the $${SALARY_CAP.toLocaleString()} cap.`);
  tx(() => {
    db.prepare('DELETE FROM lineups WHERE league_id = ? AND user_id = ? AND week = ?').run(league.id, ctx.user.id, week);
    const ins = db.prepare('INSERT INTO lineups (league_id, user_id, week, slot, player_id, team_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [slot, pid, tid] of rows) ins.run(league.id, ctx.user.id, week, slot, pid, tid);
  });
  return { ok: true, week, salary, filled: rows.length };
});

// ---------- dev: simulate matches ----------
// In production, weeks would be closed by a real stats import instead.
on('POST', '/admin/simulate', { auth: true }, () => {
  if (!ALLOW_SIM) throw new HttpError(403, 'Simulation is disabled.');
  const week = simulateCurrentWeek();
  return { simulated: week, currentWeek: currentWeek() };
});

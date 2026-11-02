import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, tx } from './db.js';
import { seedIfEmpty } from './seed.js';
import { simulateCurrentWeek, currentWeek } from './sim.js';
import { SALARY_CAP, SLOTS, ROLES, PLAYER_RULES, TEAM_RULES } from './scoring.js';

seedIfEmpty();

const app = express();
app.use(express.json());
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

// ---------- auth ----------
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
};
const checkPassword = (pw, stored) => {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
};
const cookies = (req) => Object.fromEntries(
  (req.headers.cookie || '').split(';').filter(Boolean).map((c) => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }),
);
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
}
app.use((req, _res, next) => {
  const sid = cookies(req).sid;
  req.user = sid
    ? db.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(sid)
    : null;
  next();
});
const auth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in.')));

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username || '')) throw bad('Username must be 3–20 letters, numbers or _.');
  if (typeof password !== 'string' || password.length < 6) throw bad('Password must be at least 6 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('That username is taken.');
  const { lastInsertRowid } = db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run(username, hashPassword(password));
  startSession(res, Number(lastInsertRowid));
  res.json({ id: Number(lastInsertRowid), username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!u || !checkPassword(String(password || ''), u.pass_hash)) throw new HttpError(401, 'Wrong username or password.');
  startSession(res, u.id);
  res.json({ id: u.id, username: u.username });
});

app.post('/api/logout', (req, res) => {
  const sid = cookies(req).sid;
  if (sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const totalWeeks = db.prepare('SELECT COUNT(*) AS n FROM weeks').get().n;
  res.json({ user: req.user, currentWeek: currentWeek(), totalWeeks, allowSim: ALLOW_SIM });
});

app.get('/api/rules', (_req, res) => res.json({ SALARY_CAP, SLOTS, ROLES, PLAYER_RULES, TEAM_RULES }));

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

app.get('/api/players', (_req, res) => {
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
  res.json(rows.map((r) => ({ ...r, opponent: tags[opp[r.team_id]] || null })));
});

app.get('/api/teams', (_req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.name, t.tag, t.color, t.salary,
           COUNT(ts.match_id) AS games, COALESCE(SUM(ts.won), 0) AS wins,
           COALESCE(AVG(ts.points), 0) AS avg_pts, COALESCE(SUM(ts.points), 0) AS total_pts
    FROM teams t LEFT JOIN team_stats ts ON ts.team_id = t.id
    GROUP BY t.id ORDER BY wins DESC, total_pts DESC`).all();
  const opp = opponentsFor(currentWeek());
  const tags = Object.fromEntries(rows.map((t) => [t.id, t.tag]));
  res.json(rows.map((r) => ({ ...r, opponent: tags[opp[r.id]] || null })));
});

app.get('/api/schedule', (_req, res) => {
  const weeks = db.prepare('SELECT * FROM weeks ORDER BY id').all();
  const matches = db.prepare(`
    SELECT m.*, ta.tag AS tag_a, ta.color AS color_a, tb.tag AS tag_b, tb.color AS color_b
    FROM matches m JOIN teams ta ON ta.id = m.team_a JOIN teams tb ON tb.id = m.team_b ORDER BY m.id`).all();
  res.json(weeks.map((w) => ({ ...w, matches: matches.filter((m) => m.week === w.id) })));
});

app.get('/api/matches/:id', (req, res) => {
  const m = db.prepare(`
    SELECT m.*, ta.name AS name_a, ta.tag AS tag_a, ta.color AS color_a, tb.name AS name_b, tb.tag AS tag_b, tb.color AS color_b
    FROM matches m JOIN teams ta ON ta.id = m.team_a JOIN teams tb ON tb.id = m.team_b WHERE m.id = ?`).get(req.params.id);
  if (!m) throw new HttpError(404, 'Match not found.');
  const players = db.prepare(`
    SELECT ps.*, p.handle, p.role, p.team_id FROM player_stats ps JOIN players p ON p.id = ps.player_id
    WHERE ps.match_id = ? ORDER BY p.team_id, p.id`).all(m.id);
  const teams = db.prepare('SELECT * FROM team_stats WHERE match_id = ?').all(m.id);
  res.json({ ...m, players, teams });
});

// ---------- leagues ----------
const memberOf = (leagueId, userId) =>
  db.prepare('SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?').get(leagueId, userId);

function requireLeague(req) {
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) throw new HttpError(404, 'League not found.');
  if (!memberOf(league.id, req.user.id)) throw new HttpError(403, 'You are not in this league.');
  return league;
}

const inviteCode = () => crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);

app.get('/api/leagues', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT l.id, l.name, l.invite_code, l.owner_id,
           (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) AS members
    FROM leagues l JOIN league_members lm ON lm.league_id = l.id
    WHERE lm.user_id = ? ORDER BY l.created_at DESC`).all(req.user.id));
});

app.post('/api/leagues', auth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2 || name.length > 40) throw bad('League name must be 2–40 characters.');
  const id = tx(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO leagues (name, invite_code, owner_id) VALUES (?, ?, ?)')
      .run(name, inviteCode(), req.user.id);
    db.prepare('INSERT INTO league_members (league_id, user_id) VALUES (?, ?)').run(lastInsertRowid, req.user.id);
    return Number(lastInsertRowid);
  });
  res.json({ id });
});

app.post('/api/leagues/join', auth, (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const league = db.prepare('SELECT * FROM leagues WHERE invite_code = ?').get(code);
  if (!league) throw bad('No league with that invite code.');
  db.prepare('INSERT OR IGNORE INTO league_members (league_id, user_id) VALUES (?, ?)').run(league.id, req.user.id);
  res.json({ id: league.id });
});

app.get('/api/leagues/:id', auth, (req, res) => {
  const league = requireLeague(req);
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

  res.json({ ...league, isOwner: league.owner_id === req.user.id, members, standings, completeWeeks, currentWeek: cw });
});

// Lineup for a week. Your own lineup is always visible; others' only after the week is complete.
app.get('/api/leagues/:id/lineup', auth, (req, res) => {
  const league = requireLeague(req);
  const cw = currentWeek();
  const week = req.query.week ? Number(req.query.week) : cw;
  const userId = req.query.user ? Number(req.query.user) : req.user.id;
  const weekRow = db.prepare('SELECT * FROM weeks WHERE id = ?').get(week);
  if (!weekRow) throw bad('Unknown week.');
  if (userId !== req.user.id && weekRow.status !== 'complete') throw new HttpError(403, 'Lineups are hidden until the week is complete.');

  const load = (w) => db.prepare('SELECT slot, player_id, team_id FROM lineups WHERE league_id = ? AND user_id = ? AND week = ?')
    .all(league.id, userId, w);
  let rows = load(week);
  let prefilledFrom = null;
  if (!rows.length && week === cw && userId === req.user.id) {
    const prev = db.prepare('SELECT MAX(week) AS w FROM lineups WHERE league_id = ? AND user_id = ? AND week < ?')
      .get(league.id, userId, week).w;
    if (prev) { rows = load(prev); prefilledFrom = prev; }
  }
  const pts = (r) => {
    if (weekRow.status !== 'complete' || prefilledFrom) return null;
    const q = r.player_id
      ? db.prepare(`SELECT SUM(ps.points) AS p FROM player_stats ps JOIN matches m ON m.id = ps.match_id WHERE m.week = ? AND ps.player_id = ?`).get(week, r.player_id)
      : db.prepare(`SELECT SUM(ts.points) AS p FROM team_stats ts JOIN matches m ON m.id = ts.match_id WHERE m.week = ? AND ts.team_id = ?`).get(week, r.team_id);
    return q.p ?? 0;
  };
  const slots = Object.fromEntries(rows.map((r) => [r.slot, { player_id: r.player_id, team_id: r.team_id, points: pts(r) }]));
  res.json({ week, status: weekRow.status, editable: week === cw && userId === req.user.id, prefilledFrom, slots });
});

app.put('/api/leagues/:id/lineup', auth, (req, res) => {
  const league = requireLeague(req);
  const week = currentWeek();
  if (week == null) throw bad('The season is over.');
  const input = req.body?.slots || {};
  const seen = new Set();
  let salary = 0;
  const rows = [];
  for (const slot of SLOTS) {
    const id = input[slot];
    if (id == null || id === '') continue;
    if (slot === 'TEAM') {
      const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
      if (!t) throw bad('Unknown team.');
      salary += t.salary;
      rows.push([slot, null, t.id]);
    } else {
      const p = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
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
    db.prepare('DELETE FROM lineups WHERE league_id = ? AND user_id = ? AND week = ?').run(league.id, req.user.id, week);
    const ins = db.prepare('INSERT INTO lineups (league_id, user_id, week, slot, player_id, team_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [slot, pid, tid] of rows) ins.run(league.id, req.user.id, week, slot, pid, tid);
  });
  res.json({ ok: true, week, salary, filled: rows.length });
});

// ---------- dev: simulate matches ----------
// In production, weeks would be closed by a real stats import instead.
const ALLOW_SIM = process.env.ALLOW_SIM !== '0';
app.post('/api/admin/simulate', auth, (_req, res) => {
  if (!ALLOW_SIM) throw new HttpError(403, 'Simulation is disabled.');
  const week = simulateCurrentWeek();
  res.json({ simulated: week, currentWeek: currentWeek() });
});

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));
app.use((err, _req, res, _next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong.' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Esports fantasy running at http://localhost:${PORT}`));

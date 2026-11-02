// Fragline Fantasy — single-page frontend (no build step).
import { request, MODE, resetData } from './transport.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const app = $('#app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Math.round(Number(n)).toLocaleString();
const fmt = (n, d = 1) => Number(n).toFixed(d);
const signed = (n) => (n > 0 ? '+' : '') + n;

async function api(path, opts = {}) {
  const { status, data } = await request(opts.method || 'GET', path, opts.body);
  if (status >= 400) throw new Error(data.error || `Request failed (${status})`);
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}
function modal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal' || e.target.classList.contains('modal-x')) $('#modal').classList.add('hidden');
});

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// ---------- global state ----------
const state = { me: null, games: [], game: store.get('fragline.game'), pools: {} };
const gameById = (id) => state.games.find((g) => g.id === id);
const currentGame = () => gameById(state.game) || state.games[0];
function setGame(id) { state.game = id; store.set('fragline.game', id); }

async function refreshMe() { state.me = await api('/me'); }
async function refreshGames() { state.games = await api('/games'); }
async function loadPool(gameId, force = false) {
  if (!state.pools[gameId] || force) {
    const [players, teams] = await Promise.all([api(`/players?game=${gameId}`), api(`/teams?game=${gameId}`)]);
    state.pools[gameId] = { players, teams };
  }
  return state.pools[gameId];
}

const gameBadge = (g) => `<span class="game-badge" style="--gc:${g.color}">${esc(g.short)}</span>`;
const teamTag = (tag, color) => `<span class="tag" style="color:${color}">${esc(tag)}</span>`;

/** Play the current week for a game (demo tool), then refresh. */
async function playWeek(gameId, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api('/admin/simulate', { method: 'POST', body: { game: gameId } });
    toast(`${gameById(gameId).name} week ${r.simulated} played. Scores are in!`);
    await Promise.all([refreshGames(), loadPool(gameId, true)]);
    route_();
  } catch (err) { toast(err.message, true); if (btn) btn.disabled = false; }
}
const playButton = (g) => (state.me.allowSim && g.currentWeek
  ? `<button class="small" data-play="${g.id}" title="Demo tool: simulates every series this week">▶ Play week ${g.currentWeek}</button>` : '');
function wirePlayButtons() {
  $$('[data-play]', app).forEach((b) => b.addEventListener('click', () => playWeek(b.dataset.play, b)));
}

/** Tabs for switching game on the Players / Schedule / Scoring pages. */
function gameTabs() {
  const g = currentGame();
  return `<div class="game-tabs">${state.games.map((x) => `<button class="${x.id === g.id ? 'active' : ''}" data-game="${x.id}" style="--gc:${x.color}">${esc(x.name)}</button>`).join('')}</div>`;
}
function wireGameTabs() {
  $$('[data-game]', app).forEach((b) => b.addEventListener('click', () => { setGame(b.dataset.game); route_(); }));
}

function renderHeader() {
  const { user } = state.me;
  const route = location.hash.replace(/^#\/?/, '').split('/')[0];
  const link = (href, label, keys) => `<a href="#/${href}" class="${keys.includes(route) ? 'active' : ''}">${label}</a>`;
  $('#nav').innerHTML = user
    ? link('', 'Leagues', ['', 'league']) + link('players', 'Players', ['players']) + link('schedule', 'Schedule', ['schedule']) + link('rules', 'Scoring', ['rules'])
    : link('rules', 'Scoring', ['rules']);
  $('#session').innerHTML = user
    ? `<span class="muted">${esc(user.username)}</span><button class="small ghost" id="logout">Log out</button>`
    : '';
  $('#logout')?.addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    state.me.user = null; // update before navigating so no view renders as the old user
    if (location.hash.replace(/^#\/?/, '')) location.hash = '#/'; else route_();
  });
}

// ---------- views ----------
function viewAuth() {
  let mode = 'login';
  app.innerHTML = `
    <div class="auth panel">
      <h1>Draft the pros.<br>Win the week.</h1>
      <p class="muted">Fantasy esports for ${state.games.map((g) => esc(g.name)).join(' and ')}, with real pro rosters and salary-cap lineups. Pick a captain, four players and a team, then beat your friends.</p>
      <div class="tabs"><button data-m="login" class="active">Log in</button><button data-m="register">Sign up</button></div>
      <form>
        <div><label>Username</label><input name="username" autocomplete="username" required></div>
        <div><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
        <div class="error"></div>
        <button class="primary" style="width:100%">Log in</button>
      </form>
    </div>`;
  const form = $('form', app);
  $$('.tabs button', app).forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.m;
    $$('.tabs button', app).forEach((x) => x.classList.toggle('active', x === b));
    $('button.primary', form).textContent = mode === 'login' ? 'Log in' : 'Create account';
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/' + mode, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      await refreshMe();
      route_();
    } catch (err) { $('.error', form).textContent = err.message; }
  });
}

async function viewHome() {
  const leagues = await api('/leagues');
  app.innerHTML = `
    <div class="stack">
      <div class="panel hero">
        <h1>Fantasy esports, every week</h1>
        <p>Make a league for ${state.games.map((g) => esc(g.name)).join(' or ')} and invite your friends. Each week you get a salary cap to pick a captain, four pros and a team, and they score points from their series.</p>
        <div class="game-cards">${state.games.map((g) => `
          <div class="game-card" style="--gc:${g.color}">
            <div class="row spread">${gameBadge(g)}<span class="pill ${g.currentWeek ? 'live' : 'done'}">${g.currentWeek ? `Week ${g.currentWeek} of ${g.totalWeeks}` : 'Season complete'}</span></div>
            <b>${esc(g.name)}</b>
            <small class="muted">Rosters as of ${esc(g.asOf)}</small>
          </div>`).join('')}</div>
      </div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Your leagues</h2>
          ${leagues.length ? `<div class="grid">${leagues.map((l) => {
            const g = gameById(l.game);
            return `<a class="league-card" href="#/league/${l.id}">
              <div class="row spread"><span class="row" style="gap:8px">${gameBadge(g)}<b>${esc(l.name)}</b></span><span class="muted">${l.members} member${l.members === 1 ? '' : 's'}</span></div>
              <small class="muted">Invite code <span class="mono">${l.invite_code}</span> · ${g.currentWeek ? `week ${g.currentWeek} lineups open` : 'season complete'}</small>
            </a>`;
          }).join('')}</div>` : '<p class="muted">You aren\'t in any leagues yet. Create one or join with a code.</p>'}
        </div>
        <div class="panel stack">
          <form id="create"><h2>Create a league</h2>
            <div class="seg">${state.games.map((g, i) => `<label style="--gc:${g.color}"><input type="radio" name="game" value="${g.id}" ${(g.id === currentGame().id || (!currentGame() && !i)) ? 'checked' : ''}><span>${esc(g.name)}</span></label>`).join('')}</div>
            <div class="row" style="margin-top:10px"><input name="name" placeholder="League name" required maxlength="40" style="flex:1"><button class="primary">Create</button></div>
          </form>
          <form id="join"><h2>Join a league</h2>
            <div class="row"><input name="code" placeholder="Invite code" required maxlength="6" class="mono" style="flex:1;text-transform:uppercase"><button>Join</button></div>
          </form>
        </div>
      </div>
    </div>`;
  $('#create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try { const r = await api('/leagues', { method: 'POST', body }); setGame(body.game); location.hash = `#/league/${r.id}`; }
    catch (err) { toast(err.message, true); }
  });
  $('#join').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('/leagues/join', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); location.hash = `#/league/${r.id}`; }
    catch (err) { toast(err.message, true); }
  });
}

async function viewLeague(id) {
  const L = await api(`/leagues/${id}`);
  const g = gameById(L.game);
  setGame(g.id);
  const me = state.me.user.id;
  const weeks = L.completeWeeks;
  app.innerHTML = `
    <div class="stack">
      <div class="row spread">
        <div>
          <div class="row" style="gap:8px">${gameBadge(g)}<span class="muted">${L.currentWeek ? `Week ${L.currentWeek} of ${L.totalWeeks}` : 'Season complete'}</span></div>
          <h1 style="margin-top:6px">${esc(L.name)}</h1>
          <span class="muted">Invite friends with code <b class="mono" style="color:var(--text)">${L.invite_code}</b></span>
          <button class="small ghost" id="copy">Copy</button>
        </div>
        <div class="row">${playButton(g)}
          ${L.currentWeek ? `<a href="#/league/${L.id}/lineup"><button class="primary">Set week ${L.currentWeek} lineup</button></a>` : ''}</div>
      </div>
      <div class="panel">
        <h2>Standings</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Manager</th>${weeks.map((w) => `<th class="num">W${w}</th>`).join('')}<th class="num">Week wins</th><th class="num">Total</th>
            ${L.currentWeek ? `<th>W${L.currentWeek} lineup</th>` : ''}</tr></thead>
          <tbody>${L.standings.map((s, i) => `
            <tr class="${s.id === me ? 'me' : ''}">
              <td class="mono">${i + 1}</td><td><b>${esc(s.username)}</b></td>
              ${weeks.map((w) => `<td class="num clickable" data-user="${s.id}" data-week="${w}" title="View lineup">${fmt(s.byWeek[w])}</td>`).join('')}
              <td class="num">${s.weekWins}</td><td class="num"><b>${fmt(s.total)}</b></td>
              ${L.currentWeek ? `<td>${s.lineupSet ? '<span class="pill live">Set</span>' : '<span class="pill">Not set</span>'}</td>` : ''}
            </tr>`).join('')}</tbody>
        </table></div>
        <p class="muted" style="margin-bottom:0">${weeks.length ? 'Click a weekly score to see that lineup. ' : 'No weeks have been played yet. '}If you don't change your lineup, last week's carries over.</p>
      </div>
    </div>`;
  wirePlayButtons();
  $('#copy').addEventListener('click', () => navigator.clipboard?.writeText(L.invite_code).then(() => toast('Invite code copied')));
  $$('td.clickable', app).forEach((td) => td.addEventListener('click', async () => {
    const pool = await loadPool(g.id);
    const lu = await api(`/leagues/${id}/lineup?week=${td.dataset.week}&user=${td.dataset.user}`);
    const who = L.standings.find((s) => s.id === Number(td.dataset.user)).username;
    modal(`<h2>${esc(who)} · Week ${lu.week}</h2>${lineupTable(g, pool, lu.slots)}`);
  }));
}

function lineupTable(g, pool, slots) {
  const rows = g.slots.map((slot) => {
    const s = slots[slot.id];
    const label = `<span class="role ${slot.id === 'CPT' ? 'CPT' : slot.kind === 'team' ? 'TEAM' : ''}">${slot.label}</span>`;
    if (!s) return `<tr><td>${label}</td><td class="muted">Empty</td><td></td><td class="num">0.0</td></tr>`;
    const p = s.player_id ? pool.players.find((x) => x.id === s.player_id) : null;
    const t = s.team_id ? pool.teams.find((x) => x.id === s.team_id) : null;
    return `<tr><td>${label}</td><td><b>${esc(p ? p.handle : t.name)}</b></td>
      <td>${p ? teamTag(p.team_tag, p.team_color) : teamTag(t.tag, t.color)}</td><td class="num">${fmt(s.points ?? 0)}</td></tr>`;
  }).join('');
  const total = Object.values(slots).reduce((a, s) => a + (s.points || 0), 0);
  return `<table><tbody>${rows}</tbody><tfoot><tr><td colspan="3"><b>Total</b></td><td class="num"><b>${fmt(total)}</b></td></tr></tfoot></table>`;
}

async function viewLineup(id) {
  const [L, lu] = await Promise.all([api(`/leagues/${id}`), api(`/leagues/${id}/lineup`)]);
  if (!lu.editable) { location.hash = `#/league/${id}`; return; }
  const g = gameById(L.game);
  const pool = await loadPool(g.id);
  const playerSlots = g.slots.filter((s) => s.kind === 'player');
  const teamSlot = g.slots.find((s) => s.kind === 'team');
  const mult = (slotId) => g.slots.find((s) => s.id === slotId)?.multiplier ?? 1;

  const picks = {}; // slotId -> player or team
  for (const [slot, s] of Object.entries(lu.slots)) {
    picks[slot] = s.player_id ? pool.players.find((p) => p.id === s.player_id) : pool.teams.find((t) => t.id === s.team_id);
    if (!picks[slot]) delete picks[slot];
  }
  let view = 'players', search = '', sortKey = 'salary', sortDir = -1, target = null;
  let dirty = !!lu.prefilledFrom;

  const cost = (slotId, x) => (x ? x.salary * mult(slotId) : 0);
  const spent = () => Object.entries(picks).reduce((a, [s, x]) => a + cost(s, x), 0);
  const pickedIds = () => new Set(playerSlots.map((s) => picks[s.id]?.id).filter(Boolean));
  const fromTeam = (teamId, exceptSlot) => playerSlots.filter((s) => s.id !== exceptSlot && picks[s.id]?.team_id === teamId).length;
  // Where a newly added player goes: the selected slot, else the first empty one (captain last).
  const slotFor = () => {
    if (target && playerSlots.some((s) => s.id === target)) return target;
    const open = playerSlots.filter((s) => !picks[s.id]);
    return (open.find((s) => !s.multiplier) || open[0])?.id ?? null;
  };

  app.innerHTML = `
    <div class="row spread" style="margin-bottom:16px">
      <div><a href="#/league/${id}">← ${esc(L.name)}</a>
        <h1 style="margin-top:6px">Week ${lu.week} lineup</h1>
        <div class="row" style="gap:8px">${gameBadge(g)}<span class="muted">Max ${g.maxPerTeam} players from one team · Captain scores 1.5×</span></div></div>
      ${lu.prefilledFrom ? `<span class="pill">Copied from week ${lu.prefilledFrom}</span>` : ''}
    </div>
    <div class="builder">
      <div class="panel lineup-panel">
        <div class="row spread"><b>Salary</b><span class="mono" id="cap"></span></div>
        <div class="cap-bar" id="capbar"><div></div></div>
        <small class="muted" id="avg"></small>
        <div id="slots"></div>
        <div class="row" style="margin-top:16px">
          <button class="primary" id="save" style="flex:1">Save lineup</button>
          <button class="ghost" id="clear">Clear</button>
        </div>
      </div>
      <div class="panel">
        <div class="filters" id="filters"></div>
        <div class="table-wrap"><table id="pool"></table></div>
      </div>
    </div>`;

  function renderSlots() {
    const used = spent(), left = g.salaryCap - used;
    const empty = g.slots.filter((s) => !picks[s.id]).length;
    $('#cap').innerHTML = `${money(used)} / ${money(g.salaryCap)}`;
    $('#capbar').classList.toggle('over', used > g.salaryCap);
    $('#capbar > div').style.width = Math.min(100, (used / g.salaryCap) * 100) + '%';
    $('#avg').innerHTML = used > g.salaryCap
      ? `<span style="color:var(--bad)">${money(-left)} over the cap</span>`
      : empty ? `${money(left)} left · ${money(Math.floor(left / empty))} per open slot` : `${money(left)} left · lineup full`;
    $('#slots').innerHTML = g.slots.map((slot) => {
      const x = picks[slot.id];
      const isTeam = slot.kind === 'team';
      const cls = slot.id === 'CPT' ? 'CPT' : isTeam ? 'TEAM' : '';
      return `<div class="slot ${x ? 'filled' : ''} ${target === slot.id ? 'target' : ''} ${slot.multiplier ? 'captain' : ''}" data-slot="${slot.id}">
        <span class="role ${cls}">${slot.id === 'CPT' ? 'CPT' : isTeam ? 'TEAM' : 'PLAYER'}</span>
        <div class="who">${x
          ? `<b>${esc(isTeam ? x.name : x.handle)}</b><small>${isTeam ? teamTag(x.tag, x.color) : teamTag(x.team_tag, x.team_color)} ${x.opponent ? 'vs ' + esc(x.opponent) : ''} · ${money(cost(slot.id, x))}</small>`
          : `<small>${slot.hint ? esc(slot.label) + ': ' + esc(slot.hint) : isTeam ? 'Pick a team' : 'Pick a player'}</small>`}</div>
        <span class="slot-actions">
          ${x && !isTeam && !slot.multiplier && playerSlots.some((s) => s.multiplier) ? `<button class="x cpt" data-cpt="${slot.id}" title="Make captain">C</button>` : ''}
          ${x ? `<button class="x" data-remove="${slot.id}" title="Remove">×</button>` : ''}
        </span>
      </div>`;
    }).join('');
    $$('#slots .slot').forEach((el) => el.addEventListener('click', (e) => {
      const { remove, cpt } = e.target.dataset;
      if (remove) { delete picks[remove]; dirty = true; }
      else if (cpt) {
        const cap = playerSlots.find((s) => s.multiplier).id;
        [picks[cap], picks[cpt]] = [picks[cpt], picks[cap]];
        if (!picks[cpt]) delete picks[cpt];
        dirty = true;
      } else {
        const s = el.dataset.slot;
        target = target === s ? null : s;
        view = s === teamSlot?.id ? 'teams' : 'players';
      }
      renderAll();
    }));
  }

  function renderPool() {
    $('#filters').innerHTML = `
      <button class="chip small ${view === 'players' ? 'active' : ''}" data-v="players">Players</button>
      <button class="chip small ${view === 'teams' ? 'active' : ''}" data-v="teams">Teams</button>
      <input id="q" placeholder="Search player or team" value="${esc(search)}">`;
    $$('#filters .chip').forEach((b) => b.addEventListener('click', () => { view = b.dataset.v; renderAll(); }));
    const q = $('#q');
    q.addEventListener('input', () => { search = q.value; renderTable(); });
    renderTable();
  }

  function renderTable() {
    const left = g.salaryCap - spent();
    const s = search.toLowerCase();
    const th = (k, label, num = true) => `<th class="sort ${num ? 'num' : ''}" data-k="${k}">${label}${sortKey === k ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    const sorter = (a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * sortDir;
    let html;
    if (view === 'teams') {
      const rows = pool.teams.filter((t) => !s || t.name.toLowerCase().includes(s) || t.tag.toLowerCase().includes(s)).sort(sorter);
      html = `<thead><tr><th>Team</th><th>Opp</th>${th('wins', 'W-L')}${th('avg_pts', 'FPPG')}${th('salary', 'Salary')}<th></th></tr></thead><tbody>${rows.map((t) => {
        const picked = picks[teamSlot.id]?.id === t.id;
        const cant = !picked && t.salary - (picks[teamSlot.id]?.salary || 0) > left;
        return `<tr class="${picked ? 'picked' : ''} ${cant ? 'cant' : ''}"><td><span class="dot" style="background:${t.color}"></span> <b>${esc(t.name)}</b></td>
          <td class="tag muted">${esc(t.opponent || '—')}</td><td class="num">${t.wins}-${t.games - t.wins}</td><td class="num">${fmt(t.avg_pts)}</td><td class="num">${money(t.salary)}</td>
          <td class="num"><button class="small add" data-team="${t.id}" ${picked ? 'disabled' : ''}>${picked ? 'Picked' : 'Add'}</button></td></tr>`;
      }).join('')}</tbody>`;
    } else {
      const picked = pickedIds();
      const dest = slotFor();
      const rows = pool.players
        .filter((p) => !s || p.handle.toLowerCase().includes(s) || p.team_name.toLowerCase().includes(s) || p.team_tag.toLowerCase().includes(s))
        .sort(sorter);
      html = `<thead><tr>${th('handle', 'Player', false)}<th>Team</th><th>Opp</th>${th('games', 'GP')}${th('avg_pts', 'FPPG')}${th('salary', 'Salary')}<th></th></tr></thead><tbody>${rows.map((p) => {
        const isPicked = picked.has(p.id);
        let why = '';
        if (!isPicked) {
          if (!dest) why = 'Lineup full';
          else if (fromTeam(p.team_id, dest) >= g.maxPerTeam) why = `Max ${g.maxPerTeam} from ${p.team_tag}`;
          else if (cost(dest, p) - cost(dest, picks[dest]) > left) why = 'Over cap';
        }
        return `<tr class="${isPicked ? 'picked' : ''} ${why ? 'cant' : ''}"><td><b>${esc(p.handle)}</b></td>
          <td>${teamTag(p.team_tag, p.team_color)}</td><td class="tag muted">${esc(p.opponent || '—')}</td>
          <td class="num">${p.games}</td><td class="num">${fmt(p.avg_pts)}</td><td class="num">${money(p.salary)}</td>
          <td class="num"><button class="small add" data-player="${p.id}" ${isPicked || why ? 'disabled' : ''} title="${esc(why)}">${isPicked ? 'Picked' : why ? esc(why) : dest === 'CPT' ? 'Captain' : 'Add'}</button></td></tr>`;
      }).join('')}</tbody>`;
    }
    $('#pool').innerHTML = html;
    $$('#pool th.sort').forEach((h) => h.addEventListener('click', () => {
      if (sortKey === h.dataset.k) sortDir *= -1; else { sortKey = h.dataset.k; sortDir = h.dataset.k === 'handle' ? 1 : -1; }
      renderTable();
    }));
    $$('#pool button[data-player]').forEach((b) => b.addEventListener('click', () => {
      const dest = slotFor();
      if (!dest) return;
      picks[dest] = pool.players.find((x) => x.id === Number(b.dataset.player));
      target = null; dirty = true; renderAll();
    }));
    $$('#pool button[data-team]').forEach((b) => b.addEventListener('click', () => {
      picks[teamSlot.id] = pool.teams.find((x) => x.id === Number(b.dataset.team));
      target = null; dirty = true; renderAll();
    }));
  }

  function renderAll() { renderSlots(); renderPool(); }
  renderAll();

  $('#clear').addEventListener('click', () => { for (const k of Object.keys(picks)) delete picks[k]; dirty = true; renderAll(); });
  $('#save').addEventListener('click', async () => {
    const slots = Object.fromEntries(Object.entries(picks).map(([k, v]) => [k, v.id]));
    try {
      const r = await api(`/leagues/${id}/lineup`, { method: 'PUT', body: { slots } });
      dirty = false;
      toast(r.filled < g.slots.length ? `Saved. ${g.slots.length - r.filled} slot(s) still empty.` : 'Lineup saved. Good luck!');
    } catch (err) { toast(err.message, true); }
  });
  window.onbeforeunload = () => (dirty ? true : undefined);
}

async function viewPlayers() {
  const g = currentGame();
  const pool = await loadPool(g.id);
  let sortKey = 'avg_pts', dir = -1, team = 'ALL';
  app.innerHTML = `<div class="row spread"><h1>Players</h1>${gameTabs()}</div>
    <p class="muted">${esc(g.name)} rosters as of ${esc(g.asOf)}. Stats are averages per series. Salaries update after every week based on fantasy output.</p>
    <div class="panel"><div class="filters" id="f"></div><div class="table-wrap"><table id="t"></table></div></div>`;
  wireGameTabs();
  const val = (p, k) => (k in p ? p[k] : p.avg[k] ?? 0);
  function render() {
    $('#f').innerHTML = `<button class="chip small ${team === 'ALL' ? 'active' : ''}" data-t="ALL">All teams</button>` +
      pool.teams.map((t) => `<button class="chip small ${team === t.id ? 'active' : ''}" data-t="${t.id}">${esc(t.tag)}</button>`).join('');
    $$('#f button').forEach((b) => b.addEventListener('click', () => { team = b.dataset.t === 'ALL' ? 'ALL' : Number(b.dataset.t); render(); }));
    const rows = pool.players.filter((p) => team === 'ALL' || p.team_id === team).sort((a, b) => (val(a, sortKey) > val(b, sortKey) ? 1 : -1) * dir);
    const cols = [['games', 'GP'], ...g.statColumns.map((c) => [c.key, c.label]), ['avg_pts', 'FPPG'], ['total_pts', 'Total'], ['salary', 'Salary']];
    const head = (k, l, num = true) => `<th class="sort ${num ? 'num' : ''}" data-k="${k}">${l}${sortKey === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    $('#t').innerHTML = `<thead><tr>${head('handle', 'Player', false)}<th>Team</th>${cols.map(([k, l]) => head(k, l)).join('')}</tr></thead>
      <tbody>${rows.map((p) => `<tr><td><b>${esc(p.handle)}</b></td><td>${teamTag(p.team_tag, p.team_color)} <span class="muted">${esc(p.team_name)}</span></td>
        <td class="num">${p.games}</td>${g.statColumns.map((c) => `<td class="num">${fmt(p.avg[c.key] ?? 0)}</td>`).join('')}
        <td class="num"><b>${fmt(p.avg_pts)}</b></td><td class="num">${fmt(p.total_pts)}</td><td class="num">${money(p.salary)}</td></tr>`).join('')}</tbody>`;
    $$('#t th.sort').forEach((h) => h.addEventListener('click', () => {
      if (sortKey === h.dataset.k) dir *= -1; else { sortKey = h.dataset.k; dir = h.dataset.k === 'handle' ? 1 : -1; }
      render();
    }));
  }
  render();
}

async function viewSchedule() {
  const g = currentGame();
  const weeks = await api(`/schedule?game=${g.id}`);
  app.innerHTML = `<div class="row spread"><h1>Schedule & results</h1><div class="row">${playButton(g)}${gameTabs()}</div></div>
    <p class="muted">Each team plays one best-of-3 series per week.</p>` + weeks.map((w) => `
    <div class="week">
      <div class="week-banner"><h2 style="margin:0">Week ${w.number}</h2>
        <span class="pill ${w.status === 'complete' ? 'done' : w.number === g.currentWeek ? 'live' : ''}">${w.status === 'complete' ? 'Final' : w.number === g.currentWeek ? 'Lineups open' : 'Upcoming'}</span></div>
      <div class="matches" style="margin-top:10px">${w.matches.map((m) => {
        const played = m.winner_id != null;
        const cls = (tid) => (!played ? '' : m.winner_id === tid ? 'win' : 'lose');
        return `<div class="match ${played ? 'played' : ''}" data-id="${m.id}">
          <div class="side ${cls(m.team_a)}"><span class="dot" style="background:${m.color_a}"></span><span class="tag">${esc(m.tag_a)}</span></div>
          <div class="score">${played ? `${m.maps_a} – ${m.maps_b}` : 'vs'}</div>
          <div class="side right ${cls(m.team_b)}"><span class="tag">${esc(m.tag_b)}</span><span class="dot" style="background:${m.color_b}"></span></div>
        </div>`;
      }).join('')}</div>
    </div>`).join('');
  wireGameTabs();
  wirePlayButtons();
  $$('.match.played', app).forEach((el) => el.addEventListener('click', () => showMatch(el.dataset.id)));
}

async function showMatch(id) {
  const m = await api(`/matches/${id}`);
  const g = gameById(m.game);
  const side = (teamId, name, color) => {
    const t = m.teams.find((x) => x.team_id === teamId);
    const ps = m.players.filter((p) => p.team_id === teamId);
    return `<h3 style="margin-top:16px"><span class="dot" style="background:${color}"></span> ${esc(name)} ${t.stats.series_won ? '<span class="pill live">WIN</span>' : ''}</h3>
      <div class="table-wrap"><table><thead><tr><th>Player</th>${g.statColumns.map((c) => `<th class="num">${c.label}</th>`).join('')}<th class="num">FP</th></tr></thead>
      <tbody>${ps.map((p) => `<tr><td>${esc(p.handle)}</td>${g.statColumns.map((c) => `<td class="num">${p.stats[c.key] ?? 0}</td>`).join('')}<td class="num"><b>${fmt(p.points)}</b></td></tr>`).join('')}
      <tr><td><span class="role TEAM">TEAM</span> <span class="muted">${t.stats.maps_won} maps · ${signed(t.stats.round_diff)} rounds</span></td><td colspan="${g.statColumns.length}"></td><td class="num"><b>${fmt(t.points)}</b></td></tr></tbody></table></div>`;
  };
  const maps = m.detail.maps.map((x, i) => `Map ${i + 1}: <b>${x.a}–${x.b}</b>`).join(' · ');
  modal(`<div class="row" style="gap:8px">${gameBadge(g)}<span class="muted">Week ${m.week} · Best of 3</span></div>
    <h2 style="margin-top:8px">${esc(m.name_a)} ${m.maps_a}–${m.maps_b} ${esc(m.name_b)}</h2><p class="muted">${maps}</p>
    ${side(m.team_a, m.name_a, m.color_a)}${side(m.team_b, m.name_b, m.color_b)}`);
}

function viewRules() {
  const g = currentGame();
  const dl = (rules, bonuses = []) => `<dl>${rules.map((r) => `<dt>${esc(r.label)}</dt><dd>${signed(r.pts)}</dd>`).join('')}
    ${bonuses.map((b) => `<dt>${esc(b.label)}</dt><dd>${signed(b.pts)}</dd>`).join('')}</dl>`;
  const source = /^https?:/.test(g.source) ? `<a href="${esc(g.source)}" target="_blank" rel="noopener">source</a>` : esc(g.source);
  app.innerHTML = `<div class="row spread"><h1>How it works</h1>${gameTabs()}</div>
    <div class="stack">
      <div class="panel"><h2>Lineups</h2>
        <p>Each week, in each league, pick ${g.slots.map((s) => `<b>${esc(s.label)}</b>`).join(', ')} under a <b>${money(g.salaryCap)}</b> salary cap.
        Your <b>Captain</b> scores 1.5× points and costs 1.5× salary. You can pick at most ${g.maxPerTeam} players from one team. Any number of managers can pick the same player, so there's no draft.</p>
        <p>Lineups lock when the week's series are played. If you don't change yours, last week's lineup carries over. Salaries go up or down after each week depending on how players score.</p>
        <p class="muted" style="margin-bottom:0">The highest season total wins the league. ${esc(g.name)} rosters are as of ${esc(g.asOf)} (${source}). Until a live stats feed is connected, match results are simulated from team strength.</p></div>
      <div class="rules">
        <div class="panel"><h2>Players (per series)</h2>${dl(g.playerRules, g.playerBonuses)}</div>
        <div class="panel"><h2>Team (per series)</h2>${dl(g.teamRules, g.teamBonuses)}</div>
      </div>
    </div>`;
  wireGameTabs();
}

// ---------- router ----------
let navId = 0;
async function route_() {
  const thisNav = ++navId;
  window.onbeforeunload = null;
  $('#modal').classList.add('hidden');
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  renderHeader();
  try {
    if (parts[0] === 'rules') return viewRules();
    if (!state.me.user) return viewAuth();
    if (parts[0] === 'league' && parts[2] === 'lineup') return await viewLineup(parts[1]);
    if (parts[0] === 'league') return await viewLeague(parts[1]);
    if (parts[0] === 'players') return await viewPlayers();
    if (parts[0] === 'schedule') return await viewSchedule();
    return await viewHome();
  } catch (err) {
    if (thisNav !== navId) return; // a newer page has replaced this one
    app.innerHTML = `<div class="panel"><h2>Couldn't load this page</h2><p class="muted">${esc(err.message)}</p><a href="#/">Back to leagues</a></div>`;
  }
}

if (MODE === 'browser') {
  const f = document.createElement('footer');
  f.className = 'demo-note';
  f.innerHTML = 'Demo mode: everything is saved in this browser only, so leagues can\'t be shared with other devices. ' +
    'Sign up a second account to try joining a league. <button class="small ghost" id="reset">Reset demo data</button>';
  document.body.appendChild(f);
  $('#reset').addEventListener('click', () => { if (confirm('Delete all accounts, leagues and results in this browser?')) resetData(); });
}

window.addEventListener('hashchange', route_);
(async () => {
  await Promise.all([refreshGames(), refreshMe()]);
  if (!gameById(state.game)) setGame(state.games[0].id);
  route_();
})();

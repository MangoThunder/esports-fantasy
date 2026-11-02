// Fragline Fantasy — single-page frontend (no build step).
import { request, MODE, resetData } from './transport.js';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n).toLocaleString();
const fmt = (n, d = 1) => Number(n).toFixed(d);

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

// ---------- global state ----------
const state = { me: null, rules: null, players: null, teams: null };
async function refreshMe() {
  state.me = await api('/me');
  renderHeader();
}
async function loadPool(force = false) {
  if (!state.players || force) [state.players, state.teams] = await Promise.all([api('/players'), api('/teams')]);
}

function renderHeader() {
  const { user, currentWeek, totalWeeks, allowSim } = state.me;
  const route = location.hash.split('/')[1] || '';
  const link = (href, label, key) => `<a href="#/${href}" class="${route === key ? 'active' : ''}">${label}</a>`;
  $('#nav').innerHTML = user
    ? link('', 'Leagues', route === 'league' ? 'league' : '') + link('players', 'Players', 'players') +
      link('schedule', 'Schedule', 'schedule') + link('rules', 'Scoring', 'rules')
    : link('rules', 'Scoring', 'rules');
  const weekLabel = currentWeek ? `Week ${currentWeek} of ${totalWeeks}` : 'Season complete';
  $('#session').innerHTML = user
    ? `<span class="pill ${currentWeek ? 'live' : 'done'}">${weekLabel}</span>
       ${allowSim && currentWeek ? '<button class="small" id="sim" title="Dev tool: plays every match this week">▶ Play week</button>' : ''}
       <span class="muted">${esc(user.username)}</span>
       <button class="small ghost" id="logout">Log out</button>`
    : '';
  $('#logout')?.addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    state.me.user = null; // update before navigating so no view renders as the old user
    if (location.hash.replace(/^#\/?/, '')) location.hash = '#/'; else route_();
  });
  $('#sim')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await api('/admin/simulate', { method: 'POST' });
      toast(`Week ${r.simulated} played. Scores are in!`);
      await Promise.all([refreshMe(), loadPool(true)]);
      route_();
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
}

// ---------- views ----------
function viewAuth() {
  let mode = 'login';
  app.innerHTML = `
    <div class="auth panel">
      <h1>Draft the pros.<br>Win the week.</h1>
      <p class="muted">Fantasy esports with salary-cap lineups. Pick five players and a team, beat your friends.</p>
      <div class="tabs"><button data-m="login" class="active">Log in</button><button data-m="register">Sign up</button></div>
      <form>
        <div><label>Username</label><input name="username" autocomplete="username" required></div>
        <div><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
        <div class="error"></div>
        <button class="primary" style="width:100%">Log in</button>
      </form>
    </div>`;
  const form = $('form', app);
  app.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.m;
    app.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $('button.primary', form).textContent = mode === 'login' ? 'Log in' : 'Create account';
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      await api('/' + mode, { method: 'POST', body });
      await refreshMe();
      route_();
    } catch (err) { $('.error', form).textContent = err.message; }
  });
}

async function viewHome() {
  const leagues = await api('/leagues');
  const { currentWeek, totalWeeks } = state.me;
  app.innerHTML = `
    <div class="stack">
      <div class="panel hero">
        <h1>${currentWeek ? `Week ${currentWeek} lineups are open` : 'The season is over'}</h1>
        <p>${currentWeek
          ? `Set a lineup in each of your leagues before the matches are played. You get ${money(state.rules.SALARY_CAP)} to spend on one player per role, a flex, and a team.`
          : `All ${totalWeeks} weeks are done. Check your league standings to see who took the crown.`}</p>
      </div>
      <div class="grid grid-2">
        <div class="panel">
          <h2>Your leagues</h2>
          ${leagues.length ? `<div class="grid">${leagues.map((l) => `
            <a class="league-card" href="#/league/${l.id}">
              <div class="row spread"><b>${esc(l.name)}</b><span class="muted">${l.members} member${l.members === 1 ? '' : 's'}</span></div>
              <small class="muted">Invite code <span class="mono">${l.invite_code}</span></small>
            </a>`).join('')}</div>` : '<p class="muted">You aren\'t in any leagues yet. Create one or join with a code.</p>'}
        </div>
        <div class="panel stack">
          <form id="create"><h2>Create a league</h2>
            <div class="row"><input name="name" placeholder="League name" required maxlength="40" style="flex:1"><button class="primary">Create</button></div>
          </form>
          <form id="join"><h2>Join a league</h2>
            <div class="row"><input name="code" placeholder="Invite code" required maxlength="6" class="mono" style="flex:1;text-transform:uppercase"><button>Join</button></div>
          </form>
        </div>
      </div>
    </div>`;
  $('#create').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('/leagues', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); location.hash = `#/league/${r.id}`; }
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
  const me = state.me.user.id;
  const weeks = L.completeWeeks;
  app.innerHTML = `
    <div class="stack">
      <div class="row spread">
        <div><h1>${esc(L.name)}</h1>
          <span class="muted">Invite friends with code <b class="mono" style="color:var(--text)">${L.invite_code}</b></span>
          <button class="small ghost" id="copy">Copy</button></div>
        ${L.currentWeek ? `<a href="#/league/${L.id}/lineup"><button class="primary">Set week ${L.currentWeek} lineup</button></a>` : ''}
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
        ${weeks.length ? '<p class="muted" style="margin-bottom:0">Click a weekly score to see that lineup.</p>' : '<p class="muted" style="margin-bottom:0">No weeks have been played yet.</p>'}
      </div>
    </div>`;
  $('#copy').addEventListener('click', () => navigator.clipboard?.writeText(L.invite_code).then(() => toast('Invite code copied')));
  app.querySelectorAll('td.clickable').forEach((td) => td.addEventListener('click', async () => {
    await loadPool();
    const lu = await api(`/leagues/${id}/lineup?week=${td.dataset.week}&user=${td.dataset.user}`);
    const who = L.standings.find((s) => s.id === Number(td.dataset.user)).username;
    modal(`<h2>${esc(who)} · Week ${lu.week}</h2>${lineupTable(lu.slots)}`);
  }));
}

function lineupTable(slots) {
  const rows = state.rules.SLOTS.map((slot) => {
    const s = slots[slot];
    if (!s) return `<tr><td><span class="role ${slot}">${slot}</span></td><td class="muted">Empty</td><td></td><td class="num">0.0</td></tr>`;
    const p = s.player_id ? state.players.find((x) => x.id === s.player_id) : null;
    const t = s.team_id ? state.teams.find((x) => x.id === s.team_id) : null;
    return `<tr><td><span class="role ${slot}">${slot}</span></td><td><b>${esc(p ? p.handle : t.name)}</b></td>
      <td class="tag" style="color:${p ? p.team_color : t.color}">${p ? p.team_tag : t.tag}</td><td class="num">${fmt(s.points ?? 0)}</td></tr>`;
  }).join('');
  const total = Object.values(slots).reduce((a, s) => a + (s.points || 0), 0);
  return `<table><tbody>${rows}</tbody><tfoot><tr><td colspan="3"><b>Total</b></td><td class="num"><b>${fmt(total)}</b></td></tr></tfoot></table>`;
}

async function viewLineup(id) {
  await loadPool();
  const [L, lu] = await Promise.all([api(`/leagues/${id}`), api(`/leagues/${id}/lineup`)]);
  if (!lu.editable) { location.hash = `#/league/${id}`; return; }
  const { SLOTS, SALARY_CAP } = state.rules;
  const picks = {}; // slot -> player or team object
  for (const [slot, s] of Object.entries(lu.slots)) {
    picks[slot] = s.player_id ? state.players.find((p) => p.id === s.player_id) : state.teams.find((t) => t.id === s.team_id);
  }
  let filter = 'ALL', search = '', sortKey = 'salary', sortDir = -1, target = null;
  let dirty = !!lu.prefilledFrom;

  const spent = () => Object.values(picks).reduce((a, x) => a + (x?.salary || 0), 0);
  const pickedPlayerIds = () => new Set(Object.entries(picks).filter(([s, x]) => s !== 'TEAM' && x).map(([, x]) => x.id));
  const slotFor = (p) => {
    if (target && (target === 'FLEX' || target === p.role)) return target;
    if (!picks[p.role]) return p.role;
    if (!picks.FLEX) return 'FLEX';
    return p.role; // replace existing pick at that role
  };

  app.innerHTML = `
    <div class="row spread" style="margin-bottom:16px">
      <div><a href="#/league/${id}">← ${esc(L.name)}</a><h1 style="margin-top:6px">Week ${lu.week} lineup</h1></div>
      ${lu.prefilledFrom ? `<span class="pill">Copied from week ${lu.prefilledFrom} — save to keep it</span>` : ''}
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
    const used = spent(), left = SALARY_CAP - used;
    const empty = SLOTS.filter((s) => !picks[s]).length;
    $('#cap').innerHTML = `${money(used)} / ${money(SALARY_CAP)}`;
    $('#capbar').classList.toggle('over', used > SALARY_CAP);
    $('#capbar > div').style.width = Math.min(100, (used / SALARY_CAP) * 100) + '%';
    $('#avg').innerHTML = used > SALARY_CAP
      ? `<span style="color:var(--bad)">${money(-left)} over the cap</span>`
      : empty ? `${money(left)} left · ${money(Math.floor(left / empty))} per open slot` : `${money(left)} left · lineup full`;
    $('#slots').innerHTML = SLOTS.map((slot) => {
      const x = picks[slot];
      const isTeam = slot === 'TEAM';
      return `<div class="slot ${x ? 'filled' : ''} ${target === slot ? 'target' : ''}" data-slot="${slot}">
        <span class="role ${slot}">${slot}</span>
        <div class="who">${x
          ? `<b>${esc(isTeam ? x.name : x.handle)}</b><small><span class="tag" style="color:${isTeam ? x.color : x.team_color}">${isTeam ? x.tag : x.team_tag}</span> ${x.opponent ? 'vs ' + x.opponent : ''} · ${money(x.salary)}</small>`
          : `<small>${slot === 'FLEX' ? 'Any player' : isTeam ? 'Pick a team' : 'Pick a ' + slot}</small>`}</div>
        ${x ? `<button class="x" data-remove="${slot}" title="Remove">×</button>` : ''}
      </div>`;
    }).join('');
    $('#slots').querySelectorAll('.slot').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.dataset.remove) { delete picks[e.target.dataset.remove]; dirty = true; }
      else {
        const s = el.dataset.slot;
        target = target === s ? null : s;
        filter = s === 'FLEX' ? 'ALL' : s;
      }
      renderAll();
    }));
  }

  function renderPool() {
    const chips = ['ALL', ...state.rules.ROLES, 'TEAM'];
    $('#filters').innerHTML = chips.map((c) => `<button class="chip small ${filter === c ? 'active' : ''}" data-f="${c}">${c === 'ALL' ? 'All players' : c === 'TEAM' ? 'Teams' : c}</button>`).join('') +
      `<input id="q" placeholder="Search player or team" value="${esc(search)}">`;
    $('#filters').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; target = filter === 'ALL' ? target : null; renderAll(); }));
    const q = $('#q');
    q.addEventListener('input', () => { search = q.value; renderTable(); });
    renderTable();
  }

  function renderTable() {
    const left = SALARY_CAP - spent();
    const s = search.toLowerCase();
    const th = (k, label, num = true) => `<th class="sort ${num ? 'num' : ''}" data-k="${k}">${label}${sortKey === k ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    const sorter = (a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * sortDir;
    let html;
    if (filter === 'TEAM') {
      const rows = state.teams.filter((t) => !s || t.name.toLowerCase().includes(s) || t.tag.toLowerCase().includes(s)).sort(sorter);
      html = `<thead><tr><th>Team</th><th>Opp</th>${th('wins', 'W-L')}${th('avg_pts', 'FPPG')}${th('salary', 'Salary')}<th></th></tr></thead><tbody>${rows.map((t) => {
        const picked = picks.TEAM?.id === t.id;
        const cant = !picked && t.salary - (picks.TEAM?.salary || 0) > left;
        return `<tr class="${picked ? 'picked' : ''} ${cant ? 'cant' : ''}"><td><span class="dot" style="background:${t.color}"></span> <b>${esc(t.name)}</b> <span class="tag muted">${t.tag}</span></td>
          <td class="tag muted">${t.opponent || '—'}</td><td class="num">${t.wins}-${t.games - t.wins}</td><td class="num">${fmt(t.avg_pts)}</td><td class="num">${money(t.salary)}</td>
          <td class="num"><button class="small add" data-team="${t.id}" ${picked ? 'disabled' : ''}>${picked ? 'Picked' : 'Add'}</button></td></tr>`;
      }).join('')}</tbody>`;
    } else {
      const picked = pickedPlayerIds();
      const rows = state.players
        .filter((p) => filter === 'ALL' || p.role === filter)
        .filter((p) => !s || p.handle.toLowerCase().includes(s) || p.team_name.toLowerCase().includes(s) || p.team_tag.toLowerCase().includes(s))
        .sort(sorter);
      html = `<thead><tr><th>Pos</th>${th('handle', 'Player', false)}<th>Team</th><th>Opp</th>${th('games', 'GP')}${th('avg_pts', 'FPPG')}${th('salary', 'Salary')}<th></th></tr></thead><tbody>${rows.map((p) => {
        const isPicked = picked.has(p.id);
        const replacing = picks[slotFor(p)];
        const cant = !isPicked && p.salary - (replacing?.salary || 0) > left;
        return `<tr class="${isPicked ? 'picked' : ''} ${cant ? 'cant' : ''}"><td><span class="role ${p.role}">${p.role}</span></td><td><b>${esc(p.handle)}</b></td>
          <td class="tag" style="color:${p.team_color}">${p.team_tag}</td><td class="tag muted">${p.opponent || '—'}</td>
          <td class="num">${p.games}</td><td class="num">${fmt(p.avg_pts)}</td><td class="num">${money(p.salary)}</td>
          <td class="num"><button class="small add" data-player="${p.id}" ${isPicked ? 'disabled' : ''}>${isPicked ? 'Picked' : 'Add'}</button></td></tr>`;
      }).join('')}</tbody>`;
    }
    $('#pool').innerHTML = html;
    $('#pool').querySelectorAll('th.sort').forEach((h) => h.addEventListener('click', () => {
      if (sortKey === h.dataset.k) sortDir *= -1; else { sortKey = h.dataset.k; sortDir = h.dataset.k === 'handle' ? 1 : -1; }
      renderTable();
    }));
    $('#pool').querySelectorAll('button[data-player]').forEach((b) => b.addEventListener('click', () => {
      const p = state.players.find((x) => x.id === Number(b.dataset.player));
      picks[slotFor(p)] = p; target = null; dirty = true; renderAll();
    }));
    $('#pool').querySelectorAll('button[data-team]').forEach((b) => b.addEventListener('click', () => {
      picks.TEAM = state.teams.find((x) => x.id === Number(b.dataset.team)); target = null; dirty = true; renderAll();
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
      toast(r.filled < SLOTS.length ? `Saved — ${SLOTS.length - r.filled} slot(s) still empty` : 'Lineup saved. Good luck!');
    } catch (err) { toast(err.message, true); }
  });
  window.onbeforeunload = () => (dirty ? true : undefined);
}

async function viewPlayers() {
  await loadPool();
  let sortKey = 'avg_pts', dir = -1, role = 'ALL';
  app.innerHTML = `<h1>Players</h1><div class="panel"><div class="filters" id="f"></div><div class="table-wrap"><table id="t"></table></div></div>`;
  const cols = [['handle', 'Player'], ['games', 'GP'], ['avg_k', 'K'], ['avg_d', 'D'], ['avg_a', 'A'], ['avg_cs', 'CS'], ['avg_pts', 'FPPG'], ['total_pts', 'Total'], ['salary', 'Salary']];
  function render() {
    $('#f').innerHTML = ['ALL', ...state.rules.ROLES].map((r) => `<button class="chip small ${role === r ? 'active' : ''}" data-r="${r}">${r === 'ALL' ? 'All' : r}</button>`).join('');
    $('#f').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { role = b.dataset.r; render(); }));
    const rows = state.players.filter((p) => role === 'ALL' || p.role === role)
      .sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : -1) * dir);
    $('#t').innerHTML = `<thead><tr><th>Pos</th>${cols.map(([k, l]) => `<th class="sort ${k === 'handle' ? '' : 'num'}" data-k="${k}">${l}${sortKey === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}<th>Team</th></tr></thead>
      <tbody>${rows.map((p) => `<tr><td><span class="role ${p.role}">${p.role}</span></td><td><b>${esc(p.handle)}</b></td>
        <td class="num">${p.games}</td><td class="num">${fmt(p.avg_k)}</td><td class="num">${fmt(p.avg_d)}</td><td class="num">${fmt(p.avg_a)}</td><td class="num">${fmt(p.avg_cs, 0)}</td>
        <td class="num"><b>${fmt(p.avg_pts)}</b></td><td class="num">${fmt(p.total_pts)}</td><td class="num">${money(p.salary)}</td>
        <td><span class="tag" style="color:${p.team_color}">${p.team_tag}</span> <span class="muted">${esc(p.team_name)}</span></td></tr>`).join('')}</tbody>`;
    $('#t').querySelectorAll('th.sort').forEach((h) => h.addEventListener('click', () => {
      if (sortKey === h.dataset.k) dir *= -1; else { sortKey = h.dataset.k; dir = h.dataset.k === 'handle' ? 1 : -1; }
      render();
    }));
  }
  render();
}

async function viewSchedule() {
  const weeks = await api('/schedule');
  app.innerHTML = `<h1>Schedule & results</h1>` + weeks.map((w) => `
    <div class="week">
      <div class="week-banner"><h2 style="margin:0">Week ${w.id}</h2>
        <span class="pill ${w.status === 'complete' ? 'done' : w.id === state.me.currentWeek ? 'live' : ''}">${w.status === 'complete' ? 'Final' : w.id === state.me.currentWeek ? 'Lineups open' : 'Upcoming'}</span></div>
      <div class="matches" style="margin-top:10px">${w.matches.map((m) => {
        const played = m.winner_id != null;
        const cls = (tid) => (!played ? '' : m.winner_id === tid ? 'win' : 'lose');
        return `<div class="match ${played ? 'played' : ''}" data-id="${m.id}">
          <div class="side ${cls(m.team_a)}"><span class="dot" style="background:${m.color_a}"></span><span class="tag">${m.tag_a}</span></div>
          <div class="score">${played ? `${m.kills_a} – ${m.kills_b}` : 'vs'}</div>
          <div class="side right ${cls(m.team_b)}"><span class="tag">${m.tag_b}</span><span class="dot" style="background:${m.color_b}"></span></div>
        </div>`;
      }).join('')}</div>
    </div>`).join('');
  app.querySelectorAll('.match.played').forEach((el) => el.addEventListener('click', () => showMatch(el.dataset.id)));
}

async function showMatch(id) {
  const m = await api(`/matches/${id}`);
  const side = (teamId, name, tag, color) => {
    const t = m.teams.find((x) => x.team_id === teamId);
    const ps = m.players.filter((p) => p.team_id === teamId);
    return `<h3 style="margin-top:16px"><span class="dot" style="background:${color}"></span> ${esc(name)} ${t.won ? '<span class="pill live">WIN</span>' : ''}</h3>
      <table><thead><tr><th>Pos</th><th>Player</th><th class="num">K</th><th class="num">D</th><th class="num">A</th><th class="num">CS</th><th class="num">FP</th></tr></thead>
      <tbody>${ps.map((p) => `<tr><td><span class="role ${p.role}">${p.role}</span></td><td>${esc(p.handle)}</td><td class="num">${p.kills}</td><td class="num">${p.deaths}</td><td class="num">${p.assists}</td><td class="num">${p.cs}</td><td class="num"><b>${fmt(p.points)}</b></td></tr>`).join('')}
      <tr><td><span class="role TEAM">TEAM</span></td><td class="muted">${t.towers} towers · ${t.dragons} drakes · ${t.barons} barons${t.first_blood ? ' · first blood' : ''}</td><td colspan="4"></td><td class="num"><b>${fmt(t.points)}</b></td></tr></tbody></table>`;
  };
  modal(`<h2>${esc(m.name_a)} vs ${esc(m.name_b)}</h2><p class="muted">Week ${m.week} · ${m.duration_min} min · ${m.kills_a}–${m.kills_b} kills</p>
    ${side(m.team_a, m.name_a, m.tag_a, m.color_a)}${side(m.team_b, m.name_b, m.tag_b, m.color_b)}`);
}

function viewRules() {
  const { PLAYER_RULES: P, TEAM_RULES: T, SALARY_CAP, SLOTS } = state.rules;
  const sign = (n) => (n > 0 ? '+' : '') + n;
  app.innerHTML = `<h1>How it works</h1>
    <div class="stack">
      <div class="panel"><h2>Lineups</h2>
        <p>Each week, in each league, pick <b>${SLOTS.length} slots</b>: ${SLOTS.map((s) => `<span class="role ${s}">${s}</span>`).join(' ')} — one player per role, a FLEX that takes any player, and one team.
        Your lineup must cost no more than <b>${money(SALARY_CAP)}</b>. Anyone can pick any player, so there's no draft. Lineups lock when the week's matches are played, and you score points from what happens in those matches.</p>
        <p class="muted" style="margin-bottom:0">Whoever has the most points across the season wins the league. "Week wins" counts how many weeks you posted the top score.</p></div>
      <div class="rules">
        <div class="panel"><h2>Players</h2><dl>
          <dt>Kill</dt><dd>${sign(P.kill)}</dd><dt>Death</dt><dd>${sign(P.death)}</dd><dt>Assist</dt><dd>${sign(P.assist)}</dd>
          <dt>Every ${P.csPerPoint} CS</dt><dd>+1</dd><dt>${P.bigGameKA}+ kills & assists</dt><dd>${sign(P.bigGameBonus)}</dd><dt>Team wins</dt><dd>${sign(P.win)}</dd></dl></div>
        <div class="panel"><h2>Team</h2><dl>
          <dt>Win</dt><dd>${sign(T.win)}</dd><dt>Tower</dt><dd>${sign(T.tower)}</dd><dt>Dragon</dt><dd>${sign(T.dragon)}</dd>
          <dt>Baron</dt><dd>${sign(T.baron)}</dd><dt>First blood</dt><dd>${sign(T.firstBlood)}</dd><dt>Win under ${T.fastWinMinutes} min</dt><dd>${sign(T.fastWinBonus)}</dd></dl></div>
      </div>
    </div>`;
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
  [state.rules] = await Promise.all([api('/rules'), refreshMe()]);
  route_();
})();

# Fragline Fantasy

Fantasy sports for esports. You set a salary-cap lineup each week, the matches get played, and your players' in-game stats turn into fantasy points.

## Run it

Needs Node 22.5+ (it uses the built-in `node:sqlite`).

```bash
npm install
npm start          # http://localhost:3000
npm run reset      # wipe the database and start fresh
```

### GitHub Pages version

GitHub Pages only hosts static files, so it can't run the Node server. `npm run build:static` builds a version into `dist/` that runs the same API code in the browser instead, using SQLite compiled to WebAssembly (sql.js) and saving to `localStorage`. It's a working demo, but each visitor's data stays in their own browser, so friends can't join each other's leagues. Shared leagues need the Node server hosted somewhere (Render, Railway, Fly.io and so on).

`.github/workflows/pages.yml` rebuilds and deploys the page on every push to `main`. To set it up, open the repo's **Settings → Pages** and set **Source** to **GitHub Actions**.

To try it out: sign up, create a league, share the invite code (or open a private window and join as a second user), set a lineup, then click **▶ Play week** in the header to simulate that week's matches.

## How the game works

- **Games:** VALORANT and Counter-Strike 2, each with its own season, schedule, players and scoring. Each league is for one game.
- **Real rosters:**
  - **CS2:** the top 10 of [Valve's global regional standings](https://github.com/ValveSoftware/counter-strike_regional_standings) as of 2026-11-02.
  - **VALORANT:** the top 8 teams at VALORANT Champions 2026, with their 2026 lineups. Off-season moves after that aren't included yet.
- **Leagues:** private groups you join with a 6-character invite code.
- **Weekly lineups:** a Captain (1.5× points, 1.5× salary), 4 players and 1 team, under a $50,000 cap, with at most 3 players from one team. There's no draft, so several managers can pick the same player.
- **Locking:** a lineup locks when the week's series are played. Other managers' lineups stay hidden until then. If you don't change yours, last week's carries over.
- **Salaries:** they start from team ranking (plus a bump for established stars). After every week they move toward each player's actual fantasy output.
- **Scoring:** per best-of-3 series, defined in `server/games/<game>.js` and shown on the Scoring page.
- **Results are simulated** round by round from team strength until a real stats feed is connected (see below).

## Code layout

| File | What it does |
|---|---|
| `server/routes.js` | The whole API (auth, leagues, lineups, stats) with no framework, shared by both versions |
| `server/index.js` | Express wrapper around `routes.js`, plus session cookies |
| `server/db.js`, `server/schema.js` | SQLite database (Node) and schema |
| `server/games/` | One module per game (slots, scoring, simulator), plus `data/` with the real rosters |
| `server/games/tactical-shooter.js` | Shared scoring and best-of-3 simulator for round-based shooters |
| `server/seed.js` | Loads each game's rosters and builds a round-robin schedule |
| `server/sim.js` | Plays a week, scores it, carries lineups over and re-prices players |
| `public/` | Frontend: plain JS single-page app, no build step |
| `web/` | Browser replacements for `db.js`, `crypto.js` and `transport.js`, used in the Pages build |
| `scripts/build-static.js` | Builds the GitHub Pages site into `dist/` |

## Adding a game

1. Add `server/games/data/<id>.js` with the teams and rosters (copy `cs2.js`).
2. Add `server/games/<id>.js` with the lineup slots, stat columns, scoring rules and a `simulateSeries` function. Round-based shooters can reuse `tactical-shooter.js`. Other genres need their own simulator.
3. Register it in `server/games/index.js`.

New games are seeded automatically on startup. To refresh rosters for an existing game, edit its data file and start from an empty database. A schema change wipes the database: bump `SCHEMA_VERSION` in `server/schema.js`.

## Moving to real match stats

Rosters are real but results are simulated. For live results, replace `simulateCurrentWeek()` in `server/sim.js` with a job that imports finished series from a provider such as PandaScore, GRID or Abios (these need a license for commercial use). The job writes each player's stats into `player_stats` and each team's into `team_stats`, using the same stat keys the game's scoring rules use. Standings, salaries and the UI read from those tables, so they don't need to change.

Set `ALLOW_SIM=0` in production to hide the **Play week** button.

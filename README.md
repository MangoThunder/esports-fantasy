# Fragline Fantasy

Fantasy sports for esports. You set a salary-cap lineup each week, the matches get played, and your players' in-game stats turn into fantasy points.

## Run it

Needs Node 22.5+ (it uses the built-in `node:sqlite`).

```bash
npm install
npm start          # http://localhost:3000
npm run reset      # wipe the database and start fresh
```

To try it out: sign up, create a league, share the invite code (or open a private window and join as a second user), set a lineup, then click **▶ Play week** in the header to simulate that week's matches.

## How the game works

- **Leagues:** private groups you join with a 6-character invite code.
- **Weekly lineups:** TOP, JNG, MID, ADC, SUP, a FLEX (any player) and a TEAM, with a $50,000 salary cap. There's no draft, so any number of people can pick the same player.
- **Locking:** a lineup locks when its week is played. You can't see other managers' lineups until then. A lineup you haven't set is copied from the previous week.
- **Scoring:** see `server/scoring.js` or the Scoring page. Players earn points from kills, deaths, assists, CS, a big-game bonus and wins. Teams earn points from wins, towers, dragons, barons, first blood and fast wins.
- **Standings:** total points across the season, plus a count of weeks where each manager had the top score.

## Code layout

| File | What it does |
|---|---|
| `server/index.js` | Express API: auth (scrypt + session cookie), leagues, lineups, stats |
| `server/db.js` | SQLite schema |
| `server/scoring.js` | Scoring rules and salary cap, all in one place |
| `server/seed.js` | 8 made-up teams, 40 players, a 7-week round-robin |
| `server/sim.js` | Match simulator that stands in for a real stats feed |
| `public/` | Frontend: plain JS single-page app, no build step |

## Moving to real esports data

The teams and players are invented. For real data, replace `seed.js` with an import from a provider such as PandaScore, the GRID esports data platform, or the Riot/Valve APIs (these usually need a license for commercial use). Then replace `simulateCurrentWeek()` with a job that pulls finished match stats into `player_stats` and `team_stats`. The scoring and standings code reads from those tables, so it doesn't need to change.

Set `ALLOW_SIM=0` in production to hide the **Play week** button.

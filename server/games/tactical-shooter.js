// Shared engine for round-based 5v5 shooters (CS2, VALORANT): fantasy scoring and a
// best-of-3 series simulator. The simulator stands in for a real stats feed.

/** Apply linear rules and threshold bonuses to a stats object. */
export function scoreStats(stats, rules, bonuses = []) {
  let p = 0;
  for (const r of rules) p += (stats[r.stat] || 0) * r.pts;
  for (const b of bonuses) if ((stats[b.stat] || 0) >= b.min) p += b.pts;
  return Math.round(p * 100) / 100;
}

const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pickWeighted = (items, weight) => {
  const total = items.reduce((s, x) => s + weight(x), 0);
  let r = Math.random() * total;
  for (const x of items) if ((r -= weight(x)) <= 0) return x;
  return items[items.length - 1];
};
/** Pick n distinct items, weighted. */
const sampleWeighted = (items, n, weight) => {
  const pool = [...items], out = [];
  while (out.length < n && pool.length) {
    const x = pickWeighted(pool, weight);
    out.push(x);
    pool.splice(pool.indexOf(x), 1);
  }
  return out;
};
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

/**
 * Simulate a best-of-3 series between two teams.
 * @param opts.headshots whether to track headshots (CS2 does, VALORANT doesn't)
 * @returns {{ winnerId, mapsA, mapsB, maps: {a,b}[], players: Map<id, stats>, teams: {a: stats, b: stats} }}
 */
export function simulateSeries(teamA, rosterA, teamB, rosterB, opts = {}) {
  // Teams with a 6th player rotate one starter out at random.
  const startersA = shuffle(rosterA).slice(0, 5);
  const startersB = shuffle(rosterB).slice(0, 5);
  const strength = (t, r) => t.rating * 0.4 + (r.reduce((s, p) => s + p.rating, 0) / r.length) * 0.6;
  const sA = strength(teamA, startersA), sB = strength(teamB, startersB);

  const blank = () => ({ kills: 0, deaths: 0, assists: 0, opening_kills: 0, clutches: 0, maps_played: 0, maps_won: 0, rounds: 0, ...(opts.headshots ? { headshots: 0 } : {}) });
  const ps = new Map([...startersA, ...startersB].map((p) => [p.id, blank()]));
  const killW = (p) => (p.rating / 80) ** 4;
  const deathW = (p) => (80 / p.rating) ** 2;

  const maps = [];
  let mapsA = 0, mapsB = 0;
  while (mapsA < 2 && mapsB < 2) {
    const form = gauss() * 4; // per-map swing
    const pRound = 1 / (1 + Math.pow(10, (sB - sA - form) / 85));
    let a = 0, b = 0;
    while (!((a >= 13 || b >= 13) && Math.abs(a - b) >= 2) && a + b < 40) {
      const aWins = Math.random() < pRound;
      const [win, lose] = aWins ? [startersA, startersB] : [startersB, startersA];
      aWins ? a++ : b++;

      const loserDeaths = Math.random() < 0.8 ? 5 : 3 + Math.floor(Math.random() * 2); // some rounds end in a save
      const winnerDeaths = pickWeighted([0, 1, 2, 3, 4], (n) => [10, 25, 30, 22, 13][n]);
      const deadLosers = sampleWeighted(lose, loserDeaths, deathW);
      const deadWinners = sampleWeighted(win, winnerDeaths, deathW);

      const credit = (killers, victims) => {
        for (const v of victims) {
          const k = pickWeighted(killers, killW);
          const ks = ps.get(k.id);
          ks.kills++;
          if (opts.headshots && Math.random() < 0.45) ks.headshots++;
          ps.get(v.id).deaths++;
          if (Math.random() < 0.42) ps.get(pickWeighted(killers.filter((x) => x !== k), () => 1).id).assists++;
        }
      };
      credit(win, deadLosers);
      credit(lose, deadWinners);

      // Opening kill: usually goes to the side that wins the round.
      const openers = Math.random() < 0.66 || !deadWinners.length ? win : lose;
      ps.get(pickWeighted(openers, killW).id).opening_kills++;
      // Clutch: the winning side won with only one player left alive.
      if (winnerDeaths === 4) {
        const survivor = win.find((p) => !deadWinners.includes(p));
        if (survivor) ps.get(survivor.id).clutches++;
      }
    }
    const aTook = a > b;
    aTook ? mapsA++ : mapsB++;
    maps.push({ a, b });
    for (const p of startersA) { const s = ps.get(p.id); s.maps_played++; s.rounds += a + b; if (aTook) s.maps_won++; }
    for (const p of startersB) { const s = ps.get(p.id); s.maps_played++; s.rounds += a + b; if (!aTook) s.maps_won++; }
  }

  const rd = maps.reduce((s, m) => s + m.a - m.b, 0);
  const teamStats = (won, mapsWon, mapsLost, diff) => ({
    series_won: won ? 1 : 0, maps_won: mapsWon, maps_lost: mapsLost, round_diff: diff, sweep: won && mapsLost === 0 ? 1 : 0,
  });
  const aWon = mapsA > mapsB;
  return {
    winnerId: aWon ? teamA.id : teamB.id,
    mapsA, mapsB, maps,
    players: ps,
    teams: { a: teamStats(aWon, mapsA, mapsB, rd), b: teamStats(!aWon, mapsB, mapsA, -rd) },
  };
}

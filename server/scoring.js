// Fantasy scoring rules. Shared with the frontend via GET /api/rules.
export const SALARY_CAP = 50000;

// Lineup slots: one per role, a FLEX that takes any player, and one TEAM.
export const SLOTS = ['TOP', 'JNG', 'MID', 'ADC', 'SUP', 'FLEX', 'TEAM'];
export const ROLES = ['TOP', 'JNG', 'MID', 'ADC', 'SUP'];

export const PLAYER_RULES = {
  kill: 3,
  death: -1,
  assist: 2,
  csPerPoint: 50,        // +1 point per 50 CS
  bigGameKA: 10,         // kills + assists threshold...
  bigGameBonus: 2,       // ...for this bonus
  win: 2,
};

export const TEAM_RULES = {
  win: 5,
  tower: 1,
  dragon: 2,
  baron: 3,
  firstBlood: 2,
  fastWinMinutes: 30,    // win in under this many minutes...
  fastWinBonus: 2,       // ...earns this bonus
};

export function playerPoints({ kills, deaths, assists, cs, won }) {
  const r = PLAYER_RULES;
  let p = kills * r.kill + deaths * r.death + assists * r.assist + cs / r.csPerPoint;
  if (kills + assists >= r.bigGameKA) p += r.bigGameBonus;
  if (won) p += r.win;
  return Math.round(p * 100) / 100;
}

export function teamPoints({ won, towers, dragons, barons, firstBlood, duration }) {
  const r = TEAM_RULES;
  let p = towers * r.tower + dragons * r.dragon + barons * r.baron;
  if (firstBlood) p += r.firstBlood;
  if (won) {
    p += r.win;
    if (duration < r.fastWinMinutes) p += r.fastWinBonus;
  }
  return Math.round(p * 100) / 100;
}

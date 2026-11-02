// Game registry. To add a game: create server/games/<id>.js (copy cs2.js as a template),
// add its roster file under data/, and list it here.
import valorant from './valorant.js';
import cs2 from './cs2.js';

export const GAMES = { valorant, cs2 };
export const GAME_IDS = Object.keys(GAMES);

export function getGame(id) {
  const g = GAMES[id];
  if (!g) {
    const err = new Error(`Unknown game "${id}".`);
    err.status = 400;
    throw err;
  }
  return g;
}

/** The parts of a game definition the frontend needs. */
export function publicGame(g) {
  const { id, name, short, color, salaryCap, maxPerTeam, slots, statColumns, playerRules, playerBonuses, teamRules, teamBonuses, data } = g;
  return { id, name, short, color, salaryCap, maxPerTeam, slots, statColumns, playerRules, playerBonuses, teamRules, teamBonuses, asOf: data.asOf, source: data.source };
}

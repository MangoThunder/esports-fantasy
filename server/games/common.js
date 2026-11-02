// Building blocks shared by game definitions.

// Captain-style lineup: a Captain (1.5x points and salary), four players, and one team.
export const CAPTAIN_LINEUP = {
  salaryCap: 50000,
  maxPerTeam: 3, // at most this many players (not counting the TEAM slot) from one team
  slots: [
    { id: 'CPT', label: 'Captain', kind: 'player', multiplier: 1.5, hint: '1.5× points · 1.5× salary' },
    { id: 'P1', label: 'Player', kind: 'player' },
    { id: 'P2', label: 'Player', kind: 'player' },
    { id: 'P3', label: 'Player', kind: 'player' },
    { id: 'P4', label: 'Player', kind: 'player' },
    { id: 'TEAM', label: 'Team', kind: 'team' },
  ],
};

// Team scoring for best-of-3 series.
export const TEAM_RULES = {
  teamRules: [
    { stat: 'series_won', label: 'Series won', pts: 6 },
    { stat: 'maps_won', label: 'Map won', pts: 4 },
    { stat: 'round_diff', label: 'Round differential (per round)', pts: 0.25 },
    { stat: 'sweep', label: '2–0 sweep', pts: 3 },
  ],
  teamBonuses: [],
};

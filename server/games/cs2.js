import data from './data/cs2.js';
import { simulateSeries } from './tactical-shooter.js';
import { CAPTAIN_LINEUP, TEAM_RULES } from './common.js';

export default {
  id: 'cs2',
  name: 'Counter-Strike 2',
  short: 'CS2',
  color: '#f59e0b',
  data,
  ...CAPTAIN_LINEUP,
  statColumns: [
    { key: 'kills', label: 'K' }, { key: 'deaths', label: 'D' }, { key: 'assists', label: 'A' },
    { key: 'headshots', label: 'HS' }, { key: 'opening_kills', label: 'Open' }, { key: 'clutches', label: 'Clutch' },
  ],
  playerRules: [
    { stat: 'kills', label: 'Kill', pts: 2 },
    { stat: 'deaths', label: 'Death', pts: -1 },
    { stat: 'assists', label: 'Assist', pts: 1 },
    { stat: 'headshots', label: 'Headshot kill', pts: 0.5 },
    { stat: 'opening_kills', label: 'Opening kill', pts: 1 },
    { stat: 'clutches', label: 'Clutch round', pts: 2 },
    { stat: 'maps_won', label: 'Map won', pts: 2 },
  ],
  playerBonuses: [{ stat: 'kills', min: 50, pts: 3, label: '50+ kills in a series' }],
  ...TEAM_RULES,
  simulateSeries: (a, ra, b, rb) => simulateSeries(a, ra, b, rb, { headshots: true }),
};

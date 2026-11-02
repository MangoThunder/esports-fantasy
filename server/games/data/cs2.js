// Counter-Strike 2 rosters: the top 10 of Valve's global regional standings.
// To update, copy the latest ranking from the source below and re-run with an empty database.
export default {
  asOf: '2026-11-02',
  source: 'https://github.com/ValveSoftware/counter-strike_regional_standings/blob/main/live/2026/standings_global_2026_11_02.md',
  teams: [
    { rank: 1, name: 'MOUZ', tag: 'MOUZ', color: '#e11d48', players: ['PR', 'Spinx', 'torzsi', 'xelex', 'xertioN'] },
    { rank: 2, name: 'Vitality', tag: 'VIT', color: '#facc15', players: ['flameZ', 'jL', 'mezii', 'ropz', 'ZywOo'] },
    { rank: 3, name: 'FURIA', tag: 'FUR', color: '#a3a3a3', players: ['FalleN', 'KSCERATO', 'molodoy', 'YEKINDAR', 'yuurih'] },
    { rank: 4, name: 'Aurora', tag: 'AUR', color: '#22d3ee', players: ['Jimpphat', 'kyxsan', 'Wicadia', 'woxic', 'XANTARES'] },
    { rank: 5, name: 'Spirit', tag: 'SPI', color: '#60a5fa', players: ['donk', 'magixx', 'sh1ro', 'tN1R', 'zont1x'] },
    { rank: 6, name: 'BetBoom', tag: 'BB', color: '#f97316', players: ['Boombl4', 'd1Ledez', 'Magnojez', 'S1ren', 'zorte'] },
    { rank: 7, name: 'Falcons', tag: 'FAL', color: '#22c55e', players: ['karrigan', 'kyousuke', 'm0NESY', 'NiKo', 'TeSeS'] },
    { rank: 8, name: 'FUT', tag: 'FUT', color: '#c084fc', players: ['cmtry', 'dem0n', 'dziugss', 'Krabeni', 'xfl0ud'] },
    { rank: 9, name: 'Legacy', tag: 'LEG', color: '#2dd4bf', players: ['arT', 'dumau', 'latto', 'n1ssim', 'try'] },
    { rank: 10, name: 'Nemiga', tag: 'NEM', color: '#f472b6', players: ['KaiR0N-', 'khaN', 'robo', 'syph0', 'Xant3r'] },
  ],
  // Starting-salary bump for widely recognised star players. Salaries then follow actual scoring.
  stars: ['ZywOo', 'donk', 'm0NESY', 'ropz', 'NiKo', 'sh1ro', 'KSCERATO', 'torzsi', 'XANTARES'],
};

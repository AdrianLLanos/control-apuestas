const fetch = require('node-fetch' || 'globalThis').fetch || globalThis.fetch;

async function run() {
  try {
    const url = 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-06-23&hydrate=linescore';
    const res = await fetch(url);
    const data = await res.json();
    console.log("DATES COUNT:", data.dates ? data.dates.length : 0);
    if (data.dates) {
      for (const d of data.dates) {
        console.log("Date:", d.date);
        for (const g of d.games) {
          console.log(`- GamePk: ${g.gamePk}, Date: ${g.gameDate}, Teams: ${g.teams.away.team.name} @ ${g.teams.home.team.name}, Status: ${g.status.detailedState} / ${g.status.abstractGameState}`);
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
}

run();

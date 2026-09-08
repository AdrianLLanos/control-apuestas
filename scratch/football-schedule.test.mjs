import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../script/app.js', import.meta.url), 'utf8');
const presenterSource = readFileSync(new URL('../script/football-auto-presenter.js', import.meta.url), 'utf8');
const presenter = await import(`data:text/javascript;base64,${Buffer.from(presenterSource).toString('base64')}`);
const context = vm.createContext({Date: class extends Date {
  static now() { return Date.parse('2026-09-08T18:00:00Z'); }
}});
for (const name of ['normalizarEstadoExternoTexto', 'esEstadoJuegoPrevio',
  'fechaJuegoYaPaso', 'debeMostrarHorarioJuego', 'getEstadoJuegoFutbol',
  'autoTieneResultadoVisible', 'jugadaTieneResultadoAutoVisible']) {
  const match = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'));
  assert.ok(match, name);
  vm.runInContext(match[0], context);
}
const detail = 'Mar, Septiembre 8º at 3:00 p.\u00a0m. EDT';
const fechaJuego = '2026-09-08T19:00Z';
assert.equal(context.debeMostrarHorarioJuego(fechaJuego, detail), true);
assert.equal(context.getEstadoJuegoFutbol({status: {type: {state: 'pre', detail}}}), 'Programado');
assert.equal(context.getEstadoJuegoFutbol({competitions: [{status: {type: {state: 'pre', detail}}}]}), 'Programado');
assert.equal(context.debeMostrarHorarioJuego(fechaJuego, 'In Progress'), false);
assert.equal(context.debeMostrarHorarioJuego(fechaJuego, 'Final'), false);
assert.equal(context.debeMostrarHorarioJuego('2026-09-08T17:00Z', detail), false);
const selections = ['total_goles', 'total_corners'].map(mercado => ({autoFutbol: {
  mercado, fechaJuego, estadoJuego: detail, marcador: null, cornersEquipo: null
}}));
const suppressSchedule = context.jugadaTieneResultadoAutoVisible({selections});
assert.equal(suppressSchedule, false);
const rendered = selections.map((selection, index) => presenter.getAutoFutbolMarcadorHtml(selection, {
  showAutoMeta: index === selections.length - 1, suppressSchedule
}, {
  debeMostrarHorarioJuego: context.debeMostrarHorarioJuego,
  formatFechaJuego: iso => `Hoy a las ${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(iso))}`
}));
assert.equal(rendered[0], '');
assert.equal(rendered[1], '<div class="auto-mlb-score auto-mlb-score--status">Hoy a las 15:00</div>');
console.log('Real Madrid / Inter: scheduled time appears once below the last selection, at 15:00 Bolivia.');

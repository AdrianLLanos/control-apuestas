import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../script/app.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../script/football-auto-presenter.js', import.meta.url), 'utf8');
const presenter = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const names = ['normalizarNumeroEstadisticaFutbol', 'extraerValorCornersFutbol',
  'getEquiposEstadisticasEspn', 'getCornersEquipoFutbol', 'getTotalCornersDesdeEquiposFutbol',
  'getCornersEquipoFallbackFutbol', 'obtenerCornersDetalleEnOrden'];
const context = vm.createContext({
  normalizarTextoMercado: value => String(value).toLowerCase(),
  scoreEquipoFutbol: (name, team) => name === team.name ? 1 : 0,
  escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
});
for (const name of names) {
  const match = app.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'));
  assert.ok(match, name);
  vm.runInContext(match[0], context);
}
const team = (id, name, corners) => ({team: {id, displayName: name}, statistics: [
  {name: 'unavailable', displayName: 'Corner Kicks', value: corners}
]});
const home = team('1', 'Club Brujas', 2);
const away = team('2', 'Aston Villa', 1);
const marcador = {homeTeam: 'Club Brujas', awayTeam: 'Aston Villa'};
const summary = {boxscore: {teams: [home]}, header: {competitions: [{competitors: [home, away]}]}};
const stats = context.getCornersEquipoFutbol(summary, marcador);
assert.equal(stats.home.corners, 2);
assert.equal(stats.away.corners, 1);
assert.equal(stats.total, 3);
const partial = context.getCornersEquipoFutbol({boxscore: {teams: [home]}, scoreboardEvent: {competitions: [{competitors: [home]}]}}, marcador);
assert.equal(partial.total, null, 'One team repeated is not a match total');
assert.equal(partial.away, null);
assert.equal(context.getTotalCornersDesdeEquiposFutbol({home: {corners: null}, away: {corners: 1}}), null);
const auto = {mercado: 'total_corners', equipos: ['Club Brujas', 'Aston Villa'], totalCorners: 3};
const completed = presenter.completarAutoFutbolRenderDesdeJugada({autoFutbol: auto}, {selections: [
  {autoFutbol: {...auto, mercado: 'total_goles', marcador: 'Club Brujas 1 - 2 Aston Villa', sincronizadoEn: 20}},
  {autoFutbol: {...auto, cornersEquipo: stats, sincronizadoEn: 10}}
]});
assert.equal(completed.autoFutbol.cornersEquipo, stats, 'Goal metadata must not hide the corner breakdown');
const html = presenter.getAutoFutbolMarcadorHtml(completed, {}, context);
assert.ok(html.includes('Club Brujas 2 - 1 Aston Villa &middot; Total: 3'));
const reverse = presenter.getAutoFutbolMarcadorHtml({autoFutbol: {...completed.autoFutbol, equipos: ['Aston Villa', 'Club Brujas']}}, {}, context);
assert.ok(reverse.includes('Aston Villa 1 - 2 Club Brujas'));
const missing = presenter.getAutoFutbolMarcadorHtml({autoFutbol: auto}, {}, context);
assert.ok(missing.includes('Club Brujas — - — Aston Villa'));
assert.ok(missing.includes('desglose pendiente'));
const zero = context.getCornersEquipoFallbackFutbol({...auto, totalCorners: 0});
assert.equal(zero.home.corners, 0);
assert.equal(zero.away.corners, 0);
const selectedZero = context.getCornersEquipoFallbackFutbol({...auto, totalCorners: 0, seleccionEquipo: 'Club Brujas'});
assert.equal(selectedZero.home.corners, null, 'A team total does not imply zero corners for its opponent');
console.log('Football corners regression checks passed.');

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../script/app.js', import.meta.url), 'utf8');
const context = vm.createContext({
  juegoFutbolNoIniciado: game => game.pre,
  getMarcadorFutbol: game => game.score,
  juegoFutbolFinalizado: game => game.final,
  juegoFutbolReglamentarioProbablementeTerminado: game => game.final,
  getScoreEquipoMarcadorFutbol: (team, score) => team === 'Local'
    ? {seleccionado: score.home, rival: score.away}
    : {seleccionado: score.away, rival: score.home}
});
for (const name of ['evaluarAutoFutbol', 'extraerNumeroConSigno']) {
  const match = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'));
  assert.ok(match);
  vm.runInContext(match[0], context);
}
assert.equal(context.extraerNumeroConSigno('Hándicap Real Madrid +0'), 0);
const evaluate = (home, away, linea = 0, final = true, deporte = 'futbol', team = 'Local') =>
  context.evaluarAutoFutbol({mercado: 'handicap', linea, deporte, seleccionEquipo: team},
    {score: {home, away}, final});
assert.equal(evaluate(2, 1).estado, 'ganada');
assert.equal(evaluate(1, 1).estado, 'ganada');
assert.equal(evaluate(0, 0).estado, 'ganada');
assert.equal(evaluate(0, 1).estado, 'perdida');
assert.equal(evaluate(0, 1, 0, true, 'futbol', 'Visitante').estado, 'ganada');
assert.equal(evaluate(1, 1, 0, false), null);
assert.equal(evaluate(1, 1, 0, true, 'nfl').estado, 'nula');
assert.equal(evaluate(0, 1, 1).estado, 'nula');
assert.equal(evaluate(0, 6, 7).estado, 'ganada');
assert.equal(evaluate(6, 0, -7).estado, 'perdida');
console.log('Football handicap: zero wins on win/draw, loses on defeat, waits for final; other lines and NFL unchanged.');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = async path => import(`data:text/javascript;base64,${Buffer.from(
  readFileSync(new URL(path, import.meta.url), 'utf8')
).toString('base64')}`);
const { completarMarcadoresFutbol, guardarMarcadoresFutbol } = await load('../script/sports/pending-sync.js');
const { getAutoFutbolMarcadorHtml } = await load('../script/football-auto-presenter.js');

// Fictional provider fixture: resolved selections must gain visible statistics
// without changing their original settlement or the bet's financial values.
for (const estado of ['ganada', 'perdida', 'nula']) {
  const apuesta = { id: 'fixture', resultado: estado, cuota: 2, importe: 10,
    jugadas: [{ ev: 'Equipo A vs Equipo B', estado, selections: [
      { titulo: 'Total de goles', jugada: 'Más de 2.5', estado },
      { titulo: 'Total tiros de esquina', jugada: 'Más de 7.5', estado }
    ] }] };
  const originales = structuredClone(apuesta);
  const nuevas = [{ estado: 'pendiente', selections: [
    { estado: 'pendiente', autoFutbol: { mercado: 'total_goles', marcador: 'Equipo A 2 - 1 Equipo B', estadoJuego: 'Final' } },
    { estado: 'pendiente', autoFutbol: { mercado: 'total_corners', totalCorners: 9, estadoJuego: 'Final' } }
  ] }];
  const jugadas = completarMarcadoresFutbol(apuesta.jugadas, nuevas);
  assert.equal(jugadas[0].estado, estado);
  assert.ok(jugadas[0].selections.every(sel => sel.estado === estado));
  assert.match(getAutoFutbolMarcadorHtml(jugadas[0].selections[0]), /Equipo A 2 - 1 Equipo B/);
  assert.match(getAutoFutbolMarcadorHtml(jugadas[0].selections[1]), /Total: 9/);
  assert.deepEqual(apuesta, originales);

  for (const condition of ['current', 'edited', 'deleted']) {
    const writes = [];
    const current = condition === 'edited' ? { ...apuesta, importe: 20 } : apuesta;
    const saved = await guardarMarcadoresFutbol({
      apuesta, updateData: { jugadas: nuevas, resultado: 'pendiente', cuota: 99 },
      runTransaction: async (_, callback) => callback({
        get: async () => ({ exists: () => condition !== 'deleted', data: () => current }),
        update: (_, data) => writes.push(data)
      })
    });
    assert.equal(saved, condition === 'current');
    assert.deepEqual(writes, condition === 'current' ? [{ jugadas }] : []);
  }
}
console.log('Resolved football scores render; settlement is preserved; concurrent edits and deleted bets are protected.');

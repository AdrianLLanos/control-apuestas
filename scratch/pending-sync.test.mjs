import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../script/sports/pending-sync.js', import.meta.url), 'utf8');
const policy = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { apuestaResultadoPendiente, seleccionPendiente, cargarTodasLasPaginas,
  preservarSeleccionesResueltas, guardarSiSiguePendiente } = policy;

for (const resultado of ['ganada', 'perdida', 'nula']) {
  assert.equal(apuestaResultadoPendiente({ resultado, autoSync: { estado: 'pendiente' }, partidoActivo: true }), false);
  assert.equal(seleccionPendiente({ estado: resultado }), false);
}
assert.equal(apuestaResultadoPendiente({ resultado: 'pendiente', fecha: '2020-01-01' }), true);

// More than two pages, including the exact-page-size and empty cases.
for (const total of [0, 250, 501]) {
  const docs = Array.from({ length: total }, (_, id) => ({ id }));
  const cursors = [];
  const found = await cargarTodasLasPaginas(async cursor => {
    cursors.push(cursor?.id);
    return docs.slice(cursor ? cursor.id + 1 : 0, (cursor ? cursor.id + 1 : 0) + 250);
  }, 250);
  assert.deepEqual(found, docs);
  assert.equal(cursors.length, Math.floor(total / 250) + 1);
}
await assert.rejects(cargarTodasLasPaginas(async () => { throw Error('offline'); }, 250), /offline/);

const original = [{ selections: [
  { jugada: 'Gana A', estado: 'ganada', autoFutbol: { marcador: '2-0' } },
  { jugada: 'Más de 2 goles', estado: 'pendiente' },
  { jugada: 'Hándicap A +1', estado: 'nula' }
] }, { estado: 'perdida', jug: 'Gana B' }];
const updated = [{ selections: original[0].selections.map(s => ({ ...s, estado: 'perdida', autoFutbol: { marcador: '9-9' } })) }, { estado: 'ganada' }];
const preserved = preservarSeleccionesResueltas(original, updated);
assert.deepEqual(preserved[0].selections[0], original[0].selections[0]);
assert.equal(preserved[0].selections[1].estado, 'perdida');
assert.deepEqual(preserved[0].selections[2], original[0].selections[2]);
assert.deepEqual(preserved[1], original[1]);

const apuesta = { id: 'a', resultado: 'pendiente', jugadas: original, importe: 10 };
const updateData = { resultado: 'ganada', jugadas: preserved };
async function attempt(current, exists = true) {
  const writes = [];
  const result = await guardarSiSiguePendiente({
    db: {}, ref: 'apuestas/a', apuesta, updateData,
    runTransaction: async (_, callback) => callback({
      get: async () => ({ exists: () => exists, data: () => current }),
      update: (ref, data) => writes.push({ ref, data })
    })
  });
  return { result, writes };
}
assert.equal((await attempt(apuesta)).writes.length, 1);
// Key ordering alone is not an edit.
assert.equal((await attempt({ importe: 10, jugadas: original, resultado: 'pendiente', id: 'a' })).result, true);
for (const resultado of ['ganada', 'perdida', 'nula']) {
  assert.equal((await attempt({ ...apuesta, resultado })).writes.length, 0);
}
assert.equal((await attempt(apuesta, false)).writes.length, 0);
assert.equal((await attempt({ ...apuesta, importe: 15 })).writes.length, 0);
assert.equal((await attempt({ ...apuesta, jugadas: preserved })).writes.length, 0);

// Exercise the application's query and sport filtering against fake Firestore.
const app = readFileSync(new URL('../script/app.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const rows = Array.from({ length: 503 }, (_, i) => ({ id: String(i), resultado: i < 501 ? 'pendiente' : 'ganada', deporte: ['mlb', 'futbol', 'nfl'][i % 3], fecha: '2020-01-01' }));
const queries = [];
const context = vm.createContext({
  ...policy, db: {}, AUTO_SYNC_GLOBAL_PENDING_LIMIT: 250,
  collection: (_, name) => name, where: (...args) => ({ kind: 'where', args }),
  firestoreLimit: size => ({ kind: 'limit', size }), startAfter: doc => ({ kind: 'cursor', doc }),
  query: (_, ...constraints) => constraints,
  getDocs: async constraints => {
    queries.push(constraints);
    assert.deepEqual(constraints.find(x => x.kind === 'where').args, ['resultado', '==', 'pendiente']);
    const cursor = constraints.find(x => x.kind === 'cursor')?.doc;
    const filtered = rows.filter(r => r.resultado === 'pendiente' && (!cursor || Number(r.id) > Number(cursor.id))).slice(0, 250);
    return { docs: filtered.map(row => ({ id: row.id, data: () => row })) };
  },
  normalizarFechaDeApuesta: value => value,
  deduplicarApuestasPorId: values => [...new Map(values.map(v => [v.id, v])).values()],
  apuestaPareceMlb: a => a.deporte === 'mlb', apuestaPareceFutbol: a => a.deporte === 'futbol', apuestaPareceNfl: a => a.deporte === 'nfl'
});
const start = app.indexOf('async function cargarApuestasAutoSyncGlobal()');
const end = app.indexOf('async function guardarActualizacionSyncPendiente(', start);
vm.runInContext(app.slice(start, end), context);
for (const sport of ['mlb', 'futbol', 'nfl']) {
  const found = await vm.runInContext(`getApuestasAutoSyncScope('${sport}')`, context);
  assert.equal(found.length, 167);
  assert.ok(found.every(a => a.resultado === 'pendiente' && a.deporte === sport && a.fecha === '2020-01-01'));
}
assert.equal(queries.length, 9);
// Manual and automatic calls share one in-flight operation per sport.
const lockStart = app.indexOf('const sincronizacionesPendientesEnCurso = new Map();');
const lockEnd = app.indexOf('\nfunction getCasasParaResumen()', lockStart);
let runs = 0, release;
context.sincronizarResultadosMlbInterno = async () => { runs++; await new Promise(resolve => { release = resolve; }); };
vm.runInContext(app.slice(lockStart, lockEnd), context);
const manual = vm.runInContext('sincronizarResultadosMlb(false)', context);
const automatic = vm.runInContext('sincronizarResultadosMlb(true)', context);
assert.equal(manual, automatic);
await Promise.resolve();
assert.equal(runs, 1);
release();
await manual;
// Resolved bets short-circuit before provider calls in both evaluators.
for (const [name, next] of [['aplicarResultadoMlbApuesta', 'function apuestaMlbNecesitaHorario'], ['aplicarResultadoFutbolApuesta', 'let _syncFutbolEnCurso']]) {
  const a = app.indexOf(`async function ${name}(`);
  const b = app.indexOf(next, a);
  vm.runInContext(app.slice(a, b), context);
  assert.equal(await vm.runInContext(`${name}({resultado: 'ganada'})`, context), null);
}
console.log('OK: pending-only policy, 501 records paginated across all sports, settled selections preserved, atomic stale/deleted/resolved-write protection.');

// A manual click must not pull resolved bets from the visible history.
const syncSource = app.match(/^async function sincronizarResultadosFutbolInterno\([\s\S]*?^}/m)[0];
for (const silencioso of [false, true]) {
  for (const resultado of ['ganada', 'perdida', 'nula']) {
    const syncContext = vm.createContext({
      ...policy, _syncFutbolEnCurso: false,
      obtenerFechaActualLocal: () => '2026-09-10',
      getApuestasAutoSyncScope: async () => [{id: 'resolved', resultado,
        fecha: '2026-09-10', jugadas: [{selections: [{estado: resultado}]}]}],
      getApuestasFiltradas: () => { throw Error('Resolved history must not be scanned'); },
      apuestaPareceFutbol: () => true,
      apuestaSyncCerrada: () => false,
      setFootballSyncStatus() {},
      document: {getElementById() { throw Error('Provider work must not start for resolved bets'); }}
    });
    vm.runInContext(syncSource, syncContext);
    await syncContext.sincronizarResultadosFutbolInterno(silencioso);
    assert.equal(syncContext._syncFutbolEnCurso, false);
  }
}
console.log('OK: manual and automatic football sync skip won, lost and void bets, even without scores.');

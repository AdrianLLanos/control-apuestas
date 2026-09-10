import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../script/app.js', import.meta.url), 'utf8');
const rows = [
  { id: 'ayer', fecha: '2026-09-09', dia: '2026-09-09', casaId: 'casino', creadoEn: 1 },
  ...['futbol1', 'beisbol', 'futbol2'].map((id, i) => ({
    id, fecha: '2026-09-10', dia: '2026-09-10', casaId: 'principal', creadoEn: i + 2
  }))
];

function setup(filter = 'todas') {
  const context = vm.createContext({
    apuestas: [], paginaActual: 1, porPagina: 1, paginaInicialHistorialPendiente: true,
    casasSnapshotRecibido: false, apuestasSnapshotRecibido: false,
    ultimoDiaAgregado: null, renderSnapshotPendiente: false, visible: [], filter,
    compararApuestasOrdenTabla: (a, b) => a.creadoEn - b.creadoEn,
    programarSyncInicialVisible() {}, usuarioEstaEditandoFormulario: () => false,
    paginaEstaVisible: () => true, paginaRecienReactivada: () => false,
    requestAnimationFrame: callback => callback(), setTimeout: callback => callback()
  });
  for (const name of ['cargaInicialListaParaRender', 'getDiasKeysRender', 'ajustarPaginaHistorial',
    'getApuestasPorDiaPagina', 'renderApuestasCargadas', 'renderSnapshotProgramado']) {
    const match = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  vm.runInContext(`
    function getApuestasFiltradas() {
      return apuestas.filter(a => filter === 'todas' || a.casaId === filter);
    }
    function render() {
      const rows = getApuestasFiltradas();
      const days = getDiasKeysRender(rows);
      ajustarPaginaHistorial(days);
      visible = Object.values(getApuestasPorDiaPagina(rows,
        days.slice((paginaActual - 1) * porPagina, paginaActual * porPagina))).flat();
    }
  `, context);
  return context;
}

for (const order of ['casas-primero', 'apuestas-primero']) {
  for (const filter of ['todas', 'principal']) {
    const c = setup(filter);
    const houses = () => { c.casasSnapshotRecibido = true; c.renderSnapshotProgramado(); };
    const bets = () => {
      c.apuestas = structuredClone(rows);
      c.apuestasSnapshotRecibido = true;
      c.renderApuestasCargadas();
    };
    if (order === 'casas-primero') { houses(); bets(); }
    else { bets(); assert.equal(c.visible.length, 0); houses(); }
    assert.equal(c.visible.length, 3, `${order}, ${filter}: all three bets for Sep 10`);
    assert.ok(c.visible.every(a => a.fecha === '2026-09-10'));
    assert.equal(c.paginaInicialHistorialPendiente, false);
  }
}

const c = setup();
c.casasSnapshotRecibido = c.apuestasSnapshotRecibido = true;
c.apuestas = structuredClone(rows);
c.renderApuestasCargadas();
c.paginaActual = 1;
c.renderSnapshotProgramado();
assert.equal(c.visible[0].fecha, '2026-09-09', 'Later house updates preserve deliberate navigation');
c.filter = 'principal';
c.renderApuestasCargadas();
assert.equal(c.paginaActual, 1, 'Page count uses dates in the selected house');
assert.equal(c.visible.length, 3);
c.apuestas = [];
c.renderApuestasCargadas();
assert.equal(c.paginaActual, 1);
assert.equal(c.visible.length, 0);
console.log('History: Sep 10 visible in both startup orders; filtered dates, navigation and empty history pass.');

// Exercise the real listener: cached yesterday must never be the first view.
for (const housesFirst of [true, false]) {
  const c = setup();
  Object.assign(c, {
    unsubscribeApuestas: null, apuestasExtraPaginadas: [], ultimoDocApuestas: null,
    hayMasApuestas: true, APUESTAS_PAGE_LIMIT: 80, inicializado: false,
    renderSilenciosoApuestas: new Set(), normalizarFechaDeApuesta: a => a,
    getConsultaApuestasPaginada: () => ({}), autocorregirApuestasCargadas() {},
    // Restored focus in the creation form must not suppress the initial history.
    usuarioEstaEditandoFormulario: () => true,
    onSnapshot: (query, options, callback) => {
      assert.equal(options.includeMetadataChanges, true);
      c.deliver = callback;
      return () => {};
    }
  });
  vm.runInContext(source.match(/^function cargarApuestasIniciales\([\s\S]*?^}/m)[0], c);
  c.cargarApuestasIniciales();
  c.casasSnapshotRecibido = housesFirst;
  const snapshot = (data, fromCache) => ({
    metadata: {fromCache}, docs: data.map(a => ({id: a.id, data: () => a})),
    docChanges: () => []
  });
  c.deliver(snapshot([rows[0]], true));
  assert.equal(c.apuestasSnapshotRecibido, false);
  assert.equal(c.paginaInicialHistorialPendiente, true);
  assert.equal(c.visible.length, 0, 'Do not display yesterday from the cache');
  c.deliver(snapshot(rows, false));
  if (!housesFirst) {
    c.casasSnapshotRecibido = true;
    c.renderSnapshotProgramado();
  }
  assert.equal(c.visible.length, 3, 'Today appears on the first server response');
  assert.ok(c.visible.every(a => a.fecha === '2026-09-10'));
}
console.log('Cached yesterday is withheld; the first server response displays today without reloading.');

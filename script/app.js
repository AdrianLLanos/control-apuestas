const deployModuleToken = new URL(import.meta.url).searchParams.get("deploy") ||
  new URL(import.meta.url).searchParams.get("v") ||
  Date.now().toString(36);
const withDeployToken = (path) =>
  `${path}${path.includes("?") ? "&" : "?"}deploy=${encodeURIComponent(deployModuleToken)}`;

const [
  firebaseStore,
  calculations,
  mlbModule,
  countriesModule,
  validationModal,
  marketConflicts,
  footballAutoPresenter
] = await Promise.all([
  import(withDeployToken("./firebase-store.js")),
  import(withDeployToken("./calculations.js")),
  import(withDeployToken("./mlb.js?v=2.1")),
  import(withDeployToken("./countries.js?v=1.1")),
  import(withDeployToken("./validation-modal.js")),
  import(withDeployToken("./sports/market-conflicts.js?v=1.1")),
  import(withDeployToken("./football-auto-presenter.js?v=1.0"))
]);

const {
  db,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  getDocs,
  getDoc,
  limit: firestoreLimit,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where
} = firebaseStore;
const {
  PATENTE_MIN_SELECTIONS,
  PATENTE_MAX_SELECTIONS,
  calcularCuotaMaximaPatente,
  calcularCuotaSimpleOptionBet,
  calcularDetallePatente,
  calcularRetornoApuesta,
  determinarResultadoSimpleOptionBet,
  determinarResultadoPatente,
  extraerNumeroJugada,
  formatCuotaTabla,
  formatDecimal
} = calculations;
const {
  MLB_TEAMS,
  autocorregirTextoConLogos,
  crearMlbTeamsDatalist,
  crearMlbPlaysDatalist,
  formatTextWithMlbTeams,
  habilitarAutocompleteMlb
} = mlbModule;
const { COUNTRY_FLAG_ENTRIES } = countriesModule;
const {
  cerrarModalValidacion,
  mostrarModalValidacion,
  registrarModalValidacionGlobal
} = validationModal;
const {
  combinarAutoMlbConDetectado,
  debeForzarIconoGol,
  esContextoMlb,
  quitarAutoFutbolSiEsMlb
} = marketConflicts;

let paginaActual = 1;
const porPagina = 1;
const APUESTAS_PAGE_LIMIT = 80;
const APUESTAS_VISIBLES_POR_DIA = 10;
const AUTO_SYNC_GLOBAL_PENDING_LIMIT = 250;
const AUTO_SYNC_GLOBAL_FECHA_LIMIT = 160;

/* =========================
   ESTADO
 ========================= */
let apuestas = [];
let ultimoDiaAgregado = null;
let ultimoDiaAgregadoTime = 0;
let ultimoDiaAgregadoIntentos = 0;
let editandoId = null;
let isEditingFinal = false;
const apuestasVisiblesPorDia = {};
/* =========================
   CASAS / BANKROLL
 ========================= */
const CASA_DEFAULT_ID = "casa_principal";
const CASA_TODAS_ID = "todas";
let casas = [];
let casaFormularioId = CASA_DEFAULT_ID;
let filtroCasaId = CASA_TODAS_ID;
let casasSnapshotRecibido = false;
let apuestasSnapshotRecibido = false;

function normalizarCasa(casa = {}) {
  return {
    id: casa.id || CASA_DEFAULT_ID,
    nombre: casa.nombre || "Casa principal",
    bankrollInicial: parseFloat(casa.bankrollInicial ?? casa.valor) || 0,
    ajuste: parseFloat(casa.ajuste) || 0,
    activa: casa.activa !== false,
    creadoEn: casa.creadoEn || 0
  };
}

function limpiarCacheLocalObsoleto() {
  try {
    Object.keys(localStorage)
      .filter(key => key.startsWith("apuestas-cache-"))
      .forEach(key => localStorage.removeItem(key));
  } catch (e) {
    console.warn("No se pudo limpiar cache local:", e);
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCasasDisponibles() {
  const activas = casas.filter(c => c.activa !== false);
  const base = activas.length ? activas : [normalizarCasa({ id: CASA_DEFAULT_ID })];
  return deduplicarCasasPorNombre(base);
}

function getCasasRegistradas() {
  const base = casas.length ? casas : [normalizarCasa({ id: CASA_DEFAULT_ID })];
  return deduplicarCasasPorNombre(base);
}

function deduplicarCasasPorNombre(base) {
  const vistas = [];
  const nombres = new Set();

  base.forEach(casa => {
    const key = normalizarNombreCasa(casa.nombre);
    if (nombres.has(key)) return;
    nombres.add(key);
    vistas.push(casa);
  });

  return vistas;
}

function getCasaPorId(id) {
  return casas.find(c => c.id === id) || getCasasDisponibles()[0] || normalizarCasa();
}

function getCasaNombre(id) {
  return getCasaPorId(id).nombre;
}

function getCasaIdApuesta(apuesta) {
  return apuesta?.casaId || CASA_DEFAULT_ID;
}

function normalizarNombreCasa(nombre = "") {
  return String(nombre).trim().replace(/\s+/g, " ").toLowerCase();
}

function getApuestasFiltradas() {
  if (filtroCasaId === CASA_TODAS_ID) return apuestas;
  return apuestas.filter(a => getCasaIdApuesta(a) === filtroCasaId);
}

function getApuestasSyncScope(silencioso = false) {
  if (!silencioso) return getApuestasFiltradas();
  if (filtroCasaId === CASA_TODAS_ID) return apuestas;
  return apuestas.filter(a => getCasaIdApuesta(a) === filtroCasaId);
}

function apuestaPerteneceFiltroActual(apuesta = {}) {
  return filtroCasaId === CASA_TODAS_ID || getCasaIdApuesta(apuesta) === filtroCasaId;
}

function deduplicarApuestasPorId(lista = []) {
  return [...new Map(
    lista
      .filter(Boolean)
      .map(apuesta => [apuesta.id || `${apuesta.fecha || apuesta.dia || ""}-${apuesta.creadoEn || ""}`, apuesta])
  ).values()];
}

function getFechasAutoSyncGlobal(deporte = "") {
  const hoy = obtenerFechaActualLocal();
  const fechas = [hoy];
  const lookback = deporte === "futbol" ? API_SPORTS_FOOTBALL_SILENT_SYNC_LOOKBACK_DAYS : 0;
  const base = new Date(`${hoy}T00:00:00`);
  if (!Number.isNaN(base.getTime())) {
    for (let i = 1; i <= lookback; i++) {
      const fecha = new Date(base);
      fecha.setDate(fecha.getDate() - i);
      fechas.push(formatFechaLocal(fecha));
    }
  }
  return [...new Set(fechas)];
}

async function cargarApuestasAutoSyncGlobal(deporte = "") {
  const fechas = getFechasAutoSyncGlobal(deporte);
  const consultas = [
    query(collection(db, "apuestas"), where("resultado", "==", "pendiente"), firestoreLimit(AUTO_SYNC_GLOBAL_PENDING_LIMIT)),
    ...fechas.flatMap(fecha => [
      query(collection(db, "apuestas"), where("fecha", "==", fecha), firestoreLimit(AUTO_SYNC_GLOBAL_FECHA_LIMIT)),
      query(collection(db, "apuestas"), where("dia", "==", fecha), firestoreLimit(AUTO_SYNC_GLOBAL_FECHA_LIMIT))
    ])
  ];

  const snapshots = await Promise.allSettled(consultas.map(consulta => getDocs(consulta)));
  const apuestasGlobales = snapshots.flatMap(resultado => {
    if (resultado.status !== "fulfilled") {
      console.warn("No se pudo cargar una tanda global para auto-sync:", resultado.reason?.message || resultado.reason);
      return [];
    }
    return resultado.value.docs.map(d => normalizarFechaDeApuesta({ ...d.data(), id: d.id }));
  });

  return deduplicarApuestasPorId(apuestasGlobales);
}

async function getApuestasAutoSyncScope(deporte = "") {
  const locales = getApuestasSyncScope(true);
  const globales = await cargarApuestasAutoSyncGlobal(deporte);
  const pareceDeporte = deporte === "mlb"
    ? apuestaPareceMlb
    : deporte === "futbol"
      ? apuestaPareceFutbol
      : () => true;
  return deduplicarApuestasPorId([...locales, ...globales]).filter(pareceDeporte);
}

function getCasasParaResumen() {
  if (filtroCasaId === CASA_TODAS_ID) return getCasasRegistradas();
  return [getCasaPorId(filtroCasaId)];
}

function getCasasParaEdicion(apuesta) {
  const disponibles = getCasasDisponibles();
  const actual = getCasaPorId(getCasaIdApuesta(apuesta));
  if (!disponibles.some(c => c.id === actual.id)) {
    return [...disponibles, actual];
  }
  return disponibles;
}

function getOrdenTablaApuesta(apuesta = {}) {
  return Number(apuesta.ordenTabla ?? apuesta.creadoEn ?? 0);
}

function compararApuestasOrdenTabla(a, b) {
  const ordenDiff = getOrdenTablaApuesta(a) - getOrdenTablaApuesta(b);
  if (ordenDiff !== 0) return ordenDiff;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function normalizarFechaDeApuesta(apuesta = {}) {
  const fecha = apuesta.fecha || apuesta.dia;
  if (!fecha) return apuesta;
  const normalized = String(fecha);
  if (apuesta.fecha !== normalized || apuesta.dia !== normalized) {
    apuesta.fecha = normalized;
    apuesta.dia = normalized;
  }
  return apuesta;
}

async function asegurarCasaPrincipal() {
  const casaRef = doc(db, "casas", CASA_DEFAULT_ID);
  const casaSnap = await getDoc(casaRef);
  if (casaSnap.exists()) return;

  const legacySnap = await getDoc(doc(db, "config", "bankroll"));
  const legacy = legacySnap.exists() ? legacySnap.data() : {};
  await setDoc(casaRef, {
    nombre: "Casa principal",
    bankrollInicial: parseFloat(legacy.valor) || 0,
    ajuste: parseFloat(legacy.ajuste) || 0,
    activa: true,
    creadoEn: 0
  }, { merge: true });
}

function renderCasasControls() {
  const opcionesCasa = getCasasDisponibles()
    .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nombre)}</option>`)
    .join("");
  const opcionesFiltro = getCasasRegistradas()
    .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nombre)}${c.activa === false ? " (inactiva)" : ""}</option>`)
    .join("");
  const opcionesEliminar = getCasasDisponibles()
    .filter(c => c.id !== CASA_DEFAULT_ID)
    .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nombre)}</option>`)
    .join("");

  const casaSelect = document.getElementById("casaApuesta");
  if (casaSelect) {
    casaSelect.innerHTML = opcionesCasa;
    if (!getCasasDisponibles().some(c => c.id === casaFormularioId)) {
      casaFormularioId = getCasasDisponibles()[0]?.id || CASA_DEFAULT_ID;
    }
    casaSelect.value = casaFormularioId;
  }

  const filtroSelect = document.getElementById("filtroCasa");
  if (filtroSelect) {
    filtroSelect.innerHTML = `<option value="${CASA_TODAS_ID}">Todas las casas</option>${opcionesFiltro}`;
    if (filtroCasaId !== CASA_TODAS_ID && !getCasasRegistradas().some(c => c.id === filtroCasaId)) {
      filtroCasaId = CASA_TODAS_ID;
    }
    filtroSelect.value = filtroCasaId;
  }

  const bankrollInput = document.getElementById("bankroll");
  if (bankrollInput) {
    bankrollInput.placeholder = `Bankroll inicial - ${getCasaNombre(casaFormularioId)}`;
  }

  const eliminarSelect = document.getElementById("casaEliminar");
  if (eliminarSelect) {
    const valorActual = eliminarSelect.value;
    eliminarSelect.innerHTML = `<option value="">Casa a eliminar</option>${opcionesEliminar}`;
    eliminarSelect.value = getCasasDisponibles().some(c => c.id === valorActual) ? valorActual : "";
  }
}

function escucharCasas() {
  asegurarCasaPrincipal().catch(e => console.error("Error creando casa principal:", e));
  onSnapshot(collection(db, "casas"), (snapshot) => {
    if (!casasSnapshotRecibido) {
      casas = snapshot.docs.map(d => normalizarCasa({ ...d.data(), id: d.id }));
      casasSnapshotRecibido = true;
    } else {
      snapshot.docChanges().forEach(change => {
        const id = change.doc.id;
        if (change.type === "removed") {
          casas = casas.filter(casa => casa.id !== id);
          return;
        }

        const casa = normalizarCasa({ ...change.doc.data(), id });
        const index = casas.findIndex(item => item.id === id);
        if (index >= 0) casas[index] = casa;
        else casas.push(casa);
      });
    }

    casas.sort((a, b) => (a.creadoEn || 0) - (b.creadoEn || 0) || a.nombre.localeCompare(b.nombre));

    if (!casas.some(c => c.id === CASA_DEFAULT_ID)) {
      casas.unshift(normalizarCasa({ id: CASA_DEFAULT_ID }));
    }

    renderCasasControls();
    renderSnapshotProgramado();
  }, (error) => {
    console.error("Error escuchando casas en tiempo real:", error);
    mostrarModalValidacion(["No se pudo sincronizar las casas de apuestas en tiempo real: " + error.message]);
  });
}

/* =========================
   GUARDAR BANKROLL
 ========================= */
async function guardarBankroll() {
  const valorVal = document.getElementById("bankroll").value.trim();
  const valor = parseFloat(valorVal);
  const casa = getCasaPorId(casaFormularioId);

  if (!valorVal || isNaN(valor) || valor <= 0) {
    mostrarModalValidacion(["Ingresa un bankroll inicial válido (mayor a 0)."]);
    return;
  }

  try {
    await setDoc(doc(db, "casas", casa.id), {
      nombre: casa.nombre,
      bankrollInicial: valor,
      activa: true
    }, { merge: true });

    casas = getCasasDisponibles().map(c =>
      c.id === casa.id ? { ...c, bankrollInicial: valor, activa: true } : c
    );
    document.getElementById("bankroll").value = "";
    renderCasasControls();
    render();
  } catch (e) {
    console.error("Error al guardar el bankroll:", e);
    mostrarModalValidacion(["Error al guardar el bankroll inicial en la base de datos: " + e.message]);
  }
}

async function crearCasa() {
  const input = document.getElementById("nuevaCasa");
  const nombre = input?.value.trim();
  if (!nombre) {
    mostrarModalValidacion(["Escribe el nombre de la casa de apuestas."]);
    return;
  }

  const existente = getCasasRegistradas().find(c => normalizarNombreCasa(c.nombre) === normalizarNombreCasa(nombre));
  if (existente) {
    mostrarModalValidacion([`La casa "${existente.nombre}" ya existe. Usa otro nombre.`]);
    return;
  }

  const id = `casa_${Date.now()}`;
  const nuevaCasa = normalizarCasa({
    id,
    nombre,
    bankrollInicial: 0,
    ajuste: 0,
    activa: true,
    creadoEn: Date.now()
  });

  try {
    await setDoc(doc(db, "casas", id), {
      nombre: nuevaCasa.nombre,
      bankrollInicial: nuevaCasa.bankrollInicial,
      ajuste: nuevaCasa.ajuste,
      activa: nuevaCasa.activa,
      creadoEn: nuevaCasa.creadoEn
    });

    const filtroAnterior = filtroCasaId;
    casas = [...casas.filter(c => c.id !== id), nuevaCasa];
    casaFormularioId = id;
    filtroCasaId = id;
    if (input) input.value = "";
    renderCasasControls();
    if (filtroAnterior !== filtroCasaId) {
      cargarApuestasIniciales();
    } else {
      render();
    }
    await mostrarModalCasa({
      tipo: "success",
      titulo: "Casa de apuestas creada",
      mensaje: "La nueva casa ya esta lista para registrar apuestas.",
      nombre: nuevaCasa.nombre,
      confirmarTexto: "Entendido"
    });
  } catch (e) {
    console.error("Error al crear la casa de apuestas:", e);
    mostrarModalValidacion(["Error al guardar la casa de apuestas en la base de datos: " + e.message]);
  }
}

async function eliminarCasaSeleccionada() {
  const casaEliminarId = document.getElementById("casaEliminar")?.value || "";
  if (!casaEliminarId) {
    mostrarModalValidacion(["Selecciona una casa para eliminar."]);
    return;
  }

  const casa = getCasaPorId(casaEliminarId);
  if (!casa || casa.id === CASA_DEFAULT_ID) {
    mostrarModalValidacion(["La Casa principal no se puede eliminar."]);
    return;
  }

  const tieneApuestas = apuestas.some(a => getCasaIdApuesta(a) === casa.id);
  const confirmado = await mostrarModalCasa({
    tipo: "confirm",
    titulo: "Eliminar casa de apuestas",
    mensaje: tieneApuestas
      ? "Esta casa tiene apuestas guardadas. Se ocultara para nuevas apuestas, pero el historial se conserva. Seguro que quiere eliminar esta casa?"
      : "Seguro que quiere eliminar esta casa?",
    nombre: casa.nombre,
    confirmarTexto: "Confirmar"
  });

  if (!confirmado) return;

  const filtroAnterior = filtroCasaId;
  if (tieneApuestas) {
    await setDoc(doc(db, "casas", casa.id), {
      activa: false
    }, { merge: true });
    casas = casas.map(c => c.id === casa.id ? { ...c, activa: false } : c);
  } else {
    await deleteDoc(doc(db, "casas", casa.id));
    casas = casas.filter(c => c.id !== casa.id);
    if (filtroCasaId === casa.id) filtroCasaId = CASA_TODAS_ID;
  }

  const siguienteCasa = getCasasDisponibles()[0] || normalizarCasa();
  casaFormularioId = siguienteCasa.id;
  renderCasasControls();
  if (filtroAnterior !== filtroCasaId) {
    cargarApuestasIniciales();
  } else {
    render();
  }
  await mostrarModalCasa({
    tipo: "aviso",
    titulo: "Casa eliminada",
    mensaje: "La casa se elimino correctamente.",
    nombre: casa.nombre,
    confirmarTexto: "Entendido"
  });
}

function mostrarModalCasa({ tipo = "confirm", titulo, mensaje, nombre, confirmarTexto = "Confirmar" }) {
  const backdrop = document.getElementById("casa-confirm-modal");
  const content = backdrop?.querySelector(".custom-modal-content");
  const titleEl = document.getElementById("casa-confirm-title");
  const iconEl = document.getElementById("casa-confirm-icon");
  const messageEl = document.getElementById("casa-confirm-message");
  const nameEl = document.getElementById("casa-confirm-name");
  const cancelBtn = document.getElementById("casa-confirm-cancel");
  const okBtn = document.getElementById("casa-confirm-ok");

  if (!backdrop || !titleEl || !iconEl || !messageEl || !nameEl || !cancelBtn || !okBtn) {
    return Promise.resolve(tipo !== "confirm");
  }

  titleEl.textContent = titulo;
  iconEl.textContent = tipo === "confirm" ? "!" : "✓";
  messageEl.textContent = mensaje;
  nameEl.textContent = nombre || "";
  okBtn.textContent = confirmarTexto;
  cancelBtn.style.display = tipo === "confirm" ? "inline-flex" : "none";
  okBtn.classList.toggle("custom-modal-btn-danger", tipo === "confirm");
  okBtn.classList.toggle("custom-modal-btn-success", tipo === "success");
  iconEl.classList.toggle("casa-confirm-icon-success", tipo === "success");
  nameEl.classList.toggle("casa-confirm-name-success", tipo === "success");
  content?.classList.toggle("casa-confirm-content-success", tipo === "success");

  backdrop.style.display = "flex";
  setTimeout(() => backdrop.classList.add("show"), 10);

  return new Promise(resolve => {
    const close = (result) => {
      backdrop.classList.remove("show");
      setTimeout(() => {
        backdrop.style.display = "none";
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        backdrop.onclick = null;
        resolve(result);
      }, 300);
    };

    okBtn.onclick = () => close(true);
    cancelBtn.onclick = () => close(false);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close(false);
    };
  });
}

/* =========================
   AJUSTE DE BANKROLL FINAL
 ========================= */
async function guardarAjusteFinal() {
  if (filtroCasaId === CASA_TODAS_ID) {
    mostrarModalValidacion(["Selecciona una casa especifica para ajustar el saldo final."]);
    return;
  }

  const input = document.getElementById("editBankrollFinalInput");
  if (!input) return;
  const nuevoFinal = parseFloat(input.value.trim());

  if (isNaN(nuevoFinal)) {
    mostrarModalValidacion(["Ingresa un valor numérico válido."]);
    return;
  }

  const total = calcularResumenGeneral();
  const casa = getCasaPorId(filtroCasaId);
  const rawBalance = total.balance;
  // nuevoFinal = bankrollInicial + rawBalance + nuevoAjuste - pendiente
  // nuevoAjuste = nuevoFinal - (bankrollInicial + rawBalance - pendiente)
  const nuevoAjuste = nuevoFinal - (total.bankrollInicial + rawBalance - total.pendiente);

  try {
    await setDoc(doc(db, "casas", casa.id), {
      ajuste: nuevoAjuste
    }, { merge: true });

    isEditingFinal = false;
    render();
  } catch (e) {
    console.error("Error al guardar ajuste:", e);
    mostrarModalValidacion(["Error al guardar en la base de datos: " + e.message]);
  }
}

function setEditingFinal(val) {
  isEditingFinal = val;
  render();
}

window.cambiarCasaFormulario = function (id) {
  casaFormularioId = id || CASA_DEFAULT_ID;
  renderCasasControls();
};

window.cambiarFiltroCasa = function (id) {
  const nuevoFiltro = id || CASA_TODAS_ID;
  const filtroAnterior = filtroCasaId;
  filtroCasaId = nuevoFiltro;
  if (filtroCasaId !== CASA_TODAS_ID) casaFormularioId = filtroCasaId;
  paginaActual = 1;
  isEditingFinal = false;
  Object.keys(apuestasVisiblesPorDia).forEach(dia => delete apuestasVisiblesPorDia[dia]);
  renderCasasControls();
  // Solo recargar Firestore si el filtro realmente cambió
  if (nuevoFiltro !== filtroAnterior) {
    cargarApuestasIniciales();
  } else {
    render();
  }
};

/* =========================
   RESUMEN GENERAL
 ========================= */
function calcularResumenGeneral() {
  let invertido = 0;
  let retornado = 0;
  let pendiente = 0;
  const lista = getApuestasFiltradas();

  lista.forEach(a => {
    if (a.resultado === "pendiente") {
      pendiente += a.importe || 0;
    } else {
      invertido += a.importe || 0;
      retornado += calcularRetornoApuesta(a);
    }
  });

  const casasResumen = getCasasParaResumen();
  const bankrollInicial = casasResumen.reduce((acc, c) => acc + (parseFloat(c.bankrollInicial) || 0), 0);
  const bankrollAjuste = casasResumen.reduce((acc, c) => acc + (parseFloat(c.ajuste) || 0), 0);
  const balance = retornado - invertido;

  return {
    invertido,
    retornado,
    pendiente,
    balance,
    bankrollInicial,
    bankrollAjuste,
    bankrollFinal: bankrollInicial + balance + bankrollAjuste - pendiente
  };
}

/* =========================
   ESTADÍSTICAS
 ========================= */
function actualizarResumenBankrollDom() {
  const resumenEl = document.getElementById("bankrollResumen");
  if (!resumenEl) return;

  const total = calcularResumenGeneral();
  const roi = total.invertido ? (total.balance / total.invertido) * 100 : 0;

  const setMoney = (selector, value) => {
    const el = resumenEl.querySelector(selector);
    if (el) el.textContent = `$${value.toFixed(2)}`;
  };

  const setClass = (selector, className) => {
    const el = resumenEl.querySelector(selector);
    if (el) el.className = className;
  };

  setMoney("[data-bankroll-inicial]", total.bankrollInicial);
  setMoney("[data-bankroll-invertido]", total.invertido);
  setMoney("[data-bankroll-pendiente]", total.pendiente);
  setMoney("[data-bankroll-retornado]", total.retornado);
  setMoney("[data-bankroll-balance]", total.balance);
  setMoney("[data-bankroll-final]", total.bankrollFinal);

  setClass("[data-bankroll-balance]", total.balance >= 0 ? "ganada" : "perdida");
  setClass("[data-bankroll-final]", total.bankrollFinal >= total.bankrollInicial ? "ganada" : "perdida");

  const roiEl = resumenEl.querySelector("[data-bankroll-roi]");
  if (roiEl) {
    roiEl.textContent = `${roi.toFixed(2)}%`;
    roiEl.className = roi >= 0 ? "ganada" : "perdida";
  }
}

function calcularEstadisticas() {
  let ganadas = 0;
  let perdidas = 0;
  let nulas = 0;
  let pendientes = 0;
  const lista = getApuestasFiltradas();

  lista.forEach(a => {
    if (a.resultado === "ganada") ganadas++;
    else if (a.resultado === "perdida") perdidas++;
    else if (a.resultado === "nula") nulas++;
    else if (a.resultado === "pendiente") pendientes++;
  });

  const total = ganadas + perdidas + nulas + pendientes || 1;

  return {
    pGanadas: (ganadas / total) * 100,
    pPerdidas: (perdidas / total) * 100,
    pNulas: (nulas / total) * 100,
    pPendientes: (pendientes / total) * 100
  };
}

function limpiarUndefinedFirestore(valor) {
  if (Array.isArray(valor)) {
    return valor
      .filter(item => item !== undefined)
      .map(item => limpiarUndefinedFirestore(item));
  }

  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([, item]) => item !== undefined)
        .map(([clave, item]) => [clave, limpiarUndefinedFirestore(item)])
    );
  }

  return valor;
}

function aplicarUpdateLocalApuesta(id, updateData = {}) {
  const index = apuestas.findIndex(apuesta => apuesta.id === id);
  if (index < 0) return false;
  apuestas[index] = normalizarFechaDeApuesta({
    ...apuestas[index],
    ...limpiarUndefinedFirestore(updateData),
    id
  });
  return true;
}

function getSelectionsFromJugada(jugada) {
  if (typeof jugada !== "object" || !jugada) {
    return [{ titulo: "", jugada: jugada || "", estado: "pendiente" }];
  }

  if (Array.isArray(jugada.selections) && jugada.selections.length > 0) {
    return jugada.selections.map(sel => ({
      ...sel,
      estado: sel.estado || "pendiente"
    }));
  }

  return [{
    titulo: "",
    jugada: jugada.jug || jugada.jugada || "",
    estado: jugada.estado || "pendiente"
  }];
}

function determinarEstadoJugada(jugada) {
  const selections = getSelectionsFromJugada(jugada);
  const hasPerdida = selections.some(sel => sel.estado === "perdida");
  const hasPendiente = selections.some(sel => sel.estado === "pendiente");
  const hasGanada = selections.some(sel => sel.estado === "ganada");
  const allNula = selections.length > 0 && selections.every(sel => sel.estado === "nula");

  if (hasPerdida) return "perdida";
  if (hasPendiente) return "pendiente";
  if (hasGanada) return "ganada";
  if (allNula) return "nula";
  return "pendiente";
}

function normalizarJugadasConEstado(jugadas = []) {
  return jugadas.map(jugada => {
    if (typeof jugada !== "object" || !jugada) {
      const jugadaTexto = autocorregirTextoApuesta(jugada || "");
      const selections = getSelectionsFromJugada(jugada);
      return {
        ev: "",
        jug: jugadaTexto,
        c: 0,
        estado: determinarEstadoJugada({ selections }),
        selections: selections.map(sel => ({
          ...sel,
          titulo: corregirTerminosMercado(sel.titulo || ""),
          jugada: autocorregirTextoApuesta(sel.jugada || jugadaTexto)
        }))
      };
    }

    const ev = autocorregirTextoApuesta(jugada.ev || jugada.evento || "");
    const selections = getSelectionsFromJugada(jugada).map(sel => ({
      ...sel,
      titulo: corregirTerminosMercado(sel.titulo || ""),
      jugada: autocorregirTextoApuesta(sel.jugada || "", ev)
    }));
    return {
      ...jugada,
      ev,
      selections,
      estado: determinarEstadoJugada({ ...jugada, selections })
    };
  });
}

function recalcularResultadoApuesta(apuesta) {
  if (apuesta.tipoApuesta === "patente") {
    return determinarResultadoPatente(apuesta);
  }
  if (apuesta.tipoApuesta === "simple_option_bet") {
    return determinarResultadoSimpleOptionBet(apuesta);
  }

  const jugadas = normalizarJugadasConEstado(apuesta.jugadas || []);
  const hasPerdida = jugadas.some(j => j.estado === "perdida");
  const hasPendiente = jugadas.some(j => j.estado === "pendiente");
  const hasGanada = jugadas.some(j => j.estado === "ganada");
  const allNula = jugadas.length > 0 && jugadas.every(j => j.estado === "nula");

  if (hasPerdida) return "perdida";
  if (hasPendiente) return "pendiente";
  if (hasGanada) return "ganada";
  if (allNula) return "nula";
  return "pendiente";
}

function recalcularCuotaCombinada(jugadas = []) {
  let cuotaTotal = 1;
  let tieneCuotas = false;

  jugadas.forEach(j => {
    const estado = determinarEstadoJugada(j);
    let cuota = (typeof j === "object" && j) ? parseFloat(j.c) : 1;
    if (estado === "nula") cuota = 1;
    if (cuota > 0) {
      cuotaTotal *= cuota;
      tieneCuotas = true;
    }
  });

  return tieneCuotas ? parseFloat(cuotaTotal.toFixed(2)) : 0;
}

function debeRecalcularCuotaCombinada(tipoApuesta) {
  return tipoApuesta === "combinada" ||
    tipoApuesta === "crear_apuesta" ||
    tipoApuesta === "crear_apuesta_simple";
}

function apuestaResultadoPendiente(apuesta = {}) {
  return (apuesta.resultado || "pendiente") === "pendiente";
}

function crearAutoSyncEstado(apuesta = {}, resultado = apuesta.resultado) {
  const base = apuesta.autoSync || {};
  const now = Date.now();

  if ((resultado || "pendiente") === "pendiente") {
    return {
      ...base,
      estado: "pendiente",
      cerradaEn: null,
      ultimaRevision: now
    };
  }

  return {
    ...base,
    estado: "cerrada",
    cerradaEn: base.cerradaEn || now,
    ultimaRevision: now
  };
}

function crearAutoSyncPayload(apuesta = {}, resultado = apuesta.resultado, payload = {}) {
  return {
    ...crearAutoSyncEstado(apuesta, resultado),
    ...payload
  };
}

function apuestaSyncCerrada(apuesta = {}) {
  return !apuestaResultadoPendiente(apuesta) && apuesta?.autoSync?.estado === "cerrada";
}

/* =========================
   FIREBASE LIVE
 ========================= */
let inicializado = false;
let ultimoScrollGuardado = 0;
const renderSilenciosoApuestas = new Set();
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MLB_AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000;
const AUTO_SYNC_RESUME_GRACE_MS = 12000;
const DEPLOY_VERSION_URL = "/version.json";
const DEPLOY_INDEX_URL = "/index.html";
const DEPLOY_VERSION_CHECK_MS = 5 * 1000;
const DEPLOY_TOKEN_KEY = "apuestas-deploy-token";
const DEPLOY_SIGNATURE_KEY = "apuestas-deploy-signature";
const autoSyncTimers = new Map();
let ultimoDocApuestas = null;
let hayMasApuestas = true;
let cargandoApuestas = false;
let unsubscribeApuestas = null;
let apuestasExtraPaginadas = [];
let usarConsultaApuestasFiltradaSinOrden = false;
let deployVersionActual = window.__APUESTAS_DEPLOY_SIGNATURE__ ||
  getStorageItemSeguro(sessionStorage, DEPLOY_SIGNATURE_KEY) ||
  getStorageItemSeguro(localStorage, DEPLOY_SIGNATURE_KEY) ||
  "";
let deployVersionReloading = false;
let deployVersionChecking = false;
let deployVersionTimerId = null;
let ultimaReactivacionPagina = Date.now();

function getStorageItemSeguro(storage, key) {
  try {
    return storage.getItem(key);
  } catch (error) {
    return "";
  }
}

function paginaEstaVisible() {
  return document.visibilityState !== "hidden";
}

function registrarReactivacionPagina() {
  ultimaReactivacionPagina = Date.now();
}

function paginaRecienReactivada(graceMs = AUTO_SYNC_RESUME_GRACE_MS) {
  return Date.now() - ultimaReactivacionPagina < graceMs;
}

function usuarioEstaEditandoFormulario() {
  if (typeof editandoId !== "undefined" && editandoId !== null) return true;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

function ejecutarCuandoEsteLibre(callback, timeout = 8000) {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout });
    return;
  }

  setTimeout(callback, 0);
}

function cederControlNavegador() {
  return new Promise(resolve => {
    if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
      window.requestAnimationFrame(() => setTimeout(resolve, 0));
      return;
    }

    setTimeout(resolve, 0);
  });
}

function crearTokenVersionDeploy(version = "") {
  let hash = 0;
  const texto = String(version);
  for (let i = 0; i < texto.length; i += 1) {
    hash = ((hash * 31) + texto.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36) || String(Date.now());
}

async function limpiarCachesNavegador() {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const keys = await window.caches.keys();
    await Promise.all(keys.map(key => window.caches.delete(key)));
  } catch (error) {
    console.warn("No se pudo limpiar cache del navegador:", error.message);
  }
}

async function recargarPorNuevoDeploy(version = "") {
  await limpiarCachesNavegador();
  const deployToken = crearTokenVersionDeploy(version);
  try {
    sessionStorage.setItem(DEPLOY_TOKEN_KEY, deployToken);
    localStorage.setItem(DEPLOY_TOKEN_KEY, deployToken);
    sessionStorage.setItem(DEPLOY_SIGNATURE_KEY, version);
    localStorage.setItem(DEPLOY_SIGNATURE_KEY, version);
  } catch (error) {
    console.warn("No se pudo guardar el token del deploy:", error.message);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("deploy", deployToken);
  url.searchParams.set("t", Date.now().toString(36));
  window.location.replace(url.toString());
}

async function obtenerVersionDeployActual() {
  try {
    const response = await fetch(`${DEPLOY_VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache"
      }
    });
    if (!response.ok) return "";

    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return text.trim();
    }

    return [
      data?.version,
      data?.deployId,
      data?.deployedAt,
      data?.assetToken
    ].filter(Boolean).map(item => String(item).trim()).join("|");
  } catch (error) {
    console.warn("No se pudo revisar la version desplegada:", error.message);
    return "";
  }
}

async function obtenerFirmaIndexDeployActual() {
  try {
    const response = await fetch(`${DEPLOY_INDEX_URL}?t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache"
      }
    });
    if (!response.ok) return "";

    const text = await response.text();
    const mainScript = text.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)?.[1] || "";
    return crearTokenVersionDeploy(`${mainScript}|${text}`);
  } catch (error) {
    console.warn("No se pudo revisar el index desplegado:", error.message);
    return "";
  }
}

async function obtenerFirmaDeployActual() {
  const [version, index] = await Promise.all([
    obtenerVersionDeployActual(),
    obtenerFirmaIndexDeployActual()
  ]);
  return [version, index].filter(Boolean).join("::");
}

async function revisarVersionDeploy() {
  if (deployVersionReloading || deployVersionChecking || !paginaEstaVisible()) return;

  deployVersionChecking = true;
  try {
    const firma = await obtenerFirmaDeployActual();
    if (!firma) return;

    if (!deployVersionActual) {
      deployVersionActual = firma;
      return;
    }

    if (firma !== deployVersionActual) {
      deployVersionReloading = true;
      setTimeout(() => recargarPorNuevoDeploy(firma), 500);
    }
  } finally {
    deployVersionChecking = false;
  }
}

function programarRevisionVersionDeploy(delay = 0) {
  if (!paginaEstaVisible() || deployVersionReloading) return;
  if (deployVersionTimerId !== null) return;

  const timerId = setTimeout(() => {
    deployVersionTimerId = null;
    revisarVersionDeploy();
  }, delay);
  deployVersionTimerId = timerId;
}

function iniciarMonitorVersionDeploy() {
  programarRevisionVersionDeploy(0);
  setInterval(() => {
    if (paginaEstaVisible()) programarRevisionVersionDeploy(0);
  }, DEPLOY_VERSION_CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (paginaEstaVisible()) {
      registrarReactivacionPagina();
      programarRevisionVersionDeploy(0);
    } else if (deployVersionTimerId !== null) {
      clearTimeout(deployVersionTimerId);
      deployVersionTimerId = null;
    }
  });
  window.addEventListener("focus", () => {
    registrarReactivacionPagina();
    programarRevisionVersionDeploy(0);
  });
}

function marcarRenderSilenciosoApuesta(id, ttl = 6000) {
  if (!id) return;
  renderSilenciosoApuestas.add(id);
  setTimeout(() => renderSilenciosoApuestas.delete(id), ttl);
}

function programarSyncSilenciosa(deporte, delay = 0, force = false) {
  if (!paginaEstaVisible()) return;
  if (deporte === "mlb" && !_syncMlbActivado) return;
  if (deporte === "futbol" && !_syncFutbolActivado) return;
  if (autoSyncTimers.has(deporte)) {
    if (!force) return;
    clearTimeout(autoSyncTimers.get(deporte));
    autoSyncTimers.delete(deporte);
  }

  const delayFinal = force || !paginaRecienReactivada()
    ? delay
    : Math.max(delay, AUTO_SYNC_RESUME_GRACE_MS + (deporte === "mlb" ? 4500 : 1500));

  const timerId = setTimeout(() => {
    autoSyncTimers.delete(deporte);
    if (!paginaEstaVisible()) return;

    ejecutarCuandoEsteLibre(() => {
      if (!paginaEstaVisible()) return;
      if (deporte === "mlb") {
        ejecutarAutoSyncMlb(force);
      } else if (deporte === "futbol") {
        ejecutarAutoSyncFutbol(force);
      }
    });
  }, delayFinal);

  autoSyncTimers.set(deporte, timerId);
}

function cancelarSyncSilenciosaPendiente() {
  autoSyncTimers.forEach(timerId => clearTimeout(timerId));
  autoSyncTimers.clear();
}

function esErrorIndiceFirestore(error = {}) {
  const code = String(error.code || "").toLowerCase();
  const message = String(error.message || "").toLowerCase();
  return code.includes("failed-precondition") ||
    message.includes("requires an index") ||
    message.includes("index");
}

function getConsultaApuestasPaginada(cursor = null, casaId = filtroCasaId, sinOrden = usarConsultaApuestasFiltradaSinOrden) {
  const constraints = [];
  const filtraCasa = casaId && casaId !== CASA_TODAS_ID;

  if (filtraCasa) {
    constraints.push(where("casaId", "==", casaId));
  }

  if (!sinOrden || !filtraCasa) {
    constraints.push(orderBy("creadoEn", "desc"));
  }

  if (cursor) {
    constraints.push(startAfter(cursor));
  }

  constraints.push(firestoreLimit(APUESTAS_PAGE_LIMIT));
  return query(collection(db, "apuestas"), ...constraints);
}

function autocorregirApuestasCargadas(lista = []) {
  lista.forEach(a => {
    if (!a.casaId) {
      marcarRenderSilenciosoApuesta(a.id);
      updateDoc(doc(db, "apuestas", a.id), {
        casaId: CASA_DEFAULT_ID,
        casaNombre: getCasaNombre(CASA_DEFAULT_ID)
      }).catch(err => console.error("Error al asignar casa por defecto:", err));
    }

    if (a.fecha && a.dia && a.fecha !== a.dia) {
      const fechaNormalizada = a.fecha;
      marcarRenderSilenciosoApuesta(a.id);
      updateDoc(doc(db, "apuestas", a.id), { fecha: fechaNormalizada, dia: fechaNormalizada })
        .catch(err => console.error("Error al normalizar fecha de apuesta:", err));
    }

    if (a.tipoApuesta === "patente") {
      const resultadoPatente = determinarResultadoPatente(a);
      const cuotaPatente = calcularCuotaMaximaPatente(a.jugadas || []);
      const updateData = {};

      if (a.resultado !== resultadoPatente) {
        a.resultado = resultadoPatente;
        updateData.resultado = resultadoPatente;
        updateData.autoSync = crearAutoSyncPayload(a, resultadoPatente);
      }

      if (formatDecimal(a.cuota) !== formatDecimal(cuotaPatente)) {
        a.cuota = cuotaPatente;
        updateData.cuota = cuotaPatente;
      }

      if (Object.keys(updateData).length > 0) {
        marcarRenderSilenciosoApuesta(a.id);
        updateDoc(doc(db, "apuestas", a.id), updateData)
          .catch(err => console.error("Error al auto-corregir patente:", err));
      }
    } else if (Array.isArray(a.jugadas) && a.jugadas.length > 0) {
      const resultadoRecalculado = recalcularResultadoApuesta(a);
      const updateData = {};
      if (a.resultado !== resultadoRecalculado) {
        a.resultado = resultadoRecalculado;
        updateData.resultado = resultadoRecalculado;
        updateData.autoSync = crearAutoSyncPayload(a, resultadoRecalculado);
      }
      if (debeRecalcularCuotaCombinada(a.tipoApuesta)) {
        const cuotaRecalculada = recalcularCuotaCombinada(a.jugadas);
        if (cuotaRecalculada > 0 && formatDecimal(a.cuota) !== formatDecimal(cuotaRecalculada)) {
          a.cuota = cuotaRecalculada;
          updateData.cuota = cuotaRecalculada;
        }
      }
      if (Object.keys(updateData).length > 0) {
        marcarRenderSilenciosoApuesta(a.id);
        updateDoc(doc(db, "apuestas", a.id), updateData)
          .catch(err => console.error("Error al auto-corregir resultado:", err));
      }
    }

    const val = a.importe;
    if (typeof val === 'number') {
      const rounded = Math.round(val);
      const distance = Math.abs(val - rounded);
      if (distance > 0 && distance <= 0.035) {
        marcarRenderSilenciosoApuesta(a.id);
        updateDoc(doc(db, "apuestas", a.id), { importe: rounded })
          .catch(err => console.error("Error al auto-corregir importe:", err));
      }
    }
  });

  const hoy = obtenerFechaActualLocal();
  lista.forEach(a => {
    if (apuestaPareceMlb(a)) {
      const fecha = a.fecha || a.dia;
      const esHoyOCercano = fecha === hoy || sonFechasCercanas(fecha, hoy);
      const teniaReembolsoPospuesto = (a.resultado === "nula") || (a.jugadas || []).some(j =>
        esEstadoJuegoReembolso(j?.autoMlb?.estadoJuego) ||
        Boolean(j?.autoMlb?.estadoEspecial) ||
        (j?.selections || []).some(sel =>
          sel?.estado === "nula" ||
          Boolean(sel?.autoMlb?.estadoEspecial) ||
          esEstadoJuegoReembolso(sel?.autoMlb?.estadoJuego)
        )
      );

      const targetHora = a.hora || (a.jugadas || [])[0]?.autoMlb?.horaJuego;
      const fechaJuegoActual = (a.jugadas || [])[0]?.autoMlb?.fechaJuego || (a.jugadas || [])[0]?.selections?.[0]?.autoMlb?.fechaJuego;

      let horaDesfasada = false;
      if (targetHora && fechaJuegoActual) {
        const { hora: horaLocalActual } = obtenerFechaHoraLocalDesdeIso(fechaJuegoActual);
        if (horaLocalActual) {
          const [tH, tM] = targetHora.split(":").map(Number);
          const [gH, gM] = horaLocalActual.split(":").map(Number);
          const diffMins = Math.abs((tH * 60 + tM) - (gH * 60 + gM));
          if (diffMins > 90) {
            horaDesfasada = true;
          }
        }
      }

      if (esHoyOCercano && (teniaReembolsoPospuesto || horaDesfasada)) {
        let huboCambioAutocorrecion = false;
        a.jugadas = (a.jugadas || []).map(j => {
          if (typeof j !== "object" || !j) return j;
          const autoMlbJ = j.autoMlb ? { ...j.autoMlb, gamePk: horaDesfasada ? null : j.autoMlb.gamePk, espnId: horaDesfasada ? null : j.autoMlb.espnId, estadoEspecial: null, estadoJuego: "Programado" } : null;
          const selections = (j.selections || []).map(sel => {
            const autoMlbSel = sel.autoMlb ? { ...sel.autoMlb, gamePk: horaDesfasada ? null : sel.autoMlb.gamePk, espnId: horaDesfasada ? null : sel.autoMlb.espnId, estadoEspecial: null, estadoJuego: "Programado" } : null;
            const nuevoEstado = sel.estado === "nula" ? "pendiente" : (sel.estado || "pendiente");
            if (sel.estado !== nuevoEstado || sel.autoMlb?.estadoEspecial !== null || horaDesfasada) {
              huboCambioAutocorrecion = true;
            }
            return {
              ...sel,
              estado: nuevoEstado,
              ...(autoMlbSel ? { autoMlb: autoMlbSel } : {})
            };
          });
          if (j.estado === "nula") huboCambioAutocorrecion = true;
          return {
            ...j,
            estado: "pendiente",
            selections,
            ...(autoMlbJ ? { autoMlb: autoMlbJ } : {})
          };
        });

        const nuevoResultado = recalcularResultadoApuesta(a);
        if (a.resultado !== nuevoResultado || huboCambioAutocorrecion) {
          a.resultado = nuevoResultado;
          a.autoSync = crearAutoSyncPayload(a, nuevoResultado);
          marcarRenderSilenciosoApuesta(a.id);
          updateDoc(doc(db, "apuestas", a.id), {
            jugadas: a.jugadas,
            resultado: nuevoResultado,
            autoSync: a.autoSync
          }).catch(err => console.error("Error al corregir apuesta pospuesta MLB:", err));
        }
      }
    }
  });

  const hayMlbReembolsoPospuesto = lista.some(a =>
    apuestaPareceMlb(a) && (
      a.resultado === "nula" ||
      (a.jugadas || []).some(j =>
        esEstadoJuegoReembolso(j?.autoMlb?.estadoJuego) ||
        (j?.selections || []).some(sel => sel?.estado === "nula" || esEstadoJuegoReembolso(sel?.autoMlb?.estadoJuego))
      )
    )
  );
  if (hayMlbReembolsoPospuesto && _syncMlbActivado) {
    programarSyncSilenciosa("mlb", 300, true);
  }
}

function renderApuestasCargadas({ mantenerPagina = false, pagina = null } = {}) {
  apuestas.sort(compararApuestasOrdenTabla);

  const diasUnicos = [...new Set(apuestas.map(a => a.dia || a.fecha).filter(Boolean))];
  const totalPags = Math.ceil(diasUnicos.length / porPagina);
  if (pagina !== null) {
    paginaActual = pagina;
  } else if (!mantenerPagina) {
    paginaActual = totalPags || 1;
  } else if (paginaActual > totalPags) {
    paginaActual = totalPags || 1;
  }

  render();
  programarSyncInicialVisible();
}

function cargarApuestasIniciales() {
  if (unsubscribeApuestas) {
    unsubscribeApuestas();
    unsubscribeApuestas = null;
  }

  apuestas = [];
  apuestasExtraPaginadas = [];
  ultimoDocApuestas = null;
  hayMasApuestas = true;
  apuestasSnapshotRecibido = false;
  paginaActual = 1;

  unsubscribeApuestas = onSnapshot(getConsultaApuestasPaginada(), (snapshot) => {
    const cambios = apuestasSnapshotRecibido ? snapshot.docChanges() : [];
    const soloCambiosSilenciosos = cambios.length > 0 &&
      cambios.every(change => change.type !== "removed" && renderSilenciosoApuestas.has(change.doc.id));
    const iniciales = snapshot.docs.map(d => normalizarFechaDeApuesta({ ...d.data(), id: d.id }));
    const idsIniciales = new Set(iniciales.map(a => a.id));
    apuestasExtraPaginadas = apuestasExtraPaginadas.filter(a => !idsIniciales.has(a.id));
    apuestas = [...iniciales, ...apuestasExtraPaginadas];

    if (snapshot.docs.length > 0 && apuestasExtraPaginadas.length === 0) {
      ultimoDocApuestas = snapshot.docs[snapshot.docs.length - 1];
    }

    if (apuestasExtraPaginadas.length === 0) {
      hayMasApuestas = snapshot.docs.length === APUESTAS_PAGE_LIMIT;
    }
    apuestasSnapshotRecibido = true;
    inicializado = true;
    autocorregirApuestasCargadas(iniciales);
    if (soloCambiosSilenciosos) return;
    if (usuarioEstaEditandoFormulario()) return;
    renderApuestasCargadas({ mantenerPagina: apuestasExtraPaginadas.length > 0 });
  }, (error) => {
    console.error("Error escuchando primera tanda de apuestas:", error);
    if (
      filtroCasaId !== CASA_TODAS_ID &&
      !usarConsultaApuestasFiltradaSinOrden &&
      esErrorIndiceFirestore(error)
    ) {
      usarConsultaApuestasFiltradaSinOrden = true;
      cargarApuestasIniciales();
      return;
    }
    apuestasSnapshotRecibido = true;
    inicializado = true;
    renderApuestasCargadas();
    mostrarModalValidacion(["No se pudo cargar el historial de apuestas: " + error.message]);
  });
}

async function cargarMasApuestas() {
  if (cargandoApuestas) return;
  if (!hayMasApuestas) return;

  cargandoApuestas = true;
  try {
    const snapshot = await getDocs(getConsultaApuestasPaginada(ultimoDocApuestas));
    const nuevas = snapshot.docs.map(d => normalizarFechaDeApuesta({ ...d.data(), id: d.id }));

    const existentes = new Set(apuestas.map(a => a.id));
    const nuevasUnicas = nuevas.filter(a => !existentes.has(a.id));
    apuestasExtraPaginadas = [...apuestasExtraPaginadas, ...nuevasUnicas];
    apuestas = [...apuestas, ...nuevasUnicas];

    if (snapshot.docs.length > 0) {
      ultimoDocApuestas = snapshot.docs[snapshot.docs.length - 1];
    }
    hayMasApuestas = snapshot.docs.length === APUESTAS_PAGE_LIMIT;
    apuestasSnapshotRecibido = true;
    inicializado = true;

    autocorregirApuestasCargadas(nuevas);
    renderApuestasCargadas({ pagina: 1 });
  } catch (error) {
    console.error("Error cargando apuestas con cursor:", error);
    if (
      filtroCasaId !== CASA_TODAS_ID &&
      !usarConsultaApuestasFiltradaSinOrden &&
      esErrorIndiceFirestore(error)
    ) {
      usarConsultaApuestasFiltradaSinOrden = true;
      cargandoApuestas = false;
      await cargarMasApuestas();
      return;
    }
    mostrarModalValidacion(["No se pudo cargar el historial de apuestas: " + error.message]);
  } finally {
    cargandoApuestas = false;
  }
}

function escucharApuestas() {
  cargarApuestasIniciales();
}

function apuestaMlbNecesitaSyncRapida(apuesta = {}) {
  const fecha = apuesta.fecha || apuesta.dia;
  if (fecha !== obtenerFechaActualLocal()) return false;
  if (!apuestaPareceMlb(apuesta)) return false;
  if (!Array.isArray(apuesta.jugadas) || apuesta.jugadas.length === 0) return false;
  if (apuestaSyncCerrada(apuesta)) return false;
  if (!apuestaResultadoPendiente(apuesta)) return false;
  return !apuestaTieneMarcadorMlb(apuesta);
}

function apuestaMlbNecesitaSyncLiveRapida(apuesta = {}) {
  const fecha = apuesta.fecha || apuesta.dia;
  if (fecha !== obtenerFechaActualLocal()) return false;
  if (!apuestaPareceMlb(apuesta)) return false;
  if (!Array.isArray(apuesta.jugadas) || apuesta.jugadas.length === 0) return false;
  if (apuestaSyncCerrada(apuesta)) return false;
  if (!apuestaResultadoPendiente(apuesta)) return false;
  if (apuestaYaFinalizadaYResuelta(apuesta, "autoMlb")) return false;
  return apuestaTieneMarcadorMlb(apuesta) || apuestaMlbYaDebeSincronizar(apuesta);
}

function apuestaFutbolNecesitaSyncEstadisticasRapida(apuesta = {}) {
  const fecha = apuesta.fecha || apuesta.dia;
  if (fecha !== obtenerFechaActualLocal()) return false;
  if (!apuestaPareceFutbol(apuesta)) return false;
  if (!Array.isArray(apuesta.jugadas) || apuesta.jugadas.length === 0) return false;
  if (apuestaSyncCerrada(apuesta)) return false;
  if (!apuestaResultadoPendiente(apuesta)) return false;
  if (apuestaYaFinalizadaYResuelta(apuesta, "autoFutbol")) return false;
  return apuestaTieneMercadoEstadisticasFutbol(apuesta);
}

function programarSyncInicialVisible() {
  // Solo sincronizar automáticamente si el usuario ya activó la sincronización manualmente
  const apuestasVisibles = getApuestasFiltradas();

  if (_syncFutbolActivado) {
    const hayFutbolStatsUrgente = apuestasVisibles.some(apuestaFutbolNecesitaSyncEstadisticasRapida);
    const hayFutbol = apuestasVisibles.some(apuesta => apuestaPareceFutbol(apuesta));
    if (hayFutbol) {
      programarSyncSilenciosa("futbol", hayFutbolStatsUrgente ? 1200 : 12000, hayFutbolStatsUrgente);
    }
  }

  if (_syncMlbActivado) {
    const hayMlbUrgente = apuestasVisibles.some(apuestaMlbNecesitaSyncRapida) ||
      apuestasVisibles.some(apuestaMlbNecesitaSyncLiveRapida);
    const hayMlb = apuestasVisibles.some(apuesta => apuestaPareceMlb(apuesta));
    if (hayMlb) {
      programarSyncSilenciosa("mlb", hayMlbUrgente ? 1200 : 16000, hayMlbUrgente);
    }
  }
}

/* =========================
   MODAL DE VALIDACIÓN ELEGANTE
   ========================= */
registrarModalValidacionGlobal();

/* =========================
   FUNCIONES AUXILIARES MULTI-SELECCIÓN
   ========================= */
function crearFilaSeleccionHTML(numSeleccion, showDelete = true) {
  const label = numSeleccion > 0 ? `Jugada ${numSeleccion}` : 'Jugada';
  return `
    <div class="selection-row" style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
      <input type="text" class="jugada-jug-input" placeholder="${label}" style="background:#1e293b; color:white; border:1px dashed #475569; border-radius:6px; padding:5px 8px; font-size:12px; box-sizing:border-box; width:75%; min-width:120px;">
      ${showDelete ? `<button type="button" class="btn-eliminar-selection" onclick="window.eliminarFilaSeleccion(this)" style="display:none; padding:2px 7px; font-size:11px; font-weight:bold; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer; flex-shrink:0;">✕</button>` : ''}
    </div>
  `;
}

function normalizarTextoMercado(texto = "") {
  return String(texto)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizarComparacionMercado(texto = "") {
  return normalizarTextoMercado(texto)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function limpiarEspaciosMercado(texto = "") {
  return String(texto)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function colapsarRepeticionFinalMercado(texto = "") {
  const partes = limpiarEspaciosMercado(texto).split(" ").filter(Boolean);
  if (partes.length < 2) return limpiarEspaciosMercado(texto);

  const normalizarParte = parte => normalizarComparacionMercado(parte);
  for (let largo = Math.floor(partes.length / 2); largo >= 1; largo--) {
    const inicioRepetido = partes.length - (largo * 2);
    const primera = partes.slice(inicioRepetido, inicioRepetido + largo).map(normalizarParte).join(" ");
    const segunda = partes.slice(inicioRepetido + largo).map(normalizarParte).join(" ");

    if (primera && primera === segunda) {
      return limpiarEspaciosMercado(partes.slice(0, partes.length - largo).join(" "));
    }
  }

  return limpiarEspaciosMercado(texto);
}

function limpiarEventoDuplicado(texto = "") {
  const limpio = limpiarEspaciosMercado(texto);
  if (!limpio) return "";

  const partes = limpio.split(/(\s+(?:vs?\.?|versus|contra|v|[-–—/])\s+)/i);
  if (partes.length < 3) return colapsarRepeticionFinalMercado(limpio);

  return limpiarEspaciosMercado(partes.map((parte, index) => {
    if (index % 2 === 1) return parte;
    return colapsarRepeticionFinalMercado(parte);
  }).join(""));
}

function capitalizarMercado(texto = "") {
  const limpio = limpiarEspaciosMercado(texto);
  if (!limpio) return "";
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

function capitalizarPalabrasMercado(texto = "") {
  return limpiarEspaciosMercado(texto).replace(/\p{L}[\p{L}'-]*/gu, palabra =>
    palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase()
  );
}

function corregirTerminosMercado(texto = "") {
  return limpiarEspaciosMercado(String(texto)
    .replace(/\bh[aá]?ndicap\b/ig, "Hándicap")
    .replace(/\bhandi\b/ig, "Hándicap")
    .replace(/\bhcap\b/ig, "Hándicap")
    .replace(/\bmas\s+de\b/ig, "Más de")
    .replace(/\bmás\s+de\b/ig, "Más de")
    .replace(/\bmenos\s+de\b/ig, "Menos de")
    .replace(/\bsi\b/ig, "Sí")
  );
}

function autocorregirTextoApuesta(texto = "", evento = "") {
  let corregido = corregirTerminosMercado(texto);
  corregido = autocorregirTextoConLogos(corregido);

  const normalizado = normalizarTextoMercado(corregido);
  if (/\b(gana|ganador|ganadora|moneyline|ml)\b/.test(normalizado)) {
    corregido = corregido.replace(/\b(gana|ganador|ganadora|moneyline|ml)\b\s+(.+)$/i, (_, palabra, equipo) => {
      const equipoCorregido = corregirEquipoDesdeEvento(equipo, evento);
      return `${palabra} ${equipoCorregido}`;
    });
  }

  return limpiarEventoDuplicado(corregido);
}

function distanciaEdicion(a = "", b = "") {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  const actual = Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    actual[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(anterior[j] + 1, actual[j - 1] + 1, anterior[j - 1] + costo);
    }
    for (let j = 0; j <= b.length; j++) anterior[j] = actual[j];
  }

  return anterior[b.length];
}

function textoSinLineaApuesta(texto = "") {
  return limpiarEspaciosMercado(String(texto)
    .replace(/\b(mas|más|menos|over|under)\s*(?:de)?\b/ig, "")
    .replace(/[+-]?\d+(?:[.,]\d+)?/g, "")
  );
}

function extraerEquiposEvento(evento = "") {
  return limpiarEspaciosMercado(evento)
    .split(/\s+(?:vs?\.?|versus|contra)\s+/i)
    .map(equipo => limpiarEspaciosMercado(equipo))
    .filter(Boolean);
}

function elegirEquipoSimilar(texto = "", evento = "") {
  const candidato = normalizarComparacionMercado(textoSinLineaApuesta(texto));
  if (!candidato || candidato.length < 3) return "";

  let mejor = { equipo: "", score: Infinity };
  extraerEquiposEvento(evento).forEach(equipo => {
    const equipoNorm = normalizarComparacionMercado(equipo);
    const empiezaParecido = equipoNorm.startsWith(candidato) || candidato.startsWith(equipoNorm);
    const contieneParecido = candidato.length >= 5 && equipoNorm.includes(candidato);
    const distancia = distanciaEdicion(candidato, equipoNorm);
    const limite = equipoNorm.length <= 7 ? 2 : 3;

    if ((empiezaParecido || contieneParecido || distancia <= limite) && distancia < mejor.score) {
      mejor = { equipo, score: distancia };
    }
  });

  return mejor.equipo;
}

function corregirEquipoDesdeEvento(texto = "", evento = "") {
  const limpio = limpiarEspaciosMercado(String(texto)
    .replace(HANDICAP_TEXTO_GLOBAL_REGEX, "")
    .replace(/\bhándicap\b/ig, "")
    .replace(/(\p{L})([+-]\d+(?:[.,]\d+)?)/gu, "$1 $2")
    .replace(/([+-])\s+(\d)/g, "$1$2")
  );
  const linea = limpio.match(/[+-]\d+(?:[.,]\d+)?/);
  const equipo = elegirEquipoSimilar(limpio, evento);
  const base = equipo || capitalizarPalabrasMercado(textoSinLineaApuesta(limpio));

  if (!base) return limpio;
  return limpiarEspaciosMercado(`${base}${linea ? ` ${linea[0].replace(",", ".")}` : ""}`);
}

function formatHandicapJugada(texto = "") {
  const limpio = limpiarEspaciosMercado(texto);
  const linea = limpio.match(/[+-]\d+(?:[.,]\d+)?/);
  if (!linea) return formatTextWithCorners(limpio);

  const equipo = limpiarEspaciosMercado(limpio.replace(linea[0], ""));
  return `
    <span class="handicap-selection-text">
      <span>${formatTextWithMlbTeams(equipo)}</span>
      <span class="handicap-line-value">${linea[0].replace(",", ".")}</span>
    </span>
  `;
}

function tienePalabraMercado(normalizado = "", palabras = []) {
  const tokens = normalizado.split(/\s+/).filter(Boolean);
  return palabras.some(palabra => {
    if (normalizado.includes(palabra)) return true;
    return tokens.some(token => token.length >= 4 && distanciaEdicion(token, palabra) <= 1);
  });
}

function extraerLineaTotal(texto = "", palabras = []) {
  let subtitulo = String(texto)
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\b(mas|más)\s*(?:de|d)?\s*(?=-?\d)/ig, "Más de ")
    .replace(/\bmenos\s*(?:de|d)?\s*(?=-?\d)/ig, "Menos de ")
    .replace(/\bover\s*(?=-?\d)/ig, "Más de ")
    .replace(/\bunder\s*(?=-?\d)/ig, "Menos de ");

  palabras.forEach(palabra => {
    subtitulo = subtitulo.replace(new RegExp(`\\b${palabra}\\b`, "ig"), "");
  });

  subtitulo = subtitulo
    .replace(/\btotal(?:es)?\b/ig, "")
    .replace(/\s+/g, " ")
    .trim();

  const lineaConDireccion = subtitulo.match(/\b(?:Más de|Mas de|Menos de)\s*-?\d+(?:[.,]\d+)?/i);
  if (lineaConDireccion) return capitalizarMercado(lineaConDireccion[0]);

  const numero = subtitulo.match(/-?\d+(?:[.,]\d+)?/);
  if (numero) return numero[0].replace(",", ".");

  return capitalizarMercado(subtitulo);
}

function detectarEquipoTotalMlb(texto = "", evento = "") {
  const equiposEvento = detectarEquiposMlb(evento);
  const equipoExplicito = detectarEquipoMlbEnTexto(texto, equiposEvento.length >= 2 ? equiposEvento : []);
  if (equipoExplicito) return equipoExplicito;

  const equiposTexto = detectarEquiposMlb(texto);
  if (equiposTexto.length === 1) {
    if (equiposEvento.length < 2 || equiposEvento.some(equipo => normalizarClaveMlb(equipo) === normalizarClaveMlb(equiposTexto[0]))) {
      return equiposTexto[0];
    }
    return "";
  }

  if (equiposEvento.length === 1) return equiposEvento[0];
  return "";
}

function obtenerNombreCortoMlb(equipo = "") {
  const encontrado = MLB_TEAMS.find(team => normalizarClaveMlb(team.name) === normalizarClaveMlb(equipo));
  if (!encontrado) return equipo;
  return [...encontrado.aliases]
    .filter(alias => alias.length > 2 && !/^[A-Z]{2,3}$/.test(alias))
    .sort((a, b) => a.length - b.length)[0] || encontrado.name;
}

function formatearTituloTotalCarrerasMlb(equipo = "") {
  return equipo ? `${obtenerNombreCortoMlb(equipo)} total carreras` : "Total carreras";
}

function formatearTituloTotalGolesFutbol(equipo = "") {
  return equipo ? `Goles de ${equipo}` : "Total de goles";
}

function formatearTituloTotalCornersFutbol(equipo = "") {
  return equipo ? `Corners de ${equipo}` : "Total tiros de esquina";
}

function formatearTituloTotalTarjetasFutbol(equipo = "") {
  return equipo ? `Tarjetas de ${equipo}` : "Total tarjetas";
}

const TITULO_TOTAL_HITS_MLB = "Hits M\u00e1s de/Menos de (incl. extra innings)";

function formatearTituloTotalHitsMlb() {
  return TITULO_TOTAL_HITS_MLB;
}

function esTotalCarrerasEquipoMlb(texto = "", evento = "") {
  const normalizado = normalizarTextoMercado(texto);
  const tieneDireccionTotal = /\b(over|under|mas|menos|mayor|menor|alta|baja)\b/.test(normalizado);
  return tieneDireccionTotal && extraerNumeroJugada(texto) !== null && Boolean(detectarEquipoTotalMlb(texto, evento));
}

function extraerSiNo(texto = "") {
  const normalizado = normalizarTextoMercado(texto);
  if (/\b(no|ninguno)\b/.test(normalizado)) return "No";
  if (/\b(si|ambos|marcan|anotan)\b/.test(normalizado)) return "Sí";
  return capitalizarMercado(texto);
}

function formatearLineaTotalAuto(auto = {}) {
  const linea = Number(auto.linea);
  if (Number.isNaN(linea)) return "";
  return `${auto.tipoTotal === "under" ? "Menos de" : "Más de"} ${String(linea).replace(",", ".")}`;
}

const HANDICAP_TEXTO_REGEX = /\bh(?:a|á|\u00c3\u00a1)ndicap\b/i;
const HANDICAP_TEXTO_GLOBAL_REGEX = /\bh(?:a|á|\u00c3\u00a1)ndicap\b/ig;

function esHandicapMlbTexto(texto = "") {
  const normalizado = normalizarTextoMercado(texto);
  return HANDICAP_TEXTO_REGEX.test(String(texto)) ||
    tienePalabraMercado(normalizado, ["handicap", "handi", "hcap"]) ||
    /\b(runline|spread)\b/.test(normalizado);
}

function esTotalHitsMlb(texto = "") {
  const normalizado = normalizarTextoMercado(texto);
  return tienePalabraMercado(normalizado, ["hit", "hits", "imparable", "imparables"]);
}

function limpiarEquipoGanador(texto = "", evento = "") {
  let equipo = String(texto)
    .replace(/\b(equipo\s+)?ganador\b/ig, "")
    .replace(/\b(gana|ganan|ganara|ganaran|winner|moneyline|ml)\b/ig, "")
    .replace(/\b1x2\b/ig, "");

  equipo = limpiarEspaciosMercado(equipo);
  return corregirEquipoDesdeEvento(equipo || texto, evento);
}

const TITULO_EQUIPO_GANARA_CUALQUIER_MITAD = "Equipo ganar\u00e1 cualquier mitad";

function esEquipoGanaraCualquierMitad(texto = "") {
  const normalizado = normalizarTextoMercado(texto);
  const tieneGanara = /\b(ganara|ganar|gana|ganan|gane|ganen)\b/.test(normalizado);
  const tieneCualquierMitad = /\b(cualquier|alguna)\b.*\bmitad\b|\bmitad\b.*\b(cualquier|alguna)\b/.test(normalizado);
  return tieneGanara && tieneCualquierMitad;
}

function limpiarEquipoGanaraCualquierMitad(texto = "", evento = "") {
  let equipo = String(texto)
    .replace(/\b(?:ganar[a\u00e1]?|gana|ganan|gane|ganen)\b\s+(?:en\s+)?(?:cualquier|alguna)\s+mitad\b/ig, "")
    .replace(/\b(?:cualquier|alguna)\s+mitad\b\s+(?:la\s+)?(?:ganar[a\u00e1]?|gana|ganan|gane|ganen)\b/ig, "")
    .replace(/\b(?:equipo|esquipo|team|que)\b/ig, "");

  equipo = limpiarEspaciosMercado(equipo);
  return corregirEquipoDesdeEvento(equipo || texto, evento);
}

function limpiarHandicap(texto = "", evento = "") {
  let linea = String(texto)
    .replace(HANDICAP_TEXTO_GLOBAL_REGEX, "")
    .replace(/\bhándicap\b/ig, "")
    .replace(/\bh[aá]ndicap\b/ig, "")
    .replace(/(\p{L})([+-]\d+(?:[.,]\d+)?)/gu, "$1 $2")
    .replace(/([+-])\s+(\d)/g, "$1$2");

  linea = limpiarEspaciosMercado(linea);
  return corregirEquipoDesdeEvento(linea, evento);
}

function limpiarDobleOportunidad(texto = "", evento = "") {
  let limpio = limpiarEspaciosMercado(String(texto)
    .replace(/\bdoble\s+oportunidad\b/ig, "")
    .replace(/\bdouble\s+chance\b/ig, "")
  );

  const partes = limpio.split(/\s+(?:o|\u00f3)\s+|\s*\/\s*/i).map(parte => limpiarEspaciosMercado(parte)).filter(Boolean);
  if (partes.length < 2) return capitalizarPalabrasMercado(limpio || texto);

  return partes.map(parte => {
    if (normalizarTextoMercado(parte) === "empate") return "Empate";
    return corregirEquipoDesdeEvento(parte, evento);
  }).join(" o ");
}

function detectarDobleOportunidadFutbol(texto = "", evento = "") {
  const equipos = extraerEquiposEventoFutbol(evento);
  if (equipos.length < 2) return null;

  const limpio = limpiarEspaciosMercado(String(texto)
    .replace(/\bdoble\s+oportunidad\b/ig, "")
    .replace(/\bdouble\s+chance\b/ig, "")
  );
  const partes = limpio.split(/\s+(?:o|\u00f3)\s+|\s*\/\s*/i)
    .map(parte => limpiarEspaciosMercado(parte))
    .filter(Boolean);
  if (partes.length < 2) return null;

  const seleccionEquipos = [];
  let incluyeEmpate = false;

  for (const parte of partes) {
    const normalizado = normalizarTextoMercado(parte);
    if (normalizado === "empate" || normalizado === "draw" || normalizado === "x") {
      incluyeEmpate = true;
      continue;
    }

    const equipo = equipos.find(eq => textoContieneEquipoFutbol(parte, eq));
    if (!equipo) return null;
    if (!seleccionEquipos.some(eq => normalizarClaveFutbol(eq) === normalizarClaveFutbol(equipo))) {
      seleccionEquipos.push(equipo);
    }
  }

  if (incluyeEmpate && seleccionEquipos.length === 1) {
    return { seleccionEquipo: seleccionEquipos[0], seleccionEquipos, incluyeEmpate };
  }
  if (!incluyeEmpate && seleccionEquipos.length >= 2) {
    return { seleccionEquipo: seleccionEquipos[0], seleccionEquipos, incluyeEmpate };
  }
  return null;
}

function detectarDetalleSeleccionCrear(seleccion = {}) {
  const tituloActual = limpiarEspaciosMercado(seleccion.titulo || "");
  const jugadaActual = limpiarEspaciosMercado(seleccion.jugada || seleccion.jug || "");
  const evento = limpiarEspaciosMercado(seleccion.evento || seleccion.ev || "");
  const contextoFutbolSinMlb = extraerEquiposEventoFutbol(evento).length >= 2 && detectarEquiposMlb(evento).length < 2;
  const autoFutbol = contextoFutbolSinMlb ? (seleccion.autoFutbol || null) : null;
  const autoMlb = contextoFutbolSinMlb ? null : (seleccion.autoMlb || null);
  const textoCompleto = limpiarEspaciosMercado(`${tituloActual} ${jugadaActual}`);
  const normalizado = normalizarTextoMercado(textoCompleto);
  const normalizadoJugada = normalizarTextoMercado(jugadaActual);
  const contextoMlb = !contextoFutbolSinMlb && esContextoMlb(evento, seleccion, {}, detectarEquiposMlb);

  if (autoFutbol?.mercado === "total_goles") {
    return {
      titulo: formatearTituloTotalGolesFutbol(autoFutbol.seleccionEquipo),
      jugada: formatearLineaTotalAuto(autoFutbol) || jugadaActual
    };
  }

  if (autoFutbol?.mercado === "total_corners") {
    return {
      titulo: formatearTituloTotalCornersFutbol(autoFutbol.seleccionEquipo),
      jugada: formatearLineaTotalAuto(autoFutbol) || jugadaActual
    };
  }

  if (autoFutbol?.mercado === "total_tarjetas") {
    return {
      titulo: formatearTituloTotalTarjetasFutbol(autoFutbol.seleccionEquipo),
      jugada: formatearLineaTotalAuto(autoFutbol) || jugadaActual
    };
  }

  if (autoFutbol?.mercado === "doble_oportunidad") {
    return {
      titulo: "Doble oportunidad",
      jugada: limpiarDobleOportunidad(jugadaActual || textoCompleto, evento)
    };
  }

  if (autoMlb?.mercado === "total_hits") {
    return {
      titulo: formatearTituloTotalHitsMlb(),
      jugada: formatearLineaTotalAuto(autoMlb) || jugadaActual
    };
  }

  if (autoMlb?.mercado === "total_carreras") {
    return {
      titulo: formatearTituloTotalCarrerasMlb(autoMlb.seleccionEquipo),
      jugada: formatearLineaTotalAuto(autoMlb) || jugadaActual
    };
  }

  if (autoMlb?.mercado === "handicap") {
    return {
      titulo: "Hándicap",
      jugada: limpiarHandicap(jugadaActual || textoCompleto, evento)
    };
  }

  if (autoMlb?.mercado === "ganador_partido") {
    return {
      titulo: "Ganador del partido",
      jugada: autoMlb.seleccionEquipo || limpiarEquipoGanador(jugadaActual || textoCompleto, evento)
    };
  }

  if (contextoMlb && /\b(gana|ganan|ganador|ganadora|winner|moneyline|ml)\b/.test(normalizadoJugada || normalizado)) {
    return {
      titulo: "Ganador del partido",
      jugada: limpiarEquipoGanador(jugadaActual || textoCompleto, evento)
    };
  }

  if (esHandicapMlbTexto(textoCompleto)) {
    return {
      titulo: "Hándicap",
      jugada: limpiarHandicap(jugadaActual || textoCompleto, evento)
    };
  }

  if (!contextoMlb && tienePalabraMercado(normalizado, ["corner", "corners", "corne", "esquina", "esquinas"])) {
    return {
      titulo: "Total tiros de esquina",
      jugada: extraerLineaTotal(jugadaActual || textoCompleto, ["corner", "corners", "tiro", "tiros", "esquina", "esquinas"])
    };
  }

  if (!contextoMlb && tienePalabraMercado(normalizado, ["tarjeta", "tarjetas", "card", "cards"])) {
    return {
      titulo: "Total tarjetas",
      jugada: extraerLineaTotal(jugadaActual || textoCompleto, ["tarjeta", "tarjetas", "card", "cards"])
    };
  }

  if (esTotalHitsMlb(textoCompleto)) {
    return {
      titulo: formatearTituloTotalHitsMlb(),
      jugada: extraerLineaTotal(jugadaActual || textoCompleto, ["hit", "hits", "imparable", "imparables"])
    };
  }

  if (tienePalabraMercado(normalizado, ["carrera", "carreras", "run", "runs"])) {
    const equipoTotal = detectarEquipoTotalMlb(textoCompleto, evento);
    return {
      titulo: formatearTituloTotalCarrerasMlb(equipoTotal),
      jugada: extraerLineaTotal(jugadaActual || textoCompleto, ["carrera", "carreras", "run", "runs"])
    };
  }

  if (esTotalCarrerasEquipoMlb(textoCompleto, evento)) {
    const equipoTotal = detectarEquipoTotalMlb(textoCompleto, evento);
    return {
      titulo: formatearTituloTotalCarrerasMlb(equipoTotal),
      jugada: extraerLineaTotal(jugadaActual || textoCompleto, [])
    };
  }

  if (contextoMlb && /\b(over|under|mas|menos|mayor|menor|alta|baja)\b/.test(normalizado) && extraerNumeroJugada(textoCompleto) !== null) {
    return {
      titulo: formatearTituloTotalCarrerasMlb(detectarEquipoTotalMlb(textoCompleto, evento)),
      jugada: extraerLineaTotal(jugadaActual || textoCompleto, ["gol", "goles"])
    };
  }

  if (!contextoMlb && tienePalabraMercado(normalizado, ["ambos", "marcan", "anotan"]) && !/\b(mas|menos|over|under)\b/.test(normalizado)) {
    return {
      titulo: "Ambos equipos marcan",
      jugada: extraerSiNo(jugadaActual || textoCompleto)
    };
  }

  if (!contextoMlb && tienePalabraMercado(normalizado, ["gol", "goles"])) {
    const seleccionEquipo = extraerEquiposEventoFutbol(evento)
      .find(equipo => textoContieneEquipoFutbol(textoCompleto, equipo));
    return {
      titulo: formatearTituloTotalGolesFutbol(seleccionEquipo),
      jugada: extraerLineaTotal(jugadaActual || textoCompleto, ["gol", "goles"])
    };
  }

  if (tienePalabraMercado(normalizado, ["handicap", "handi", "hcap"])) {
    return {
      titulo: "Hándicap",
      jugada: limpiarHandicap(jugadaActual || textoCompleto, evento)
    };
  }

  if (detectarDobleOportunidadFutbol(textoCompleto, evento)) {
    return {
      titulo: "Doble oportunidad",
      jugada: limpiarDobleOportunidad(jugadaActual || textoCompleto, evento)
    };
  }

  if (esEquipoGanaraCualquierMitad(textoCompleto)) {
    return {
      titulo: TITULO_EQUIPO_GANARA_CUALQUIER_MITAD,
      jugada: limpiarEquipoGanaraCualquierMitad(jugadaActual || textoCompleto, evento)
    };
  }

  if (normalizado === "1x2" || normalizado.includes("1x2") || normalizado.includes("equipo ganador") || /\b(gana|ganador|moneyline|ml)\b/.test(normalizado)) {
    return {
      titulo: "Equipo ganador",
      jugada: limpiarEquipoGanador(jugadaActual || textoCompleto, evento)
    };
  }

  if (tituloActual && normalizarTextoMercado(tituloActual) !== "1x2") {
    return {
      titulo: tituloActual,
      jugada: jugadaActual
    };
  }

  return {
    titulo: "Equipo ganador",
    jugada: limpiarEquipoGanador(jugadaActual, evento)
  };
}

function crearSeleccionDetectada(jugada, estado = "pendiente", tituloActual = "", evento = "") {
  const eventoCorregido = autocorregirTextoApuesta(evento);
  const jugadaCorregida = autocorregirTextoApuesta(jugada, eventoCorregido);
  const jugadaOriginal = limpiarEspaciosMercado(jugadaCorregida);
  const contextoFutbolSinMlb = extraerEquiposEventoFutbol(eventoCorregido).length >= 2 &&
    detectarEquiposMlb(eventoCorregido).length < 2;
  const autoMlbDetectado = esContextoMlb(
    eventoCorregido,
    { titulo: tituloActual, jugada: jugadaOriginal },
    {},
    detectarEquiposMlb
  )
    ? crearAutoMlbSeleccion({ evento: eventoCorregido, titulo: tituloActual, jugada: jugadaOriginal })
    : null;
  const autoFutbolDetectado = contextoFutbolSinMlb
    ? crearAutoFutbolSeleccion({ evento: eventoCorregido, titulo: tituloActual, jugada: jugadaOriginal })
    : null;
  const detalle = detectarDetalleSeleccionCrear({
    titulo: tituloActual,
    jugada: jugadaCorregida,
    evento: eventoCorregido,
    autoMlb: autoMlbDetectado,
    autoFutbol: autoFutbolDetectado
  });
  return {
    titulo: detalle.titulo,
    jugada: detalle.jugada || jugadaOriginal,
    jugadaOriginal,
    ...(autoMlbDetectado ? { autoMlb: autoMlbDetectado } : {}),
    ...(autoFutbolDetectado ? { autoFutbol: autoFutbolDetectado } : {}),
    estado
  };
}

function getDeporteFormulario() {
  return document.getElementById("deporte")?.value || "";
}

function inferirDeporteDesdeJugadas(deporteActual = "", jugadas = [], evento = "") {
  if (deporteActual) return deporteActual;

  const textos = [evento];
  jugadas.forEach(jugada => {
    if (typeof jugada === "string") {
      textos.push(jugada);
      return;
    }
    if (!jugada || typeof jugada !== "object") return;
    textos.push(jugada.ev || jugada.evento || "");
    getSelectionsFromJugada(jugada).forEach(sel => {
      textos.push(sel.titulo || "", sel.jugada || "");
    });
  });

  const combinado = textos.filter(Boolean).join(" ");
  if (!combinado) return "";
  if (detectarEquiposMlb(combinado).length > 0) return "mlb";
  if (textos.some(texto => extraerEquiposEventoFutbol(texto).length >= 2)) return "futbol";
  return "";
}

function normalizarClaveMlb(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function equiposMlbCoinciden(equipoA = "", equipoB = "") {
  const a = normalizarClaveMlb(equipoA);
  const b = normalizarClaveMlb(equipoB);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a));
}

function textoContieneAliasMlb(textoNormalizado, alias = "") {
  const aliasNormalizado = normalizarClaveMlb(alias);
  if (!aliasNormalizado) return false;
  return new RegExp(`(^|\\s)${aliasNormalizado.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(textoNormalizado);
}

function detectarEquiposMlb(texto = "") {
  const normalizado = normalizarClaveMlb(texto);
  if (!normalizado) return [];

  const encontrados = [];
  MLB_TEAMS.forEach(team => {
    const aliases = [team.name, ...(team.aliases || [])].sort((a, b) => b.length - a.length);
    if (aliases.some(alias => textoContieneAliasMlb(normalizado, alias))) {
      encontrados.push(team.name);
    }
  });

  return [...new Set(encontrados)];
}

function detectarEquipoMlbEnTexto(texto = "", equiposPermitidos = []) {
  const normalizado = normalizarClaveMlb(texto);
  if (!normalizado) return "";
  const permitidos = (equiposPermitidos || []).map(normalizarClaveMlb).filter(Boolean);

  const candidatos = MLB_TEAMS
    .filter(team => permitidos.length === 0 || permitidos.includes(normalizarClaveMlb(team.name)))
    .map(team => {
      const aliases = [team.name, ...(team.aliases || [])]
        .filter(alias => alias && !/^[A-Z]{2,3}$/.test(alias))
        .sort((a, b) => b.length - a.length);
      const match = aliases.find(alias => textoContieneAliasMlb(normalizado, alias));
      return match ? { team: team.name, matchLength: normalizarClaveMlb(match).length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.matchLength - a.matchLength);

  return candidatos[0]?.team || "";
}

function detectarLadoTotal(texto = "") {
  const normalizado = normalizarTextoMercado(texto);
  const numeroConSigno = String(texto).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (numeroConSigno && parseFloat(numeroConSigno[0]) < 0) return "under";
  if (/\b(under|menos|menor|baja)\b/.test(normalizado)) return "under";
  if (/\b(over|mas|mayor|alta)\b/.test(normalizado)) return "over";
  return "";
}

function detectarSiNo(texto = "") {
  const normalizado = normalizarTextoMercado(texto);
  if (/\b(no)\b/.test(normalizado)) return "no";
  if (/\b(si|yes|ambos)\b/.test(normalizado)) return "si";
  return "";
}

function extraerNumeroConSigno(texto = "") {
  const match = String(texto).replace(",", ".").match(/[+-]?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function crearAutoMlbSeleccion({ evento = "", titulo = "", jugada = "" } = {}) {
  const textoCompleto = limpiarEspaciosMercado(`${titulo} ${jugada}`);
  const normalizado = normalizarTextoMercado(textoCompleto);
  const equiposEvento = detectarEquiposMlb(evento);
  const equiposTexto = detectarEquiposMlb(`${evento} ${textoCompleto}`);

  if (/\b(gana|ganan|ganador|ganadora|winner|moneyline|ml)\b/.test(normalizado)) {
    const equiposJugada = detectarEquiposMlb(jugada || textoCompleto);
    const seleccionEquipo = detectarEquipoMlbEnTexto(jugada || textoCompleto, equiposEvento) || equiposJugada[0] || null;
    if (seleccionEquipo) {
      return {
        deporte: "mlb",
        mercado: "ganador_partido",
        equipos: equiposEvento.length >= 2 ? equiposEvento.slice(0, 2) : equiposTexto.slice(0, 2),
        seleccionEquipo
      };
    }
  }

  if (esHandicapMlbTexto(textoCompleto) || /[+-]\s*\d+(?:[.,]\d+)?/.test(textoCompleto)) {
    const linea = extraerNumeroConSigno(textoCompleto);
    const equiposJugada = detectarEquiposMlb(textoCompleto);
    const seleccionEquipo = equiposJugada[0] || null;
    if (linea !== null && seleccionEquipo) {
      return {
        deporte: "mlb",
        mercado: "handicap",
        equipos: equiposEvento.length >= 2 ? equiposEvento.slice(0, 2) : equiposTexto.slice(0, 2),
        seleccionEquipo,
        linea
      };
    }
  }

  if (tienePalabraMercado(normalizado, ["carrera", "carreras", "run", "runs"])) {
    const linea = extraerNumeroJugada(textoCompleto);
    const tipoTotal = detectarLadoTotal(jugada) || detectarLadoTotal(textoCompleto);
    const equiposJugada = detectarEquiposMlb(textoCompleto);
    const seleccionEquipo = detectarEquipoMlbEnTexto(textoCompleto, equiposEvento) || (equiposJugada.length === 1 ? equiposJugada[0] : null);
    if (linea !== null && tipoTotal) {
      return {
        deporte: "mlb",
        mercado: "total_carreras",
        equipos: equiposEvento.length >= 2 ? equiposEvento.slice(0, 2) : equiposTexto.slice(0, 2),
        seleccionEquipo,
        tipoTotal,
        linea
      };
    }
  }

  if (esTotalHitsMlb(textoCompleto)) {
    const linea = extraerNumeroJugada(textoCompleto);
    const tipoTotal = detectarLadoTotal(jugada) || detectarLadoTotal(textoCompleto);
    if (linea !== null && tipoTotal) {
      return {
        deporte: "mlb",
        mercado: "total_hits",
        equipos: equiposEvento.length >= 2 ? equiposEvento.slice(0, 2) : equiposTexto.slice(0, 2),
        tipoTotal,
        linea
      };
    }
  }

  if (/\b(over|under|mas|menos|mayor|menor|alta|baja)\b/.test(normalizado)) {
    const linea = extraerNumeroJugada(textoCompleto);
    const tipoTotal = detectarLadoTotal(jugada) || detectarLadoTotal(textoCompleto);
    const equiposJugada = detectarEquiposMlb(textoCompleto);
    const seleccionEquipo = detectarEquipoMlbEnTexto(textoCompleto, equiposEvento) || (equiposJugada.length === 1 ? equiposJugada[0] : null);
    if (linea !== null && tipoTotal) {
      return {
        deporte: "mlb",
        mercado: "total_carreras",
        equipos: equiposEvento.length >= 2 ? equiposEvento.slice(0, 2) : equiposTexto.slice(0, 2),
        seleccionEquipo,
        tipoTotal,
        linea
      };
    }
  }

  if (tienePalabraMercado(normalizado, ["ambos", "anotan", "marcan"])) {
    const seleccion = detectarSiNo(textoCompleto) || "si";
    return {
      deporte: "mlb",
      mercado: "ambos_equipos_anotan",
      equipos: equiposEvento.length >= 2 ? equiposEvento.slice(0, 2) : equiposTexto.slice(0, 2),
      seleccion
    };
  }

  if (!/\b(handicap|handi|hcap|runline|spread|over|under|mas|menos|total|carreras?|runs?)\b/.test(normalizado)) {
    const equiposJugada = detectarEquiposMlb(textoCompleto);
    const seleccionEquipo = equiposJugada[0] || null;
    if (seleccionEquipo) {
      return {
        deporte: "mlb",
        mercado: "ganador_partido",
        equipos: equiposEvento.length >= 2 ? equiposEvento.slice(0, 2) : equiposTexto.slice(0, 2),
        seleccionEquipo
      };
    }
  }

  return null;
}

function enriquecerJugadasAutoMlb(jugadas = [], deporte = "") {
  if (deporte !== "mlb") return jugadas;

  const enriquecidas = jugadas.map(jugada => {
    if (typeof jugada !== "object" || !jugada) return jugada;

    const ev = jugada.ev || jugada.evento || "";
    const equipos = detectarEquiposMlb(ev);
    const selections = getSelectionsFromJugada(jugada).map(sel => {
      const autoMlb = crearAutoMlbSeleccion({
        evento: ev,
        titulo: sel.titulo || "",
        jugada: sel.jugadaOriginal || sel.jugada || ""
      });

      return autoMlb ? { ...sel, autoMlb } : sel;
    });

    return {
      ...jugada,
      autoMlb: equipos.length >= 2 ? { deporte: "mlb", equipos: equipos.slice(0, 2) } : (jugada.autoMlb ?? null),
      selections
    };
  });

  return repararTotalesEquipoMlbPartidos(enriquecidas);
}

function getEquipoGanadorSeleccionMlb(selection = {}) {
  const autoMlb = selection?.autoMlb || {};
  return autoMlb.mercado === "ganador_partido" ? autoMlb.seleccionEquipo || "" : "";
}

function esTotalCarrerasMlbSinEquipo(selection = {}) {
  const autoMlb = selection?.autoMlb || {};
  return autoMlb.mercado === "total_carreras" && !autoMlb.seleccionEquipo;
}

function esSeleccionHandicapMlb(selection = {}) {
  const autoMlb = selection?.autoMlb || {};
  return autoMlb.mercado === "handicap" || esHandicapMlbTexto(`${selection.titulo || ""} ${selection.jugada || ""}`);
}

function aplicarEquipoATotalCarrerasMlb(selection = {}, equipo = "") {
  if (!equipo) return selection;
  const autoMlb = {
    ...(selection.autoMlb || {}),
    seleccionEquipo: equipo
  };

  return {
    ...selection,
    titulo: formatearTituloTotalCarrerasMlb(equipo),
    jugada: formatearLineaTotalAuto(autoMlb) || selection.jugada || "",
    autoMlb
  };
}

function repararTotalesEquipoMlbPartidos(jugadas = []) {
  return jugadas.map(jugada => {
    if (typeof jugada !== "object" || !jugada || !Array.isArray(jugada.selections)) return jugada;

    const reparadas = [];
    jugada.selections.forEach(selection => {
      const anterior = reparadas[reparadas.length - 1];
      const equipoAnterior = getEquipoGanadorSeleccionMlb(anterior);
      const totalSinEquipo = esTotalCarrerasMlbSinEquipo(selection) && !esSeleccionHandicapMlb(selection);
      const yaHabiaGanadorMismoEquipo = equipoAnterior && reparadas
        .slice(0, -1)
        .some(sel => normalizarClaveMlb(getEquipoGanadorSeleccionMlb(sel)) === normalizarClaveMlb(equipoAnterior));

      if (totalSinEquipo && equipoAnterior && yaHabiaGanadorMismoEquipo) {
        reparadas.pop();
        reparadas.push(aplicarEquipoATotalCarrerasMlb(selection, equipoAnterior));
        return;
      }

      reparadas.push(selection);
    });

    return {
      ...jugada,
      selections: reparadas
    };
  });
}

function normalizarBaseFutbol(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|club|deportivo|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarClaveFutbol(value = "") {
  const normalizado = normalizarBaseFutbol(value);
  return aplicarAliasFutbol(normalizado);
}

function extraerEquiposEventoFutbol(evento = "") {
  const partes = limpiarEventoDuplicado(evento)
    .split(/\s+(?:vs?\.?|versus|contra|v|[-–—/])\s+/i)
    .map(parte => limpiarEspaciosMercado(parte))
    .filter(Boolean);
  return partes.length >= 2 ? partes.slice(0, 2) : [];
}

function textoContieneEquipoFutbol(texto = "", equipo = "") {
  const textoNorm = normalizarClaveFutbol(texto);
  const equipoNorm = normalizarClaveFutbol(equipo);
  if (!textoNorm || !equipoNorm) return false;
  if (textoNorm.includes(equipoNorm) || equipoNorm.includes(textoNorm)) return true;

  const textoTokens = textoNorm.split(" ").filter(t => t.length >= 3);
  const equipoTokens = equipoNorm.split(" ").filter(t => t.length >= 3);
  if (!textoTokens.length || !equipoTokens.length) return false;
  return equipoTokens.some(token => textoTokens.includes(token));
}

function crearAutoFutbolSeleccion({ evento = "", titulo = "", jugada = "" } = {}) {
  const equipos = extraerEquiposEventoFutbol(evento);
  if (equipos.length < 2) return null;

  const textoCompleto = limpiarEspaciosMercado(`${titulo} ${jugada}`);
  const normalizado = normalizarTextoMercado(textoCompleto);
  const seleccionEquipoTotal = equipos.find(equipo => textoContieneEquipoFutbol(textoCompleto, equipo)) || "";

  if (tienePalabraMercado(normalizado, ["corner", "corners", "esquina", "esquinas"])) {
    const linea = extraerNumeroJugada(textoCompleto);
    const tipoTotal = detectarLadoTotal(textoCompleto);
    if (linea !== null && tipoTotal) {
      return {
        deporte: "futbol",
        mercado: "total_corners",
        equipos,
        ...(seleccionEquipoTotal ? { seleccionEquipo: seleccionEquipoTotal } : {}),
        tipoTotal,
        linea
      };
    }
  }

  if (tienePalabraMercado(normalizado, ["tarjeta", "tarjetas", "card", "cards"])) {
    const linea = extraerNumeroJugada(textoCompleto);
    const tipoTotal = detectarLadoTotal(textoCompleto);
    if (linea !== null && tipoTotal) {
      return {
        deporte: "futbol",
        mercado: "total_tarjetas",
        equipos,
        ...(seleccionEquipoTotal ? { seleccionEquipo: seleccionEquipoTotal } : {}),
        tipoTotal,
        linea
      };
    }
  }

  if (tienePalabraMercado(normalizado, ["handicap", "handi", "hcap"]) || /[+-]\s*\d+(?:[.,]\d+)?/.test(textoCompleto)) {
    const linea = extraerNumeroConSigno(textoCompleto);
    const seleccionEquipo = equipos.find(equipo => textoContieneEquipoFutbol(textoCompleto, equipo));
    if (linea !== null && seleccionEquipo) {
      return {
        deporte: "futbol",
        mercado: "handicap",
        equipos,
        seleccionEquipo,
        linea
      };
    }
  }

  if (tienePalabraMercado(normalizado, ["gol", "goles"])) {
    const linea = extraerNumeroJugada(textoCompleto);
    const tipoTotal = detectarLadoTotal(textoCompleto);
    if (linea !== null && tipoTotal) {
      return {
        deporte: "futbol",
        mercado: "total_goles",
        equipos,
        ...(seleccionEquipoTotal ? { seleccionEquipo: seleccionEquipoTotal } : {}),
        tipoTotal,
        linea
      };
    }
  }

  if (
    /\b(over|under|mas|menos|mayor|menor|alta|baja)\b/.test(normalizado) &&
    !/\b(corner|corners|esquina|esquinas|tarjeta|tarjetas)\b/.test(normalizado)
  ) {
    const linea = extraerNumeroJugada(textoCompleto);
    const tipoTotal = detectarLadoTotal(textoCompleto);
    if (linea !== null && tipoTotal) {
      return {
        deporte: "futbol",
        mercado: "total_goles",
        equipos,
        ...(seleccionEquipoTotal ? { seleccionEquipo: seleccionEquipoTotal } : {}),
        tipoTotal,
        linea
      };
    }
  }

  if (tienePalabraMercado(normalizado, ["ambos", "marcan", "anotan"])) {
    return {
      deporte: "futbol",
      mercado: "ambos_marcan",
      equipos,
      seleccion: detectarSiNo(textoCompleto) || "si"
    };
  }

  const dobleOportunidad = detectarDobleOportunidadFutbol(textoCompleto, evento);
  if (dobleOportunidad) {
    return {
      deporte: "futbol",
      mercado: "doble_oportunidad",
      equipos,
      ...dobleOportunidad
    };
  }

  if (/\b(empate|draw|x)\b/.test(normalizado)) {
    return {
      deporte: "futbol",
      mercado: "ganador_partido",
      equipos,
      seleccion: "empate"
    };
  }

  if (esEquipoGanaraCualquierMitad(textoCompleto)) {
    return null;
  }

  const seleccionEquipo = equipos.find(equipo => textoContieneEquipoFutbol(textoCompleto, equipo));
  if (seleccionEquipo && !/\b(handicap|handi|hcap|corner|corners|tarjeta|tarjetas|over|under|mas|menos|total|goles?)\b/.test(normalizado)) {
    return {
      deporte: "futbol",
      mercado: "ganador_partido",
      equipos,
      seleccionEquipo
    };
  }

  return null;
}

function combinarAutoFutbolConDetectado(autoOriginal = null, autoDetectado = null) {
  if (!autoOriginal) return autoDetectado;
  if (!autoDetectado) return autoOriginal;

  const camposDetectados = [
    "mercado",
    "equipos",
    "seleccion",
    "seleccionEquipo",
    "seleccionEquipos",
    "incluyeEmpate",
    "tipoTotal",
    "linea"
  ];
  const combinado = { ...autoOriginal };
  camposDetectados.forEach(campo => {
    if (autoDetectado[campo] !== undefined) {
      combinado[campo] = autoDetectado[campo];
    }
  });
  return combinado;
}

function aplicarDetalleAutoFutbolSeleccion(selection = {}, autoFutbol = null, evento = "") {
  if (!autoFutbol) return selection;
  const detalle = detectarDetalleSeleccionCrear({
    titulo: selection.titulo || "",
    jugada: selection.jugadaOriginal || selection.jugada || "",
    evento,
    autoFutbol
  });

  return {
    ...selection,
    titulo: detalle.titulo || selection.titulo,
    jugada: detalle.jugada || selection.jugada,
    autoFutbol
  };
}

function enriquecerJugadasAutoFutbol(jugadas = [], deporte = "") {
  if (deporte !== "futbol") return jugadas;

  return jugadas.map(jugada => {
    if (typeof jugada !== "object" || !jugada) return jugada;

    const ev = jugada.ev || jugada.evento || "";
    const equipos = extraerEquiposEventoFutbol(ev);
    const selections = getSelectionsFromJugada(jugada).map(sel => {
      const autoDetectado = crearAutoFutbolSeleccion({
        evento: ev,
        titulo: sel.titulo || "",
        jugada: sel.jugadaOriginal || sel.jugada || ""
      });
      const autoFutbol = combinarAutoFutbolConDetectado(sel.autoFutbol || null, autoDetectado);
      return autoFutbol ? aplicarDetalleAutoFutbolSeleccion(sel, autoFutbol, ev) : sel;
    });

    return {
      ...jugada,
      autoFutbol: equipos.length >= 2 ? { deporte: "futbol", equipos } : (jugada.autoFutbol ?? null),
      selections
    };
  });
}

function enriquecerJugadasAuto(jugadas = [], deporte = "") {
  return enriquecerJugadasAutoFutbol(enriquecerJugadasAutoMlb(jugadas, deporte), deporte);
}

window.agregarSeleccionAlSlot = function (btn) {
  const slot = btn.closest(".jugada-slot");
  const container = slot.querySelector(".selections-container");
  const existingRows = container.querySelectorAll(".selection-row");
  const num = existingRows.length + 1;

  // Update all existing placeholders to be numbered
  existingRows.forEach((r, i) => {
    const inp = r.querySelector(".jugada-jug-input");
    if (inp) inp.placeholder = `Jugada ${i + 1}`;
    const delBtn = r.querySelector(".btn-eliminar-selection");
    if (delBtn) delBtn.style.display = "inline-block";
  });

  const div = document.createElement("div");
  div.innerHTML = crearFilaSeleccionHTML(num, true);
  const row = div.firstElementChild;
  row.querySelector(".btn-eliminar-selection").style.display = "inline-block";
  container.appendChild(row);
  habilitarAutocompleteMlb(row);
  row.querySelector(".jugada-jug-input").focus();
};

window.eliminarFilaSeleccion = function (btn) {
  const row = btn.closest(".selection-row");
  const container = row.closest(".selections-container") || row.closest("#selections-simple-container");
  row.remove();

  const remainingRows = container.querySelectorAll(".selection-row");
  remainingRows.forEach((r, i) => {
    const inp = r.querySelector(".jugada-jug-input");
    if (inp) inp.placeholder = `Jugada ${i + 1}`;
  });

  if (remainingRows.length === 1) {
    const delBtn = remainingRows[0].querySelector(".btn-eliminar-selection");
    if (delBtn) delBtn.style.display = "none";
    const inp = remainingRows[0].querySelector(".jugada-jug-input");
    if (inp && inp.placeholder.startsWith("Jugada")) inp.placeholder = "Jugada";
  }
};

window.agregarSeleccionCrear = function () {
  const container = document.getElementById("selections-crear-container");
  const existingRows = container.querySelectorAll(".selection-row");
  const num = existingRows.length + 1;

  existingRows.forEach((r, i) => {
    const inp = r.querySelector(".jugada-jug-input");
    if (inp) inp.placeholder = `Jugada ${i + 1}`;
    const delBtn = r.querySelector(".btn-eliminar-selection");
    if (delBtn) delBtn.style.display = "inline-block";
  });

  const div = document.createElement("div");
  div.className = "selection-row";
  div.style.cssText = "display:flex; align-items:center; gap:6px; margin-bottom:4px;";
  div.innerHTML = `
    <input type="text" class="jugada-jug-input" placeholder="Jugada ${num}" style="background:#1e293b; color:white; border:1px dashed #475569; border-radius:6px; padding:7px 10px; font-size:12px; box-sizing:border-box; width:75%; min-width:120px;">
    <button type="button" class="btn-eliminar-selection" onclick="window.eliminarFilaSeleccionCrear(this)" style="display:inline-block; padding:2px 7px; font-size:11px; font-weight:bold; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer; flex-shrink:0;">✕</button>
  `;
  container.appendChild(div);
  habilitarAutocompleteMlb(div);
  div.querySelector(".jugada-jug-input").focus();
};

window.eliminarFilaSeleccionCrear = function (btn) {
  const row = btn.closest(".selection-row");
  row.remove();

  const container = document.getElementById("selections-crear-container");
  const remainingRows = container.querySelectorAll(".selection-row");
  remainingRows.forEach((r, i) => {
    const inp = r.querySelector(".jugada-jug-input");
    if (inp) inp.placeholder = `Jugada ${i + 1}`;
  });

  if (remainingRows.length === 1) {
    const delBtn = remainingRows[0].querySelector(".btn-eliminar-selection");
    if (delBtn) delBtn.style.display = "none";
    const inp = remainingRows[0].querySelector(".jugada-jug-input");
    if (inp) inp.placeholder = "Jugada";
  }
};

/* =========================
   ELIMINAR SLOT DE JUGADA
   ========================= */
window.eliminarSlot = function (btn) {
  const slot = btn.closest(".jugada-slot");
  slot.remove();
  const container = document.getElementById("eventosContainer");
  const remaining = container.querySelectorAll(".jugada-slot");
  remaining.forEach((s, i) => {
    const numEl = s.querySelector(".jugada-slot-num");
    if (numEl) numEl.textContent = `Partido #${i + 1}`;
    const evInput = s.querySelector(".jugada-ev-input");
    if (evInput) evInput.placeholder = `Partido #${i + 1} (Ej: Dodgers vs Mets)`;
  });
  if (remaining.length === 1) {
    const delBtn = remaining[0].querySelector(".btn-eliminar-slot");
    if (delBtn) delBtn.style.display = "none";
  }
};

/* helper: create one combinada party slot */
function crearSlotCombinada(num) {
  const slot = document.createElement("div");
  slot.className = "jugada-slot";
  slot.style.cssText = "display:flex; flex-direction:column; gap:4px; border-left:2px solid #fbbf24; padding-left:10px; margin-bottom:8px;";
  slot.innerHTML = `
    <div class="jugada-slot-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:2px;">
      <span class="jugada-slot-num" style="font-size:10px; font-weight:700; color:#fbbf24; text-transform:uppercase; letter-spacing:0.5px;">Partido #${num}</span>
      <button type="button" class="btn-eliminar-slot" onclick="window.eliminarSlot(this)" style="display:\${num > 1 ? 'inline-block' : 'none'}; padding:2px 7px; font-size:11px; font-weight:700; background:rgba(239, 68, 68, 0.15); color:#f87171; border:1px solid rgba(239, 68, 68, 0.3); border-radius:4px; cursor:pointer;">✕</button>
    </div>
    <input type="text" class="jugada-ev-input" placeholder="Partido #${num} (Ej: Dodgers vs Mets)" autocomplete="off" style="font-size:12px; font-weight:600; color:#f1f5f9 !important; background:#1e293b !important; border:1px solid #334155 !important; border-radius:6px !important; padding:6px 10px !important;">
    <input type="text" class="jugada-jug-input" placeholder="Jugada (Ej: Dodgers gana)" autocomplete="off" style="font-size:12px; color:#94a3b8 !important; background:#1e293b !important; border:1px dashed #475569 !important; border-radius:6px !important; padding:6px 10px !important;">
    <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
      <span style="font-size:11px; color:#94a3b8; font-weight:600;">Cuota:</span>
      <input type="number" class="jugada-cuota-input" placeholder="1.80" step="0.01" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')" style="width:90px; background:#1e293b; color:#fbbf24; border:1px dashed #fbbf24; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
    </div>
  `;
  habilitarAutocompleteMlb(slot);
  return slot;
}

/* helper: create one simple party slot */
function crearSlotSimple(num) {
  const slot = document.createElement("div");
  slot.className = "jugada-slot simple-slot";
  slot.style.cssText = "display:flex; flex-direction:column; gap:4px; border-left:2px solid #00c6ff; padding-left:10px; margin-bottom:8px;";
  slot.innerHTML = `
    <div class="jugada-slot-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:2px;">
      <span class="jugada-slot-num" style="font-size:10px; font-weight:700; color:#00c6ff; text-transform:uppercase; letter-spacing:0.5px;">Partido #${num}</span>
      <button type="button" class="btn-eliminar-slot-simple" onclick="window.eliminarSlotSimple(this)" style="display:\${num > 1 ? 'inline-block' : 'none'}; padding:2px 7px; font-size:11px; font-weight:700; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;">✕</button>
    </div>
    <input type="text" class="jugada-ev-input" placeholder="Partido #${num} (Ej: México vs Sudáfrica)" autocomplete="off" style="font-size:12px; font-weight:600; color:#f1f5f9 !important; background:#1e293b !important; border:1px solid #334155 !important; border-radius:6px !important; padding:6px 10px !important;">
    <input type="text" class="jugada-jug-input" placeholder="Jugada (Ej: México gana)" autocomplete="off" style="font-size:12px; color:#94a3b8 !important; background:#1e293b !important; border:1px dashed #475569 !important; border-radius:6px !important; padding:6px 10px !important;">
    <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
      <span style="font-size:11px; color:#94a3b8; font-weight:600;">Importe:</span>
      <input type="number" class="jugada-importe-input" placeholder="0.00" step="0.01" min="0" autocomplete="off"
        oninput="if(document.activeElement !== this && this.dataset.touched !== '1') { this.value = ''; } else { this.dataset.touched = '1'; }"
        onchange="if(document.activeElement !== this && this.dataset.touched !== '1') { this.value = ''; }"
        style="width:140px; background:#1e293b; color:#f1f5f9; border:1px solid #334155; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:600; box-sizing:border-box;">
    </div>
    <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
      <span style="font-size:11px; color:#94a3b8; font-weight:600;">Cuota:</span>
      <input type="number" class="jugada-cuota-input" placeholder="1.80" step="0.01" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')" style="width:90px; background:#1e293b; color:#fbbf24; border:1px dashed #fbbf24; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
    </div>
  `;
  // Forzar limpieza de todos los inputs para evitar autofill del navegador
  requestAnimationFrame(() => {
    slot.querySelectorAll("input[type='text'], input[type='number']").forEach(i => { i.value = ""; });
  });
  habilitarAutocompleteMlb(slot);
  return slot;
}

/* eliminar un slot de apuesta simple */
window.eliminarSlotSimple = function (btn) {
  const slot = btn.closest(".simple-slot");
  slot.remove();
  const container = document.getElementById("eventosSimpleContainer");
  const remaining = container.querySelectorAll(".simple-slot");
  remaining.forEach((s, i) => {
    const numEl = s.querySelector(".jugada-slot-num");
    if (numEl) numEl.textContent = `Partido #${i + 1}`;
    const evInput = s.querySelector(".jugada-ev-input");
    if (evInput) evInput.placeholder = `Partido #${i + 1} (Ej: México vs Sudáfrica)`;
  });
  if (remaining.length === 1) {
    const delBtn = remaining[0].querySelector(".btn-eliminar-slot-simple");
    if (delBtn) delBtn.style.display = "none";
  }
};

function crearSlotSimpleOption(num) {
  const slot = document.createElement("div");
  slot.className = "jugada-slot simple-option-slot";
  slot.style.cssText = "display:flex; flex-direction:column; gap:4px; border-left:2px solid #22d3ee; padding-left:10px; margin-bottom:8px;";
  slot.innerHTML = `
    <div class="jugada-slot-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:2px;">
      <span class="jugada-slot-num" style="font-size:10px; font-weight:700; color:#22d3ee; text-transform:uppercase; letter-spacing:0.5px;">Partido #${num}</span>
      <button type="button" class="btn-eliminar-slot-simple-option" onclick="window.eliminarSlotSimpleOption(this)" style="display:${num > 1 ? 'inline-block' : 'none'}; padding:2px 7px; font-size:11px; font-weight:700; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;">x</button>
    </div>
    <input type="text" class="jugada-ev-input" placeholder="Partido #${num} (Ej: Alemania vs Curacao)" autocomplete="off" style="font-size:12px; font-weight:600; color:#f1f5f9 !important; background:#1e293b !important; border:1px solid #334155 !important; border-radius:6px !important; padding:6px 10px !important;">
    <input type="text" class="jugada-jug-input" placeholder="Jugada (Ej: Mas de 4.5 goles)" autocomplete="off" style="font-size:12px; color:#94a3b8 !important; background:#1e293b !important; border:1px dashed #475569 !important; border-radius:6px !important; padding:6px 10px !important;">
    <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
      <span style="font-size:11px; color:#94a3b8; font-weight:600;">Importe:</span>
      <input type="number" class="jugada-importe-input" placeholder="0.00" step="0.01" min="0" autocomplete="off"
        oninput="if(document.activeElement !== this && this.dataset.touched !== '1') { this.value = ''; } else { this.dataset.touched = '1'; }"
        onchange="if(document.activeElement !== this && this.dataset.touched !== '1') { this.value = ''; }"
        style="width:140px; background:#1e293b; color:#f1f5f9; border:1px solid #334155; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:600; box-sizing:border-box;">
    </div>
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:2px;">
      <span style="font-size:11px; color:#94a3b8; font-weight:600;">Max odds:</span>
      <input type="number" class="jugada-max-odds-input" placeholder="2.483" step="0.001" min="0" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')" style="width:100px; background:#1e293b; color:#22d3ee; border:1px dashed #22d3ee; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
      <span style="font-size:11px; color:#94a3b8; font-weight:600;">Opti odds:</span>
      <input type="number" class="jugada-opti-odds-input" placeholder="1.546" step="0.001" min="0" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')" style="width:100px; background:#1e293b; color:#22d3ee; border:1px dashed #22d3ee; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
    </div>
  `;
  requestAnimationFrame(() => {
    slot.querySelectorAll("input[type='text'], input[type='number']").forEach(i => { i.value = ""; });
  });
  habilitarAutocompleteMlb(slot);
  return slot;
}

window.eliminarSlotSimpleOption = function (btn) {
  const slot = btn.closest(".simple-option-slot");
  slot.remove();
  const container = document.getElementById("eventosSimpleOptionContainer");
  const remaining = container.querySelectorAll(".simple-option-slot");
  remaining.forEach((s, i) => {
    const numEl = s.querySelector(".jugada-slot-num");
    if (numEl) numEl.textContent = `Partido #${i + 1}`;
    const evInput = s.querySelector(".jugada-ev-input");
    if (evInput) evInput.placeholder = `Partido #${i + 1} (Ej: Alemania vs Curacao)`;
  });
  if (remaining.length === 1) {
    const delBtn = remaining[0].querySelector(".btn-eliminar-slot-simple-option");
    if (delBtn) delBtn.style.display = "none";
  }
};

function actualizarSlotsPatente() {
  const container = document.getElementById("eventosPatenteContainer");
  if (!container) return;

  const slots = container.querySelectorAll(".patente-slot");
  slots.forEach((s, i) => {
    const num = i + 1;
    const numEl = s.querySelector(".jugada-slot-num");
    if (numEl) numEl.textContent = `Seleccion #${num}`;
    const evInput = s.querySelector(".jugada-ev-input");
    if (evInput) evInput.placeholder = `Seleccion #${num} (Ej: Dodgers vs Mets)`;
    const del = s.querySelector(".btn-eliminar-slot-patente");
    if (del) del.style.display = slots.length > PATENTE_MIN_SELECTIONS ? "inline-block" : "none";
  });

  const addBtn = document.getElementById("btnAgregarSeleccionPatente");
  if (addBtn) {
    addBtn.style.display = slots.length >= PATENTE_MAX_SELECTIONS ? "none" : "inline-block";
  }
}

function crearSlotPatente(num) {
  const slot = document.createElement("div");
  slot.className = "jugada-slot patente-slot";
  slot.style.cssText = "display:flex; flex-direction:column; gap:4px; border-left:2px solid #fb7185; padding-left:10px; margin-bottom:8px;";
  slot.innerHTML = `
    <div class="jugada-slot-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:2px;">
      <span class="jugada-slot-num" style="font-size:10px; font-weight:700; color:#fb7185; text-transform:uppercase; letter-spacing:0.5px;">Seleccion #${num}</span>
      <button type="button" class="btn-eliminar-slot-patente" onclick="window.eliminarSlotPatente(this)" style="display:${num > PATENTE_MIN_SELECTIONS ? 'inline-block' : 'none'}; padding:2px 7px; font-size:11px; font-weight:700; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;">x</button>
    </div>
    <input type="text" class="jugada-ev-input" placeholder="Seleccion #${num} (Ej: Dodgers vs Mets)" autocomplete="off" style="font-size:12px; font-weight:600; color:#f1f5f9 !important; background:#1e293b !important; border:1px solid #334155 !important; border-radius:6px !important; padding:6px 10px !important;">
    <input type="text" class="jugada-jug-input" placeholder="Jugada (Ej: Dodgers gana)" autocomplete="off" style="font-size:12px; color:#94a3b8 !important; background:#1e293b !important; border:1px dashed #475569 !important; border-radius:6px !important; padding:6px 10px !important;">
    <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
      <span style="font-size:11px; color:#94a3b8; font-weight:600;">Cuota:</span>
      <input type="number" class="jugada-cuota-input" placeholder="1.80" step="0.01" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')" style="width:90px; background:#1e293b; color:#fb7185; border:1px dashed #fb7185; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
    </div>
  `;
  requestAnimationFrame(() => {
    slot.querySelectorAll("input[type='text'], input[type='number']").forEach(i => { i.value = ""; });
  });
  habilitarAutocompleteMlb(slot);
  return slot;
}

function inicializarPatenteSlots() {
  const container = document.getElementById("eventosPatenteContainer");
  if (!container) return;
  while (container.querySelectorAll(".patente-slot").length < PATENTE_MIN_SELECTIONS) {
    container.appendChild(crearSlotPatente(container.querySelectorAll(".patente-slot").length + 1));
  }
  actualizarSlotsPatente();
}

window.eliminarSlotPatente = function (btn) {
  const container = document.getElementById("eventosPatenteContainer");
  if (!container) return;

  const slots = container.querySelectorAll(".patente-slot");
  if (slots.length <= PATENTE_MIN_SELECTIONS) {
    mostrarModalValidacion([`La patente necesita al menos ${PATENTE_MIN_SELECTIONS} selecciones.`]);
    return;
  }

  btn.closest(".patente-slot")?.remove();
  actualizarSlotsPatente();
};


function crearSlotCrearApuesta(num) {
  const slot = document.createElement("div");
  slot.className = "jugada-slot crear-slot";
  slot.style.cssText = "display:flex; flex-direction:column; gap:4px; border-left:2px solid #818cf8; padding-left:10px; margin-bottom:8px;";
  slot.innerHTML = `
    <div class="jugada-slot-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:2px;">
      <span class="jugada-slot-num" style="font-size:10px; font-weight:700; color:#818cf8; text-transform:uppercase; letter-spacing:0.5px;">Partido #${num}</span>
      <button type="button" class="btn-eliminar-slot-crear" onclick="window.eliminarSlotCrear(this)" style="display:${num > 1 ? 'inline-block' : 'none'}; padding:2px 7px; font-size:11px; font-weight:700; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;">✕</button>
    </div>
    <input type="text" class="jugada-ev-input" placeholder="Partido #${num} (Ej: Dodgers vs Mets)" autocomplete="off" style="font-size:12px; font-weight:600; color:#f1f5f9 !important; background:#1e293b !important; border:1px solid #334155 !important; border-radius:6px !important; padding:6px 10px !important; width:100%; box-sizing:border-box;">
    
    <div class="selections-container" style="display:flex; flex-direction:column; gap:4px; margin-top:2px;">
      <div class="selection-row" style="display:flex; align-items:center; gap:6px;">
        <input type="text" class="jugada-jug-input" placeholder="Jugada" autocomplete="off" style="background:#1e293b; color:white; border:1px dashed #475569; border-radius:6px; padding:5px 8px; font-size:12px; box-sizing:border-box; width:75%; min-width:120px;">
        <button type="button" class="btn-eliminar-selection" onclick="window.eliminarFilaSeleccion(this)" style="display:none; padding:2px 7px; font-size:11px; font-weight:bold; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer; flex-shrink:0;">✕</button>
      </div>
    </div>
    
    <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
      <span style="font-size:11px; color:#94a3b8; font-weight:600;">Cuota:</span>
      <input type="number" class="jugada-cuota-input" placeholder="1.80" step="0.01" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')" style="width:90px; background:#1e293b; color:#fbbf24; border:1px dashed #fbbf24; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
    </div>
    
    <button type="button" class="btn-agregar-sel-slot" onclick="window.agregarSeleccionAlSlot(this)"
      style="align-self:flex-start; font-size:11px; padding:3px 10px; background:#818cf8; color:black; font-weight:bold; border-radius:4px; border:none; cursor:pointer; margin-top:4px;">➕ Agregar selección</button>
  `;
  habilitarAutocompleteMlb(slot);
  return slot;
}

/* eliminar un slot de crear apuesta */
window.eliminarSlotCrear = function (btn) {
  const slot = btn.closest(".crear-slot");
  slot.remove();
  const container = document.getElementById("eventosCrearContainer");
  const remaining = container.querySelectorAll(".crear-slot");
  remaining.forEach((s, i) => {
    const numEl = s.querySelector(".jugada-slot-num");
    if (numEl) numEl.textContent = `Partido #${i + 1}`;
    const evInput = s.querySelector(".jugada-ev-input");
    if (evInput) evInput.placeholder = `Partido #${i + 1} (Ej: Dodgers vs Mets)`;
  });
  if (remaining.length === 1) {
    const delBtn = remaining[0].querySelector(".btn-eliminar-slot-crear");
    if (delBtn) delBtn.style.display = "none";
  }
};

/* helper: create one crear apuesta simple slot (same UI as crear combinada but green) */
function crearSlotCrearApuestaSimple(num) {
  const slot = document.createElement("div");
  slot.className = "jugada-slot crear-simple-slot";
  slot.style.cssText = "display:flex; flex-direction:column; gap:4px; border-left:2px solid #34d399; padding-left:10px; margin-bottom:8px;";
  slot.innerHTML = `
    <div class="jugada-slot-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:2px;">
      <span class="jugada-slot-num" style="font-size:10px; font-weight:700; color:#34d399; text-transform:uppercase; letter-spacing:0.5px;">Partido #${num}</span>
      <button type="button" class="btn-eliminar-slot-crear-simple" onclick="window.eliminarSlotCrearSimple(this)" style="display:${num > 1 ? 'inline-block' : 'none'}; padding:2px 7px; font-size:11px; font-weight:700; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;">✕</button>
    </div>
    <input type="text" class="jugada-ev-input" placeholder="Partido #${num} (Ej: Dodgers vs Mets)" autocomplete="off" style="font-size:12px; font-weight:600; color:#f1f5f9 !important; background:#1e293b !important; border:1px solid #334155 !important; border-radius:6px !important; padding:6px 10px !important; width:100%; box-sizing:border-box;">
    
    <div class="selections-container" style="display:flex; flex-direction:column; gap:4px; margin-top:2px;">
      <div class="selection-row" style="display:flex; align-items:center; gap:6px;">
        <input type="text" class="jugada-jug-input" placeholder="Jugada" autocomplete="off" style="background:#1e293b; color:white; border:1px dashed #475569; border-radius:6px; padding:5px 8px; font-size:12px; box-sizing:border-box; width:75%; min-width:120px;">
        <button type="button" class="btn-eliminar-selection" onclick="window.eliminarFilaSeleccion(this)" style="display:none; padding:2px 7px; font-size:11px; font-weight:bold; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer; flex-shrink:0;">✕</button>
      </div>
    </div>
    
    <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
      <span style="font-size:11px; color:#94a3b8; font-weight:600;">Importe:</span>
      <input type="number" class="jugada-importe-input" placeholder="0.00" step="0.01" min="0" autocomplete="off"
        oninput="if(document.activeElement !== this && this.dataset.touched !== '1') { this.value = ''; } else { this.dataset.touched = '1'; }"
        onchange="if(document.activeElement !== this && this.dataset.touched !== '1') { this.value = ''; }"
        style="width:140px; background:#1e293b; color:#f1f5f9; border:1px solid #334155; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:600; box-sizing:border-box;">
    </div>

    <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
      <span style="font-size:11px; color:#94a3b8; font-weight:600;">Cuota:</span>
      <input type="number" class="jugada-cuota-input" placeholder="1.80" step="0.01" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')" style="width:90px; background:#1e293b; color:#fbbf24; border:1px dashed #fbbf24; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
    </div>
    
    <button type="button" class="btn-agregar-sel-slot" onclick="window.agregarSeleccionAlSlotCrearSimple(this)"
      style="align-self:flex-start; font-size:11px; padding:3px 10px; background:#34d399; color:black; font-weight:bold; border-radius:4px; border:none; cursor:pointer; margin-top:4px;">➕ Agregar selección</button>
  `;
  // Forzar limpieza de todos los inputs para evitar autofill del navegador
  requestAnimationFrame(() => {
    slot.querySelectorAll("input[type='text'], input[type='number']").forEach(i => { i.value = ""; });
  });
  habilitarAutocompleteMlb(slot);
  return slot;
}

/* eliminar un slot de crear apuesta simple */
window.eliminarSlotCrearSimple = function (btn) {
  const slot = btn.closest(".crear-simple-slot");
  slot.remove();
  const container = document.getElementById("eventosCrearSimpleContainer");
  const remaining = container.querySelectorAll(".crear-simple-slot");
  remaining.forEach((s, i) => {
    const numEl = s.querySelector(".jugada-slot-num");
    if (numEl) numEl.textContent = `Partido #${i + 1}`;
    const evInput = s.querySelector(".jugada-ev-input");
    if (evInput) evInput.placeholder = `Partido #${i + 1} (Ej: Dodgers vs Mets)`;
  });
  if (remaining.length === 1) {
    const delBtn = remaining[0].querySelector(".btn-eliminar-slot-crear-simple");
    if (delBtn) delBtn.style.display = "none";
  }
};

/* agregar seleccion al slot de crear apuesta simple */
window.agregarSeleccionAlSlotCrearSimple = function (btn) {
  const slot = btn.closest(".crear-simple-slot");
  const container = slot.querySelector(".selections-container");
  const existingRows = container.querySelectorAll(".selection-row");
  const num = existingRows.length + 1;

  existingRows.forEach((r, i) => {
    const inp = r.querySelector(".jugada-jug-input");
    if (inp) inp.placeholder = `Jugada ${i + 1}`;
    const delBtn = r.querySelector(".btn-eliminar-selection");
    if (delBtn) delBtn.style.display = "inline-block";
  });

  const div = document.createElement("div");
  div.innerHTML = crearFilaSeleccionHTML(num, true);
  const row = div.firstElementChild;
  row.querySelector(".btn-eliminar-selection").style.display = "inline-block";
  container.appendChild(row);
  habilitarAutocompleteMlb(row);
  row.querySelector(".jugada-jug-input").focus();
};

/* =========================
   AGREGAR APUESTA
   ========================= */
async function agregarApuesta() {
  const fecha = document.getElementById("fecha").value;
  const hora = document.getElementById("hora")?.value || "";
  const tipoApuesta = document.getElementById("tipoApuesta").value;
  let deporte = getDeporteFormulario();
  const isCombinada = tipoApuesta === "combinada";
  const isPatente = tipoApuesta === "patente";
  const isCrearApuesta = tipoApuesta === "crear_apuesta";
  const isCrearApuestaSimple = tipoApuesta === "crear_apuesta_simple";
  const isSimpleOptionBet = tipoApuesta === "simple_option_bet";

  let errores = [];
  if (!fecha) errores.push("Rellena la fecha.");

  const importeVal = document.getElementById("importe").value.trim();
  const importe = parseFloat(importeVal);
  if (tipoApuesta !== "simple" && tipoApuesta !== "crear_apuesta_simple" && tipoApuesta !== "simple_option_bet") {
    if (!importeVal || isNaN(importe) || importe <= 0) {
      errores.push("Rellena el importe (debe ser mayor a 0).");
    }
  }

  let jugadas = [];
  let cuota = 0;
  let evento = "";

  if (tipoApuesta === "simple") {
    // ── SIMPLE (multi-partido dinámico) ──
    const slots = document.querySelectorAll("#eventosSimpleContainer .simple-slot");
    if (slots.length === 0) {
      errores.push("Agrega al menos un partido.");
    }
    // Check if any slot lacks individual/global importe
    let needsGlobalImporte = false;
    slots.forEach((slot, idx) => {
      const n = idx + 1;
      const ev = autocorregirTextoApuesta(slot.querySelector(".jugada-ev-input")?.value.trim() || "");
      const jug = autocorregirTextoApuesta(slot.querySelector(".jugada-jug-input")?.value.trim() || "", ev);
      const cuotaVal = slot.querySelector(".jugada-cuota-input")?.value.trim() || "";
      const c = parseFloat(cuotaVal);

      const importeInput = slot.querySelector(".jugada-importe-input");
      const importeSlotVal = importeInput?.value.trim() || "";
      const isCustom = (importeInput && importeInput.dataset.touched === '1' && importeSlotVal);

      if (!isCustom) {
        needsGlobalImporte = true;
      } else {
        if (isNaN(parseFloat(importeSlotVal)) || parseFloat(importeSlotVal) <= 0) {
          errores.push(`Rellena el importe del partido #${n} (debe ser mayor a 0).`);
        }
      }

      if (!ev) errores.push(`Rellena el partido/evento #${n}.`);
      if (!jug) errores.push(`Rellena la jugada del partido #${n}.`);
      if (!cuotaVal || isNaN(c) || c <= 0) errores.push(`Rellena la cuota del partido #${n} (debe ser mayor a 0).`);
    });
    if (needsGlobalImporte && (!importeVal || isNaN(importe) || importe <= 0)) {
      errores.push("Rellena el importe general (o pon un importe individual en cada partido).");
    }
  } else if (isSimpleOptionBet) {
    const slots = document.querySelectorAll("#eventosSimpleOptionContainer .simple-option-slot");
    if (slots.length === 0) {
      errores.push("Agrega al menos un partido.");
    }

    let needsGlobalImporte = false;
    slots.forEach((slot, idx) => {
      const n = idx + 1;
      const ev = autocorregirTextoApuesta(slot.querySelector(".jugada-ev-input")?.value.trim() || "");
      const jug = autocorregirTextoApuesta(slot.querySelector(".jugada-jug-input")?.value.trim() || "", ev);
      const maxOddsVal = slot.querySelector(".jugada-max-odds-input")?.value.trim() || "";
      const optiOddsVal = slot.querySelector(".jugada-opti-odds-input")?.value.trim() || "";
      const maxOdds = parseFloat(maxOddsVal);
      const optiOdds = parseFloat(optiOddsVal);

      const importeInput = slot.querySelector(".jugada-importe-input");
      const importeSlotVal = importeInput?.value.trim() || "";
      const isCustom = (importeInput && importeInput.dataset.touched === '1' && importeSlotVal);

      if (!isCustom) {
        needsGlobalImporte = true;
      } else if (isNaN(parseFloat(importeSlotVal)) || parseFloat(importeSlotVal) <= 0) {
        errores.push(`Rellena el importe del partido #${n} (debe ser mayor a 0).`);
      }

      if (!ev) errores.push(`Rellena el partido/evento #${n}.`);
      if (!jug) errores.push(`Rellena la jugada del partido #${n}.`);
      if (!/\d+(?:[.,]\d+)?/.test(jug)) errores.push(`La jugada del partido #${n} debe tener un numero como 4.5.`);
      if (!maxOddsVal || isNaN(maxOdds) || maxOdds <= 0) errores.push(`Rellena Max odds del partido #${n} (debe ser mayor a 0).`);
      if (!optiOddsVal || isNaN(optiOdds) || optiOdds <= 0) errores.push(`Rellena Opti odds del partido #${n} (debe ser mayor a 0).`);
    });

    if (needsGlobalImporte && (!importeVal || isNaN(importe) || importe <= 0)) {
      errores.push("Rellena el importe general (o pon un importe individual en cada partido).");
    }
  } else if (isPatente) {
    evento = autocorregirTextoApuesta(document.getElementById("eventoPatente")?.value.trim() || "Patente");
    const slots = document.querySelectorAll("#eventosPatenteContainer .patente-slot");

    if (slots.length < PATENTE_MIN_SELECTIONS || slots.length > PATENTE_MAX_SELECTIONS) {
      errores.push(`La patente necesita entre ${PATENTE_MIN_SELECTIONS} y ${PATENTE_MAX_SELECTIONS} selecciones.`);
    }

    slots.forEach((slot, idx) => {
      const n = idx + 1;
      const ev = autocorregirTextoApuesta(slot.querySelector(".jugada-ev-input")?.value.trim() || "");
      const jug = autocorregirTextoApuesta(slot.querySelector(".jugada-jug-input")?.value.trim() || "", ev);
      const cuotaVal = slot.querySelector(".jugada-cuota-input")?.value.trim() || "";
      const c = parseFloat(cuotaVal);

      if (!ev) errores.push(`Rellena el partido/evento de la seleccion #${n}.`);
      if (!jug) errores.push(`Rellena la jugada de la seleccion #${n}.`);
      if (!cuotaVal || isNaN(c) || c <= 0) errores.push(`Rellena la cuota de la seleccion #${n} (debe ser mayor a 0).`);

      jugadas.push({ ev, c: c || 0, estado: "pendiente", selections: [{ titulo: "", jugada: jug, estado: "pendiente" }] });
    });

    cuota = calcularCuotaMaximaPatente(jugadas);
  } else if (isCrearApuesta) {
    // ── CREAR APUESTA COMBINADA (multi-partido, multi-seleccion) ──
    const slots = document.querySelectorAll("#eventosCrearContainer .crear-slot");
    if (slots.length === 0) {
      errores.push("Agrega al menos un partido.");
    }

    let cuotaTotal = 1;
    let tieneCuotas = false;

    slots.forEach((slot, idx) => {
      const n = idx + 1;
      const ev = autocorregirTextoApuesta(slot.querySelector(".jugada-ev-input")?.value.trim() || "");
      if (!ev) errores.push(`Rellena el nombre del Partido #${n}.`);

      const cuotaVal = slot.querySelector(".jugada-cuota-input")?.value.trim() || "";
      const c = parseFloat(cuotaVal);
      if (!cuotaVal || isNaN(c) || c <= 0) {
        errores.push(`Rellena la cuota del Partido #${n} (debe ser mayor a 0).`);
      } else {
        cuotaTotal *= c;
        tieneCuotas = true;
      }

      const selections = [];
      slot.querySelectorAll(".selection-row .jugada-jug-input").forEach(inp => {
        const val = inp.value.trim();
        if (val) selections.push(crearSeleccionDetectada(val, "pendiente", "", ev));
      });
      if (selections.length === 0) errores.push(`Agrega al menos una jugada en el Partido #${n}.`);

      jugadas.push({ ev, c: c || 0, estado: "pendiente", selections });
    });

    // Use the first slot's ev as the main evento name
    evento = jugadas.length > 0 ? jugadas[0].ev : "";
    cuota = tieneCuotas ? parseFloat(cuotaTotal.toFixed(2)) : 0;
  } else if (isCrearApuestaSimple) {
    // ── CREAR APUESTA SIMPLE (multi-partido multi-seleccion, guardadas individualmente) ──
    const slots = document.querySelectorAll("#eventosCrearSimpleContainer .crear-simple-slot");
    if (slots.length === 0) {
      errores.push("Agrega al menos un partido.");
    }

    let needsGlobalImporte = false;
    slots.forEach((slot, idx) => {
      const n = idx + 1;
      const ev = autocorregirTextoApuesta(slot.querySelector(".jugada-ev-input")?.value.trim() || "");
      if (!ev) errores.push(`Rellena el nombre del Partido #${n}.`);

      const cuotaVal = slot.querySelector(".jugada-cuota-input")?.value.trim() || "";
      const c = parseFloat(cuotaVal);
      if (!cuotaVal || isNaN(c) || c <= 0) {
        errores.push(`Rellena la cuota del Partido #${n} (debe ser mayor a 0).`);
      }

      const importeInput = slot.querySelector(".jugada-importe-input");
      const importeSlotVal = importeInput?.value.trim() || "";
      const isCustom = (importeInput && importeInput.dataset.touched === '1' && importeSlotVal);

      if (!isCustom) {
        needsGlobalImporte = true;
      } else {
        if (isNaN(parseFloat(importeSlotVal)) || parseFloat(importeSlotVal) <= 0) {
          errores.push(`Rellena el importe del partido #${n} (debe ser mayor a 0).`);
        }
      }

      const selections = [];
      slot.querySelectorAll(".selection-row .jugada-jug-input").forEach(inp => {
        const val = inp.value.trim();
        if (val) selections.push(crearSeleccionDetectada(val, "pendiente", "", ev));
      });
      if (selections.length === 0) errores.push(`Agrega al menos una jugada en el Partido #${n}.`);
    });

    if (needsGlobalImporte && (!importeVal || isNaN(importe) || importe <= 0)) {
      errores.push("Rellena el importe general (o pon un importe individual en cada partido).");
    }
  } else {
    // ── COMBINADA ──
    evento = autocorregirTextoApuesta(document.getElementById("evento").value.trim());
    const slots = document.querySelectorAll("#eventosContainer .jugada-slot");
    let cuotaTotal = 1;
    let tieneCuotas = false;
    slots.forEach((slot, idx) => {
      const n = idx + 1;
      const ev = autocorregirTextoApuesta(slot.querySelector(".jugada-ev-input")?.value.trim() || "");
      const jug = autocorregirTextoApuesta(slot.querySelector(".jugada-jug-input")?.value.trim() || "", ev);
      const cuotaVal = slot.querySelector(".jugada-cuota-input")?.value.trim() || "";
      const c = parseFloat(cuotaVal);
      if (!ev) errores.push(`Rellena el partido #${n}.`);
      if (!jug) errores.push(`Rellena la jugada del partido #${n}.`);
      if (!cuotaVal || isNaN(c) || c <= 0) errores.push(`Rellena la cuota del partido #${n}.`);
      else { cuotaTotal *= c; tieneCuotas = true; }

      jugadas.push({ ev, c: c || 0, estado: "pendiente", selections: [{ titulo: "", jugada: jug, estado: "pendiente" }] });
    });
    cuota = tieneCuotas ? parseFloat(cuotaTotal.toFixed(2)) : 0;
  }

  if (errores.length > 0) { mostrarModalValidacion(errores); return; }

  const dia = fecha;
  ultimoDiaAgregado = dia;
  ultimoDiaAgregadoTime = Date.now();
  ultimoDiaAgregadoIntentos = 0;
  const resultado = document.getElementById("resultado").value;
  const casaSeleccionada = document.getElementById("casaApuesta")?.value || casaFormularioId;
  const casa = getCasaPorId(casaSeleccionada);
  const datosCasa = {
    casaId: casa.id,
    casaNombre: casa.nombre
  };
  casaFormularioId = casa.id;
  if (jugadas.length > 0) {
    deporte = inferirDeporteDesdeJugadas(deporte, jugadas, evento);
    jugadas = normalizarJugadasConEstado(jugadas);
    jugadas = enriquecerJugadasAuto(jugadas, deporte);
  }
  if (resultado !== "pendiente" && jugadas.length > 0) {
    jugadas = jugadas.map(j => ({
      ...j,
      estado: resultado,
      selections: (j.selections || []).map(sel => ({ ...sel, estado: resultado }))
    }));
  }
  // NOTE: paginaActual se calcula DESPUÉS de setear filtroCasaId para usar el filtro correcto

  const ordenBase = Date.now();

  try {
    if (tipoApuesta === "simple") {
      // ── Guardar cada partido simple como apuesta independiente ──
      const slots = document.querySelectorAll("#eventosSimpleContainer .simple-slot");
      const saves = [];
      for (let idx = 0; idx < slots.length; idx++) {
        const slot = slots[idx];
        const ev = autocorregirTextoApuesta(slot.querySelector(".jugada-ev-input").value.trim());
        const jug = autocorregirTextoApuesta(slot.querySelector(".jugada-jug-input").value.trim(), ev);

        const importeInput = slot.querySelector(".jugada-importe-input");
        const importeSlotVal = importeInput.value.trim();

        const hasCustom = (importeInput.dataset.touched === '1' && importeSlotVal && parseFloat(importeSlotVal) > 0);
        const importeSlot = hasCustom
          ? parseFloat(importeSlotVal)
          : importe;

        const c = parseFloat(slot.querySelector(".jugada-cuota-input").value.trim());
        const jugadasBase = [{ ev, c, estado: resultado, selections: [{ titulo: "", jugada: jug, estado: resultado }] }];
        let deporteSlot = inferirDeporteDesdeJugadas(deporte, jugadasBase, ev);
        if (!deporte && deporteSlot) deporte = deporteSlot;
        let jugadasSlot = enriquecerJugadasAuto(jugadasBase, deporteSlot);

        let slotHora = hora;
        if (deporteSlot === "mlb") {
          let juegoElegido = null;
          if (slot.dataset.selectedGame) {
            try { juegoElegido = JSON.parse(slot.dataset.selectedGame); } catch (e) {}
          }
          if (!juegoElegido) {
            const infoDoble = await detectarDobleJornadaMlb(ev, fecha);
            if (infoDoble?.esDobleJornada) {
              juegoElegido = await solicitarSeleccionDobleJornada(infoDoble);
              if (!juegoElegido) return; // Cancelado por el usuario
            }
          }
          if (juegoElegido) {
            if (juegoElegido.hora) slotHora = juegoElegido.hora;
            jugadasSlot = aplicarDobleJornadaAJugadas(jugadasSlot, juegoElegido);
          }
        }

        saves.push(addDoc(collection(db, "apuestas"), limpiarUndefinedFirestore({
          ...datosCasa,
          deporte: deporteSlot,
          fecha, dia, hora: slotHora,
          evento: ev,
          jugadas: jugadasSlot,
          tipoApuesta: "simple",
          cuota: c,
          importe: importeSlot,
          resultado,
          autoSync: crearAutoSyncPayload({}, resultado),
          creadoEn: ordenBase + idx,
          ordenTabla: ordenBase + idx,
          ordenFormulario: idx
        })));
      }
      await Promise.all(saves);
    } else if (tipoApuesta === "simple_option_bet") {
      const slots = document.querySelectorAll("#eventosSimpleOptionContainer .simple-option-slot");
      const saves = [];
      for (let idx = 0; idx < slots.length; idx++) {
        const slot = slots[idx];
        const ev = autocorregirTextoApuesta(slot.querySelector(".jugada-ev-input").value.trim());
        const jug = autocorregirTextoApuesta(slot.querySelector(".jugada-jug-input").value.trim(), ev);
        const optiOdds = parseFloat(slot.querySelector(".jugada-opti-odds-input").value.trim());
        const maxOdds = parseFloat(slot.querySelector(".jugada-max-odds-input").value.trim());

        const importeInput = slot.querySelector(".jugada-importe-input");
        const importeSlotVal = importeInput.value.trim();
        const hasCustom = (importeInput.dataset.touched === '1' && importeSlotVal && parseFloat(importeSlotVal) > 0);
        const importeSlot = hasCustom ? parseFloat(importeSlotVal) : importe;

        const jugada = {
          ev,
          c: optiOdds,
          optiOdds,
          maxOdds,
          resultadoTotal: null,
          estado: "pendiente",
          selections: [{ titulo: "", jugada: jug, estado: "pendiente" }]
        };
        let deporteSlot = inferirDeporteDesdeJugadas(deporte, [jugada], ev);
        if (!deporte && deporteSlot) deporte = deporteSlot;
        let jugadasSlot = enriquecerJugadasAuto([jugada], deporteSlot);

        let slotHora = hora;
        if (deporteSlot === "mlb") {
          let juegoElegido = null;
          if (slot.dataset.selectedGame) {
            try { juegoElegido = JSON.parse(slot.dataset.selectedGame); } catch (e) {}
          }
          if (!juegoElegido) {
            const infoDoble = await detectarDobleJornadaMlb(ev, fecha);
            if (infoDoble?.esDobleJornada) {
              juegoElegido = await solicitarSeleccionDobleJornada(infoDoble);
              if (!juegoElegido) return;
            }
          }
          if (juegoElegido) {
            if (juegoElegido.hora) slotHora = juegoElegido.hora;
            jugadasSlot = aplicarDobleJornadaAJugadas(jugadasSlot, juegoElegido);
          }
        }

        saves.push(addDoc(collection(db, "apuestas"), limpiarUndefinedFirestore({
          ...datosCasa,
          deporte: deporteSlot,
          fecha, dia, hora: slotHora,
          evento: ev,
          jugadas: jugadasSlot,
          tipoApuesta: "simple_option_bet",
          cuota: optiOdds,
          importe: importeSlot,
          resultado: "pendiente",
          autoSync: crearAutoSyncPayload({}, "pendiente"),
          creadoEn: ordenBase + idx,
          ordenTabla: ordenBase + idx,
          ordenFormulario: idx
        })));
      }
      await Promise.all(saves);
    } else if (tipoApuesta === "crear_apuesta_simple") {
      // ── Guardar cada partido de crear apuesta simple como apuesta independiente ──
      const slots = document.querySelectorAll("#eventosCrearSimpleContainer .crear-simple-slot");
      const saves = [];
      for (let idx = 0; idx < slots.length; idx++) {
        const slot = slots[idx];
        const ev = autocorregirTextoApuesta(slot.querySelector(".jugada-ev-input").value.trim());
        const c = parseFloat(slot.querySelector(".jugada-cuota-input").value.trim());

        const importeInput = slot.querySelector(".jugada-importe-input");
        const importeSlotVal = importeInput?.value.trim() || "";
        const hasCustom = (importeInput && importeInput.dataset.touched === '1' && importeSlotVal && parseFloat(importeSlotVal) > 0);
        const importeSlot = hasCustom ? parseFloat(importeSlotVal) : importe;

        const selections = [];
        slot.querySelectorAll(".selection-row .jugada-jug-input").forEach(inp => {
          const val = inp.value.trim();
          if (val) selections.push(crearSeleccionDetectada(val, "pendiente", "", ev));
        });
        const jugadasBase = [{ ev, c, estado: resultado, selections: selections.map(sel => ({ ...sel, estado: resultado })) }];
        let deporteSlot = inferirDeporteDesdeJugadas(deporte, jugadasBase, ev);
        if (!deporte && deporteSlot) deporte = deporteSlot;
        let jugadasSlot = enriquecerJugadasAuto(jugadasBase, deporteSlot);

        let slotHora = hora;
        if (deporteSlot === "mlb") {
          let juegoElegido = null;
          if (slot.dataset.selectedGame) {
            try { juegoElegido = JSON.parse(slot.dataset.selectedGame); } catch (e) {}
          }
          if (!juegoElegido) {
            const infoDoble = await detectarDobleJornadaMlb(ev, fecha);
            if (infoDoble?.esDobleJornada) {
              juegoElegido = await solicitarSeleccionDobleJornada(infoDoble);
              if (!juegoElegido) return;
            }
          }
          if (juegoElegido) {
            if (juegoElegido.hora) slotHora = juegoElegido.hora;
            jugadasSlot = aplicarDobleJornadaAJugadas(jugadasSlot, juegoElegido);
          }
        }

        saves.push(addDoc(collection(db, "apuestas"), limpiarUndefinedFirestore({
          ...datosCasa,
          deporte: deporteSlot,
          fecha, dia, hora: slotHora,
          evento: ev,
          jugadas: jugadasSlot,
          tipoApuesta: "crear_apuesta_simple",
          cuota: c,
          importe: importeSlot,
          resultado,
          autoSync: crearAutoSyncPayload({}, resultado),
          creadoEn: ordenBase + idx,
          ordenTabla: ordenBase + idx,
          ordenFormulario: idx
        })));
      }
      await Promise.all(saves);
    } else {
      let apuestaHora = hora;
      if (deporte === "mlb" || jugadas.some(j => detectarEquiposMlb(j.ev || j.evento || "").length >= 2)) {
        const slotsForm = document.querySelectorAll("#eventosContainer .jugada-slot, #eventosPatenteContainer .patente-slot, #eventosCrearContainer .crear-slot");
        for (let i = 0; i < jugadas.length; i++) {
          const ev = jugadas[i].ev || jugadas[i].evento || evento;
          const slotItem = slotsForm[i] || document.getElementById("tarjetaApuesta");
          let juegoElegido = null;
          if (slotItem?.dataset?.selectedGame) {
            try { juegoElegido = JSON.parse(slotItem.dataset.selectedGame); } catch (e) {}
          }
          if (!juegoElegido) {
            const infoDoble = await detectarDobleJornadaMlb(ev, fecha);
            if (infoDoble?.esDobleJornada) {
              juegoElegido = await solicitarSeleccionDobleJornada(infoDoble);
              if (!juegoElegido) return;
            }
          }
          if (juegoElegido) {
            if (!apuestaHora && juegoElegido.hora) apuestaHora = juegoElegido.hora;
            const res = aplicarDobleJornadaAJugadas([jugadas[i]], juegoElegido);
            jugadas[i] = res[0];
          }
        }
      }

      await addDoc(collection(db, "apuestas"), limpiarUndefinedFirestore({
        ...datosCasa,
        deporte,
        fecha, evento, jugadas, tipoApuesta, cuota, importe,
        resultado,
        autoSync: crearAutoSyncPayload({}, resultado),
        dia, hora: apuestaHora,
        creadoEn: ordenBase,
        ordenTabla: ordenBase,
        ordenFormulario: 0
      }));
    }
  } catch (e) {
    console.error("Error al agregar la apuesta:", e);
    mostrarModalValidacion(["Error al guardar la apuesta en la base de datos: " + e.message]);
    return;
  }

  // Siempre apunta el filtro a la casa de la apuesta recién guardada
  // para que el usuario vea la nueva apuesta de inmediato en el historial.
  const filtroAnterior = filtroCasaId;
  filtroCasaId = casaFormularioId;
  // Calcular la página después de actualizar filtroCasaId para usar el filtro correcto
  const diasUnicosPost = [...new Set([...getApuestasFiltradas().map(a => a.dia), dia])].sort((a, b) => new Date(a) - new Date(b));
  paginaActual = Math.ceil((diasUnicosPost.indexOf(dia) + 1) / porPagina) || 1;
  renderCasasControls();
  if (filtroAnterior !== filtroCasaId) {
    cargarApuestasIniciales();
  } else {
    renderSnapshotProgramado();
  }

  // ── Reset form ──
  document.getElementById("importe").value = "";
  document.getElementById("fecha").value = obtenerFechaActualLocal();
  document.getElementById("resultado").value = "pendiente";

  // Reset to SIMPLE
  document.getElementById("tipoApuesta").value = "simple";
  document.getElementById("tipoApuesta").className = "tipo-select-badge simple";
  document.getElementById("tarjetaApuesta").className = "tarjeta-apuesta simple";
  document.getElementById("tarjetaApuesta").style.borderColor = "";
  document.getElementById("tarjetaApuesta").style.boxShadow = "";
  document.getElementById("camposSimple").style.display = "flex";
  document.getElementById("camposCombinada").style.display = "none";
  document.getElementById("camposPatente").style.display = "none";
  document.getElementById("camposCrearApuesta").style.display = "none";
  document.getElementById("camposCrearApuestaSimple").style.display = "none";
  document.getElementById("camposSimpleOptionBet").style.display = "none";

  // Clear simple fields (dynamic container)
  const simpleCont = document.getElementById("eventosSimpleContainer");
  if (simpleCont) {
    simpleCont.innerHTML = "";
    simpleCont.appendChild(crearSlotSimple(1));
  }

  // Clear crear apuesta combinada fields
  const crearCont = document.getElementById("eventosCrearContainer");
  if (crearCont) {
    crearCont.innerHTML = "";
    crearCont.appendChild(crearSlotCrearApuesta(1));
  }

  // Clear crear apuesta simple fields
  const crearSimpleCont = document.getElementById("eventosCrearSimpleContainer");
  if (crearSimpleCont) {
    crearSimpleCont.innerHTML = "";
    crearSimpleCont.appendChild(crearSlotCrearApuestaSimple(1));
  }

  const simpleOptionCont = document.getElementById("eventosSimpleOptionContainer");
  if (simpleOptionCont) {
    simpleOptionCont.innerHTML = "";
    simpleOptionCont.appendChild(crearSlotSimpleOption(1));
  }

  // Clear patente fields
  const patenteEvento = document.getElementById("eventoPatente");
  if (patenteEvento) patenteEvento.value = "";
  const patenteCont = document.getElementById("eventosPatenteContainer");
  if (patenteCont) {
    patenteCont.innerHTML = "";
    inicializarPatenteSlots();
  }

  // Clear combinada fields
  document.getElementById("evento").value = "";
  document.getElementById("eventosContainer").querySelectorAll(".jugada-slot").forEach(s => s.remove());

  // Sincronizar hora automáticamente desde la API solo si la apuesta es de hoy
  if (dia === obtenerFechaActualLocal()) {
    if (deporte === "mlb" && _syncMlbActivado) {
      programarSyncSilenciosa("mlb", 1200, true);
    } else if (deporte === "futbol" && _syncFutbolActivado) {
      programarSyncSilenciosa("futbol", 1200, true);
    }
  }
}

/* =========================
   CAMBIAR ESTADO
 ========================= */
async function cambiarEstado(id, nuevoEstado) {
  const scrollPosition = window.scrollY;

  const index = apuestas.findIndex(a => a.id === id);
  let updatedJugadas = null;
  let updatedCuota = null;
  let updatedAutoSync = null;
  if (index > -1) {
    const a = apuestas[index];
    a.resultado = nuevoEstado;
    if (a.jugadas && a.jugadas.length > 0) {
      a.jugadas = a.jugadas.map((j, idx) => {
        // Normalize legacy string jugadas
        if (typeof j !== 'object') {
          return {
            ev: a.evento || "",
            jug: j,
            c: 0,
            estado: nuevoEstado,
            selections: [{ titulo: "", jugada: j, estado: nuevoEstado }]
          };
        }

        // Normalize jugadas without selections
        let selections = j.selections;
        if (!selections || selections.length === 0) {
          selections = [{ titulo: "", jugada: j.jug || j.jugada || "", estado: nuevoEstado }];
        } else {
          // Update all existing selections
          selections = selections.map(sel => ({ ...sel, estado: nuevoEstado }));
        }

        return { ...j, ev: j.ev || j.evento || a.evento || "", estado: nuevoEstado, selections };
      });
      a.jugadas = normalizarJugadasConEstado(a.jugadas).map(j => ({
        ...j,
        ev: j.ev || j.evento || a.evento || "",
        estado: nuevoEstado,
        selections: j.selections.map(sel => ({ ...sel, estado: nuevoEstado }))
      }));
      updatedJugadas = a.jugadas;
      if (a.tipoApuesta === "patente") {
        a.cuota = calcularCuotaMaximaPatente(a.jugadas);
        updatedCuota = a.cuota;
      } else if (debeRecalcularCuotaCombinada(a.tipoApuesta)) {
        const cuotaRecalculada = recalcularCuotaCombinada(a.jugadas);
        if (cuotaRecalculada > 0) {
          a.cuota = cuotaRecalculada;
          updatedCuota = a.cuota;
        }
      }
    }
    updatedAutoSync = crearAutoSyncPayload(a, nuevoEstado);
    a.autoSync = updatedAutoSync;
  }

  const apuestaActualizada = index > -1 ? apuestas[index] : null;
  const renderFluido = actualizarApuestaParcialDom(apuestaActualizada, { actualizarSelecciones: true });
  if (renderFluido) {
    renderSilenciosoApuestas.add(id);
    setTimeout(() => renderSilenciosoApuestas.delete(id), 2000);
  } else {
    render();
    window.scrollTo(0, scrollPosition);
  }

  try {
    const updateData = { resultado: nuevoEstado };
    if (updatedJugadas) {
      updateData.jugadas = updatedJugadas;
    }
    if (updatedCuota !== null) {
      updateData.cuota = updatedCuota;
    }
    if (updatedAutoSync) {
      updateData.autoSync = updatedAutoSync;
    }
    await updateDoc(doc(db, "apuestas", id), updateData);
  } catch (e) {
    console.error("Error cambiando estado:", e);
    renderSilenciosoApuestas.delete(id);
    render();
    window.scrollTo(0, scrollPosition);
  }
}

async function actualizarResultadoTotalSimpleOption(id, valor) {
  const scrollPosition = window.scrollY;
  const apuesta = apuestas.find(a => a.id === id);
  if (!apuesta || apuesta.tipoApuesta !== "simple_option_bet") return;

  const raw = String(valor ?? "").trim();
  const jugadas = normalizarJugadasConEstado(apuesta.jugadas || []);
  if (!jugadas[0]) return;
  jugadas[0].ev = jugadas[0].ev || jugadas[0].evento || apuesta.evento || "";

  const optiOdds = parseFloat(jugadas[0].optiOdds ?? apuesta.optiOdds ?? apuesta.cuota) || 0;
  let nuevoResultado = "pendiente";
  let nuevaCuota = optiOdds;

  if (!raw) {
    jugadas[0].resultadoTotal = null;
  } else {
    const resultadoTotal = parseFloat(raw);
    if (isNaN(resultadoTotal) || resultadoTotal < 0) {
      mostrarModalValidacion(["Ingresa un resultado total valido."]);
      return;
    }

    jugadas[0].resultadoTotal = resultadoTotal;
    const apuestaTemp = {
      ...apuesta,
      jugadas,
      cuota: optiOdds,
      resultado: apuesta.resultado || "pendiente"
    };
    nuevoResultado = determinarResultadoSimpleOptionBet(apuestaTemp);
    const cuotaCalculada = calcularCuotaSimpleOptionBet(apuestaTemp);
    nuevaCuota = nuevoResultado === "ganada" && cuotaCalculada > 0 ? cuotaCalculada : optiOdds;
  }

  jugadas[0].c = nuevaCuota;
  jugadas[0].estado = nuevoResultado;
  jugadas[0].selections = (jugadas[0].selections || []).map(sel => ({ ...sel, estado: nuevoResultado }));

  apuesta.jugadas = jugadas;
  apuesta.resultado = nuevoResultado;
  apuesta.cuota = nuevaCuota;
  apuesta.autoSync = crearAutoSyncPayload(apuesta, nuevoResultado);

  render();
  window.scrollTo(0, scrollPosition);

  try {
    await updateDoc(doc(db, "apuestas", id), {
      jugadas,
      resultado: nuevoResultado,
      cuota: nuevaCuota,
      autoSync: apuesta.autoSync
    });
  } catch (e) {
    console.error("Error actualizando resultado total:", e);
    mostrarModalValidacion(["Error al guardar el resultado total: " + e.message]);
  }
}

function setMlbSyncStatus(message = "", type = "") {
  const el = document.getElementById("mlbSyncStatus");
  if (!el) return;
  el.textContent = message;
  el.className = `mlb-sync-status${type ? ` ${type}` : ""}`;
}

function apuestaTieneAutoMlb(apuesta) {
  if (apuesta?.deporte === "mlb") return true;
  return (apuesta?.jugadas || []).some(j =>
    j?.autoMlb?.deporte === "mlb" ||
    (j?.selections || []).some(sel => sel?.autoMlb?.deporte === "mlb")
  );
}

function apuestaPareceMlb(apuesta) {
  if (apuestaTieneAutoMlb(apuesta)) return true;
  return (apuesta?.jugadas || []).some(j => {
    const ev = typeof j === "object" && j ? (j.ev || j.evento || apuesta.evento || "") : apuesta.evento || "";
    return detectarEquiposMlb(ev).length >= 2;
  });
}

function apuestaTieneMarcadorMlb(apuesta) {
  return (apuesta?.jugadas || []).some(j =>
    (j?.selections || []).some(sel => Boolean(sel?.autoMlb?.marcador))
  );
}

function normalizarEstadoExternoTexto(...partes) {
  return partes
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectarEstadoEspecialTexto({ estado = "", motivo = "", clima = "", proveedor = "" } = {}) {
  // Convertir a strings para evitar problemas con números u otros tipos
  motivo = String(motivo || "").trim();
  clima = String(clima || "").trim();
  estado = String(estado || "").trim();
  
  const texto = normalizarEstadoExternoTexto(estado, motivo, clima);
  if (!texto) return null;

  const esCancelado = /\b(cancelled|canceled|cancelado|cancelada|abandoned|abandonado|abandonada|abd)\b/.test(texto);
  const esPospuesto = /\b(postponed|pospuesto|pospuesta|aplazado|aplazada|pst)\b/.test(texto);
  const esRetrasado = /\b(delayed|delay|retrasado|retrasada|demorado|demorada|weather delay|rain delay)\b/.test(texto);
  const esSuspendido = /\b(suspended|suspendido|suspendida|interrupted|interrumpido|interrumpida|susp|int)\b/.test(texto);
  if (!esCancelado && !esPospuesto && !esRetrasado && !esSuspendido) return null;

  const motivoOriginal = motivo || clima || "";
  const motivoNormalizado = normalizarEstadoExternoTexto(motivoOriginal, clima);
  // Si el motivo es un número o está vacío pero se detectó estado especial por clima, usar "Por Condiciones Climáticas"
  const motivoLimpio = /\b(rain|weather|clima|climatic|inclement|wet grounds|thunder|lightning|storm|delay)\b/.test(motivoNormalizado) || (!motivoOriginal && esRetrasado)
    ? "Por Condiciones Climaticas"
    : motivoOriginal;
  const tipo = esCancelado ? "cancelado" : esPospuesto ? "pospuesto" : esSuspendido ? "suspendido" : "retrasado";
  const labelBase = tipo.charAt(0).toUpperCase() + tipo.slice(1);

  return {
    tipo,
    proveedor,
    accion: (esCancelado || esPospuesto) ? "nula" : "pendiente",
    motivo: motivoLimpio,
    estado: labelBase,
    reembolso: esCancelado || esPospuesto,
    label: motivoLimpio ? `${labelBase}: ${motivoLimpio}` : labelBase
  };
}

function getEstadoJuegoTraducido(estadoJuego = "") {
  const normalizado = normalizarEstadoExternoTexto(estadoJuego);
  if (/\b(postponed|pospuesto|pospuesta|aplazado|aplazada)\b/.test(normalizado)) return "Aplazado";
  if (/\b(cancelled|canceled|cancelado|cancelada)\b/.test(normalizado)) return "Cancelado";
  if (/\b(abandoned|abandonado|abandonada)\b/.test(normalizado)) return "Abandonado";
  if (/\b(suspended|suspendido|suspendida)\b/.test(normalizado)) return "Suspendido";
  if (/\b(delayed|delay|retrasado|retrasada|demorado|demorada)\b/.test(normalizado)) return "Retrasado";
  return estadoJuego;
}

function esEstadoJuegoFinalizado(estadoJuego = "") {
  const normalizado = normalizarEstadoExternoTexto(estadoJuego);
  return /\b(final|finalizado|partido terminado|tiempo completo|game over|match finished|full time|finished|ended|ft|aet|pen)\b/.test(normalizado);
}

function esEstadoFutbolMedioTiempo(estadoJuego = "") {
  const normalizado = normalizarEstadoExternoTexto(estadoJuego);
  return /\b(ht|halftime|half time|descanso|medio tiempo|entretiempo)\b/.test(normalizado);
}

function getPausaMedioTiempoHastaFutbol(estadoJuego = "", pausaActual = null) {
  if (FOOTBALL_HALFTIME_PAUSE_MS <= 0) return null;
  if (!esEstadoFutbolMedioTiempo(estadoJuego)) return null;
  const pausaActualMs = Number(pausaActual) || 0;
  return pausaActualMs > Date.now() ? pausaActualMs : Date.now() + FOOTBALL_HALFTIME_PAUSE_MS;
}

function getEstadoFinalizadoHtml(auto = {}) {
  return esEstadoJuegoFinalizado(auto?.estadoJuego)
    ? `<div class="auto-mlb-score auto-mlb-score--final">Finalizado</div>`
    : "";
}

function tieneEstadoJuegoEspecial(auto = {}) {
  return Boolean(auto?.estadoEspecial) ||
    /postpon|pospuest|aplaz|cancel|abandon|retras|delay|suspend/i.test(auto?.estadoJuego || "");
}

function esEstadoJuegoReembolso(estadoJuego = "") {
  const normalizado = normalizarEstadoExternoTexto(estadoJuego);
  return /\b(postponed|pospuesto|pospuesta|aplazado|aplazada|cancelled|canceled|cancelado|cancelada|abandoned|abandonado|abandonada)\b/.test(normalizado);
}

function getRazonReembolsoLegacy(estadoJuego = "") {
  const normalizado = normalizarEstadoExternoTexto(estadoJuego);
  if (/\b(postponed|pospuesto|pospuesta|aplazado|aplazada|rain|weather|clima|inclement|wet grounds|thunder|lightning|storm)\b/.test(normalizado)) {
    return "Por Condiciones Climaticas";
  }
  return "Partido cancelado";
}

function getEstadoEspecialMlb(game) {
  const status = game?.status || {};
  return detectarEstadoEspecialTexto({
    proveedor: "mlb_stats_api",
    estado: [
      status.abstractGameState,
      status.detailedState,
      status.statusCode,
      status.codedGameState
    ].filter(Boolean).join(" "),
    motivo: status.reason || "",
    clima: status.reason || ""
  });
}

function getEstadoEspecialEspn(event, proveedor = "espn") {
  const status = event?.status?.type || event?.competitions?.[0]?.status?.type || {};
  const notesArray = event?.competitions?.[0]?.notes;
  const notes = (Array.isArray(notesArray) && notesArray[0]?.headline) 
    ? String(notesArray[0].headline).trim()
    : (notesArray?.headline || event?.notes?.headline || "");
  const weather = String(event?.weather?.displayValue || "").trim();
  return detectarEstadoEspecialTexto({
    proveedor,
    estado: [
      status.name,
      status.description,
      status.detail,
      status.shortDetail,
      event?.status?.displayClock
    ].filter(Boolean).join(" "),
    motivo: notes,
    clima: weather
  });
}

function getEstadoEspecialApiSportsFutbol(game) {
  const status = game?.fixture?.status || {};
  return detectarEstadoEspecialTexto({
    proveedor: "api_sports_football",
    estado: [
      status.long,
      status.short,
      status.elapsed ? `${status.elapsed}'` : ""
    ].filter(Boolean).join(" "),
    motivo: ""
  });
}

function combinarEstadoEspecial(estadoPrincipal, estadoRespaldo) {
  if (!estadoPrincipal) return estadoRespaldo || null;
  if (!estadoRespaldo?.motivo || estadoPrincipal.motivo) return estadoPrincipal;

  const motivo = estadoRespaldo.motivo;
  return {
    ...estadoPrincipal,
    motivo,
    label: motivo ? `${estadoPrincipal.estado || estadoPrincipal.tipo}: ${motivo}` : estadoPrincipal.label,
    proveedor: `${estadoPrincipal.proveedor}+${estadoRespaldo.proveedor}`
  };
}

function obtenerFechaLocalJuego(game) {
  if (game?.officialDate) return game.officialDate;
  const dateStr = game?.gameDate || game?.date;
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch (e) {
    return "";
  }
}

function obtenerFechaLocalEvent(event) {
  const dateStr = event?.fixture?.date || event?.date || event?.competitions?.[0]?.date;
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch (e) {
    return "";
  }
}

function formatFechaJuego(fechaJuegoStr) {
  if (!fechaJuegoStr) return "";
  try {
    const d = new Date(fechaJuegoStr);
    if (Number.isNaN(d.getTime())) return "";
    const hoy = new Date();
    const esHoy = d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
    
    const hora = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (esHoy) {
      return `Hoy a las ${hora}`;
    }
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    return `${dia}/${mes} a las ${hora}`;
  } catch (e) {
    return "";
  }
}

function esEstadoJuegoPrevio(estadoJuego = "") {
  const normalizado = normalizarEstadoExternoTexto(estadoJuego);
  if (!normalizado) return true;
  return /\b(preview|scheduled|pre|pre game|programado|previo|not started|no iniciado|por comenzar|warmup|ns|tbd)\b/.test(normalizado);
}

function fechaJuegoYaPaso(fechaJuegoStr = "") {
  if (!fechaJuegoStr) return false;
  const fechaJuego = new Date(fechaJuegoStr);
  if (Number.isNaN(fechaJuego.getTime())) return false;
  return Date.now() >= fechaJuego.getTime();
}

function debeMostrarHorarioJuego(fechaJuego = "", estadoJuego = "") {
  if (!fechaJuego) return false;
  if (esEstadoJuegoPrevio(estadoJuego)) return true;
  return !fechaJuegoYaPaso(fechaJuego);
}

function getAutoMlbFechasJuego(apuesta = {}) {
  return (apuesta.jugadas || []).flatMap(jugada => {
    const fechas = [];
    if (jugada?.autoMlb?.fechaJuego) fechas.push(jugada.autoMlb.fechaJuego);
    (jugada?.selections || []).forEach(sel => {
      if (sel?.autoMlb?.fechaJuego) fechas.push(sel.autoMlb.fechaJuego);
    });
    return fechas;
  }).map(fecha => new Date(fecha)).filter(date => !Number.isNaN(date.getTime()));
}

function getInicioMlbApuesta(apuesta = {}) {
  const fechasAuto = getAutoMlbFechasJuego(apuesta);
  if (fechasAuto.length > 0) {
    return new Date(Math.min(...fechasAuto.map(date => date.getTime())));
  }
  return parseFechaHoraLocal(apuesta.fecha || apuesta.dia, apuesta.hora || "");
}

function apuestaMlbYaDebeSincronizar(apuesta = {}) {
  const inicio = getInicioMlbApuesta(apuesta);
  if (inicio) return Date.now() >= inicio.getTime();

  const fecha = apuesta.fecha || apuesta.dia;
  if (!fecha) return false;
  return fecha < obtenerFechaActualLocal();
}

function apuestaTieneAutoFinalizado(apuesta = {}, key = "") {
  return (apuesta.jugadas || []).some(jugada =>
    esEstadoJuegoFinalizado(jugada?.[key]?.estadoJuego) ||
    (jugada?.selections || []).some(sel => esEstadoJuegoFinalizado(sel?.[key]?.estadoJuego))
  );
}

function apuestaYaFinalizadaYResuelta(apuesta = {}, key = "") {
  return (apuesta.resultado || "pendiente") !== "pendiente" && apuestaTieneAutoFinalizado(apuesta, key);
}

function apuestaFutbolPausadaPorMedioTiempo(apuesta = {}) {
  if (FOOTBALL_HALFTIME_PAUSE_MS <= 0) return false;
  return (apuesta.jugadas || []).some(jugada =>
    Number(jugada?.autoFutbol?.pausaMedioTiempoHasta) > Date.now() ||
    (jugada?.selections || []).some(sel => Number(sel?.autoFutbol?.pausaMedioTiempoHasta) > Date.now())
  );
}

function apuestaFutbolPausadaPorEstadoEspecial(apuesta = {}) {
  if (FOOTBALL_SPECIAL_STATUS_RETRY_MS <= 0) return false;
  return (apuesta.jugadas || []).some(jugada =>
    Number(jugada?.autoFutbol?.pausaEstadoEspecialHasta) > Date.now() ||
    (jugada?.selections || []).some(sel => Number(sel?.autoFutbol?.pausaEstadoEspecialHasta) > Date.now())
  );
}

// Compara dos fechas (YYYY-MM-DD) y devuelve true si están dentro de 36 horas
// de diferencia, tolerando el desfase UTC vs hora local.
function sonFechasCercanas(fechaA, fechaB) {
  if (!fechaA || !fechaB) return false;
  if (fechaA === fechaB) return true;
  try {
    const a = new Date(`${fechaA}T12:00:00`);
    const b = new Date(`${fechaB}T12:00:00`);
    return Math.abs(a - b) <= 36 * 60 * 60 * 1000;
  } catch (e) {
    return false;
  }
}

// Convierte un ISO string UTC de la API a { fecha, hora } en hora local del usuario.
function obtenerFechaHoraLocalDesdeIso(dateStr) {
  if (!dateStr) return { fecha: "", hora: "" };
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return { fecha: "", hora: "" };
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return { fecha: `${yyyy}-${mm}-${dd}`, hora: `${hh}:${min}` };
  } catch (e) {
    return { fecha: "", hora: "" };
  }
}

async function cargarJuegosMlbPorFecha(fecha) {
  const timezone = getSportsTimezone();
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${encodeURIComponent(fecha)}&hydrate=linescore&timeZone=${encodeURIComponent(timezone)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MLB API respondio ${response.status}`);
  }

  const data = await response.json();
  return (data.dates || []).flatMap(d => d.games || []);
}

async function cargarJuegosEspnMlbPorFecha(fecha) {
  const date = String(fecha).replace(/-/g, "");
  const timezone = getSportsTimezone();
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${encodeURIComponent(date)}&limit=300&lang=es&region=mx&tz=${encodeURIComponent(timezone)}`;
  const response = await fetch(url);
  if (!response.ok) return [];

  const data = await response.json();
  return data.events || [];
}

async function detectarDobleJornadaMlb(eventoTexto = "", fecha = "") {
  if (!eventoTexto || !fecha) return null;
  const equipos = detectarEquiposMlb(eventoTexto);
  if (!Array.isArray(equipos) || equipos.length < 2) return null;

  try {
    const juegosFecha = await cargarJuegosMlbPorFecha(fecha);
    const buscados = equipos.map(normalizarClaveMlb);

    const juegosCoincidentes = (juegosFecha || []).filter(game => {
      const fechaJuego = obtenerFechaLocalJuego(game);
      if (fechaJuego && fechaJuego !== fecha) return false;
      const nombres = [
        game?.teams?.home?.team?.name,
        game?.teams?.away?.team?.name
      ];
      return buscados.every(equipo => nombres.some(nombre => equiposMlbCoinciden(equipo, nombre)));
    });

    const esDobleHeaderByFlag = juegosCoincidentes.some(g => 
      g.doubleHeader === "Y" || g.doubleHeader === "FE" || g.doubleHeader === "SE" || g.doubleHeader === "D" || (g.gameNumber && g.gameNumber > 1)
    );

    if (juegosCoincidentes.length > 1 || esDobleHeaderByFlag) {
      juegosCoincidentes.sort((a, b) => new Date(a.gameDate || 0) - new Date(b.gameDate || 0));

      const listaOpciones = juegosCoincidentes.map((game, idx) => {
        const iso = game.gameDate || game.date || "";
        const { hora } = obtenerFechaHoraLocalDesdeIso(iso);
        const homeTeam = game?.teams?.home?.team?.name || "Home";
        const awayTeam = game?.teams?.away?.team?.name || "Away";
        const estado = game?.status?.detailedState || game?.status?.abstractGameState || "Programado";
        const gameNumber = game?.gameNumber || (idx + 1);

        return {
          gamePk: game.gamePk,
          gameNumber,
          hora,
          fechaJuego: iso,
          homeTeam,
          awayTeam,
          estado,
          label: `Juego ${gameNumber}: ${awayTeam} vs ${homeTeam} — ${hora ? `${hora} hs` : "Horario a confirmar"} (${estado})`
        };
      });

      return {
        esDobleJornada: true,
        equipos,
        fecha,
        eventoTexto,
        juegos: listaOpciones
      };
    }
  } catch (e) {
    console.warn("No se pudo consultar MLB API para doble jornada:", e);
  }

  try {
    const juegosEspn = await cargarJuegosEspnMlbPorFecha(fecha);
    const buscados = equipos.map(normalizarClaveMlb);

    const juegosEspnCoincidentes = (juegosEspn || []).filter(event => {
      const fechaJuego = obtenerFechaLocalEvent(event);
      if (fechaJuego && fechaJuego !== fecha) return false;
      const nombres = (event?.competitions?.[0]?.competitors || [])
        .map(item => item?.team?.displayName || item?.team?.name || item?.team?.shortDisplayName || item?.team?.abbreviation || "")
        .map(normalizarClaveMlb);
      return buscados.every(equipo => nombres.some(nombre => nombre === equipo || nombre.includes(equipo) || equipo.includes(nombre)));
    });

    if (juegosEspnCoincidentes.length > 1) {
      juegosEspnCoincidentes.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

      const listaOpciones = juegosEspnCoincidentes.map((event, idx) => {
        const iso = event.date || event.competitions?.[0]?.date || "";
        const { hora } = obtenerFechaHoraLocalDesdeIso(iso);
        const comps = event?.competitions?.[0]?.competitors || [];
        const homeComp = comps.find(c => c.homeAway === "home")?.team?.displayName || "Home";
        const awayComp = comps.find(c => c.homeAway === "away")?.team?.displayName || "Away";
        const estado = event?.status?.type?.detail || event?.status?.type?.description || "Programado";
        const gameNumber = idx + 1;

        return {
          espnId: event.id,
          gameNumber,
          hora,
          fechaJuego: iso,
          homeTeam: homeComp,
          awayTeam: awayComp,
          estado,
          label: `Juego ${gameNumber}: ${awayComp} vs ${homeComp} — ${hora ? `${hora} hs` : "Horario a confirmar"} (${estado})`
        };
      });

      return {
        esDobleJornada: true,
        equipos,
        fecha,
        eventoTexto,
        juegos: listaOpciones
      };
    }
  } catch (e) {
    console.warn("No se pudo consultar ESPN API para doble jornada:", e);
  }

  return null;
}

function solicitarSeleccionDobleJornada(infoDobleJornada) {
  return new Promise((resolve) => {
    const modal = document.getElementById("doubleheader-modal");
    const desc = document.getElementById("dh-modal-desc");
    const list = document.getElementById("dh-modal-options");
    const btnCancel = document.getElementById("dh-modal-cancel");
    const btnConfirm = document.getElementById("dh-modal-confirm");

    if (!modal || !desc || !list || !btnCancel || !btnConfirm) {
      resolve(infoDobleJornada?.juegos?.[0] || null);
      return;
    }

    desc.innerHTML = `Se detectó que el encuentro <strong>${escapeHtml(infoDobleJornada.eventoTexto)}</strong> del día <strong>${escapeHtml(infoDobleJornada.fecha)}</strong> es un <strong>partido de doble jornada (2 juegos)</strong>. Selecciona el horario del partido que deseas registrar:`;

    list.innerHTML = infoDobleJornada.juegos.map((juego, idx) => `
      <label class="doubleheader-option-card ${idx === 0 ? 'selected' : ''}">
        <input type="radio" name="dh_game_choice" value="${idx}" ${idx === 0 ? 'checked' : ''}>
        <div class="doubleheader-option-info">
          <span class="doubleheader-option-title">Juego ${juego.gameNumber}: ${escapeHtml(juego.awayTeam)} vs ${escapeHtml(juego.homeTeam)}</span>
          <span class="doubleheader-option-time">🕒 Hora local: ${juego.hora ? `${juego.hora} hs` : "Por confirmar"}</span>
          <span class="doubleheader-option-status">Estado: ${escapeHtml(juego.estado)}</span>
        </div>
      </label>
    `).join("");

    list.querySelectorAll(".doubleheader-option-card").forEach(card => {
      card.addEventListener("click", () => {
        list.querySelectorAll(".doubleheader-option-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        const radio = card.querySelector("input[type='radio']");
        if (radio) radio.checked = true;
      });
    });

    const cleanup = () => {
      modal.classList.remove("show");
      setTimeout(() => { modal.style.display = "none"; }, 300);
      btnCancel.onclick = null;
      btnConfirm.onclick = null;
    };

    btnCancel.onclick = () => {
      cleanup();
      resolve(null);
    };

    btnConfirm.onclick = () => {
      const selectedRadio = list.querySelector("input[name='dh_game_choice']:checked");
      const idx = selectedRadio ? parseInt(selectedRadio.value, 10) : 0;
      const juegoElegido = infoDobleJornada.juegos[idx] || infoDobleJornada.juegos[0];
      cleanup();
      resolve(juegoElegido);
    };

    modal.style.display = "flex";
    setTimeout(() => { modal.classList.add("show"); }, 10);
  });
}

function aplicarDobleJornadaAJugadas(jugadas = [], juegoElegido = null) {
  if (!juegoElegido || !Array.isArray(jugadas)) return jugadas;
  return jugadas.map(j => {
    const autoMlbOriginal = j.autoMlb || {};
    const autoMlbNext = {
      ...autoMlbOriginal,
      gamePk: juegoElegido.gamePk ?? autoMlbOriginal.gamePk,
      espnId: juegoElegido.espnId ?? autoMlbOriginal.espnId,
      fechaJuego: juegoElegido.fechaJuego || autoMlbOriginal.fechaJuego,
      gameNumber: juegoElegido.gameNumber,
      horaJuego: juegoElegido.hora
    };
    const selections = (j.selections || []).map(sel => {
      const selAutoOriginal = sel.autoMlb || {};
      return {
        ...sel,
        autoMlb: {
          ...selAutoOriginal,
          gamePk: juegoElegido.gamePk ?? selAutoOriginal.gamePk,
          espnId: juegoElegido.espnId ?? selAutoOriginal.espnId,
          fechaJuego: juegoElegido.fechaJuego || selAutoOriginal.fechaJuego,
          gameNumber: juegoElegido.gameNumber,
          horaJuego: juegoElegido.hora
        }
      };
    });
    return {
      ...j,
      autoMlb: autoMlbNext,
      selections
    };
  });
}

async function verificarDobleJornadaEnSlot(input) {
  if (!input) return;
  const slot = input.closest(".jugada-slot, .simple-slot, .simple-option-slot, .crear-slot, .crear-simple-slot, .patente-slot, .apuesta-edit-card, [class*='edit-jugada-slot-'], .tarjeta-apuesta") || input.parentElement;
  const ev = input.value.trim();
  const editCard = input.closest(".apuesta-edit-card");
  const betId = editCard ? editCard.id.replace("edit-tarjeta-", "") : null;
  const fecha = editCard 
    ? (document.getElementById(`edit-fecha-${betId}`)?.value || document.getElementById("fecha")?.value)
    : document.getElementById("fecha")?.value;

  if (!ev || !fecha) {
    if (slot) {
      const existingAlert = slot.querySelector(".doubleheader-inline-alert");
      if (existingAlert) existingAlert.remove();
      delete slot.dataset.selectedGame;
    }
    return;
  }

  const equipos = detectarEquiposMlb(ev);
  if (equipos.length < 2) {
    if (slot) {
      const existingAlert = slot.querySelector(".doubleheader-inline-alert");
      if (existingAlert) existingAlert.remove();
      delete slot.dataset.selectedGame;
    }
    return;
  }

  const infoDoble = await detectarDobleJornadaMlb(ev, fecha);
  if (!slot) return;

  let existingAlert = slot.querySelector(".doubleheader-inline-alert");

  if (!infoDoble?.esDobleJornada) {
    if (existingAlert) existingAlert.remove();
    delete slot.dataset.selectedGame;
    return;
  }

  if (!existingAlert) {
    existingAlert = document.createElement("div");
    existingAlert.className = "doubleheader-inline-alert";
    existingAlert.style.cssText = "margin-top:6px; margin-bottom:6px; padding:8px 10px; background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.4); border-radius:6px; display:flex; flex-direction:column; gap:4px;";
    
    if (input.nextSibling) {
      input.parentNode.insertBefore(existingAlert, input.nextSibling);
    } else {
      input.parentNode.appendChild(existingAlert);
    }
  }

  let currentGamePk = null;
  let currentHora = null;
  if (betId) {
    const bet = (typeof apuestas !== "undefined" ? apuestas : []).find(a => a.id === betId);
    currentHora = bet?.hora || document.getElementById(`edit-hora-${betId}`)?.value;
    currentGamePk = bet?.jugadas?.[0]?.autoMlb?.gamePk || bet?.jugadas?.[0]?.selections?.[0]?.autoMlb?.gamePk;
  }

  let initialIdx = -1;
  if (currentGamePk) {
    const foundIdx = infoDoble.juegos.findIndex(g => Number(g.gamePk) === Number(currentGamePk));
    if (foundIdx >= 0) initialIdx = foundIdx;
  } else if (currentHora) {
    const foundIdx = infoDoble.juegos.findIndex(g => g.hora === currentHora);
    if (foundIdx >= 0) initialIdx = foundIdx;
  }

  const defaultOptionHtml = `<option value="" ${initialIdx < 0 ? 'selected' : ''}>-- Elige un horario del partido --</option>`;

  existingAlert.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
      <span style="font-size:11px; font-weight:700; color:#38bdf8; display:inline-flex; align-items:center; gap:4px;">
        ⚾ Doble Jornada Detectada (2 juegos)
      </span>
      <span style="font-size:10px; font-weight:600; color:#94a3b8;">Elige la hora del partido:</span>
    </div>
    <select class="jugada-dh-select" style="width:100%; background:#0f172a; color:#f8fafc; border:1px solid #3b82f6; border-radius:4px; padding:5px 8px; font-size:12px; font-weight:600; cursor:pointer;">
      ${defaultOptionHtml}
      ${infoDoble.juegos.map((g, i) => `
        <option value="${i}" ${i === initialIdx ? 'selected' : ''}>Juego ${g.gameNumber}: ${escapeHtml(g.awayTeam)} vs ${escapeHtml(g.homeTeam)} — ${g.hora ? `${g.hora} hs` : "Horario a confirmar"} (${escapeHtml(g.estado)})</option>
      `).join("")}
    </select>
  `;

  const select = existingAlert.querySelector(".jugada-dh-select");
  if (select) {
    const guardarSeleccion = () => {
      const val = select.value;
      if (val === "" || val === undefined || val === null) {
        delete slot.dataset.selectedGame;
        if (editCard) delete editCard.dataset.selectedGame;
      } else {
        const idx = parseInt(val, 10);
        const juego = infoDoble.juegos[idx];
        if (juego) {
          slot.dataset.selectedGame = JSON.stringify(juego);
          if (editCard) editCard.dataset.selectedGame = JSON.stringify(juego);
          if (betId && juego.hora) {
            const horaInput = document.getElementById(`edit-hora-${betId}`);
            if (horaInput) horaInput.value = juego.hora;
          }
        }
      }
    };
    select.onchange = guardarSeleccion;
    if (betId && initialIdx >= 0) {
      guardarSeleccion();
    } else if (!slot.dataset.selectedGame) {
      delete slot.dataset.selectedGame;
    }
  }
}

function buscarJuegoMlb(juegos = [], equipos = [], fechaBet = "", targetGamePk = null, targetHora = "") {
  if (!Array.isArray(equipos) || equipos.length < 2) return null;
  const buscados = equipos.map(normalizarClaveMlb);

  const juegosEquipos = (juegos || []).filter(game => {
    const nombres = [
      game?.teams?.home?.team?.name,
      game?.teams?.away?.team?.name
    ];
    return buscados.every(equipo => nombres.some(nombre => equiposMlbCoinciden(equipo, nombre)));
  });

  if (juegosEquipos.length === 0) return null;

  const juegosFechaExacta = fechaBet
    ? juegosEquipos.filter(g => obtenerFechaLocalJuego(g) === fechaBet)
    : [];

  const candidatos = juegosFechaExacta.length > 0 ? juegosFechaExacta : juegosEquipos;

  if (targetGamePk) {
    const gameByPk = candidatos.find(g => Number(g.gamePk) === Number(targetGamePk));
    if (gameByPk) {
      const fechaGameByPk = obtenerFechaLocalJuego(gameByPk);
      const estadoDetallado = gameByPk?.status?.detailedState || gameByPk?.status?.abstractGameState || "";
      const esPospuestoOtraFecha = fechaBet && fechaGameByPk !== fechaBet && esEstadoJuegoReembolso(estadoDetallado);

      let horaCoincide = true;
      if (targetHora && candidatos.length > 1) {
        const iso = gameByPk.gameDate || gameByPk.date;
        const { hora } = obtenerFechaHoraLocalDesdeIso(iso);
        if (hora) {
          const [tH, tM] = targetHora.split(":").map(Number);
          const [gH, gM] = hora.split(":").map(Number);
          const diffMins = Math.abs((tH * 60 + tM) - (gH * 60 + gM));
          if (diffMins > 90) {
            horaCoincide = false;
          }
        }
      }

      if (!esPospuestoOtraFecha && horaCoincide) {
        return gameByPk;
      }
    }
  }

  if (juegosFechaExacta.length === 1) {
    return juegosFechaExacta[0];
  }

  if (juegosFechaExacta.length > 1) {
    const activos = juegosFechaExacta.filter(g => !esEstadoJuegoReembolso(g?.status?.detailedState || g?.status?.abstractGameState || ""));
    const pool = activos.length > 0 ? activos : juegosFechaExacta;

    if (targetHora) {
      let mejorJuego = pool[0];
      let minDiff = Infinity;
      const [tH, tM] = targetHora.split(":").map(Number);
      const targetMins = (tH || 0) * 60 + (tM || 0);

      for (const game of pool) {
        const iso = game.gameDate || game.date;
        const { hora } = obtenerFechaHoraLocalDesdeIso(iso);
        if (hora) {
          const [gH, gM] = hora.split(":").map(Number);
          const gameMins = gH * 60 + gM;
          const diff = Math.abs(gameMins - targetMins);
          if (diff < minDiff) {
            minDiff = diff;
            mejorJuego = game;
          }
        }
      }
      return mejorJuego;
    }
    return pool[0];
  }

  const juegosCercanos = juegosEquipos.filter(game => {
    if (fechaBet) {
      const fechaJuego = obtenerFechaLocalJuego(game);
      if (fechaJuego && !sonFechasCercanas(fechaJuego, fechaBet)) return false;
    }
    return true;
  });

  if (juegosCercanos.length === 0) return null;

  const cercanosActivos = juegosCercanos.filter(g => !esEstadoJuegoReembolso(g?.status?.detailedState || g?.status?.abstractGameState || ""));
  return cercanosActivos[0] || juegosCercanos[0];
}

function buscarJuegoEspnMlb(juegos = [], equipos = [], fechaBet = "", targetEspnId = null, targetHora = "") {
  if (!Array.isArray(equipos) || equipos.length < 2) return null;
  const buscados = equipos.map(normalizarClaveMlb);

  const juegosEquipos = (juegos || []).filter(event => {
    const nombres = (event?.competitions?.[0]?.competitors || [])
      .map(item => item?.team?.displayName || item?.team?.name || item?.team?.shortDisplayName || item?.team?.abbreviation || "")
      .map(normalizarClaveMlb);
    return buscados.every(equipo => nombres.some(nombre => nombre === equipo || nombre.includes(equipo) || equipo.includes(nombre)));
  });

  if (juegosEquipos.length === 0) return null;

  const juegosFechaExacta = fechaBet
    ? juegosEquipos.filter(event => obtenerFechaLocalEvent(event) === fechaBet)
    : [];

  const candidatos = juegosFechaExacta.length > 0 ? juegosFechaExacta : juegosEquipos;

  if (targetEspnId) {
    const gameById = candidatos.find(e => String(e.id) === String(targetEspnId));
    if (gameById) {
      const fechaGameById = obtenerFechaLocalEvent(gameById);
      const statusText = gameById?.status?.type?.name || gameById?.status?.type?.description || "";
      const esPospuestoOtraFecha = fechaBet && fechaGameById !== fechaBet && esEstadoJuegoReembolso(statusText);

      let horaCoincide = true;
      if (targetHora && candidatos.length > 1) {
        const iso = gameById.date || gameById.competitions?.[0]?.date;
        const { hora } = obtenerFechaHoraLocalDesdeIso(iso);
        if (hora) {
          const [tH, tM] = targetHora.split(":").map(Number);
          const [gH, gM] = hora.split(":").map(Number);
          const diffMins = Math.abs((tH * 60 + tM) - (gH * 60 + gM));
          if (diffMins > 90) {
            horaCoincide = false;
          }
        }
      }

      if (!esPospuestoOtraFecha && horaCoincide) {
        return gameById;
      }
    }
  }

  if (juegosFechaExacta.length === 1) {
    return juegosFechaExacta[0];
  }

  if (juegosFechaExacta.length > 1) {
    const activos = juegosFechaExacta.filter(event => {
      const statusText = event?.status?.type?.name || event?.status?.type?.description || "";
      return !esEstadoJuegoReembolso(statusText);
    });
    const pool = activos.length > 0 ? activos : juegosFechaExacta;

    if (targetHora) {
      let mejorJuego = pool[0];
      let minDiff = Infinity;
      const [tH, tM] = targetHora.split(":").map(Number);
      const targetMins = (tH || 0) * 60 + (tM || 0);

      for (const event of pool) {
        const iso = event.date || event.competitions?.[0]?.date;
        const { hora } = obtenerFechaHoraLocalDesdeIso(iso);
        if (hora) {
          const [gH, gM] = hora.split(":").map(Number);
          const gameMins = gH * 60 + gM;
          const diff = Math.abs(gameMins - targetMins);
          if (diff < minDiff) {
            minDiff = diff;
            mejorJuego = event;
          }
        }
      }
      return mejorJuego;
    }
    return pool[0];
  }

  const juegosCercanos = juegosEquipos.filter(event => {
    if (fechaBet) {
      const fechaJuego = obtenerFechaLocalEvent(event);
      if (fechaJuego && !sonFechasCercanas(fechaJuego, fechaBet)) return false;
    }
    return true;
  });

  if (juegosCercanos.length === 0) return null;

  const cercanosActivos = juegosCercanos.filter(event => {
    const statusText = event?.status?.type?.name || event?.status?.type?.description || "";
    return !esEstadoJuegoReembolso(statusText);
  });
  return cercanosActivos[0] || juegosCercanos[0];
}

function getOrdenMarcadorMlbSegunEvento(evento = "", marcador) {
  if (!marcador) return null;
  const equiposEvento = extraerEquiposEvento(evento);
  if (equiposEvento.length < 2) return null;

  const [equipo1Evento, equipo2Evento] = equiposEvento.slice(0, 2);
  const equipo1EsHome = equiposMlbCoinciden(equipo1Evento, marcador.homeTeam);
  const equipo1EsAway = equiposMlbCoinciden(equipo1Evento, marcador.awayTeam);
  const equipo2EsHome = equiposMlbCoinciden(equipo2Evento, marcador.homeTeam);
  const equipo2EsAway = equiposMlbCoinciden(equipo2Evento, marcador.awayTeam);

  if (equipo1EsHome && equipo2EsAway) {
    return {
      equipoA: marcador.homeTeam,
      equipoB: marcador.awayTeam,
      scoreA: marcador.home,
      scoreB: marcador.away,
      hitsA: marcador.homeHits,
      hitsB: marcador.awayHits
    };
  }

  if (equipo1EsAway && equipo2EsHome) {
    return {
      equipoA: marcador.awayTeam,
      equipoB: marcador.homeTeam,
      scoreA: marcador.away,
      scoreB: marcador.home,
      hitsA: marcador.awayHits,
      hitsB: marcador.homeHits
    };
  }

  return null;
}

function formatMarcadorSegunEvento(evento = "", marcador) {
  if (!marcador) return null;
  const ordenEvento = getOrdenMarcadorMlbSegunEvento(evento, marcador);
  if (ordenEvento) {
    return `${ordenEvento.equipoA} ${ordenEvento.scoreA} - ${ordenEvento.scoreB} ${ordenEvento.equipoB}`;
  }
  
  // Extraer equipos del evento en el orden que aparecen
  const equiposEvento = extraerEquiposEvento(evento);
  if (equiposEvento.length < 2) {
    // Si no podemos extraer, usar el formato por defecto
    return `${marcador.awayTeam} ${marcador.away} - ${marcador.home} ${marcador.homeTeam}`;
  }
  
  const [equipo1Evento, equipo2Evento] = equiposEvento.slice(0, 2);
  const equipo1Norm = normalizarClaveMlb(equipo1Evento);
  const equipo2Norm = normalizarClaveMlb(equipo2Evento);
  const homeNorm = normalizarClaveMlb(marcador.homeTeam);
  const awayNorm = normalizarClaveMlb(marcador.awayTeam);
  
  // Determinar qué equipo del evento corresponde a home/away en el marcador
  const equipo1EsHome = homeNorm === equipo1Norm || homeNorm.includes(equipo1Norm) || equipo1Norm.includes(homeNorm);
  const equipo1EsAway = awayNorm === equipo1Norm || awayNorm.includes(equipo1Norm) || equipo1Norm.includes(awayNorm);
  
  if (equipo1EsHome) {
    // equipo1 es home, equipo2 es away
    return `${marcador.homeTeam} ${marcador.home} - ${marcador.away} ${marcador.awayTeam}`;
  } else if (equipo1EsAway) {
    // equipo1 es away, equipo2 es home
    return `${marcador.awayTeam} ${marcador.away} - ${marcador.home} ${marcador.homeTeam}`;
  }
  
  // Fallback: formato por defecto
  return `${marcador.awayTeam} ${marcador.away} - ${marcador.home} ${marcador.homeTeam}`;
}

function formatHitsMlbSegunEvento(evento = "", marcador) {
  if (!marcador || marcador.homeHits === null || marcador.awayHits === null) return "";

  const equiposEvento = extraerEquiposEvento(evento);
  const totalHits = marcador.totalHits ?? (marcador.homeHits + marcador.awayHits);

  const crearTexto = (equipoA, hitsA, equipoB, hitsB) =>
    `${equipoA} Hits: ${hitsA} - ${equipoB} Hits: ${hitsB} \u00b7 Total hits: ${totalHits}`;
  const ordenEvento = getOrdenMarcadorMlbSegunEvento(evento, marcador);
  if (ordenEvento) return crearTexto(ordenEvento.equipoA, ordenEvento.hitsA, ordenEvento.equipoB, ordenEvento.hitsB);

  if (equiposEvento.length < 2) {
    return crearTexto(marcador.awayTeam, marcador.awayHits, marcador.homeTeam, marcador.homeHits);
  }

  const [equipo1Evento] = equiposEvento.slice(0, 2);
  const equipo1Norm = normalizarClaveMlb(equipo1Evento);
  const homeNorm = normalizarClaveMlb(marcador.homeTeam);
  const awayNorm = normalizarClaveMlb(marcador.awayTeam);
  const equipo1EsHome = homeNorm === equipo1Norm || homeNorm.includes(equipo1Norm) || equipo1Norm.includes(homeNorm);
  const equipo1EsAway = awayNorm === equipo1Norm || awayNorm.includes(equipo1Norm) || equipo1Norm.includes(awayNorm);

  if (equipo1EsHome) return crearTexto(marcador.homeTeam, marcador.homeHits, marcador.awayTeam, marcador.awayHits);
  if (equipo1EsAway) return crearTexto(marcador.awayTeam, marcador.awayHits, marcador.homeTeam, marcador.homeHits);

  return crearTexto(marcador.awayTeam, marcador.awayHits, marcador.homeTeam, marcador.homeHits);
}

function getMarcadorMlb(game) {
  const home = Number(game?.teams?.home?.score ?? game?.linescore?.teams?.home?.runs);
  const away = Number(game?.teams?.away?.score ?? game?.linescore?.teams?.away?.runs);
  if (Number.isNaN(home) || Number.isNaN(away)) return null;

  const homeHits = Number(game?.linescore?.teams?.home?.hits ?? game?.teams?.home?.hits);
  const awayHits = Number(game?.linescore?.teams?.away?.hits ?? game?.teams?.away?.hits);
  const tieneHits = !Number.isNaN(homeHits) && !Number.isNaN(awayHits);

  return {
    home,
    away,
    total: home + away,
    homeHits: tieneHits ? homeHits : null,
    awayHits: tieneHits ? awayHits : null,
    totalHits: tieneHits ? homeHits + awayHits : null,
    homeTeam: game?.teams?.home?.team?.name || "",
    awayTeam: game?.teams?.away?.team?.name || ""
  };
}

function getScoreEquipoMarcadorMlb(equipo = "", marcador) {
  if (!marcador) return null;
  const objetivo = normalizarClaveMlb(equipo);
  const home = normalizarClaveMlb(marcador.homeTeam);
  const away = normalizarClaveMlb(marcador.awayTeam);

  if (objetivo && (home === objetivo || home.includes(objetivo) || objetivo.includes(home))) {
    return { seleccionado: marcador.home, rival: marcador.away, nombre: marcador.homeTeam };
  }
  if (objetivo && (away === objetivo || away.includes(objetivo) || objetivo.includes(away))) {
    return { seleccionado: marcador.away, rival: marcador.home, nombre: marcador.awayTeam };
  }
  return null;
}

function getTotalCarrerasObjetivoMlb(autoMlb = {}, marcador) {
  if (!autoMlb?.seleccionEquipo) return marcador?.total ?? null;
  const equipo = getScoreEquipoMarcadorMlb(autoMlb.seleccionEquipo, marcador);
  return equipo ? equipo.seleccionado : null;
}

function getHitsEquipoMarcadorMlb(equipo = "", marcador) {
  if (!marcador) return null;
  const objetivo = normalizarClaveMlb(equipo);
  const home = normalizarClaveMlb(marcador.homeTeam);
  const away = normalizarClaveMlb(marcador.awayTeam);

  if (objetivo && (home === objetivo || home.includes(objetivo) || objetivo.includes(home))) {
    return marcador.homeHits;
  }
  if (objetivo && (away === objetivo || away.includes(objetivo) || objetivo.includes(away))) {
    return marcador.awayHits;
  }
  return null;
}

function getTotalHitsObjetivoMlb(autoMlb = {}, marcador) {
  if (!autoMlb?.seleccionEquipo) return marcador?.totalHits ?? null;
  return getHitsEquipoMarcadorMlb(autoMlb.seleccionEquipo, marcador);
}

function getTotalObjetivoAutoMlb(autoMlb = {}, marcador) {
  if (autoMlb?.mercado === "total_hits") return getTotalHitsObjetivoMlb(autoMlb, marcador);
  if (autoMlb?.mercado === "total_carreras") return getTotalCarrerasObjetivoMlb(autoMlb, marcador);
  return marcador?.total ?? null;
}

function juegoMlbFinalizado(game) {
  const state = String(game?.status?.abstractGameState || "").toLowerCase();
  const detail = String(game?.status?.detailedState || "").toLowerCase();
  return state === "final" || /\b(final|game over)\b/i.test(detail);
}

function juegoMlbTieneEvidenciaInicio(game) {
  const state = String(game?.status?.abstractGameState || "").toLowerCase();
  const detail = String(game?.status?.detailedState || "").toLowerCase();
  if (/\b(in progress|live|final)\b/.test(state)) return true;
  if (/\b(in progress|live|final|game over|top|bottom|inning|extra)\b/.test(detail)) return true;

  const marcador = getMarcadorMlb(game);
  if (!marcador) return false;
  const linescore = game?.linescore || {};
  if (linescore.currentInning || linescore.currentInningOrdinal || linescore.inningState || linescore.inningHalf) return true;
  return marcador.total > 0 || (marcador.totalHits ?? 0) > 0;
}

function juegoMlbNoIniciado(game) {
  if (juegoMlbTieneEvidenciaInicio(game)) return false;
  const state = String(game?.status?.abstractGameState || "").toLowerCase();
  const detail = String(game?.status?.detailedState || "").toLowerCase();
  return /\b(preview|pre-game|pre game|scheduled|warmup)\b/.test(state) ||
    /\b(preview|pre-game|pre game|scheduled|warmup)\b/.test(detail);
}

function juegoMlbEnCurso(game) {
  const state = String(game?.status?.abstractGameState || "").toLowerCase();
  const detail = String(game?.status?.detailedState || "").toLowerCase();
  if (/\b(in progress|live)\b/.test(state)) return true;
  if (/\b(pre-game|preview|scheduled|postponed|delayed|final|game over)\b/.test(state)) return false;
  return /\b(top|bottom|inning|extra|half|inning\s*\d+)\b/.test(detail);
}

function equipoTuvoVentajaDe5Carreras(autoMlb, game) {
  if (!autoMlb || !game || !autoMlb.seleccionEquipo) return false;
  const marcador = getMarcadorMlb(game);
  if (!marcador) return false;

  const equipoObjetivo = normalizarClaveMlb(autoMlb.seleccionEquipo);
  const homeObj = normalizarClaveMlb(marcador.homeTeam);
  const awayObj = normalizarClaveMlb(marcador.awayTeam);

  const esHome = equiposMlbCoinciden(equipoObjetivo, homeObj);
  const esAway = equiposMlbCoinciden(equipoObjetivo, awayObj);

  if (!esHome && !esAway) return false;

  // 1. Verificar si en el marcador actual tiene ventaja >= 5 carreras
  const diffActual = esHome ? (marcador.home - marcador.away) : (marcador.away - marcador.home);
  if (diffActual >= 5) return true;

  // 2. Verificar la evolución por entradas (linescore)
  const innings = game?.linescore?.innings;
  if (Array.isArray(innings) && innings.length > 0) {
    let cumulativeHome = 0;
    let cumulativeAway = 0;

    for (const inning of innings) {
      if (inning?.away?.runs !== undefined && inning?.away?.runs !== null) {
        cumulativeAway += Number(inning.away.runs) || 0;
        const diffAway = cumulativeAway - cumulativeHome;
        if (esAway && diffAway >= 5) return true;
      }

      if (inning?.home?.runs !== undefined && inning?.home?.runs !== null) {
        cumulativeHome += Number(inning.home.runs) || 0;
        const diffHome = cumulativeHome - cumulativeAway;
        if (esHome && diffHome >= 5) return true;
      }
    }
  }

  return false;
}

function esApuestaDeMiCasino(apuesta = {}) {
  const casaId = getCasaIdApuesta(apuesta);
  const nombreCasa = getCasaNombre(casaId);
  const normNombre = normalizarNombreCasa(nombreCasa);
  const normApuesta = normalizarNombreCasa(apuesta?.casaNombre || apuesta?.casa || "");
  const normSimple = str => String(str).toLowerCase().replace(/[^a-z0-9]/g, "");

  return (
    normNombre.includes("mi casino") ||
    normNombre.includes("micasino") ||
    normSimple(normNombre).includes("micasino") ||
    normApuesta.includes("mi casino") ||
    normApuesta.includes("micasino") ||
    normSimple(normApuesta).includes("micasino")
  );
}

function evaluarAutoMlb(autoMlb, game, options = {}) {
  if (!autoMlb) return null;
  if (juegoMlbNoIniciado(game)) return null;
  const marcador = getMarcadorMlb(game);
  if (!marcador) return null;
  const finalizado = juegoMlbFinalizado(game);
  const esMiCasino = Boolean(options.esMiCasino);

  if (autoMlb.mercado === "ganador_partido") {
    // Regla de Pago Anticipado (5 carreras de ventaja): aplica EXCLUSIVAMENTE a la casa "Mi Casino"
    const tuvoPagoAnticipado = esMiCasino && (autoMlb.pagoAnticipado || equipoTuvoVentajaDe5Carreras(autoMlb, game));
    if (tuvoPagoAnticipado) {
      return {
        estado: "ganada",
        marcador,
        pagoAnticipado: true
      };
    }

    if (!finalizado) return null;
    const homeWon = marcador.home > marcador.away;
    const awayWon = marcador.away > marcador.home;
    if (!homeWon && !awayWon) return { estado: "nula", marcador };

    const ganador = homeWon ? marcador.homeTeam : marcador.awayTeam;
    return {
      estado: normalizarClaveMlb(ganador) === normalizarClaveMlb(autoMlb.seleccionEquipo) ? "ganada" : "perdida",
      marcador,
      pagoAnticipado: false
    };
  }

  if (autoMlb.mercado === "handicap") {
    if (!finalizado) return null;
    const linea = Number(autoMlb.linea);
    const equipo = getScoreEquipoMarcadorMlb(autoMlb.seleccionEquipo, marcador);
    if (Number.isNaN(linea) || !equipo) return null;
    const ajustado = equipo.seleccionado + linea;
    if (ajustado === equipo.rival) return { estado: "nula", marcador };
    return {
      estado: ajustado > equipo.rival ? "ganada" : "perdida",
      marcador
    };
  }

  if (autoMlb.mercado === "total_carreras") {
    const linea = Number(autoMlb.linea);
    const totalObjetivo = getTotalCarrerasObjetivoMlb(autoMlb, marcador);
    if (Number.isNaN(linea) || totalObjetivo === null) return null;
    if (!finalizado) {
      if (autoMlb.tipoTotal === "over" && totalObjetivo > linea) return { estado: "ganada", marcador };
      if (autoMlb.tipoTotal === "under" && totalObjetivo > linea) return { estado: "perdida", marcador };
      return null;
    }
    if (totalObjetivo === linea) return { estado: "nula", marcador };
    const ganaOver = totalObjetivo > linea;
    return {
      estado: (autoMlb.tipoTotal === "over" ? ganaOver : !ganaOver) ? "ganada" : "perdida",
      marcador
    };
  }

  if (autoMlb.mercado === "total_hits") {
    const linea = Number(autoMlb.linea);
    const totalObjetivo = getTotalHitsObjetivoMlb(autoMlb, marcador);
    if (Number.isNaN(linea) || totalObjetivo === null) return null;
    if (!finalizado) {
      if (autoMlb.tipoTotal === "over" && totalObjetivo > linea) return { estado: "ganada", marcador };
      if (autoMlb.tipoTotal === "under" && totalObjetivo > linea) return { estado: "perdida", marcador };
      return null;
    }
    if (totalObjetivo === linea) return { estado: "nula", marcador };
    const ganaOver = totalObjetivo > linea;
    return {
      estado: (autoMlb.tipoTotal === "over" ? ganaOver : !ganaOver) ? "ganada" : "perdida",
      marcador
    };
  }

  if (autoMlb.mercado === "ambos_equipos_anotan") {
    const ambosAnotaron = marcador.home > 0 && marcador.away > 0;
    if (!finalizado && ambosAnotaron) {
      return {
        estado: autoMlb.seleccion === "no" ? "perdida" : "ganada",
        marcador
      };
    }
    if (!finalizado) return null;
    return {
      estado: (autoMlb.seleccion === "no" ? !ambosAnotaron : ambosAnotaron) ? "ganada" : "perdida",
      marcador
    };
  }

  return null;
}

function aplicarResultadoMlbApuesta(apuesta, juegosFecha = [], juegosEspnFecha = []) {
  const fechaBet = apuesta.fecha || apuesta.dia;
  const jugadasBase = normalizarJugadasConEstado(apuesta.jugadas || []);
  const jugadas = repararTotalesEquipoMlbPartidos(jugadasBase);
  let huboCambio = false;
  let huboCambioMetadata = JSON.stringify(jugadasBase) !== JSON.stringify(jugadas);

  const nuevasJugadas = jugadas.map(jugada => {
    if (typeof jugada !== "object" || !jugada) return jugada;

    const ev = jugada.ev || jugada.evento || apuesta.evento || "";
    const selections = getSelectionsFromJugada(jugada).map(sel => {
      const autoMlbOriginal = sel.autoMlb || null;
      const autoMlbDetectado = crearAutoMlbSeleccion({
        evento: ev,
        titulo: sel.titulo || "",
        jugada: sel.jugadaOriginal || sel.jugada || ""
      });
      let autoMlb = combinarAutoMlbConDetectado(autoMlbOriginal, autoMlbDetectado);
      if (!autoMlb) return sel;
      const equiposBusqueda = getEquiposBusquedaAutoMlb(autoMlb, jugada, ev);
      if (equiposBusqueda.length >= 2 && JSON.stringify(autoMlb.equipos || []) !== JSON.stringify(equiposBusqueda)) {
        autoMlb = { ...autoMlb, equipos: equiposBusqueda };
        huboCambioMetadata = true;
      }
      const { autoFutbol, ...selMlb } = sel;
      if (autoFutbol) huboCambioMetadata = true;

      if (
        !autoMlbOriginal ||
        (autoMlbDetectado && (
          autoMlbOriginal.mercado !== autoMlb.mercado ||
          autoMlbOriginal.seleccionEquipo !== autoMlb.seleccionEquipo ||
          autoMlbOriginal.tipoTotal !== autoMlb.tipoTotal ||
          Number(autoMlbOriginal.linea) !== Number(autoMlb.linea)
        ))
      ) {
        huboCambioMetadata = true;
      }
      const game = buscarJuegoMlb(juegosFecha, autoMlb.equipos, fechaBet, autoMlb.gamePk, autoMlb.horaJuego || autoMlb.hora || apuesta.hora);
      const espnGame = buscarJuegoEspnMlb(juegosEspnFecha, autoMlb.equipos, fechaBet, autoMlb.espnId, autoMlb.horaJuego || autoMlb.hora || apuesta.hora);
      const estadoEspecialMlb = getEstadoEspecialMlb(game);
      const estadoEspecialEspn = getEstadoEspecialEspn(espnGame, "espn_mlb_scoreboard");
      const estadoEspecial = (game && !estadoEspecialMlb)
        ? null
        : combinarEstadoEspecial(estadoEspecialMlb, estadoEspecialEspn);

      const ignorarRetrasadoActivo = estadoEspecial?.tipo === "retrasado" && juegoMlbEnCurso(game);
      if (estadoEspecial && !ignorarRetrasadoActivo) {
        const siguienteEstado = estadoEspecial.accion === "nula" ? "nula" : (sel.estado || "pendiente");
        if ((sel.estado || "pendiente") !== siguienteEstado) huboCambio = true;
        if (
          autoMlb.estadoJuego !== estadoEspecial.label ||
          autoMlb.estadoEspecial?.tipo !== estadoEspecial.tipo ||
          autoMlb.estadoEspecial?.motivo !== estadoEspecial.motivo ||
          autoMlb.fechaJuego !== (game?.gameDate || autoMlb.fechaJuego)
        ) {
          huboCambioMetadata = true;
        }
        return {
          ...selMlb,
          estado: siguienteEstado,
          autoMlb: {
            ...autoMlb,
            gamePk: game?.gamePk ?? autoMlb.gamePk,
            espnId: espnGame?.id ?? autoMlb.espnId,
            estadoJuego: estadoEspecial.label,
            estadoEspecial,
            marcador: autoMlb.marcador,
            fechaJuego: game?.gameDate || autoMlb.fechaJuego
          }
        };
      }
      if (!game) return { ...selMlb, autoMlb };

      const esMiCasino = esApuestaDeMiCasino(apuesta);
      const evaluacion = evaluarAutoMlb(autoMlb, game, { esMiCasino });
      if (!evaluacion) {
        const juegoNoIniciado = juegoMlbNoIniciado(game);
        const marcador = juegoNoIniciado ? null : getMarcadorMlb(game);
        const estadoJuego = game?.status?.detailedState || game?.status?.abstractGameState || "";
        const totalObjetivo = getTotalObjetivoAutoMlb(autoMlb, marcador);
        const marcadorTexto = marcador
          ? formatMarcadorSegunEvento(ev, marcador)
          : null;
        const marcadorHitsTexto = marcador
          ? formatHitsMlbSegunEvento(ev, marcador)
          : null;
        const esMercadoHits = autoMlb.mercado === "total_hits";

        const estadoAnterior = sel.estado || "pendiente";
        const fueMarcadoReembolsoPrevio = estadoAnterior === "nula" ||
          esEstadoJuegoReembolso(autoMlb.estadoJuego) ||
          Boolean(autoMlb.estadoEspecial?.reembolso) ||
          autoMlb.estadoEspecial?.tipo === "pospuesto";
        const nuevoEstadoSel = fueMarcadoReembolsoPrevio ? "pendiente" : estadoAnterior;

        if (estadoAnterior !== nuevoEstadoSel) {
          huboCambio = true;
        }

        if (
          estadoAnterior !== nuevoEstadoSel ||
          autoMlb.gamePk !== game.gamePk ||
          autoMlb.estadoJuego !== estadoJuego ||
          autoMlb.marcador !== marcadorTexto ||
          (esMercadoHits && autoMlb.marcadorHits !== marcadorHitsTexto) ||
          autoMlb.fechaJuego !== game.gameDate ||
          autoMlb.estadoEspecial !== null ||
          (juegoNoIniciado && (
            autoMlb.totalCarreras !== undefined ||
            autoMlb.totalHits !== undefined
          ))
        ) {
          huboCambioMetadata = true;
        }
        return {
          ...selMlb,
          estado: nuevoEstadoSel,
          autoMlb: {
            ...autoMlb,
            gamePk: game.gamePk,
            estadoJuego,
            estadoEspecial: null,
            marcador: marcadorTexto,
            marcadorHits: esMercadoHits ? marcadorHitsTexto : autoMlb.marcadorHits,
            totalCarreras: autoMlb.mercado === "total_carreras" && !juegoNoIniciado ? totalObjetivo : undefined,
            totalHits: esMercadoHits && !juegoNoIniciado ? totalObjetivo : undefined,
            fechaJuego: game.gameDate
          }
        };
      }

      const totalObjetivo = getTotalObjetivoAutoMlb(autoMlb, evaluacion.marcador);
      const marcadorHitsTexto = formatHitsMlbSegunEvento(ev, evaluacion.marcador);
      const esMercadoHits = autoMlb.mercado === "total_hits";
      const pagoAnticipado = Boolean(evaluacion.pagoAnticipado || autoMlb.pagoAnticipado);
      const siguiente = {
        ...selMlb,
        estado: evaluacion.estado,
        autoMlb: {
          ...autoMlb,
          gamePk: game.gamePk,
          estadoJuego: game?.status?.detailedState || game?.status?.abstractGameState || "Final",
          estadoEspecial: null,
          marcador: formatMarcadorSegunEvento(ev, evaluacion.marcador),
          marcadorHits: esMercadoHits ? marcadorHitsTexto : autoMlb.marcadorHits,
          totalCarreras: autoMlb.mercado === "total_carreras" ? totalObjetivo : autoMlb.totalCarreras,
          totalHits: esMercadoHits ? totalObjetivo : autoMlb.totalHits,
          pagoAnticipado,
          fechaJuego: game.gameDate,
          sincronizadoEn: Date.now()
        }
      };

      if ((sel.estado || "pendiente") !== evaluacion.estado) huboCambio = true;
      if (
        autoMlb.sincronizadoEn === undefined ||
        autoMlb.fechaJuego !== game.gameDate ||
        (esMercadoHits && autoMlb.marcadorHits !== marcadorHitsTexto) ||
        autoMlb.pagoAnticipado !== pagoAnticipado
      ) {
        huboCambioMetadata = true;
      }
      return siguiente;
    });

    const equiposMlb = detectarEquiposMlb(ev);
    const jugadaActualizada = {
      ...jugada,
      selections
    };

    const tieneEstadoEspecialSelecciones = selections.some(s => Boolean(s.autoMlb?.estadoEspecial));
    if (jugada.autoMlb) {
      jugadaActualizada.autoMlb = {
        ...jugada.autoMlb,
        estadoEspecial: tieneEstadoEspecialSelecciones ? jugada.autoMlb.estadoEspecial : null
      };
    } else if (equiposMlb.length >= 2) {
      jugadaActualizada.autoMlb = { deporte: "mlb", equipos: equiposMlb.slice(0, 2) };
    }

    if (apuesta.tipoApuesta === "simple_option_bet") {
      const totalAuto = selections.find(sel => ["total_carreras", "total_hits"].includes(sel.autoMlb?.mercado))?.autoMlb;
      const game = totalAuto ? buscarJuegoMlb(juegosFecha, totalAuto.equipos, fechaBet, totalAuto.gamePk, totalAuto.horaJuego || totalAuto.hora || apuesta.hora) : null;
      const marcador = game ? getMarcadorMlb(game) : null;
      const finalizado = game ? juegoMlbFinalizado(game) : false;
      const totalObjetivo = getTotalObjetivoAutoMlb(totalAuto, marcador);
      const totalIrreversible = marcador && totalAuto && (
        finalizado ||
        (totalAuto.tipoTotal === "over" && totalObjetivo > Number(totalAuto.linea)) ||
        (totalAuto.tipoTotal === "under" && totalObjetivo > Number(totalAuto.linea))
      );
      if (totalIrreversible && totalObjetivo !== null && jugadaActualizada.resultadoTotal !== totalObjetivo) {
        jugadaActualizada.resultadoTotal = totalObjetivo;
        huboCambio = true;
      }
    }

    jugadaActualizada.estado = determinarEstadoJugada(jugadaActualizada);
    return jugadaActualizada;
  });

  if (!huboCambio && !huboCambioMetadata) return null;

  // Extraer hora y fecha local desde el primer juego MLB encontrado
  const primerJuego = juegosFecha.find(game => {
    const equiposApuesta = nuevasJugadas
      .flatMap(j => (j?.autoMlb?.equipos || []))
      .filter(Boolean);
    if (equiposApuesta.length < 2) return false;
    const nombres = [
      game?.teams?.home?.team?.name,
      game?.teams?.away?.team?.name
    ];
    return equiposApuesta.every(eq => nombres.some(nombre => equiposMlbCoinciden(eq, nombre)));
  });
  const isoJuego = primerJuego?.gameDate || primerJuego?.date || "";
  const { fecha: fechaExtraida, hora: horaExtraida } = obtenerFechaHoraLocalDesdeIso(isoJuego);

  const apuestaTemp = {
    ...apuesta,
    jugadas: nuevasJugadas
  };
  const resultado = recalcularResultadoApuesta(apuestaTemp);
  let cuota = apuesta.cuota;

  if (apuesta.tipoApuesta === "patente") {
    cuota = calcularCuotaMaximaPatente(nuevasJugadas);
  } else if (apuesta.tipoApuesta === "simple_option_bet") {
    cuota = calcularCuotaSimpleOptionBet(apuestaTemp) || apuesta.cuota;
  } else if (debeRecalcularCuotaCombinada(apuesta.tipoApuesta)) {
    const cuotaRecalculada = recalcularCuotaCombinada(nuevasJugadas);
    if (cuotaRecalculada > 0) cuota = cuotaRecalculada;
  }

  const updatePayload = {
    jugadas: nuevasJugadas,
    resultado,
    cuota,
    deporte: "mlb",
    autoSync: crearAutoSyncPayload(apuesta, resultado, {
      proveedor: "mlb_stats_api",
      ultimaRevision: Date.now()
    })
  };

  if ((!apuesta.fecha && !apuesta.dia) && fechaExtraida) {
    updatePayload.fecha = fechaExtraida;
    updatePayload.dia = fechaExtraida;
  }

  if (!apuesta.hora && horaExtraida) {
    updatePayload.hora = horaExtraida;
  }

  if (apuesta.fecha || apuesta.dia) {
    delete updatePayload.fecha;
    delete updatePayload.dia;
  }

  return updatePayload;
}

function apuestaMlbNecesitaHorario(apuesta = {}) {
  const fecha = apuesta.fecha || apuesta.dia;
  if (fecha !== obtenerFechaActualLocal()) return false;
  if (!apuestaPareceMlb(apuesta)) return false;
  if (!Array.isArray(apuesta.jugadas) || apuesta.jugadas.length === 0) return false;
  if ((apuesta.resultado || "pendiente") !== "pendiente") return false;
  if (!apuesta.hora) return true;
  return getAutoMlbFechasJuego(apuesta).length === 0;
}

function aplicarHorarioMlbApuesta(apuesta, juegosFecha = [], juegosEspnFecha = []) {
  const fechaBet = apuesta.fecha || apuesta.dia;
  const jugadasBase = normalizarJugadasConEstado(apuesta.jugadas || []);
  let huboCambio = false;
  let primeraHora = "";

  const nuevasJugadas = jugadasBase.map(jugada => {
    if (typeof jugada !== "object" || !jugada) return jugada;

    const ev = jugada.ev || jugada.evento || apuesta.evento || "";
    const selections = getSelectionsFromJugada(jugada).map(sel => {
      const autoMlbOriginal = sel.autoMlb || null;
      const autoMlbDetectado = crearAutoMlbSeleccion({
        evento: ev,
        titulo: sel.titulo || "",
        jugada: sel.jugadaOriginal || sel.jugada || ""
      });
      let autoMlb = combinarAutoMlbConDetectado(autoMlbOriginal, autoMlbDetectado);
      if (!autoMlb) return sel;
      const equiposBusqueda = getEquiposBusquedaAutoMlb(autoMlb, jugada, ev);
      if (equiposBusqueda.length >= 2 && JSON.stringify(autoMlb.equipos || []) !== JSON.stringify(equiposBusqueda)) {
        autoMlb = { ...autoMlb, equipos: equiposBusqueda };
        huboCambio = true;
      }
      const { autoFutbol, ...selMlb } = sel;

      const game = buscarJuegoMlb(juegosFecha, autoMlb.equipos, fechaBet, autoMlb.gamePk, autoMlb.horaJuego || autoMlb.hora || apuesta.hora);
      const espnGame = buscarJuegoEspnMlb(juegosEspnFecha, autoMlb.equipos, fechaBet, autoMlb.espnId, autoMlb.horaJuego || autoMlb.hora || apuesta.hora);
      const isoJuego = game?.gameDate || espnGame?.date || autoMlb.fechaJuego || "";
      const { hora } = obtenerFechaHoraLocalDesdeIso(isoJuego);
      if (!primeraHora && hora) primeraHora = hora;
      if (!game && !espnGame) {
        if (!autoMlbOriginal && autoMlbDetectado) huboCambio = true;
        if (autoFutbol) huboCambio = true;
        return autoMlbOriginal || autoMlbDetectado ? { ...selMlb, autoMlb } : selMlb;
      }

      const estadoJuego = game?.status?.detailedState ||
        game?.status?.abstractGameState ||
        espnGame?.status?.type?.detail ||
        espnGame?.status?.type?.description ||
        autoMlb.estadoJuego ||
        "";
      const siguienteAuto = {
        ...autoMlb,
        gamePk: game?.gamePk ?? autoMlb.gamePk,
        espnId: espnGame?.id ?? autoMlb.espnId,
        estadoJuego,
        fechaJuego: isoJuego || autoMlb.fechaJuego
      };

      if (
        !autoMlbOriginal ||
        autoMlb.gamePk !== siguienteAuto.gamePk ||
        autoMlb.espnId !== siguienteAuto.espnId ||
        autoMlb.estadoJuego !== siguienteAuto.estadoJuego ||
        autoMlb.fechaJuego !== siguienteAuto.fechaJuego
      ) {
        huboCambio = true;
      }
      if (autoFutbol) huboCambio = true;

      return {
        ...selMlb,
        autoMlb: siguienteAuto
      };
    });

    const equiposMlb = detectarEquiposMlb(ev);
    const siguienteJugada = {
      ...jugada,
      selections
    };
    const autoJugada = jugada.autoMlb || (equiposMlb.length >= 2 ? { deporte: "mlb", equipos: equiposMlb.slice(0, 2) } : null);
    if (autoJugada) {
      const game = buscarJuegoMlb(juegosFecha, autoJugada.equipos, fechaBet, autoJugada.gamePk, autoJugada.horaJuego || autoJugada.hora || apuesta.hora);
      const espnGame = buscarJuegoEspnMlb(juegosEspnFecha, autoJugada.equipos, fechaBet, autoJugada.espnId, autoJugada.horaJuego || autoJugada.hora || apuesta.hora);
      const isoJuego = game?.gameDate || espnGame?.date || autoJugada.fechaJuego || "";
      const { hora } = obtenerFechaHoraLocalDesdeIso(isoJuego);
      if (!primeraHora && hora) primeraHora = hora;
      siguienteJugada.autoMlb = {
        ...autoJugada,
        gamePk: game?.gamePk ?? autoJugada.gamePk,
        espnId: espnGame?.id ?? autoJugada.espnId,
        estadoJuego: game?.status?.detailedState || game?.status?.abstractGameState || autoJugada.estadoJuego || "",
        fechaJuego: isoJuego || autoJugada.fechaJuego
      };
      if (JSON.stringify(jugada.autoMlb || null) !== JSON.stringify(siguienteJugada.autoMlb || null)) {
        huboCambio = true;
      }
    }

    return siguienteJugada;
  });

  const updatePayload = {};
  if (huboCambio) updatePayload.jugadas = nuevasJugadas;
  if (!apuesta.hora && primeraHora) updatePayload.hora = primeraHora;
  return Object.keys(updatePayload).length > 0 ? updatePayload : null;
}

let _syncMlbEnCurso = false;

async function sincronizarResultadosMlb(silencioso = false) {
  if (_syncMlbEnCurso) {
    if (!silencioso) {
      setMlbSyncStatus("Ya hay una sincronizacion MLB en curso.", "");
    }
    return;
  }

  const hoy = obtenerFechaActualLocal();
  const apuestasSync = silencioso
    ? await getApuestasAutoSyncScope("mlb")
    : getApuestasSyncScope(false);
  const candidatasResultados = apuestasSync.filter(a => {
    if (!apuestaPareceMlb(a)) return false;
    if (!Array.isArray(a.jugadas) || a.jugadas.length === 0) return false;
    if (apuestaYaFinalizadaYResuelta(a, "autoMlb")) return false;

    const esResultadoPendiente = apuestaResultadoPendiente(a);
    const fuePospuesto = (a.jugadas || []).some(j =>
      esEstadoJuegoReembolso(j?.autoMlb?.estadoJuego) ||
      (j?.selections || []).some(sel =>
        sel?.estado === "nula" ||
        sel?.autoMlb?.estadoEspecial?.tipo === "pospuesto" ||
        esEstadoJuegoReembolso(sel?.autoMlb?.estadoJuego)
      )
    ) || (a.resultado === "nula" && (apuestaTieneMarcadorMlb(a) || apuestaPareceMlb(a)));

    if (apuestaSyncCerrada(a) && !fuePospuesto) return false;
    if (!esResultadoPendiente && !fuePospuesto) return false;

    const fechaApuesta = a.fecha || a.dia;
    const esApuestaHoy = fechaApuesta === hoy;
    if (!apuestaMlbYaDebeSincronizar(a) && !esApuestaHoy) return false;
    // En modo automático/silencioso, solo procesar apuestas de hoy o con estado pospuesto
    if (silencioso && !esApuestaHoy && !fuePospuesto) return false;
    return true;
  });
  const candidatasHorario = apuestasSync.filter(a => {
    if (!apuestaMlbNecesitaHorario(a)) return false;
    if (apuestaSyncCerrada(a)) return false;
    if (apuestaYaFinalizadaYResuelta(a, "autoMlb")) return false;
    return true;
  });
  const candidatas = [...new Map(
    [...candidatasResultados, ...candidatasHorario].map(apuesta => [apuesta.id, apuesta])
  ).values()];

  if (candidatas.length === 0) {
    if (!silencioso) {
      setMlbSyncStatus("No hay apuestas MLB pendientes para sincronizar.", "");
    }
    return;
  }

  _syncMlbEnCurso = true;
  const btn = document.getElementById("btnSincronizarMlb");
  if (!silencioso) {
    if (btn) btn.disabled = true;
    await cederControlNavegador();
    setMlbSyncStatus("Sincronizando resultados MLB...", "");
  }

  try {
    const fechas = [...new Set(candidatas.map(a => a.fecha || a.dia).filter(Boolean))];
    const juegosPorFecha = new Map();
    const juegosEspnPorFecha = new Map();
    for (const fecha of fechas) {
      if (silencioso && !paginaEstaVisible()) return;
      await cederControlNavegador();
      const fechasBusqueda = getFechasCercanas(fecha);
      const juegos = [];
      const juegosEspn = [];
      for (const fechaBusqueda of fechasBusqueda) {
        if (silencioso && !paginaEstaVisible()) return;
        await cederControlNavegador();
        juegos.push(...await cargarJuegosMlbPorFecha(fechaBusqueda));
        try {
          juegosEspn.push(...await cargarJuegosEspnMlbPorFecha(fechaBusqueda));
        } catch (e) {
          console.warn("No se pudo cargar ESPN MLB:", fechaBusqueda, e);
        }
      }
      juegosPorFecha.set(fecha, juegos);
      juegosEspnPorFecha.set(fecha, juegosEspn);
    }

    let actualizadas = 0;
    let horariosActualizados = 0;
    let revisadas = 0;
    let actualizacionesVisibles = 0;

    for (const apuesta of candidatas) {
      if (silencioso && !paginaEstaVisible()) return;
      await cederControlNavegador();
      revisadas++;
      const fecha = apuesta.fecha || apuesta.dia;
      const juegosApuesta = juegosPorFecha.get(fecha) || [];
      const juegosEspnApuesta = juegosEspnPorFecha.get(fecha) || [];
      const debeSincronizarResultado = candidatasResultados.some(item => item.id === apuesta.id);
      const updateData = debeSincronizarResultado
        ? aplicarResultadoMlbApuesta(apuesta, juegosApuesta, juegosEspnApuesta)
        : aplicarHorarioMlbApuesta(apuesta, juegosApuesta, juegosEspnApuesta);
      if (!updateData) continue;

      if (silencioso) marcarRenderSilenciosoApuesta(apuesta.id);
      await updateDoc(doc(db, "apuestas", apuesta.id), limpiarUndefinedFirestore(updateData));
      const actualizadaLocal = aplicarUpdateLocalApuesta(apuesta.id, updateData);
      const afectaVistaActual = actualizadaLocal && apuestaPerteneceFiltroActual(apuesta);
      if (!silencioso || afectaVistaActual) {
        renderSnapshotProgramado();
      }
      if (silencioso && afectaVistaActual) actualizacionesVisibles++;
      actualizadas++;
      if (!debeSincronizarResultado) horariosActualizados++;
    }

    if (silencioso && actualizacionesVisibles > 0) {
      renderSnapshotProgramado();
    }

    if (!silencioso) {
      setMlbSyncStatus(
        `MLB sincronizado: ${actualizadas} de ${revisadas} apuestas revisadas.${horariosActualizados ? ` Horarios: ${horariosActualizados}.` : ""}`,
        actualizadas > 0 ? "success" : ""
      );
    }
  } catch (e) {
    console.error("Error sincronizando MLB:", e);
    if (!silencioso) {
      setMlbSyncStatus(`No se pudo sincronizar MLB: ${e.message}`, "error");
    }
  } finally {
    _syncMlbEnCurso = false;
    if (!silencioso && btn) btn.disabled = false;
    if (!silencioso) {
      render();
      if (_syncMlbActivado) programarSyncSilenciosa("mlb", 1500, true);
    }
  }
}

function reordenarMarcadorTextoMlb(marcadorTexto = "", equipos = []) {
  if (!marcadorTexto || !Array.isArray(equipos) || equipos.length < 2) return marcadorTexto;

  const match = String(marcadorTexto).match(/^(.+?)\s+(\d+)\s*[-–—]\s*(\d+)\s+(.+?)(\s+·.*)?$/);
  if (!match) return marcadorTexto;

  const equipoIzq = match[1].trim();
  const scoreIzq = match[2];
  const scoreDer = match[3];
  const equipoDer = match[4].trim();
  const extra = match[5] || "";
  const [equipoA, equipoB] = equipos.slice(0, 2);

  const izquierdaEsA = equiposMlbCoinciden(equipoIzq, equipoA);
  const derechaEsB = equiposMlbCoinciden(equipoDer, equipoB);
  if (izquierdaEsA && derechaEsB) return marcadorTexto;

  const izquierdaEsB = equiposMlbCoinciden(equipoIzq, equipoB);
  const derechaEsA = equiposMlbCoinciden(equipoDer, equipoA);
  if (izquierdaEsB && derechaEsA) {
    return `${equipoDer} ${scoreDer} - ${scoreIzq} ${equipoIzq}${extra}`;
  }

  return marcadorTexto;
}

function getAutoMlbMarcadorHtml(selection = {}, options = {}) {
  const autoMlb = selection?.autoMlb || {};
  const fechaJuego = autoMlb.fechaJuego || options.fallbackFechaJuego || "";
  const marcador = autoMlb.marcador;
  const marcadorOrdenado = reordenarMarcadorTextoMlb(marcador, autoMlb.equipos);
  const estadoPrevio = debeMostrarHorarioJuego(fechaJuego, autoMlb.estadoJuego);
  const ocultarResultadoPorHorario = estadoPrevio;
  const estadoEspecialHtml = getEstadoEspecialApuestaHtml(autoMlb);
  const showAutoMeta = options.showAutoMeta !== false;
  const suppressSchedule = options.suppressSchedule === true;
  const showFinalStatus = options.showFinalStatus !== false;
  const estadoFinalizadoHtml = showFinalStatus ? getEstadoFinalizadoHtml(autoMlb) : "";
  const totalCarreras = Number(autoMlb.totalCarreras);
  const totalHits = Number(autoMlb.totalHits);
  const carrerasLabel = autoMlb.seleccionEquipo ? `Carreras de ${autoMlb.seleccionEquipo}` : "Carreras";
  const carrerasHtml = autoMlb.mercado === "total_carreras" && !Number.isNaN(totalCarreras)
    ? ` · ${escapeHtml(carrerasLabel)}: ${escapeHtml(totalCarreras)}`
    : "";
  const hitsLabel = autoMlb.seleccionEquipo ? `Hits de ${autoMlb.seleccionEquipo}` : "Hits";
  const marcadorVisible = ocultarResultadoPorHorario
    ? ""
    : autoMlb.mercado === "total_hits"
    ? (autoMlb.marcadorHits || (!Number.isNaN(totalHits) ? `${hitsLabel}: ${totalHits}` : marcadorOrdenado))
    : marcadorOrdenado;
  const marcadorExtra = autoMlb.mercado === "total_hits" ? "" : carrerasHtml;
  const marcadorHtml = marcadorVisible
    ? `<div class="auto-mlb-score">${escapeHtml(marcadorVisible)}${marcadorExtra}</div>`
    : "";

  let horaHtml = "";
  if (!suppressSchedule && showAutoMeta && fechaJuego && estadoPrevio) {
    const formattedTime = formatFechaJuego(fechaJuego);
    if (formattedTime) {
      horaHtml = `<div class="auto-mlb-score auto-mlb-score--status">${escapeHtml(formattedTime)}</div>`;
    }
  }

  const pagoAnticipadoBadge = autoMlb.pagoAnticipado
    ? `<div class="pago-anticipado-badge">⚡ Ganado por Pago Anticipado</div>`
    : "";

  if (estadoEspecialHtml) return `${marcadorHtml || horaHtml}${estadoEspecialHtml}${pagoAnticipadoBadge}`;
  if (!marcador && selection?.estado === "nula" && autoMlb.estadoJuego && /postpon|pospuest|cancel|retras|delay|suspend/i.test(autoMlb.estadoJuego)) {
    return `${getEstadoJuegoLegacyHtml(autoMlb.estadoJuego)}${pagoAnticipadoBadge}`;
  }
  return marcadorHtml ? `${marcadorHtml}${pagoAnticipadoBadge}${estadoFinalizadoHtml}` : `${horaHtml}${pagoAnticipadoBadge}`;
}

function autoMlbTieneMetaVisible(autoMlb = {}) {
  return Boolean(autoMlb?.marcador || autoMlb?.fechaJuego || autoMlb?.estadoJuego || autoMlb?.estadoEspecial);
}

function autoFutbolTieneMetaVisible(autoFutbol = {}) {
  return footballAutoPresenter.autoFutbolTieneMetaVisible(autoFutbol);
}

function autoTieneResultadoVisible(auto = {}) {
  if (debeMostrarHorarioJuego(auto?.fechaJuego || "", auto?.estadoJuego || "")) return false;
  return Boolean(auto?.marcador) ||
    auto?.totalCarreras !== undefined ||
    auto?.totalHits !== undefined ||
    auto?.totalGoles !== undefined ||
    auto?.totalCorners !== undefined ||
    auto?.totalTarjetas !== undefined;
}

function jugadaTieneResultadoAutoVisible(jugada = {}) {
  if (autoTieneResultadoVisible(jugada?.autoMlb) || autoTieneResultadoVisible(jugada?.autoFutbol)) return true;
  return (jugada?.selections || []).some(sel =>
    autoTieneResultadoVisible(sel?.autoMlb) || autoTieneResultadoVisible(sel?.autoFutbol)
  );
}

function completarAutoMlbRenderDesdeJugada(selection = {}, jugada = {}) {
  const autoActual = selection?.autoMlb || null;
  if (autoMlbTieneMetaVisible(autoActual)) return selection;

  const candidatos = [
    ...(Array.isArray(jugada?.selections) ? jugada.selections.map(sel => sel?.autoMlb).filter(Boolean) : []),
    jugada?.autoMlb
  ].filter(autoMlbTieneMetaVisible);

  if (candidatos.length === 0) return selection;
  const base = candidatos.find(auto => {
    if (!autoActual?.equipos || !auto?.equipos) return true;
    return autoActual.equipos.every(eq => auto.equipos.some(candidato => equiposMlbCoinciden(eq, candidato)));
  }) || candidatos[0];

  const estadoEspecialSeguro = (autoActual && autoActual.estadoEspecial === null)
    ? null
    : (autoActual?.estadoEspecial || (base?.estadoEspecial && selection?.estado === "nula" ? base.estadoEspecial : null));

  return {
    ...selection,
    autoMlb: {
      ...(autoActual || {}),
      gamePk: autoActual?.gamePk ?? base.gamePk,
      espnId: autoActual?.espnId ?? base.espnId,
      estadoJuego: autoActual?.estadoJuego || base.estadoJuego,
      estadoEspecial: estadoEspecialSeguro,
      marcador: autoActual?.marcador || base.marcador,
      fechaJuego: autoActual?.fechaJuego || base.fechaJuego
    }
  };
}

function equiposFutbolCoinciden(equipoA = "", equipoB = "") {
  if (!equipoA || !equipoB) return false;
  return scoreEquipoFutbol(equipoA, { name: equipoB }) >= 0.45 ||
    scoreEquipoFutbol(equipoB, { name: equipoA }) >= 0.45;
}

function completarAutoFutbolRenderDesdeJugada(selection = {}, jugada = {}) {
  return footballAutoPresenter.completarAutoFutbolRenderDesdeJugada(selection, jugada, {
    equiposFutbolCoinciden
  });
}

function getAutoMarcadorSeleccionHtml(selection = {}, jugada = {}, options = {}) {
  const selectionMlbCompleta = completarAutoMlbRenderDesdeJugada(selection, jugada);
  const evento = options.evento || jugada?.ev || jugada?.evento || "";
  const tieneContextoMlbDirecto = esContextoMlb(evento, selectionMlbCompleta, jugada, detectarEquiposMlb);
  if (tieneContextoMlbDirecto) {
    return getAutoMlbMarcadorHtml(selectionMlbCompleta, options);
  }

  const selectionAutoCompleta = completarAutoFutbolRenderDesdeJugada(selectionMlbCompleta, jugada);
  const fechaJuegoFutbol = selectionAutoCompleta?.autoFutbol?.fechaJuego ||
    jugada?.autoFutbol?.fechaJuego ||
    (jugada?.selections || []).find(sel => sel?.autoFutbol?.fechaJuego)?.autoFutbol?.fechaJuego ||
    options.fallbackFechaJuego;
  const selectionConFallbackFutbol = selectionAutoCompleta?.autoFutbol && fechaJuegoFutbol
    ? {
      ...selectionAutoCompleta,
      autoFutbol: {
        ...selectionAutoCompleta.autoFutbol,
        fechaJuego: fechaJuegoFutbol,
        estadoJuego: selectionAutoCompleta.autoFutbol.estadoJuego || jugada?.autoFutbol?.estadoJuego || "Programado"
      }
    }
    : selectionAutoCompleta;
  const tieneAutoFutbol = Boolean(selectionConFallbackFutbol?.autoFutbol);
  const tieneContextoMlb = !tieneAutoFutbol && (
    (selectionAutoCompleta?.autoMlb?.equipos || []).length >= 2 ||
    (jugada?.autoMlb?.equipos || []).length >= 2
  );
  const marcadorFutbol = selectionConFallbackFutbol?.autoFutbol && !tieneContextoMlb
    ? getAutoFutbolMarcadorHtml(selectionConFallbackFutbol, options)
    : "";
  const marcadorMlb = tieneAutoFutbol && !tieneContextoMlb
    ? ""
    : getAutoMlbMarcadorHtml(selectionAutoCompleta, options);
  const marcadorSeleccion = marcadorFutbol || marcadorMlb;
  if (marcadorSeleccion) return marcadorSeleccion;
  if (jugada?.autoFutbol) {
    const fechaJuego = jugada.autoFutbol.fechaJuego || options.fallbackFechaJuego;
    return getAutoFutbolMarcadorHtml({
      autoFutbol: {
        ...jugada.autoFutbol,
        ...(fechaJuego ? { fechaJuego, estadoJuego: jugada.autoFutbol.estadoJuego || "Programado" } : {})
      }
    }, options);
  }
  if (jugada?.autoMlb) return getAutoMlbMarcadorHtml({ autoMlb: jugada.autoMlb }, options);
  return "";
}

const FOOTBALL_LEAGUES = [
  { slug: "fifa.world", label: "FIFA" },
  { slug: "fifa.worldcup", label: "Copa Mundial" },
  { slug: "fifa.friendly", label: "Amistosos internacionales" },
  { slug: "fifa.worldq", label: "Eliminatorias mundialistas" },
  { slug: "uefa.euro", label: "Eurocopa" },
  { slug: "uefa.nations", label: "UEFA Nations League" },
  { slug: "uefa.champions", label: "Champions League" },
  { slug: "uefa.europa", label: "Europa League" },
  { slug: "uefa.euroq", label: "Clasificatorios Eurocopa" },
  { slug: "eng.1", label: "Premier League" },
  { slug: "esp.1", label: "LaLiga" },
  { slug: "ita.1", label: "Serie A" },
  { slug: "ger.1", label: "Bundesliga" },
  { slug: "fra.1", label: "Ligue 1" },
  { slug: "conmebol.libertadores", label: "Libertadores" },
  { slug: "conmebol.sudamericana", label: "Sudamericana" },
  { slug: "conmebol.copa", label: "Copa América" },
  { slug: "conmebol.recopa", label: "Recopa" },
  { slug: "concacaf.goldcup", label: "Copa Oro" },
  { slug: "concacaf.nations", label: "Concacaf Nations League" },
  { slug: "concacaf.champions", label: "Concacaf Champions Cup" }
];

const API_SPORTS_FOOTBALL_KEY = "0f4bd89af94f37638906a3de25f55d91";
const API_SPORTS_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
const API_SPORTS_FOOTBALL_DAILY_LIMIT = 95;
const API_SPORTS_FOOTBALL_CACHE_MS = 20 * 60 * 1000;
const API_SPORTS_FOOTBALL_LIVE_CACHE_MS = 0;
const API_SPORTS_FOOTBALL_STATISTICS_CACHE_MS = 15 * 1000;
const API_SPORTS_FOOTBALL_DISCOVERY_RETRY_MS = 6 * 60 * 60 * 1000;
const API_SPORTS_FOOTBALL_DISCOVERY_VERSION = "v2";
const API_SPORTS_FOOTBALL_SILENT_SYNC_LOOKBACK_DAYS = 1;
const API_SPORTS_FOOTBALL_DEFAULT_TIMEZONE = "America/La_Paz";
const MLB_LIVE_SYNC_INTERVAL_MS = 2 * 60 * 1000;
const FOOTBALL_HALFTIME_PAUSE_MS = 15 * 60 * 1000;
const FOOTBALL_SPECIAL_STATUS_RETRY_MS = 30 * 60 * 1000;
const FOOTBALL_REGULATION_CLOSE_GRACE_MS = 115 * 60 * 1000;
const FOOTBALL_LIVE_STATS_SYNC_INTERVAL_MS = 60 * 1000;
const FOOTBALL_MARKET_TIME_SCOPE = "90_minutos_mas_adicional";
const apiSportsFootballCache = new Map();

const FOOTBALL_TEAM_ALIASES_BASE = [
  ["catar", "qatar"],
  ["qatar", "qatar"],
  ["bosnia y herzegovina", "bosnia herzegovina"],
  ["bosnia and herzegovina", "bosnia herzegovina"],
  ["bosnia-herzegovina", "bosnia herzegovina"],
  ["francia", "france"],
  ["irak", "iraq"],
  ["alemania", "germany"],
  ["espana", "spain"],
  ["inglaterra", "england"],
  ["paises bajos", "netherlands"],
  ["holanda", "netherlands"],
  ["belgica", "belgium"],
  ["suiza", "switzerland"],
  ["croacia", "croatia"],
  ["republica checa", "czech republic"],
  ["chequia", "czech republic"],
  ["czechia", "czech republic"],
  ["czech republic", "czech republic"],
  ["marruecos", "morocco"],
  ["japon", "japan"],
  ["corea del sur", "south korea"],
  ["sudafrica", "south africa"],
  ["costa de marfil", "ivory coast"],
  ["congo rep dem", "congo dr"],
  ["congo republica democratica", "congo dr"],
  ["republica democratica del congo", "congo dr"],
  ["democratic republic of congo", "congo dr"],
  ["dr congo", "congo dr"],
  ["d r congo", "congo dr"],
  ["rd congo", "congo dr"],
  ["congo democratic republic", "congo dr"],
  ["urbezkistan", "uzbekistan"],
  ["urbezquistan", "uzbekistan"],
  ["urbequistan", "uzbekistan"],
  ["uzbezkistan", "uzbekistan"],
  ["uzbezquistan", "uzbekistan"],
  ["uzbekistan", "uzbekistan"],
  ["curazao", "curacao"],
  ["cape verde islands", "cabo verde"],
  ["cav", "cabo verde"],
  ["cpv", "cabo verde"],
  ["sau", "arabia saudita"],
  ["suecia", "sweden"],
  ["tunez", "tunisia"],
  ["turquia", "turkey"],
  ["turkiye", "turkey"],
  ["estados unidos", "united states"],
  ["united states of america", "united states"],
  ["eeuu", "united states"],
  ["ee uu", "united states"],
  ["u s a", "united states"],
  ["u s", "united states"],
  ["usa", "united states"],
  ["mexico", "mexico"],
  ["brasil", "brazil"],
  ["argentina", "argentina"],
  ["uruguay", "uruguay"],
  ["colombia", "colombia"],
  ["chile", "chile"],
  ["peru", "peru"],
  ["ecuador", "ecuador"],
  ["bolivia", "bolivia"],
  ["paraguay", "paraguay"],
  ["venezuela", "venezuela"]
];

function crearAliasesFutbolPaises() {
  const aliases = new Map();
  const ambiguos = new Set();

  const agregarAlias = (alias, oficial) => {
    const key = normalizarBaseFutbol(alias);
    if (!key || !oficial || ambiguos.has(key)) return;
    if (aliases.has(key) && aliases.get(key) !== oficial) {
      aliases.delete(key);
      ambiguos.add(key);
      return;
    }
    aliases.set(key, oficial);
  };

  COUNTRY_FLAG_ENTRIES.forEach(country => {
    const code = String(country.flag || "")
      .replace(/^flag-/i, "")
      .replace(/\.png$/i, "");
    const oficial = code ? `country${code}` : normalizarBaseFutbol(country.name || "");
    if (!oficial) return;

    [country.name, ...(country.aliases || [])].forEach(alias => agregarAlias(alias, oficial));
  });

  return [...aliases.entries()];
}

const FOOTBALL_COUNTRY_ALIASES = crearAliasesFutbolPaises();
const FOOTBALL_COUNTRY_ALIAS_LOOKUP = new Map(FOOTBALL_COUNTRY_ALIASES);

const FOOTBALL_TEAM_ALIASES = [
  ...FOOTBALL_COUNTRY_ALIASES,
  ...FOOTBALL_TEAM_ALIASES_BASE.map(([alias, oficial]) => [
    normalizarBaseFutbol(alias),
    FOOTBALL_COUNTRY_ALIAS_LOOKUP.get(normalizarBaseFutbol(oficial)) || normalizarBaseFutbol(oficial)
  ])
].sort((a, b) => b[0].length - a[0].length);

function aplicarAliasFutbol(normalizado = "") {
  let texto = normalizado;
  FOOTBALL_TEAM_ALIASES.forEach(([alias, oficial]) => {
    const pattern = new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "g");
    texto = texto.replace(pattern, (_, prefix) => `${prefix}${oficial}`);
  });
  return texto.replace(/\s+/g, " ").trim();
}

function setFootballSyncStatus(message = "", type = "") {
  const el = document.getElementById("footballSyncStatus");
  if (!el) return;
  el.textContent = message;
  el.className = `mlb-sync-status${type ? ` ${type}` : ""}`;
}

function esAutoFutbolObjeto(autoFutbol = null) {
  if (!autoFutbol || typeof autoFutbol !== "object") return false;
  if (autoFutbol.deporte === "futbol") return true;
  return Boolean(
    autoFutbol.mercado ||
    autoFutbol.marcador ||
    autoFutbol.estadoJuego ||
    autoFutbol.estadoEspecial ||
    autoFutbol.fechaJuego ||
    autoFutbol.totalGoles !== undefined ||
    autoFutbol.totalCorners !== undefined ||
    autoFutbol.totalTarjetas !== undefined ||
    autoFutbol.cornersEquipo ||
    autoFutbol.tarjetasEquipo ||
    (Array.isArray(autoFutbol.equipos) && autoFutbol.equipos.length >= 2)
  );
}

function apuestaTieneAutoFutbol(apuesta) {
  if (apuesta?.deporte === "futbol") return true;
  return (apuesta?.jugadas || []).some(j =>
    esAutoFutbolObjeto(j?.autoFutbol) ||
    (j?.selections || []).some(sel => esAutoFutbolObjeto(sel?.autoFutbol))
  );
}

function apuestaPareceFutbol(apuesta) {
  if (apuestaTieneAutoFutbol(apuesta)) return true;
  return (apuesta?.jugadas || []).some(j => {
    const ev = typeof j === "object" && j ? (j.ev || j.evento || apuesta.evento || "") : apuesta.evento || "";
    return extraerEquiposEventoFutbol(ev).length >= 2;
  });
}

function apuestaTieneMarcadorFutbol(apuesta) {
  return (apuesta?.jugadas || []).some(j =>
    (j?.selections || []).some(sel => Boolean(sel?.autoFutbol?.marcador))
  );
}

function apuestaTieneEstadisticasFutbolIncompletas(apuesta) {
  return (apuesta?.jugadas || []).some(j =>
    (j?.selections || []).some(sel => {
      const auto = sel?.autoFutbol;
      if (auto?.mercado === "total_corners") return !auto.cornersEquipo?.home || !auto.cornersEquipo?.away;
      if (auto?.mercado === "total_tarjetas") return !auto.tarjetasEquipo?.home || !auto.tarjetasEquipo?.away;
      return false;
    })
  );
}

function apuestaTieneMercadoEstadisticasFutbol(apuesta) {
  return (apuesta?.jugadas || []).some(j =>
    (j?.selections || []).some(sel =>
      sel?.autoFutbol?.mercado === "total_corners" ||
      sel?.autoFutbol?.mercado === "total_tarjetas"
    )
  );
}

function getApiSportsFootballUsageKey() {
  return `api-sports-football-usage-${obtenerFechaActualLocal()}`;
}

function getApiSportsFootballUsage() {
  try {
    const value = JSON.parse(localStorage.getItem(getApiSportsFootballUsageKey()) || "0");
    return Number(value) || 0;
  } catch (e) {
    return 0;
  }
}

function registrarApiSportsFootballRequest() {
  try {
    const key = getApiSportsFootballUsageKey();
    localStorage.setItem(key, String(getApiSportsFootballUsage() + 1));
  } catch (e) {
    console.warn("No se pudo registrar el uso diario de API-Sports:", e);
  }
}

function assertApiSportsFootballQuotaDisponible() {
  const usadas = getApiSportsFootballUsage();
  if (usadas >= API_SPORTS_FOOTBALL_DAILY_LIMIT) {
    throw new Error(`Limite diario de API-Sports alcanzado (${usadas}/${API_SPORTS_FOOTBALL_DAILY_LIMIT}).`);
  }
}

function parseFechaHoraLocal(fecha = "", hora = "") {
  if (!fecha) return null;
  if (!/^\d{1,2}:\d{2}$/.test(String(hora || ""))) return null;
  const date = new Date(`${fecha}T${hora}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatFechaLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatFechaHoraLocalIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${formatFechaLocal(date)}T${hh}:${min}:00`;
}

function getFechaJuegoFallbackApuesta(apuesta = {}) {
  const fecha = apuesta.fecha || apuesta.dia || "";
  const hora = apuesta.hora || "";
  const date = parseFechaHoraLocal(fecha, hora);
  return date ? formatFechaHoraLocalIso(date) : "";
}

function getAutoFutbolFechasJuego(apuesta = {}) {
  return (apuesta.jugadas || []).flatMap(jugada => {
    const fechas = [];
    if (jugada?.autoFutbol?.fechaJuego) fechas.push(jugada.autoFutbol.fechaJuego);
    (jugada?.selections || []).forEach(sel => {
      if (sel?.autoFutbol?.fechaJuego) fechas.push(sel.autoFutbol.fechaJuego);
    });
    return fechas;
  }).map(fecha => new Date(fecha)).filter(date => !Number.isNaN(date.getTime()));
}

function getInicioFutbolApuesta(apuesta = {}) {
  const fechasAuto = getAutoFutbolFechasJuego(apuesta);
  if (fechasAuto.length > 0) {
    return new Date(Math.min(...fechasAuto.map(date => date.getTime())));
  }
  return parseFechaHoraLocal(apuesta.fecha || apuesta.dia, apuesta.hora || "");
}

function obtenerHoraAutoApuesta(apuesta = {}) {
  const fechasAuto = [
    ...getAutoMlbFechasJuego(apuesta),
    ...getAutoFutbolFechasJuego(apuesta)
  ].filter(date => date instanceof Date && !Number.isNaN(date.getTime()));
  if (fechasAuto.length === 0) return "";

  const primeraFecha = new Date(Math.min(...fechasAuto.map(date => date.getTime())));
  return primeraFecha.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function apuestaFutbolYaDebeSincronizar(apuesta = {}) {
  const inicio = getInicioFutbolApuesta(apuesta);
  if (inicio) return Date.now() >= inicio.getTime();

  const fecha = apuesta.fecha || apuesta.dia;
  if (!fecha) return false;
  return fecha < obtenerFechaActualLocal();
}

function apuestaFutbolEnVentanaSyncSilencioso(apuesta = {}) {
  const fecha = apuesta.fecha || apuesta.dia;
  if (!fecha) return false;

  const hoy = obtenerFechaActualLocal();
  if (fecha === hoy) return true;

  const inicio = getInicioFutbolApuesta(apuesta);
  const base = inicio || new Date(`${fecha}T12:00:00`);
  if (!base || Number.isNaN(base.getTime())) return false;

  const limiteInferior = new Date(`${hoy}T00:00:00`);
  if (Number.isNaN(limiteInferior.getTime())) return false;
  limiteInferior.setDate(limiteInferior.getDate() - API_SPORTS_FOOTBALL_SILENT_SYNC_LOOKBACK_DAYS);

  return base >= limiteInferior && base <= new Date();
}

function getFutbolDiscoveryKey(apuesta = {}) {
  const fecha = apuesta.fecha || apuesta.dia || "sin-fecha";
  return `api-sports-football-discovery-${API_SPORTS_FOOTBALL_DISCOVERY_VERSION}-${apuesta.id || fecha}`;
}

function getUltimoIntentoDescubrirInicioFutbol(apuesta = {}) {
  try {
    return Number(localStorage.getItem(getFutbolDiscoveryKey(apuesta))) || 0;
  } catch (e) {
    return 0;
  }
}

function registrarIntentoDescubrirInicioFutbol(apuesta = {}) {
  try {
    localStorage.setItem(getFutbolDiscoveryKey(apuesta), String(Date.now()));
  } catch (e) {
    console.warn("No se pudo registrar el intento de descubrir horario de futbol:", e);
  }
}

function puedeDescubrirInicioFutbol(apuesta = {}, silencioso = false) {
  if (getInicioFutbolApuesta(apuesta)) return false;

  const fecha = apuesta.fecha || apuesta.dia;
  if (!fecha || fecha !== obtenerFechaActualLocal()) return false;
  if (!silencioso) return true;

  const ultimoIntento = getUltimoIntentoDescubrirInicioFutbol(apuesta);
  return !ultimoIntento || Date.now() - ultimoIntento >= API_SPORTS_FOOTBALL_DISCOVERY_RETRY_MS;
}

function getFechaApiSportsFutbolApuesta(apuesta = {}) {
  const inicio = getInicioFutbolApuesta(apuesta);
  if (inicio) return formatFechaLocal(inicio);
  return apuesta.fecha || apuesta.dia || "";
}

function apuestaNecesitaEspnFutbol(apuesta = {}, juegosApiSports = [], fechaBet = "") {
  return (apuesta.jugadas || []).some(jugada => {
    if (typeof jugada !== "object" || !jugada) return false;
    const ev = jugada.ev || jugada.evento || apuesta.evento || "";

    return getSelectionsFromJugada(jugada).some(sel => {
      const autoFutbol = sel.autoFutbol || crearAutoFutbolSeleccion({
        evento: ev,
        titulo: sel.titulo || "",
        jugada: sel.jugada || ""
      });

      if (autoFutbol) {
        if (esMercadoEstadisticasFutbol(autoFutbol)) return true;
        const apiGame = buscarJuegoFutbol(juegosApiSports, autoFutbol.equipos, fechaBet);
        if (!apiGame) return true;
        if (juegoFutbolEnCurso(apiGame)) return true;
        if (juegoFutbolTieneResultadoUtil(apiGame) && !autoFutbol.marcador) return true;
        return !juegoFutbolTieneResultadoActualizado(apiGame, autoFutbol);
      }

      const textoFallback = sel.jugada || sel.titulo || ev;
      const apiFallback = buscarJuegoFutbolFallback(juegosApiSports, textoFallback, fechaBet);
      return !apiFallback || !juegoFutbolTieneResultadoUtil(apiFallback);
    });
  });
}

function buscarJuegoFutbolFallback(juegos = [], equipoTexto = "", fechaBet = "") {
  if (!equipoTexto || !Array.isArray(juegos) || juegos.length === 0) return null;
  const objetivo = normalizarClaveFutbol(equipoTexto);
  if (!objetivo) return null;
  for (const game of juegos) {
    if (fechaBet) {
      const fechaJuego = obtenerFechaLocalEvent(game);
      if (fechaJuego && !sonFechasCercanas(fechaJuego, fechaBet)) continue;
    }
    const competitors = getCompetidoresFutbol(game);
    for (const c of competitors) {
      const opciones = [c.name, c.shortName, c.abbreviation].map(normalizarClaveFutbol).filter(Boolean);
      if (opciones.some(op => op === objetivo || op.includes(objetivo) || objetivo.includes(op))) {
        return game;
      }
      const objetivoTokens = objetivo.split(" ").filter(t => t.length >= 3);
      const opcionesTokens = opciones.flatMap(op => op.split(" ").filter(t => t.length >= 3));
      if (objetivoTokens.length && opcionesTokens.length) {
        const matches = objetivoTokens.filter(token => opcionesTokens.includes(token)).length;
        if (matches / Math.max(objetivoTokens.length, 1) >= 0.5) return game;
      }
    }
  }
  return null;
}

function getFechasCercanas(fecha = "") {
  const base = new Date(`${fecha}T12:00:00`);
  if (Number.isNaN(base.getTime())) return [fecha].filter(Boolean);

  return [-1, 0, 1].map(offset => {
    const date = new Date(base);
    date.setDate(base.getDate() + offset);
    return formatFechaLocal(date);
  });
}

function fechaIsoConOffset(fecha = "", offset = 0) {
  const base = new Date(`${fecha}T12:00:00`);
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + offset);
  return formatFechaLocal(base);
}

function getFechasPermitidasApiSportsFutbol() {
  const hoy = obtenerFechaActualLocal();
  return new Set([
    fechaIsoConOffset(hoy, -1),
    hoy,
    fechaIsoConOffset(hoy, 1)
  ].filter(Boolean));
}

function filtrarFechasPermitidasApiSportsFutbol(fechas = []) {
  const permitidas = getFechasPermitidasApiSportsFutbol();
  return fechas.filter(fecha => permitidas.has(fecha));
}

function esErrorRangoApiSportsFreePlan(error) {
  return /free plans do not have access to this date/i.test(error?.message || "");
}

function getSportsTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || API_SPORTS_FOOTBALL_DEFAULT_TIMEZONE;
  } catch (e) {
    return API_SPORTS_FOOTBALL_DEFAULT_TIMEZONE;
  }
}

async function cargarJuegosFutbolPorFecha(fecha, options = {}) {
  if (!fecha) return [];
  const cacheMs = options.cacheMs ?? API_SPORTS_FOOTBALL_CACHE_MS;
  const timezone = options.timezone || getSportsTimezone();

  const cacheKey = `fixtures:${fecha}:${timezone}`;
  const cached = apiSportsFootballCache.get(cacheKey);
  if (cacheMs > 0 && cached && Date.now() - cached.createdAt < cacheMs) {
    return cached.fixtures;
  }

  assertApiSportsFootballQuotaDisponible();

  const url = `${API_SPORTS_FOOTBALL_BASE_URL}/fixtures?date=${encodeURIComponent(fecha)}&timezone=${encodeURIComponent(timezone)}`;
  const response = await fetch(url, {
    headers: {
      "x-apisports-key": API_SPORTS_FOOTBALL_KEY
    }
  });
  registrarApiSportsFootballRequest();

  if (!response.ok) {
    throw new Error(`API-Sports respondio ${response.status}`);
  }

  const data = await response.json();
  const errors = data?.errors;
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : errors && Object.keys(errors).length > 0;
  if (hasErrors) {
    throw new Error(`API-Sports devolvio error: ${JSON.stringify(errors)}`);
  }

  const fixtures = data?.response || [];
  apiSportsFootballCache.set(cacheKey, {
    createdAt: Date.now(),
    fixtures
  });
  return fixtures;
}

async function cargarJuegosEspnFutbolPorFecha(fecha, options = {}) {
  if (!fecha) return [];
  const cacheMs = options.cacheMs ?? API_SPORTS_FOOTBALL_LIVE_CACHE_MS;
  const timezone = options.timezone || getSportsTimezone();
  const cacheKey = `espn-football:${fecha}:${timezone}`;
  const cached = apiSportsFootballCache.get(cacheKey);
  if (cacheMs > 0 && cached && Date.now() - cached.createdAt < cacheMs) {
    return cached.events;
  }

  const date = String(fecha).replace(/-/g, "");
  const events = [];
  const batchSize = 5;
  for (let i = 0; i < FOOTBALL_LEAGUES.length; i += batchSize) {
    await cederControlNavegador();
    const batch = FOOTBALL_LEAGUES.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(async league => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${encodeURIComponent(date)}&limit=300&lang=es&region=mx&tz=${encodeURIComponent(timezone)}`;
      const response = await fetch(url);
      if (!response.ok) return [];

      const data = await response.json();
      return (data.events || []).map(event => ({
        ...event,
        leagueLabel: event.leagueLabel || data?.leagues?.[0]?.name || league.label,
        leagueSlug: league.slug
      }));
    }));

    events.push(...results
      .flatMap(result => result.status === "fulfilled" ? result.value : [])
      .filter(Boolean));
  }
  apiSportsFootballCache.set(cacheKey, {
    createdAt: Date.now(),
    events
  });
  return events;
}

async function cargarResumenApiSportsFutbol(game) {
  const fixtureId = getIdJuegoFutbol(game);
  if (!fixtureId) return null;

  const cacheKey = `fixture-statistics:${fixtureId}`;
  const cached = apiSportsFootballCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < API_SPORTS_FOOTBALL_STATISTICS_CACHE_MS) {
    return cached.summary;
  }

  assertApiSportsFootballQuotaDisponible();

  const url = `${API_SPORTS_FOOTBALL_BASE_URL}/fixtures/statistics?fixture=${encodeURIComponent(fixtureId)}`;
  const response = await fetch(url, {
    headers: {
      "x-apisports-key": API_SPORTS_FOOTBALL_KEY
    }
  });
  registrarApiSportsFootballRequest();

  if (!response.ok) {
    throw new Error(`API-Sports estadisticas respondio ${response.status}`);
  }

  const data = await response.json();
  const errors = data?.errors;
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : errors && Object.keys(errors).length > 0;
  if (hasErrors) {
    throw new Error(`API-Sports estadisticas devolvio error: ${JSON.stringify(errors)}`);
  }

  const summary = { apiSportsStatistics: data?.response || [], proveedor: "api_sports_football_statistics" };
  apiSportsFootballCache.set(cacheKey, {
    createdAt: Date.now(),
    summary
  });
  return summary;
}

async function cargarResumenEspnFutbol(event) {
  const eventId = event?.id;
  const leagueSlug = event?.leagueSlug;
  if (!eventId || !leagueSlug) return null;

  const cacheKey = `espn-football-summary:${leagueSlug}:${eventId}`;
  const cached = apiSportsFootballCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < API_SPORTS_FOOTBALL_STATISTICS_CACHE_MS) {
    return cached.summary;
  }

  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(leagueSlug)}/summary?event=${encodeURIComponent(eventId)}&lang=es&region=mx`;
  const response = await fetch(url);
  if (!response.ok) return null;

  const summary = {
    ...(await response.json()),
    scoreboardEvent: event,
    proveedor: "espn_football_summary"
  };
  apiSportsFootballCache.set(cacheKey, {
    createdAt: Date.now(),
    summary
  });
  return summary;
}

function getTotalEstadisticaFutbol(summary = null, autoFutbol = {}, marcador = null) {
  if (!summary || !autoFutbol) return null;
  if (autoFutbol.mercado === "total_corners") {
    return getCornersEquipoFutbol(summary, marcador)?.total ?? null;
  }
  if (autoFutbol.mercado === "total_tarjetas") {
    return getTarjetasEquipoFutbol(summary, marcador)?.total ?? null;
  }
  return null;
}

function getTotalEstadisticaGuardadaFutbol(autoFutbol = {}) {
  if (autoFutbol.mercado === "total_corners") {
    const total = getTotalCornersDesdeEquiposFutbol(autoFutbol.cornersEquipo) ?? Number(autoFutbol.totalCorners);
    return Number.isNaN(total) ? null : total;
  }
  if (autoFutbol.mercado === "total_tarjetas") {
    const total = getTotalTarjetasDesdeEquiposFutbol(autoFutbol.tarjetasEquipo) ?? Number(autoFutbol.totalTarjetas);
    return Number.isNaN(total) ? null : total;
  }
  return null;
}

function autoFutbolTieneStatsReglamentariasGuardadas(autoFutbol = {}) {
  if (!esMercadoEstadisticasFutbol(autoFutbol)) return false;
  if (autoFutbol.estadisticasTiempo !== getMarcadorTiempoReglamentarioMeta()) return false;
  if (getEstadisticaManualFutbol(autoFutbol)) return true;
  if (crearResumenEstadisticasGuardadasFutbol(autoFutbol)) return true;
  return getTotalEstadisticaGuardadaFutbol(autoFutbol) !== null;
}

function elegirResumenEstadisticasFutbol(apiSummary = null, espnSummary = null, autoFutbol = {}, marcador = null) {
  const apiTotal = getTotalEstadisticaFutbol(apiSummary, autoFutbol, marcador);
  const espnTotal = getTotalEstadisticaFutbol(espnSummary, autoFutbol, marcador);
  const guardadoTotal = getTotalEstadisticaGuardadaFutbol(autoFutbol);

  if (espnTotal !== null && apiTotal === null) return espnSummary;
  if (apiTotal !== null && espnTotal === null) return apiSummary;
  if (apiTotal === null && espnTotal === null) return apiSummary || espnSummary;

  const referencia = Math.max(apiTotal ?? -1, guardadoTotal ?? -1);
  if (espnTotal > referencia) return espnSummary;
  return apiSummary || espnSummary;
}

async function cargarResumenFutbol(apiGame, espnGame = null, options = {}) {
  let apiSummary = null;
  const juegoConAlargue = juegoFutbolTieneAlargueOPenales(apiGame) || juegoFutbolTieneAlargueOPenales(espnGame);
  const autoFutbol = options.autoFutbol || null;
  const marcador = options.marcador || getMarcadorFutbol(apiGame || espnGame);
  if (juegoConAlargue && autoFutbolTieneStatsReglamentariasGuardadas(autoFutbol)) {
    return crearResumenEstadisticasGuardadasFutbol(autoFutbol);
  }

  if (apiGame) {
    try {
      apiSummary = await cargarResumenApiSportsFutbol(apiGame);
    } catch (e) {
      console.warn("No se pudo cargar estadisticas API-Sports futbol:", e);
    }
  }

  if (juegoConAlargue && (!autoFutbol || !esMercadoEstadisticasFutbol(autoFutbol))) return apiSummary;

  const espnSummary = await cargarResumenEspnFutbol(espnGame);
  if (autoFutbol && esMercadoEstadisticasFutbol(autoFutbol)) {
    return elegirResumenEstadisticasFutbol(apiSummary, espnSummary, autoFutbol, marcador);
  }

  if (getCornersEquipoFutbol(apiSummary, marcador) || getTarjetasEquipoFutbol(apiSummary, marcador)) return apiSummary;
  if (getCornersEquipoFutbol(espnSummary, marcador) || getTarjetasEquipoFutbol(espnSummary, marcador)) return espnSummary;

  return apiSummary || espnSummary;
}

function getIdJuegoFutbol(game) {
  return game?.fixture?.id ?? game?.id;
}

function getLigaJuegoFutbol(game) {
  return game?.league?.name || game?.leagueLabel || "";
}

function getFechaJuegoFutbol(game) {
  return game?.fixture?.date || game?.date || game?.competitions?.[0]?.date || "";
}

function getEstadoJuegoFutbol(game) {
  const apiStatus = game?.fixture?.status;
  if (apiStatus) {
    const elapsed = apiStatus.elapsed ? ` ${apiStatus.elapsed}'` : "";
    return `${apiStatus.long || apiStatus.short || ""}${elapsed}`.trim();
  }
  return game?.status?.type?.detail || game?.status?.type?.description || "";
}

function toScoreNumberFutbol(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const numero = Number(value);
  return Number.isNaN(numero) ? NaN : numero;
}

function getMarcadorReglamentarioApiSports(event, lado) {
  const fulltime = toScoreNumberFutbol(event?.score?.fulltime?.[lado]);
  if (!Number.isNaN(fulltime)) return fulltime;
  if (juegoFutbolTieneAlargueOPenales(event)) return NaN;
  return toScoreNumberFutbol(event?.goals?.[lado]);
}

function getMarcadorTiempoReglamentarioMeta() {
  return FOOTBALL_MARKET_TIME_SCOPE;
}

function esEstadoAlargueOPenalesFutbol(estado = "") {
  const texto = normalizarEstadoExternoTexto(estado);
  return /\b(aet|after extra time|extra time|extra-time|overtime|over time|ot|prorroga|alargue|suplementario|tiempo suplementario|pen|penalties|penales|shootout|end regulation|end of regulation|fin del tiempo reglamentario)\b/.test(texto);
}

function getPeriodoJuegoFutbol(game = {}) {
  const apiStatus = game?.fixture?.status || {};
  const status = game?.status || {};
  const type = status.type || game?.competitions?.[0]?.status?.type || {};
  const competitionStatus = game?.competitions?.[0]?.status || {};
  const candidates = [
    apiStatus.period,
    status.period,
    type.period,
    competitionStatus.period,
    competitionStatus.type?.period
  ];

  for (const value of candidates) {
    const periodo = Number(value);
    if (!Number.isNaN(periodo) && periodo > 0) return periodo;
  }

  return 0;
}

function juegoFutbolTieneMarcadorReglamentarioCerrado(game = {}) {
  const fulltimeHome = toScoreNumberFutbol(game?.score?.fulltime?.home);
  const fulltimeAway = toScoreNumberFutbol(game?.score?.fulltime?.away);
  return !Number.isNaN(fulltimeHome) && !Number.isNaN(fulltimeAway);
}

function juegoFutbolTieneAlargueOPenales(game = {}) {
  const apiStatus = game?.fixture?.status || {};
  const apiShort = String(apiStatus.short || "").toUpperCase();
  if (["AET", "PEN", "ET", "BT", "P", "OT"].includes(apiShort)) return true;
  if (getPeriodoJuegoFutbol(game) > 2) return true;

  const statusRoot = game?.status || {};
  const competitionStatus = game?.competitions?.[0]?.status || {};
  const status = statusRoot.type || competitionStatus.type || {};
  const texto = [
    apiStatus.short,
    apiStatus.long,
    apiStatus.elapsed,
    apiStatus.extra,
    status.name,
    status.state,
    status.description,
    status.detail,
    status.shortDetail,
    statusRoot.displayClock,
    competitionStatus.displayClock
  ].filter(Boolean).join(" ");

  if (esEstadoAlargueOPenalesFutbol(texto)) return true;

  const competitors = game?.competitions?.[0]?.competitors || [];
  return competitors.some(item => {
    const lineas = Array.isArray(item.linescores) ? item.linescores : [];
    return lineas.some(line => {
      const periodo = Number(line.period ?? line.periodNumber ?? line.number ?? line.sequence);
      return !Number.isNaN(periodo) && periodo > 2;
    });
  });
}

function esPeriodoReglamentarioEspn(line = {}, index = 0) {
  const periodo = toScoreNumberFutbol(line.period ?? line.periodNumber ?? line.number ?? line.sequence);
  if (!Number.isNaN(periodo)) return periodo >= 1 && periodo <= 2;

  const texto = normalizarTextoMercado([
    line.displayName,
    line.name,
    line.label,
    line.shortDisplayName,
    line.abbreviation
  ].filter(Boolean).join(" "));

  if (/\b(1h|2h|1st|2nd|first half|second half|primer tiempo|segundo tiempo)\b/.test(texto)) return true;
  return index < 2;
}

function getScoreReglamentarioEspnCompetidor(item = {}, event = {}) {
  const lineas = Array.isArray(item.linescores) ? item.linescores : [];
  const reglamentarias = lineas
    .filter(esPeriodoReglamentarioEspn)
    .map(line => toScoreNumberFutbol(line.value ?? line.score ?? line.displayValue))
    .filter(value => !Number.isNaN(value));

  if (reglamentarias.length >= 2) {
    return reglamentarias.slice(0, 2).reduce((acc, value) => acc + value, 0);
  }

  if (juegoFutbolTieneAlargueOPenales(event)) return NaN;
  return toScoreNumberFutbol(item.score);
}

function getCompetidoresFutbol(event) {
  if (event?.fixture && event?.teams) {
    const homeScore = getMarcadorReglamentarioApiSports(event, "home");
    const awayScore = getMarcadorReglamentarioApiSports(event, "away");
    return [
      {
        homeAway: "home",
        score: homeScore,
        name: event.teams.home?.name || "",
        shortName: event.teams.home?.name || "",
        abbreviation: ""
      },
      {
        homeAway: "away",
        score: awayScore,
        name: event.teams.away?.name || "",
        shortName: event.teams.away?.name || "",
        abbreviation: ""
      }
    ];
  }

  const competitors = event?.competitions?.[0]?.competitors || [];
  return competitors.map(item => ({
    homeAway: item.homeAway,
    score: getScoreReglamentarioEspnCompetidor(item, event),
    name: item.team?.displayName || item.team?.name || item.team?.shortDisplayName || "",
    shortName: item.team?.shortDisplayName || item.team?.name || "",
    abbreviation: item.team?.abbreviation || ""
  }));
}

function scoreEquipoFutbol(equipoApuesta = "", competitor = {}) {
  const objetivo = normalizarClaveFutbol(equipoApuesta);
  const opciones = [competitor.name, competitor.shortName, competitor.abbreviation].map(normalizarClaveFutbol).filter(Boolean);
  if (!objetivo || opciones.length === 0) return 0;
  if (opciones.some(op => op === objetivo || op.includes(objetivo) || objetivo.includes(op))) return 1;

  const objetivoTokens = objetivo.split(" ").filter(t => t.length >= 3);
  const opcionesTokens = opciones.flatMap(op => op.split(" ").filter(t => t.length >= 3));
  if (!objetivoTokens.length || !opcionesTokens.length) return 0;
  const matchesObjetivo = objetivoTokens.filter(token => opcionesTokens.includes(token)).length;
  const matchesOpcion = opcionesTokens.filter(token => objetivoTokens.includes(token)).length;
  return Math.max(
    matchesObjetivo / Math.max(objetivoTokens.length, 1),
    matchesOpcion / Math.max(opcionesTokens.length, 1)
  );
}

function getTextoJuegoFutbol(game = {}) {
  const competidores = getCompetidoresFutbol(game)
    .flatMap(c => [c.name, c.shortName, c.abbreviation])
    .filter(Boolean);
  return [
    game?.name,
    game?.shortName,
    game?.league?.name,
    game?.leagueLabel,
    ...competidores
  ].filter(Boolean).join(" ");
}

function textoJuegoContieneEquiposFutbol(game = {}, equipos = []) {
  if (!Array.isArray(equipos) || equipos.length < 2) return false;
  const texto = normalizarClaveFutbol(getTextoJuegoFutbol(game));
  if (!texto) return false;
  return equipos.slice(0, 2).every(equipo => {
    const equipoNorm = normalizarClaveFutbol(equipo);
    if (!equipoNorm) return false;
    if (texto.includes(equipoNorm)) return true;

    const tokens = equipoNorm.split(" ").filter(token => token.length >= 3);
    return tokens.length > 0 && tokens.every(token => texto.includes(token));
  });
}

function buscarJuegoFutbol(juegos = [], equipos = [], fechaBet = "") {
  if (!Array.isArray(equipos) || equipos.length < 2) return null;

  let mejor = { game: null, score: 0 };
  juegos.forEach(game => {
    if (fechaBet) {
      const fechaJuego = obtenerFechaLocalEvent(game);
      if (fechaJuego && !sonFechasCercanas(fechaJuego, fechaBet)) return;
    }

    const competitors = getCompetidoresFutbol(game);
    if (competitors.length < 2) return;

    const scoreA = Math.max(...competitors.map(c => scoreEquipoFutbol(equipos[0], c)));
    const scoreB = Math.max(...competitors.map(c => scoreEquipoFutbol(equipos[1], c)));
    const total = scoreA + scoreB;
    if (total > mejor.score && scoreA >= 0.45 && scoreB >= 0.45) {
      mejor = { game, score: total };
    }
  });

  if (mejor.game) return mejor.game;

  return juegos.find(game => {
    if (fechaBet) {
      const fechaJuego = obtenerFechaLocalEvent(game);
      if (fechaJuego && !sonFechasCercanas(fechaJuego, fechaBet)) return false;
    }
    return textoJuegoContieneEquiposFutbol(game, equipos);
  }) || null;
}

function getEquiposBusquedaAutoMlb(autoMlb = {}, jugada = {}, evento = "") {
  const candidatos = [
    autoMlb?.equipos,
    jugada?.autoMlb?.equipos,
    detectarEquiposMlb(evento)
  ];
  return candidatos.find(equipos => Array.isArray(equipos) && equipos.length >= 2) || [];
}

function buscarJuegoEspnFutbol(juegos = [], equipos = [], fechaBet = "") {
  return buscarJuegoFutbol(juegos, equipos, fechaBet);
}

function autoFutbolTieneDatosJuego(autoFutbol = {}) {
  return Boolean(
    autoFutbol?.id ||
    autoFutbol?.liga ||
    autoFutbol?.estadoJuego ||
    autoFutbol?.estadoEspecial ||
    autoFutbol?.marcador ||
    autoFutbol?.totalGoles !== undefined ||
    autoFutbol?.totalCorners !== undefined ||
    autoFutbol?.cornersEquipo ||
    autoFutbol?.totalTarjetas !== undefined ||
    autoFutbol?.tarjetasEquipo ||
    autoFutbol?.fechaJuego ||
    autoFutbol?.pausaMedioTiempoHasta ||
    autoFutbol?.pausaEstadoEspecialHasta ||
    autoFutbol?.sincronizadoEn ||
    autoFutbol?.marcadorTiempo
  );
}

function juegoFutbolFinalizado(game) {
  const apiStatus = game?.fixture?.status?.short;
  if (apiStatus) return ["FT", "AET", "PEN", "AWD", "WO"].includes(apiStatus);

  const status = game?.status?.type || game?.competitions?.[0]?.status?.type || {};
  return status.completed === true || status.state === "post" || /\bfinal\b/i.test(status.description || status.detail || "");
}

function juegoFutbolReglamentarioProbablementeTerminado(game) {
  if (juegoFutbolFinalizado(game)) return true;
  if (juegoFutbolNoIniciado(game)) return false;
  if (!getMarcadorFutbol(game)) return false;
  if (juegoFutbolTieneMarcadorReglamentarioCerrado(game)) return true;
  if (juegoFutbolTieneAlargueOPenales(game)) return true;

  const minuto = getMinutoJuegoFutbol(game);
  if (minuto >= 90 && !juegoFutbolEnCurso(game)) return true;

  const fechaJuego = getFechaJuegoFutbol(game);
  if (!fechaJuego) return false;
  const inicio = new Date(fechaJuego);
  if (Number.isNaN(inicio.getTime())) return false;
  return Date.now() - inicio.getTime() >= FOOTBALL_REGULATION_CLOSE_GRACE_MS;
}

function juegoFutbolNoIniciado(game) {
  const fechaJuego = getFechaJuegoFutbol(game);
  const horaProgramadaPaso = fechaJuego ? fechaJuegoYaPaso(fechaJuego) : false;
  const apiStatus = game?.fixture?.status?.short;
  if (apiStatus) return ["NS", "TBD"].includes(apiStatus) && !horaProgramadaPaso;

  const status = game?.status?.type || game?.competitions?.[0]?.status?.type || {};
  const estadoPrevio = status.state === "pre" ||
    /\b(programado|scheduled|pre-game|pre game|not started)\b/i.test(status.description || status.detail || "");
  return estadoPrevio && !horaProgramadaPaso;
}

function juegoFutbolEnCurso(game) {
  const apiStatus = game?.fixture?.status;
  if (apiStatus) {
    const short = String(apiStatus.short || "").toUpperCase();
    if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE"].includes(short)) return true;
    if (["NS", "TBD", "FT", "AET", "PEN", "AWD", "WO", "PST", "CANC", "ABD"].includes(short)) return false;
    return Number(apiStatus.elapsed) > 0;
  }

  const status = game?.status?.type || game?.competitions?.[0]?.status?.type || {};
  const state = normalizarEstadoExternoTexto(status.state || status.name || "");
  const detail = normalizarEstadoExternoTexto(status.description || status.detail || status.shortDetail || "");
  if (status.completed === true || state === "post") return false;
  if (/\b(in|in progress|live)\b/.test(state)) return true;
  if (/\b(1st|2nd|first half|second half|halftime|half time|tiempo|live|in progress)\b/.test(detail)) return true;
  return false;
}

function juegoFutbolTieneResultadoUtil(game) {
  const marcador = getMarcadorFutbol(game);
  if (!marcador) return false;
  if (juegoFutbolFinalizado(game) || juegoFutbolEnCurso(game)) return true;
  if (juegoFutbolNoIniciado(game)) return false;

  const fechaJuego = getFechaJuegoFutbol(game);
  const horaProgramadaPaso = fechaJuego ? fechaJuegoYaPaso(fechaJuego) : false;
  if (!horaProgramadaPaso) return false;

  return marcador.total > 0;
}

function juegoFutbolTieneResultadoActualizado(game, autoFutbol = {}) {
  if (!juegoFutbolTieneResultadoUtil(game)) return false;

  const marcador = getMarcadorFutbol(game);
  const marcadorNuevo = marcador
    ? reordenarMarcadorTextoFutbol(obtenerMarcadorTextoFutbol(marcador, autoFutbol.equipos), autoFutbol.equipos)
    : "";
  const marcadorActual = autoFutbol?.marcador
    ? reordenarMarcadorTextoFutbol(autoFutbol.marcador, autoFutbol.equipos)
    : "";

  if (marcadorNuevo && marcadorNuevo !== marcadorActual) return true;

  return false;
}

function getMarcadorFutbol(game) {
  const competitors = getCompetidoresFutbol(game);
  const home = competitors.find(c => c.homeAway === "home") || competitors[0];
  const away = competitors.find(c => c.homeAway === "away") || competitors[1];
  if (!home || !away || Number.isNaN(home.score) || Number.isNaN(away.score)) return null;

  return {
    home: home.score,
    away: away.score,
    total: home.score + away.score,
    homeTeam: home.name,
    awayTeam: away.name
  };
}

function getMinutoJuegoFutbol(game = null) {
  const apiElapsed = Number(game?.fixture?.status?.elapsed);
  const apiExtra = Number(game?.fixture?.status?.extra);
  if (!Number.isNaN(apiElapsed) && apiElapsed > 0) {
    return !Number.isNaN(apiExtra) && apiExtra > 0 ? apiElapsed + apiExtra : apiElapsed;
  }

  const statusRoot = game?.status || {};
  const competitionStatus = game?.competitions?.[0]?.status || {};
  const status = statusRoot.type || competitionStatus.type || {};
  const texto = [
    status.shortDetail,
    status.detail,
    status.description,
    statusRoot.displayClock,
    competitionStatus.displayClock
  ].filter(Boolean).join(" ");

  const stoppage = texto.match(/\b(\d{1,3})\s*\+\s*(\d{1,2})\b/);
  if (stoppage) {
    const base = Number(stoppage[1]);
    const extra = Number(stoppage[2]);
    if (!Number.isNaN(base) && !Number.isNaN(extra)) return base + extra;
  }

  const match = texto.match(/\b(\d{1,3})(?:'| min)?\b/i);
  const minuto = match ? Number(match[1]) : NaN;
  return !Number.isNaN(minuto) && minuto > 0 ? minuto : 0;
}

function elegirJuegoFutbolMasReciente(apiGame = null, espnGame = null) {
  if (!apiGame) return espnGame;
  if (!espnGame) return apiGame;

  const apiFinalizado = juegoFutbolFinalizado(apiGame);
  const espnFinalizado = juegoFutbolFinalizado(espnGame);
  if (apiFinalizado && !espnFinalizado) return apiGame;
  if (espnFinalizado && !apiFinalizado) return espnGame;

  const apiMarcador = getMarcadorFutbol(apiGame);
  const espnMarcador = getMarcadorFutbol(espnGame);
  if (!apiMarcador) return espnGame;
  if (!espnMarcador) return apiGame;

  const apiEnCurso = juegoFutbolEnCurso(apiGame);
  const espnEnCurso = juegoFutbolEnCurso(espnGame);
  if (espnMarcador.total > apiMarcador.total) return espnGame;
  if (apiMarcador.total > espnMarcador.total) return apiGame;

  if (apiEnCurso && espnEnCurso) {
    const apiMinuto = getMinutoJuegoFutbol(apiGame);
    const espnMinuto = getMinutoJuegoFutbol(espnGame);
    if (espnMinuto > apiMinuto) return espnGame;
    if (apiMinuto > espnMinuto) return apiGame;
  }

  if (espnEnCurso && !apiEnCurso) return espnGame;
  if (apiEnCurso && !espnEnCurso) return apiGame;
  return apiGame;
}

function calcularResumenYEstadisticas() {
  let invertido = 0;
  let retornado = 0;
  let pendiente = 0;
  let ganadas = 0;
  let perdidas = 0;
  let nulas = 0;
  let pendientes = 0;

  getApuestasFiltradas().forEach(a => {
    if (a.resultado === "pendiente") {
      pendiente += a.importe || 0;
      pendientes++;
    } else {
      invertido += a.importe || 0;
      retornado += calcularRetornoApuesta(a);
      if (a.resultado === "ganada") ganadas++;
      else if (a.resultado === "perdida") perdidas++;
      else if (a.resultado === "nula") nulas++;
    }
  });

  const casasResumen = getCasasParaResumen();
  const bankrollInicial = casasResumen.reduce((acc, c) => acc + (parseFloat(c.bankrollInicial) || 0), 0);
  const bankrollAjuste = casasResumen.reduce((acc, c) => acc + (parseFloat(c.ajuste) || 0), 0);
  const balance = retornado - invertido;
  const totalStats = ganadas + perdidas + nulas + pendientes || 1;

  return {
    resumen: {
      invertido,
      retornado,
      pendiente,
      balance,
      bankrollInicial,
      bankrollAjuste,
      bankrollFinal: bankrollInicial + balance + bankrollAjuste - pendiente
    },
    stats: {
      pGanadas: (ganadas / totalStats) * 100,
      pPerdidas: (perdidas / totalStats) * 100,
      pNulas: (nulas / totalStats) * 100,
      pPendientes: (pendientes / totalStats) * 100
    }
  };
}

function elegirJuegoFutbolPrincipal(apiGame = null, espnGame = null, autoFutbol = null) {
  const apiFinalizado = juegoFutbolFinalizado(apiGame);
  const espnFinalizado = juegoFutbolFinalizado(espnGame);
  if (apiFinalizado && !espnFinalizado) return apiGame;
  if (espnFinalizado && !apiFinalizado) return espnGame;

  if (autoFutbol) {
    const apiActualizado = juegoFutbolTieneResultadoActualizado(apiGame, autoFutbol);
    const espnActualizado = juegoFutbolTieneResultadoActualizado(espnGame, autoFutbol);
    if (apiActualizado && espnActualizado) return elegirJuegoFutbolMasReciente(apiGame, espnGame);
    if (espnActualizado) return espnGame;
    if (apiActualizado) return apiGame;
  }
  if (juegoFutbolTieneResultadoUtil(apiGame) && juegoFutbolTieneResultadoUtil(espnGame)) {
    return elegirJuegoFutbolMasReciente(apiGame, espnGame);
  }
  if (juegoFutbolTieneResultadoUtil(espnGame)) return espnGame;
  if (juegoFutbolTieneResultadoUtil(apiGame)) return apiGame;
  return apiGame || espnGame;
}

function reordenarMarcadorTextoFutbol(marcadorTexto, equipos) {
  if (!marcadorTexto || !equipos || equipos.length < 2) return marcadorTexto;

  const match = marcadorTexto.match(/^(.+?)\s+(\d+)\s*-\s*(\d+)\s+(.+)$/);
  if (!match) return marcadorTexto;

  const teamLeft = match[1].trim();
  const scoreLeft = match[2];
  const scoreRight = match[3];
  const teamRight = match[4].trim();

  const eq0 = equipos[0];
  const scoreEq0Left = scoreEquipoFutbol(eq0, { name: teamLeft });
  const scoreEq0Right = scoreEquipoFutbol(eq0, { name: teamRight });

  if (scoreEq0Left >= scoreEq0Right) {
    return `${teamLeft} ${scoreLeft} - ${scoreRight} ${teamRight}`;
  } else {
    return `${teamRight} ${scoreRight} - ${scoreLeft} ${teamLeft}`;
  }
}

function obtenerMarcadorTextoFutbol(marcador, equipos) {
  if (!marcador) return "";
  const eq0 = equipos?.[0];
  const eq1 = equipos?.[1];
  if (!eq0 || !eq1) {
    return `${marcador.awayTeam} ${marcador.away} - ${marcador.home} ${marcador.homeTeam}`;
  }
  const scoreEq0Home = scoreEquipoFutbol(eq0, { name: marcador.homeTeam });
  const scoreEq0Away = scoreEquipoFutbol(eq0, { name: marcador.awayTeam });
  if (scoreEq0Home >= scoreEq0Away) {
    return `${marcador.homeTeam} ${marcador.home} - ${marcador.away} ${marcador.awayTeam}`;
  } else {
    return `${marcador.awayTeam} ${marcador.away} - ${marcador.home} ${marcador.homeTeam}`;
  }
}

function obtenerCornersDetalleEnOrden(cornersEquipo, equipos) {
  if (!cornersEquipo?.home || !cornersEquipo?.away) return "";
  const awayName = cornersEquipo.away.name || "Visitante";
  const homeName = cornersEquipo.home.name || "Local";
  const awayCorners = cornersEquipo.away.corners;
  const homeCorners = cornersEquipo.home.corners;

  const eq0 = equipos?.[0];
  const eq1 = equipos?.[1];
  if (!eq0 || !eq1) {
    return `${escapeHtml(awayName)} ${escapeHtml(awayCorners)} - ${escapeHtml(homeCorners)} ${escapeHtml(homeName)}`;
  }

  const scoreEq0Home = scoreEquipoFutbol(eq0, { name: homeName });
  const scoreEq0Away = scoreEquipoFutbol(eq0, { name: awayName });

  if (scoreEq0Home >= scoreEq0Away) {
    return `${escapeHtml(homeName)} ${escapeHtml(homeCorners)} - ${escapeHtml(awayCorners)} ${escapeHtml(awayName)}`;
  } else {
    return `${escapeHtml(awayName)} ${escapeHtml(awayCorners)} - ${escapeHtml(homeCorners)} ${escapeHtml(homeName)}`;
  }
}

function obtenerTarjetasDetalleEnOrden(tarjetasEquipo, equipos) {
  if (!tarjetasEquipo?.home || !tarjetasEquipo?.away) return "";
  const awayName = tarjetasEquipo.away.name || "Visitante";
  const homeName = tarjetasEquipo.home.name || "Local";
  const awayTarjetas = tarjetasEquipo.away.tarjetas;
  const homeTarjetas = tarjetasEquipo.home.tarjetas;

  const eq0 = equipos?.[0];
  const eq1 = equipos?.[1];
  if (!eq0 || !eq1) {
    return `${escapeHtml(awayName)} ${escapeHtml(awayTarjetas)} - ${escapeHtml(homeTarjetas)} ${escapeHtml(homeName)}`;
  }

  const scoreEq0Home = scoreEquipoFutbol(eq0, { name: homeName });
  const scoreEq0Away = scoreEquipoFutbol(eq0, { name: awayName });

  if (scoreEq0Home >= scoreEq0Away) {
    return `${escapeHtml(homeName)} ${escapeHtml(homeTarjetas)} - ${escapeHtml(awayTarjetas)} ${escapeHtml(awayName)}`;
  } else {
    return `${escapeHtml(awayName)} ${escapeHtml(awayTarjetas)} - ${escapeHtml(homeTarjetas)} ${escapeHtml(homeName)}`;
  }
}

function getTotalCornersDesdeEquiposFutbol(cornersEquipo = {}) {
  const home = Number(cornersEquipo?.home?.corners);
  const away = Number(cornersEquipo?.away?.corners);
  return Number.isNaN(home) || Number.isNaN(away) ? null : home + away;
}

function getTotalTarjetasDesdeEquiposFutbol(tarjetasEquipo = {}) {
  const home = Number(tarjetasEquipo?.home?.tarjetas);
  const away = Number(tarjetasEquipo?.away?.tarjetas);
  return Number.isNaN(home) || Number.isNaN(away) ? null : home + away;
}

function getCornersEquipoFallbackFutbol(autoFutbol = {}) {
  const total = Number(autoFutbol.totalCorners);
  if (Number.isNaN(total)) return null;

  const equipos = Array.isArray(autoFutbol.equipos) ? autoFutbol.equipos : [];
  const nombres = autoFutbol.marcador
    ? String(autoFutbol.marcador).split(/\s+\d+\s*-\s*\d+\s+/).map(item => item.trim()).filter(Boolean)
    : [];
  const awayName = equipos[0] || nombres[0] || "Visitante";
  const homeName = equipos[1] || nombres[1] || "Local";

  if (total === 0) {
    return {
      total: 0,
      away: { name: awayName, corners: 0 },
      home: { name: homeName, corners: 0 }
    };
  }

  return null;
}

function getTarjetasEquipoFallbackFutbol(autoFutbol = {}) {
  const total = Number(autoFutbol.totalTarjetas);
  if (Number.isNaN(total)) return null;

  const equipos = Array.isArray(autoFutbol.equipos) ? autoFutbol.equipos : [];
  const nombres = autoFutbol.marcador
    ? String(autoFutbol.marcador).split(/\s+\d+\s*-\s*\d+\s+/).map(item => item.trim()).filter(Boolean)
    : [];
  const awayName = equipos[0] || nombres[0] || "Visitante";
  const homeName = equipos[1] || nombres[1] || "Local";

  if (total === 0) {
    return {
      total: 0,
      away: { name: awayName, tarjetas: 0 },
      home: { name: homeName, tarjetas: 0 }
    };
  }

  return null;
}

function getCornersInicialesFutbol(marcador = null) {
  if (!marcador) return null;
  return {
    total: 0,
    home: { name: marcador.homeTeam, corners: 0 },
    away: { name: marcador.awayTeam, corners: 0 }
  };
}

function getTarjetasInicialesFutbol(marcador = null) {
  if (!marcador) return null;
  return {
    total: 0,
    home: { name: marcador.homeTeam, tarjetas: 0 },
    away: { name: marcador.awayTeam, tarjetas: 0 }
  };
}

function crearResumenEstadisticasGuardadasFutbol(autoFutbol = {}) {
  const teams = [];

  if (autoFutbol.mercado === "total_corners" && autoFutbol.cornersEquipo?.home && autoFutbol.cornersEquipo?.away) {
    [autoFutbol.cornersEquipo.home, autoFutbol.cornersEquipo.away].forEach(team => {
      teams.push({
        team: {
          displayName: team.name || "",
          name: team.name || "",
          shortDisplayName: team.name || "",
          abbreviation: ""
        },
        statistics: [{ name: "wonCorners", value: team.corners, displayValue: String(team.corners) }]
      });
    });
  }

  if (autoFutbol.mercado === "total_tarjetas" && autoFutbol.tarjetasEquipo?.home && autoFutbol.tarjetasEquipo?.away) {
    [autoFutbol.tarjetasEquipo.home, autoFutbol.tarjetasEquipo.away].forEach(team => {
      teams.push({
        team: {
          displayName: team.name || "",
          name: team.name || "",
          shortDisplayName: team.name || "",
          abbreviation: ""
        },
        statistics: [{ name: "totalCards", value: team.tarjetas, displayValue: String(team.tarjetas) }]
      });
    });
  }

  return teams.length ? { boxscore: { teams }, proveedor: "auto_futbol_guardado_reglamentario" } : null;
}

function normalizarNumeroEstadisticaFutbol(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numero = Number(String(value).replace("%", "").trim());
    if (!Number.isNaN(numero)) return numero;
  }
  return null;
}

function extraerValorCornersFutbol(stat = {}) {
  const etiqueta = normalizarTextoMercado(
    stat.name || stat.type || stat.displayName || stat.label || stat.key || ""
  );
  if (!/\b(corner|corners|cornerkick|cornerkicks|corner kick|corner kicks|woncorners|won corners|esquina|esquinas)\b/.test(etiqueta)) return null;

  return normalizarNumeroEstadisticaFutbol(stat.value, stat.displayValue);
}

function extraerValorTarjetasFutbol(stat = {}) {
  const etiqueta = normalizarTextoMercado(
    stat.name || stat.type || stat.displayName || stat.label || stat.key || ""
  );
  if (!/\b(yellow cards?|yellowcards?|red cards?|redcards?|tarjetas? amarillas?|tarjetas? rojas?|amarillas?|rojas?)\b/.test(etiqueta)) {
    return null;
  }

  return normalizarNumeroEstadisticaFutbol(stat.value, stat.displayValue);
}

function getEquiposEstadisticasEspn(summary = {}) {
  const boxscoreTeams = Array.isArray(summary?.boxscore?.teams) ? summary.boxscore.teams : [];
  const scoreboardCompetitors = Array.isArray(summary?.scoreboardEvent?.competitions?.[0]?.competitors)
    ? summary.scoreboardEvent.competitions[0].competitors.map(item => ({
      team: item.team || {},
      statistics: item.statistics || item.stats || []
    }))
    : [];

  return [...boxscoreTeams, ...scoreboardCompetitors];
}

function getCornersEquipoFutbol(summary, marcador = null) {
  const apiSportsStatistics = Array.isArray(summary?.apiSportsStatistics)
    ? summary.apiSportsStatistics.map(teamInfo => {
      const corners = (teamInfo.statistics || [])
        .map(extraerValorCornersFutbol)
        .find(value => value !== null);
      if (corners === undefined) return null;
      return {
        team: {
          displayName: teamInfo.team?.name || "",
          name: teamInfo.team?.name || "",
          shortDisplayName: teamInfo.team?.name || "",
          abbreviation: ""
        },
        statistics: [{ name: "wonCorners", value: corners, displayValue: String(corners) }]
      };
    }).filter(Boolean)
    : [];
  const teams = apiSportsStatistics.length ? apiSportsStatistics : getEquiposEstadisticasEspn(summary);
  if (!Array.isArray(teams) || teams.length === 0) return null;

  const cornersEquipos = teams.map(teamInfo => {
    const stat = (teamInfo.statistics || []).find(item =>
      item.name === "wonCorners" || extraerValorCornersFutbol(item) !== null
    );
    const value = stat ? normalizarNumeroEstadisticaFutbol(stat.value, stat.displayValue) : null;
    if (!stat || value === null) return null;

    return {
      name: teamInfo.team?.displayName || teamInfo.team?.name || teamInfo.team?.shortDisplayName || "",
      shortName: teamInfo.team?.shortDisplayName || teamInfo.team?.name || "",
      abbreviation: teamInfo.team?.abbreviation || "",
      corners: value
    };
  }).filter(Boolean);

  if (cornersEquipos.length === 0) return null;

  let home = null;
  let away = null;

  if (marcador) {
    home = cornersEquipos.find(team => scoreEquipoFutbol(marcador.homeTeam, team) >= 0.45) || null;
    away = cornersEquipos.find(team => scoreEquipoFutbol(marcador.awayTeam, team) >= 0.45) || null;
  }

  if ((!home || !away) && cornersEquipos.length >= 2) {
    home = home || cornersEquipos[0];
    away = away || cornersEquipos.find(team => team !== home) || cornersEquipos[1];
  }

  const totalPartido = home && away
    ? getTotalCornersDesdeEquiposFutbol({
      home: { corners: home.corners },
      away: { corners: away.corners }
    })
    : cornersEquipos.reduce((sum, team) => sum + team.corners, 0);

  return {
    total: totalPartido,
    home: home ? { name: home.name, corners: home.corners } : null,
    away: away ? { name: away.name, corners: away.corners } : null
  };
}

function getScoreEquipoMarcadorFutbol(equipo = "", marcador) {
  if (!marcador) return null;
  const homeScore = scoreEquipoFutbol(equipo, { name: marcador.homeTeam });
  const awayScore = scoreEquipoFutbol(equipo, { name: marcador.awayTeam });
  if (homeScore >= awayScore && homeScore >= 0.45) {
    return { seleccionado: marcador.home, rival: marcador.away, nombre: marcador.homeTeam };
  }
  if (awayScore >= 0.45) {
    return { seleccionado: marcador.away, rival: marcador.home, nombre: marcador.awayTeam };
  }
  return null;
}

function getTotalGolesObjetivoFutbol(autoFutbol = {}, marcador = null) {
  if (!marcador) return null;
  if (!autoFutbol?.seleccionEquipo) return marcador.total;
  const equipo = getScoreEquipoMarcadorFutbol(autoFutbol.seleccionEquipo, marcador);
  return equipo ? equipo.seleccionado : null;
}

function getValorEstadisticaEquipoFutbol(equipoStats = {}, equipo = "", campo = "") {
  if (!equipo) return equipoStats?.total ?? null;
  const candidatos = [equipoStats?.home, equipoStats?.away].filter(Boolean);
  const encontrado = candidatos
    .map(item => ({
      item,
      score: scoreEquipoFutbol(equipo, { name: item.name || "" })
    }))
    .filter(({ score }) => score >= 0.45)
    .sort((a, b) => b.score - a.score)[0]?.item;
  if (!encontrado) return null;
  const value = Number(encontrado[campo]);
  return Number.isNaN(value) ? null : value;
}

function getTotalCornersObjetivoFutbol(autoFutbol = {}, cornersEquipo = {}) {
  return getValorEstadisticaEquipoFutbol(cornersEquipo, autoFutbol.seleccionEquipo, "corners");
}

function getTotalTarjetasObjetivoFutbol(autoFutbol = {}, tarjetasEquipo = {}) {
  return getValorEstadisticaEquipoFutbol(tarjetasEquipo, autoFutbol.seleccionEquipo, "tarjetas");
}

function crearJuegoFutbolDesdeAutoFutbol(autoFutbol = {}) {
  if (!autoFutbol?.marcador || !esEstadoJuegoFinalizado(autoFutbol.estadoJuego)) return null;
  if (
    autoFutbol.marcadorTiempo !== getMarcadorTiempoReglamentarioMeta() &&
    esEstadoAlargueOPenalesFutbol(autoFutbol.estadoJuego)
  ) {
    return null;
  }

  const marcadorTexto = String(autoFutbol.marcador).replace(/\s+·.*$/g, "").trim();
  const match = marcadorTexto.match(/^(.+?)\s+(\d+)\s*[-–—]\s*(\d+)\s+(.+)$/);
  if (!match) return null;

  const homeName = match[1].trim();
  const awayName = match[4].trim();
  const homeScore = Number(match[2]);
  const awayScore = Number(match[3]);
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore) || !homeName || !awayName) return null;

  return {
    fixture: {
      id: autoFutbol.id,
      date: autoFutbol.fechaJuego || "",
      status: {
        short: "FT",
        long: autoFutbol.estadoJuego || "Match Finished",
        elapsed: 90
      }
    },
    teams: {
      home: { name: homeName },
      away: { name: awayName }
    },
    goals: {
      home: homeScore,
      away: awayScore
    },
    league: {
      name: autoFutbol.liga || ""
    }
  };
}

function getTarjetasEquipoFutbol(summary, marcador = null) {
  const apiSportsStatistics = Array.isArray(summary?.apiSportsStatistics)
    ? summary.apiSportsStatistics.map(teamInfo => {
      const tarjetas = (teamInfo.statistics || [])
        .map(extraerValorTarjetasFutbol)
        .filter(value => value !== null)
        .reduce((sum, value) => sum + value, 0);
      const tieneTarjetas = (teamInfo.statistics || []).some(stat => extraerValorTarjetasFutbol(stat) !== null);
      if (!tieneTarjetas) return null;
      return {
        team: {
          displayName: teamInfo.team?.name || "",
          name: teamInfo.team?.name || "",
          shortDisplayName: teamInfo.team?.name || "",
          abbreviation: ""
        },
        statistics: [{ name: "totalCards", value: tarjetas, displayValue: String(tarjetas) }]
      };
    }).filter(Boolean)
    : [];
  const teams = apiSportsStatistics.length ? apiSportsStatistics : getEquiposEstadisticasEspn(summary);
  if (!Array.isArray(teams) || teams.length === 0) return null;

  const tarjetasEquipos = teams.map(teamInfo => {
    const stats = teamInfo.statistics || [];
    const statTotal = stats.find(item => item.name === "totalCards");
    const tarjetas = statTotal
      ? normalizarNumeroEstadisticaFutbol(statTotal.value, statTotal.displayValue)
      : stats.map(extraerValorTarjetasFutbol)
        .filter(value => value !== null)
        .reduce((sum, value) => sum + value, 0);
    const tieneTarjetas = Boolean(statTotal) || stats.some(item => extraerValorTarjetasFutbol(item) !== null);
    if (!tieneTarjetas || tarjetas === null || Number.isNaN(tarjetas)) return null;

    return {
      name: teamInfo.team?.displayName || teamInfo.team?.name || teamInfo.team?.shortDisplayName || "",
      shortName: teamInfo.team?.shortDisplayName || teamInfo.team?.name || "",
      abbreviation: teamInfo.team?.abbreviation || "",
      tarjetas
    };
  }).filter(Boolean);

  if (tarjetasEquipos.length === 0) return null;

  let home = null;
  let away = null;

  if (marcador) {
    home = tarjetasEquipos.find(team => scoreEquipoFutbol(marcador.homeTeam, team) >= 0.45) || null;
    away = tarjetasEquipos.find(team => scoreEquipoFutbol(marcador.awayTeam, team) >= 0.45) || null;
  }

  if ((!home || !away) && tarjetasEquipos.length >= 2) {
    home = home || tarjetasEquipos[0];
    away = away || tarjetasEquipos.find(team => team !== home) || tarjetasEquipos[1];
  }

  const totalPartido = home && away
    ? getTotalTarjetasDesdeEquiposFutbol({
      home: { tarjetas: home.tarjetas },
      away: { tarjetas: away.tarjetas }
    })
    : tarjetasEquipos.reduce((sum, team) => sum + team.tarjetas, 0);

  return {
    total: totalPartido,
    home: home ? { name: home.name, tarjetas: home.tarjetas } : null,
    away: away ? { name: away.name, tarjetas: away.tarjetas } : null
  };
}

function getTotalCornersFutbol(summary) {
  return getCornersEquipoFutbol(summary)?.total ?? null;
}

function getTotalTarjetasFutbol(summary) {
  return getTarjetasEquipoFutbol(summary)?.total ?? null;
}

function esMercadoEstadisticasFutbol(autoFutbol = {}) {
  return autoFutbol?.mercado === "total_corners" || autoFutbol?.mercado === "total_tarjetas";
}

function getEstadisticaManualFutbol(autoFutbol = {}) {
  const ajuste = autoFutbol?.ajusteManual;
  if (!ajuste || ajuste.mercado !== autoFutbol.mercado) return null;

  const home = Number(ajuste.home);
  const away = Number(ajuste.away);
  if (Number.isNaN(home) || Number.isNaN(away)) return null;

  const homeName = ajuste.homeName || autoFutbol.cornersEquipo?.home?.name || autoFutbol.tarjetasEquipo?.home?.name || "Local";
  const awayName = ajuste.awayName || autoFutbol.cornersEquipo?.away?.name || autoFutbol.tarjetasEquipo?.away?.name || "Visitante";

  if (autoFutbol.mercado === "total_corners") {
    return {
      total: home + away,
      home: { name: homeName, corners: home },
      away: { name: awayName, corners: away }
    };
  }

  if (autoFutbol.mercado === "total_tarjetas") {
    return {
      total: home + away,
      home: { name: homeName, tarjetas: home },
      away: { name: awayName, tarjetas: away }
    };
  }

  return null;
}

function evaluarAutoFutbol(autoFutbol, game, summary = null) {
  if (!autoFutbol) return null;
  if (juegoFutbolNoIniciado(game)) return null;
  const marcador = getMarcadorFutbol(game);
  if (!marcador) return null;
  const finalizado = juegoFutbolReglamentarioProbablementeTerminado(game);

  if (autoFutbol.mercado === "ganador_partido") {
    if (!finalizado) return null;
    if (marcador.home === marcador.away) {
      return { estado: autoFutbol.seleccion === "empate" ? "ganada" : "perdida", marcador };
    }

    const ganador = marcador.home > marcador.away ? marcador.homeTeam : marcador.awayTeam;
    return {
      estado: normalizarClaveFutbol(ganador).includes(normalizarClaveFutbol(autoFutbol.seleccionEquipo)) ||
        normalizarClaveFutbol(autoFutbol.seleccionEquipo).includes(normalizarClaveFutbol(ganador))
        ? "ganada"
        : "perdida",
      marcador
    };
  }

  if (autoFutbol.mercado === "doble_oportunidad") {
    if (!finalizado) return null;
    if (marcador.home === marcador.away) {
      return { estado: autoFutbol.incluyeEmpate !== false ? "ganada" : "perdida", marcador };
    }

    const ganador = marcador.home > marcador.away ? marcador.homeTeam : marcador.awayTeam;
    const selecciones = Array.isArray(autoFutbol.seleccionEquipos) && autoFutbol.seleccionEquipos.length
      ? autoFutbol.seleccionEquipos
      : [autoFutbol.seleccionEquipo].filter(Boolean);
    if (autoFutbol.incluyeEmpate === false && selecciones.length >= 2) {
      return { estado: "ganada", marcador };
    }
    return {
      estado: selecciones.some(equipo =>
        normalizarClaveFutbol(ganador).includes(normalizarClaveFutbol(equipo)) ||
        normalizarClaveFutbol(equipo).includes(normalizarClaveFutbol(ganador))
      )
        ? "ganada"
        : "perdida",
      marcador
    };
  }

  if (autoFutbol.mercado === "handicap") {
    if (!finalizado) return null;
    const linea = Number(autoFutbol.linea);
    const equipo = getScoreEquipoMarcadorFutbol(autoFutbol.seleccionEquipo, marcador);
    if (Number.isNaN(linea) || !equipo) return null;
    const ajustado = equipo.seleccionado + linea;
    if (ajustado === equipo.rival) return { estado: "nula", marcador };
    return {
      estado: ajustado > equipo.rival ? "ganada" : "perdida",
      marcador
    };
  }

  if (autoFutbol.mercado === "total_goles") {
    const linea = Number(autoFutbol.linea);
    if (Number.isNaN(linea)) return null;
    const totalGolesObjetivo = getTotalGolesObjetivoFutbol(autoFutbol, marcador);
    if (totalGolesObjetivo === null) return null;
    if (!finalizado) {
      if (autoFutbol.tipoTotal === "over" && totalGolesObjetivo > linea) return { estado: "ganada", marcador, totalGoles: totalGolesObjetivo };
      if (autoFutbol.tipoTotal === "under" && totalGolesObjetivo > linea) return { estado: "perdida", marcador, totalGoles: totalGolesObjetivo };
      return null;
    }
    if (totalGolesObjetivo === linea) return { estado: "nula", marcador, totalGoles: totalGolesObjetivo };
    const ganaOver = totalGolesObjetivo > linea;
    return {
      estado: (autoFutbol.tipoTotal === "over" ? ganaOver : !ganaOver) ? "ganada" : "perdida",
      marcador,
      totalGoles: totalGolesObjetivo
    };
  }

  if (autoFutbol.mercado === "ambos_marcan") {
    const ambosMarcaron = marcador.home > 0 && marcador.away > 0;
    if (!finalizado && ambosMarcaron) {
      return {
        estado: autoFutbol.seleccion === "no" ? "perdida" : "ganada",
        marcador
      };
    }
    if (!finalizado) return null;
    return {
      estado: (autoFutbol.seleccion === "no" ? !ambosMarcaron : ambosMarcaron) ? "ganada" : "perdida",
      marcador
    };
  }

  if (autoFutbol.mercado === "total_corners") {
    const cornersEquipo = getEstadisticaManualFutbol(autoFutbol) || getCornersEquipoFutbol(summary, marcador);
    const totalCorners = getTotalCornersObjetivoFutbol(autoFutbol, cornersEquipo);
    const linea = Number(autoFutbol.linea);
    if (totalCorners === null || Number.isNaN(linea)) return null;
    if (!finalizado) {
      if (autoFutbol.tipoTotal === "over" && totalCorners > linea) return { estado: "ganada", marcador, totalCorners, cornersEquipo };
      if (autoFutbol.tipoTotal === "under" && totalCorners > linea) return { estado: "perdida", marcador, totalCorners, cornersEquipo };
      return null;
    }
    if (totalCorners === linea) return { estado: "nula", marcador, totalCorners, cornersEquipo };
    const ganaOver = totalCorners > linea;
    return {
      estado: (autoFutbol.tipoTotal === "over" ? ganaOver : !ganaOver) ? "ganada" : "perdida",
      marcador,
      totalCorners,
      cornersEquipo
    };
  }

  if (autoFutbol.mercado === "total_tarjetas") {
    const tarjetasEquipo = getEstadisticaManualFutbol(autoFutbol) || getTarjetasEquipoFutbol(summary, marcador);
    const totalTarjetas = getTotalTarjetasObjetivoFutbol(autoFutbol, tarjetasEquipo);
    const linea = Number(autoFutbol.linea);
    if (totalTarjetas === null || Number.isNaN(linea)) return null;
    if (!finalizado) {
      if (autoFutbol.tipoTotal === "over" && totalTarjetas > linea) return { estado: "ganada", marcador, totalTarjetas, tarjetasEquipo };
      if (autoFutbol.tipoTotal === "under" && totalTarjetas > linea) return { estado: "perdida", marcador, totalTarjetas, tarjetasEquipo };
      return null;
    }
    if (totalTarjetas === linea) return { estado: "nula", marcador, totalTarjetas, tarjetasEquipo };
    const ganaOver = totalTarjetas > linea;
    return {
      estado: (autoFutbol.tipoTotal === "over" ? ganaOver : !ganaOver) ? "ganada" : "perdida",
      marcador,
      totalTarjetas,
      tarjetasEquipo
    };
  }

  return null;
}

async function aplicarResultadoFutbolApuesta(apuesta, juegosFecha = [], juegosEspnFecha = []) {
  const fechaBet = apuesta.fecha || apuesta.dia;
  const jugadas = normalizarJugadasConEstado(apuesta.jugadas || []);
  let huboCambio = false;
  let huboCambioMetadata = false;

  const nuevasJugadas = [];

  for (const jugada of jugadas) {
    await cederControlNavegador();
    if (typeof jugada !== "object" || !jugada) {
      nuevasJugadas.push(jugada);
      continue;
    }

    const ev = jugada.ev || jugada.evento || apuesta.evento || "";
    const selections = [];

    for (const sel of getSelectionsFromJugada(jugada)) {
      await cederControlNavegador();
      const autoOriginal = sel.autoFutbol || null;
      const autoDetectado = crearAutoFutbolSeleccion({
        evento: ev,
        titulo: sel.titulo || "",
        jugada: sel.jugadaOriginal || sel.jugada || ""
      });
      let autoFutbol = combinarAutoFutbolConDetectado(autoOriginal, autoDetectado);
      if (!autoFutbol) {
        const jugadaText = sel.jugada || sel.titulo || "";
        const juegosDescubrimiento = [...juegosEspnFecha, ...juegosFecha];
        if (jugadaText && juegosDescubrimiento.length > 0) {
          const foundGame = buscarJuegoFutbolFallback(juegosDescubrimiento, jugadaText, fechaBet);
          if (foundGame) {
            const competidores = getCompetidoresFutbol(foundGame);
            const nombresEquipos = competidores.map(c => c.name).filter(Boolean);
            const foundEv = nombresEquipos.join(" vs ");
            const nuevoAuto = crearAutoFutbolSeleccion({ evento: foundEv, titulo: sel.titulo || "", jugada: sel.jugada || "" });
            if (nuevoAuto) {
              autoFutbol = nuevoAuto;
              huboCambioMetadata = true;
            }
          }
        }
      }
      if (!autoFutbol) {
        selections.push(sel);
        continue;
      }

      if (!autoOriginal || JSON.stringify(autoOriginal) !== JSON.stringify(autoFutbol)) huboCambioMetadata = true;
      const selConDetalle = aplicarDetalleAutoFutbolSeleccion(sel, autoFutbol, ev);
      if (selConDetalle.titulo !== sel.titulo || selConDetalle.jugada !== sel.jugada) {
        huboCambioMetadata = true;
      }
      const apiGame = buscarJuegoFutbol(juegosFecha, autoFutbol.equipos, fechaBet);
      const espnGame = buscarJuegoEspnFutbol(juegosEspnFecha, autoFutbol.equipos, fechaBet);
      const game = elegirJuegoFutbolPrincipal(apiGame, espnGame, autoFutbol);
      if (!game) {
        const gameGuardado = crearJuegoFutbolDesdeAutoFutbol(autoFutbol);
        const evaluacionGuardada = gameGuardado ? evaluarAutoFutbol(autoFutbol, gameGuardado, null) : null;
        if (evaluacionGuardada) {
          const targetFechaJuego = getFechaJuegoFutbol(gameGuardado) || autoFutbol.fechaJuego;
          const estadoJuego = getEstadoJuegoFutbol(gameGuardado) || autoFutbol.estadoJuego || "Final";
          if ((sel.estado || "pendiente") !== evaluacionGuardada.estado) huboCambio = true;
          selections.push({
            ...selConDetalle,
            estado: evaluacionGuardada.estado,
            autoFutbol: {
              ...autoFutbol,
              estadoJuego,
              estadoEspecial: null,
              marcador: obtenerMarcadorTextoFutbol(evaluacionGuardada.marcador, autoFutbol.equipos),
              marcadorTiempo: getMarcadorTiempoReglamentarioMeta(),
              fechaJuego: targetFechaJuego,
              sincronizadoEn: Date.now()
            }
          });
          continue;
        }
        // Una busqueda sin coincidencia puede ser transitoria; conservar marcador y stats ya visibles.
        selections.push({
          ...selConDetalle,
          autoFutbol
        });
        continue;
      }

      const estadoEspecial = combinarEstadoEspecial(
        getEstadoEspecialApiSportsFutbol(apiGame),
        getEstadoEspecialEspn(espnGame, "espn_football_scoreboard")
      );
      if (estadoEspecial) {
        const siguienteEstado = estadoEspecial.accion === "nula" ? "nula" : (sel.estado || "pendiente");
        if ((sel.estado || "pendiente") !== siguienteEstado) huboCambio = true;
        const targetFechaJuego = getFechaJuegoFutbol(game);
        const pausaEstadoEspecialHasta = ["suspendido", "retrasado"].includes(estadoEspecial.tipo)
          ? Date.now() + FOOTBALL_SPECIAL_STATUS_RETRY_MS
          : null;
        if (
          autoFutbol.estadoJuego !== estadoEspecial.label ||
          autoFutbol.estadoEspecial?.tipo !== estadoEspecial.tipo ||
          autoFutbol.estadoEspecial?.motivo !== estadoEspecial.motivo ||
          autoFutbol.fechaJuego !== targetFechaJuego ||
          (autoFutbol.pausaEstadoEspecialHasta || null) !== pausaEstadoEspecialHasta
        ) {
          huboCambioMetadata = true;
        }
        selections.push({
          ...selConDetalle,
          estado: siguienteEstado,
          autoFutbol: {
            ...autoFutbol,
            id: getIdJuegoFutbol(apiGame || game),
            espnId: espnGame?.id ?? autoFutbol.espnId,
            liga: getLigaJuegoFutbol(game),
            estadoJuego: estadoEspecial.label,
            estadoEspecial,
            marcador: autoFutbol.marcador,
            marcadorTiempo: autoFutbol.marcador ? (autoFutbol.marcadorTiempo || getMarcadorTiempoReglamentarioMeta()) : autoFutbol.marcadorTiempo,
            fechaJuego: targetFechaJuego || autoFutbol.fechaJuego,
            pausaMedioTiempoHasta: null,
            pausaEstadoEspecialHasta
          }
        });
        continue;
      }

      const juegoNoIniciado = juegoFutbolNoIniciado(game);
      const juegoConAlargue =
        juegoFutbolTieneAlargueOPenales(game) ||
        juegoFutbolTieneAlargueOPenales(apiGame) ||
        juegoFutbolTieneAlargueOPenales(espnGame);
      const statsReglamentariasGuardadas = autoFutbol.estadisticasTiempo === getMarcadorTiempoReglamentarioMeta();
      const usarStatsReglamentariasGuardadas = juegoConAlargue && autoFutbolTieneStatsReglamentariasGuardadas(autoFutbol);
      const summaryGuardado = usarStatsReglamentariasGuardadas
        ? crearResumenEstadisticasGuardadasFutbol(autoFutbol)
        : null;
      const puedeCargarStatsProveedor = esMercadoEstadisticasFutbol(autoFutbol) &&
        !juegoNoIniciado &&
        !usarStatsReglamentariasGuardadas;
      const summaryProveedor = puedeCargarStatsProveedor
        ? await cargarResumenFutbol(apiGame, espnGame, { autoFutbol })
        : null;
      const summary = summaryGuardado || summaryProveedor;
      const evaluacion = evaluarAutoFutbol(autoFutbol, game, summary);
      if (!evaluacion) {
        const estadoJuegoDetectado = getEstadoJuegoFutbol(game);
        const preservarDatosPrevios = juegoNoIniciado && autoFutbolTieneDatosJuego(autoFutbol);
        const estadoJuego = preservarDatosPrevios
          ? (autoFutbol.estadoJuego || estadoJuegoDetectado)
          : estadoJuegoDetectado;
        const pausaMedioTiempoHasta = getPausaMedioTiempoHastaFutbol(
          estadoJuego,
          autoFutbol.pausaMedioTiempoHasta
        );
        const marcador = juegoNoIniciado ? null : getMarcadorFutbol(game);
        const marcadorTexto = marcador
          ? obtenerMarcadorTextoFutbol(marcador, autoFutbol.equipos)
          : autoFutbol.marcador;
        const totalGolesDetectado = autoFutbol.mercado === "total_goles" && !juegoNoIniciado
          ? getTotalGolesObjetivoFutbol(autoFutbol, marcador)
          : null;
        const cornersEquipoDetectado = autoFutbol.mercado === "total_corners" && !juegoNoIniciado && summary
          ? getCornersEquipoFutbol(summary, marcador)
          : null;
        const tarjetasEquipoDetectado = autoFutbol.mercado === "total_tarjetas" && !juegoNoIniciado && summary
          ? getTarjetasEquipoFutbol(summary, marcador)
          : null;
        const summaryTieneStatsMercado = autoFutbol.mercado === "total_corners"
          ? Boolean(cornersEquipoDetectado)
          : autoFutbol.mercado === "total_tarjetas"
            ? Boolean(tarjetasEquipoDetectado)
            : false;
        const puedeUsarStatsGuardadas = !juegoConAlargue || statsReglamentariasGuardadas;
        const cornersEquipo = autoFutbol.mercado === "total_corners"
          ? (cornersEquipoDetectado || (puedeUsarStatsGuardadas ? autoFutbol.cornersEquipo : null))
          : autoFutbol.cornersEquipo;
        const totalCorners = autoFutbol.mercado === "total_corners"
          ? cornersEquipo?.total ?? (puedeUsarStatsGuardadas ? autoFutbol.totalCorners : undefined)
          : autoFutbol.totalCorners;
        const tarjetasEquipo = autoFutbol.mercado === "total_tarjetas"
          ? (tarjetasEquipoDetectado || (puedeUsarStatsGuardadas ? autoFutbol.tarjetasEquipo : null))
          : autoFutbol.tarjetasEquipo;
        const totalTarjetas = autoFutbol.mercado === "total_tarjetas"
          ? tarjetasEquipo?.total ?? (puedeUsarStatsGuardadas ? autoFutbol.totalTarjetas : undefined)
          : autoFutbol.totalTarjetas;
        const siguienteMarcador = preservarDatosPrevios ? autoFutbol.marcador : (juegoNoIniciado ? null : marcadorTexto);
        const siguienteTotalGoles = preservarDatosPrevios ? autoFutbol.totalGoles : (juegoNoIniciado ? undefined : (totalGolesDetectado ?? autoFutbol.totalGoles));
        const siguienteTotalCorners = preservarDatosPrevios ? autoFutbol.totalCorners : (juegoNoIniciado ? undefined : totalCorners);
        const siguienteCornersEquipo = preservarDatosPrevios ? (autoFutbol.cornersEquipo || null) : (cornersEquipo || null);
        const siguienteTotalTarjetas = preservarDatosPrevios ? autoFutbol.totalTarjetas : (juegoNoIniciado ? undefined : totalTarjetas);
        const siguienteTarjetasEquipo = preservarDatosPrevios ? (autoFutbol.tarjetasEquipo || null) : (tarjetasEquipo || null);
        const siguienteEstadisticasTiempo = preservarDatosPrevios
          ? autoFutbol.estadisticasTiempo
          : ((siguienteTotalCorners !== undefined || siguienteTotalTarjetas !== undefined)
            ? getMarcadorTiempoReglamentarioMeta()
            : undefined);
        const targetFechaJuego = getFechaJuegoFutbol(game);
        if (
          autoFutbol.id !== getIdJuegoFutbol(game) ||
          autoFutbol.estadoJuego !== estadoJuego ||
          autoFutbol.marcador !== siguienteMarcador ||
          autoFutbol.totalGoles !== siguienteTotalGoles ||
          autoFutbol.totalCorners !== siguienteTotalCorners ||
          autoFutbol.totalTarjetas !== siguienteTotalTarjetas ||
          JSON.stringify(autoFutbol.cornersEquipo || null) !== JSON.stringify(siguienteCornersEquipo) ||
          JSON.stringify(autoFutbol.tarjetasEquipo || null) !== JSON.stringify(siguienteTarjetasEquipo) ||
          autoFutbol.estadisticasTiempo !== siguienteEstadisticasTiempo ||
          autoFutbol.fechaJuego !== targetFechaJuego ||
          (autoFutbol.pausaMedioTiempoHasta || null) !== pausaMedioTiempoHasta ||
          (autoFutbol.pausaEstadoEspecialHasta || null) !== null
        ) {
          huboCambioMetadata = true;
        }
        selections.push({
          ...selConDetalle,
          autoFutbol: {
            ...autoFutbol,
            id: getIdJuegoFutbol(apiGame || game),
            espnId: espnGame?.id ?? autoFutbol.espnId,
            liga: getLigaJuegoFutbol(game),
            estadoJuego,
            estadoEspecial: null,
            marcador: siguienteMarcador,
            marcadorTiempo: siguienteMarcador ? getMarcadorTiempoReglamentarioMeta() : autoFutbol.marcadorTiempo,
            totalGoles: siguienteTotalGoles,
            totalCorners: siguienteTotalCorners,
            cornersEquipo: siguienteCornersEquipo,
            totalTarjetas: siguienteTotalTarjetas,
            tarjetasEquipo: siguienteTarjetasEquipo,
            estadisticasTiempo: siguienteEstadisticasTiempo,
            fechaJuego: targetFechaJuego,
            pausaMedioTiempoHasta,
            pausaEstadoEspecialHasta: null
          }
        });
        continue;
      }

      const targetFechaJuego = getFechaJuegoFutbol(game);
      const estadoJuego = getEstadoJuegoFutbol(game) || "Final";
      const pausaMedioTiempoHasta = getPausaMedioTiempoHastaFutbol(
        estadoJuego,
        autoFutbol.pausaMedioTiempoHasta
      );
      const siguienteEstadisticasTiempo = esMercadoEstadisticasFutbol(autoFutbol)
        ? getMarcadorTiempoReglamentarioMeta()
        : autoFutbol.estadisticasTiempo;
      const siguiente = {
        ...sel,
        estado: evaluacion.estado,
        autoFutbol: {
          ...autoFutbol,
          id: getIdJuegoFutbol(apiGame || game),
          espnId: espnGame?.id ?? autoFutbol.espnId,
          liga: getLigaJuegoFutbol(game),
          estadoJuego,
          estadoEspecial: null,
          marcador: obtenerMarcadorTextoFutbol(evaluacion.marcador, autoFutbol.equipos),
          marcadorTiempo: getMarcadorTiempoReglamentarioMeta(),
          totalGoles: evaluacion.totalGoles ?? autoFutbol.totalGoles,
          totalCorners: evaluacion.totalCorners ?? autoFutbol.totalCorners,
          cornersEquipo: evaluacion.cornersEquipo || autoFutbol.cornersEquipo || null,
          totalTarjetas: evaluacion.totalTarjetas ?? autoFutbol.totalTarjetas,
          tarjetasEquipo: evaluacion.tarjetasEquipo || autoFutbol.tarjetasEquipo || null,
          estadisticasTiempo: siguienteEstadisticasTiempo,
          fechaJuego: targetFechaJuego,
          pausaMedioTiempoHasta,
          pausaEstadoEspecialHasta: null,
          sincronizadoEn: Date.now()
        }
      };

      if ((sel.estado || "pendiente") !== evaluacion.estado) huboCambio = true;
      if (
        autoFutbol.sincronizadoEn === undefined ||
        autoFutbol.id !== getIdJuegoFutbol(apiGame || game) ||
        (espnGame?.id && autoFutbol.espnId !== espnGame.id) ||
        autoFutbol.liga !== getLigaJuegoFutbol(game) ||
        autoFutbol.estadoJuego !== siguiente.autoFutbol.estadoJuego ||
        autoFutbol.marcador !== siguiente.autoFutbol.marcador ||
        autoFutbol.totalGoles !== siguiente.autoFutbol.totalGoles ||
        autoFutbol.totalCorners !== siguiente.autoFutbol.totalCorners ||
        autoFutbol.totalTarjetas !== siguiente.autoFutbol.totalTarjetas ||
        JSON.stringify(autoFutbol.cornersEquipo || null) !== JSON.stringify(siguiente.autoFutbol.cornersEquipo || null) ||
        JSON.stringify(autoFutbol.tarjetasEquipo || null) !== JSON.stringify(siguiente.autoFutbol.tarjetasEquipo || null) ||
        autoFutbol.estadisticasTiempo !== siguiente.autoFutbol.estadisticasTiempo ||
        autoFutbol.fechaJuego !== targetFechaJuego ||
        (autoFutbol.pausaMedioTiempoHasta || null) !== siguiente.autoFutbol.pausaMedioTiempoHasta ||
        (autoFutbol.pausaEstadoEspecialHasta || null) !== null
      ) {
        huboCambioMetadata = true;
      }
      selections.push(siguiente);
    }

    const equipos = extraerEquiposEventoFutbol(ev);
    const jugadaActualizada = {
      ...jugada,
      selections
    };

    if (jugada.autoFutbol) {
      const autoConFecha = selections.find(sel => sel?.autoFutbol?.fechaJuego)?.autoFutbol;
      jugadaActualizada.autoFutbol = autoConFecha
        ? {
          ...jugada.autoFutbol,
          fechaJuego: autoConFecha.fechaJuego,
          estadoJuego: autoConFecha.estadoJuego || jugada.autoFutbol.estadoJuego,
          marcadorTiempo: autoConFecha.marcadorTiempo || jugada.autoFutbol.marcadorTiempo
        }
        : jugada.autoFutbol;
    } else if (equipos.length >= 2) {
      const autoConFecha = selections.find(sel => sel?.autoFutbol?.fechaJuego)?.autoFutbol;
      jugadaActualizada.autoFutbol = autoConFecha
        ? { deporte: "futbol", equipos, fechaJuego: autoConFecha.fechaJuego, estadoJuego: autoConFecha.estadoJuego || "", marcadorTiempo: autoConFecha.marcadorTiempo }
        : { deporte: "futbol", equipos };
    }

    if (apuesta.tipoApuesta === "simple_option_bet") {
      const totalAuto = selections.find(sel => sel.autoFutbol?.mercado === "total_goles")?.autoFutbol;
      const game = totalAuto
        ? elegirJuegoFutbolPrincipal(
          buscarJuegoFutbol(juegosFecha, totalAuto.equipos, fechaBet),
          buscarJuegoEspnFutbol(juegosEspnFecha, totalAuto.equipos, fechaBet),
          totalAuto
        )
        : null;
      const marcador = game ? getMarcadorFutbol(game) : null;
      const finalizado = game ? juegoFutbolReglamentarioProbablementeTerminado(game) : false;
      const totalObjetivo = getTotalGolesObjetivoFutbol(totalAuto, marcador);
      const totalIrreversible = totalObjetivo !== null && totalAuto && (
        finalizado ||
        (totalAuto.tipoTotal === "over" && totalObjetivo > Number(totalAuto.linea)) ||
        (totalAuto.tipoTotal === "under" && totalObjetivo > Number(totalAuto.linea))
      );
      if (totalIrreversible && jugadaActualizada.resultadoTotal !== totalObjetivo) {
        jugadaActualizada.resultadoTotal = totalObjetivo;
        huboCambio = true;
      }
    }

    jugadaActualizada.estado = determinarEstadoJugada(jugadaActualizada);
    nuevasJugadas.push(jugadaActualizada);
  }

  if (!huboCambio && !huboCambioMetadata) return null;

  // Extraer hora y fecha local desde el primer juego de fútbol encontrado
  const juegosFutbolDisponibles = [...juegosEspnFecha, ...juegosFecha];
  const primerJuegoFutbol = juegosFutbolDisponibles.find(game => {
    const equiposApuesta = nuevasJugadas
      .flatMap(j => (j?.autoFutbol?.equipos || []))
      .filter(Boolean);
    if (equiposApuesta.length < 2) return false;
    const competitors = getCompetidoresFutbol(game);
    const scoreA = Math.max(...competitors.map(c => scoreEquipoFutbol(equiposApuesta[0], c)));
    const scoreB = Math.max(...competitors.map(c => scoreEquipoFutbol(equiposApuesta[1], c)));
    return scoreA >= 0.45 && scoreB >= 0.45;
  });
  const isoJuegoFutbol = getFechaJuegoFutbol(primerJuegoFutbol);
  const { fecha: fechaExtraidaFutbol, hora: horaExtraidaFutbol } = obtenerFechaHoraLocalDesdeIso(isoJuegoFutbol);

  const apuestaTemp = {
    ...apuesta,
    jugadas: nuevasJugadas
  };
  const resultado = recalcularResultadoApuesta(apuestaTemp);
  let cuota = apuesta.cuota;

  if (apuesta.tipoApuesta === "patente") {
    cuota = calcularCuotaMaximaPatente(nuevasJugadas);
  } else if (apuesta.tipoApuesta === "simple_option_bet") {
    cuota = calcularCuotaSimpleOptionBet(apuestaTemp) || apuesta.cuota;
  } else if (debeRecalcularCuotaCombinada(apuesta.tipoApuesta)) {
    const cuotaRecalculada = recalcularCuotaCombinada(nuevasJugadas);
    if (cuotaRecalculada > 0) cuota = cuotaRecalculada;
  }

  const updatePayloadFutbol = {
    jugadas: nuevasJugadas,
    resultado,
    cuota,
    deporte: "futbol",
    autoSync: crearAutoSyncPayload(apuesta, resultado, {
      proveedor: "api_sports_football_primary+espn_scoreboard_fallback",
      ultimaRevision: Date.now()
    })
  };

  if ((!apuesta.fecha && !apuesta.dia) && fechaExtraidaFutbol) {
    updatePayloadFutbol.fecha = fechaExtraidaFutbol;
    updatePayloadFutbol.dia = fechaExtraidaFutbol;
  }

  if (!apuesta.hora && horaExtraidaFutbol) {
    updatePayloadFutbol.hora = horaExtraidaFutbol;
  }

  if (apuesta.fecha || apuesta.dia) {
    delete updatePayloadFutbol.fecha;
    delete updatePayloadFutbol.dia;
  }

  return updatePayloadFutbol;
}

async function sincronizarResultadosFutbol(silencioso = false) {
  const hoy = obtenerFechaActualLocal();
  const apuestasSync = silencioso
    ? await getApuestasAutoSyncScope("futbol")
    : getApuestasSyncScope(false);
  const candidatasResultados = apuestasSync.filter(a => {
    if (!apuestaPareceFutbol(a)) return false;
    if (!Array.isArray(a.jugadas) || a.jugadas.length === 0) return false;
    if (silencioso && apuestaSyncCerrada(a)) return false;
    if (silencioso && !apuestaResultadoPendiente(a)) return false;
    if (silencioso && apuestaYaFinalizadaYResuelta(a, "autoFutbol")) return false;
    if (silencioso && apuestaFutbolPausadaPorMedioTiempo(a)) return false;
    if (silencioso && apuestaFutbolPausadaPorEstadoEspecial(a)) return false;
    const fechaApuesta = a.fecha || a.dia;
    const forzarRevisionManualHoy = !silencioso && fechaApuesta === hoy;
    if (!apuestaFutbolYaDebeSincronizar(a) && !forzarRevisionManualHoy) return false;
    // En modo automatico/silencioso, revisar tambien pendientes recientes para cerrar partidos que terminaron tarde.
    if (silencioso && !apuestaFutbolEnVentanaSyncSilencioso(a)) return false;
    return true;
  });
  const candidatasHorario = apuestasSync.filter(a => {
    if (!apuestaPareceFutbol(a)) return false;
    if (!Array.isArray(a.jugadas) || a.jugadas.length === 0) return false;
    if (silencioso && apuestaSyncCerrada(a)) return false;
    if (!apuestaResultadoPendiente(a)) return false;
    if (apuestaYaFinalizadaYResuelta(a, "autoFutbol")) return false;
    if (!puedeDescubrirInicioFutbol(a, silencioso)) return false;
    return true;
  });
  const idsHorario = new Set(candidatasHorario.map(apuesta => apuesta.id));
  const candidatas = [...new Map(
    [...candidatasResultados, ...candidatasHorario].map(apuesta => [apuesta.id, apuesta])
  ).values()];

  if (candidatas.length === 0) {
    if (!silencioso) {
      setFootballSyncStatus("No hay apuestas de futbol pendientes para sincronizar.", "");
    }
    return;
  }

  const btn = document.getElementById("btnSincronizarFutbol");
  if (!silencioso) {
    if (btn) btn.disabled = true;
    await cederControlNavegador();
    setFootballSyncStatus("Sincronizando resultados de fútbol...", "");
  }

  try {
    const fechasBusquedaPorApuesta = new Map();
    const fechas = new Set();
    let fechasOmitidasPorPlan = 0;
    candidatas.forEach(apuesta => {
      const fecha = getFechaApiSportsFutbolApuesta(apuesta);
      if (!fecha) return;
      if (idsHorario.has(apuesta.id)) registrarIntentoDescubrirInicioFutbol(apuesta);
      const fechasBase = getInicioFutbolApuesta(apuesta) ? [fecha] : getFechasCercanas(fecha);
      const fechasBusqueda = filtrarFechasPermitidasApiSportsFutbol(fechasBase);
      fechasOmitidasPorPlan += fechasBase.length - fechasBusqueda.length;
      fechasBusquedaPorApuesta.set(apuesta, fechasBusqueda);
      fechasBusqueda.forEach(fechaBusqueda => fechas.add(fechaBusqueda));
    });
    const juegosPorFecha = new Map();
    for (const fecha of fechas) {
      juegosPorFecha.set(fecha, []);
    }
    let juegosApiSportsCargados = 0;
    let erroresApiSports = 0;
    let fechasApiProcesadas = 0;
    for (const fecha of fechas) {
      fechasApiProcesadas++;
      if (!silencioso) {
        setFootballSyncStatus(`Sincronizando futbol... API-Football ${fechasApiProcesadas}/${fechas.size}`, "");
      }
      await cederControlNavegador();
      try {
        const juegos = await cargarJuegosFutbolPorFecha(fecha, {
          cacheMs: API_SPORTS_FOOTBALL_LIVE_CACHE_MS
        });
        juegosApiSportsCargados += juegos.length;
        juegosPorFecha.set(fecha, juegos);
      } catch (e) {
        if (esErrorRangoApiSportsFreePlan(e)) {
          fechasOmitidasPorPlan++;
        } else {
          erroresApiSports++;
          console.warn("No se pudo cargar API-Sports futbol:", fecha, e);
        }
        juegosPorFecha.set(fecha, []);
      }
    }

    const idsHorariosActualizados = new Set();
    const getApuestaActualizada = apuesta => apuestas.find(item => item.id === apuesta.id) || apuesta;
    let actualizacionesVisibles = 0;
    const aplicarUpdateFutbol = async (apuesta, updateData) => {
      if (!updateData) return false;
      if (silencioso) marcarRenderSilenciosoApuesta(apuesta.id);
      await updateDoc(doc(db, "apuestas", apuesta.id), limpiarUndefinedFirestore(updateData));
      const actualizadaLocal = aplicarUpdateLocalApuesta(apuesta.id, updateData);
      const afectaVistaActual = actualizadaLocal && apuestaPerteneceFiltroActual(apuesta);
      if (!silencioso || afectaVistaActual) {
        renderSnapshotProgramado();
      }
      if (silencioso && afectaVistaActual) actualizacionesVisibles++;
      if (idsHorario.has(apuesta.id)) idsHorariosActualizados.add(apuesta.id);
      return true;
    };

    let actualizadasApi = 0;
    let revisadasApi = 0;
    for (const apuesta of candidatas) {
      revisadasApi++;
      if (!silencioso) {
        setFootballSyncStatus(`Sincronizando futbol... API-Football apuestas ${revisadasApi}/${candidatas.length}`, "");
      }
      await cederControlNavegador();
      const fecha = getFechaApiSportsFutbolApuesta(apuesta);
      const fechasBusqueda = fechasBusquedaPorApuesta.get(apuesta) || [fecha].filter(Boolean);
      const juegosApiSportsApuesta = fechasBusqueda.flatMap(fechaBusqueda => juegosPorFecha.get(fechaBusqueda) || []);
      const updateDataApi = await aplicarResultadoFutbolApuesta(apuesta, juegosApiSportsApuesta, []);
      if (await aplicarUpdateFutbol(apuesta, updateDataApi)) {
        actualizadasApi++;
      }
    }

    const fechasEspn = new Set();
    candidatas.forEach(apuesta => {
      const apuestaActualizada = getApuestaActualizada(apuesta);
      const fecha = getFechaApiSportsFutbolApuesta(apuestaActualizada);
      const fechasBusqueda = fechasBusquedaPorApuesta.get(apuesta) || [fecha].filter(Boolean);
      const juegosApiSportsApuesta = fechasBusqueda.flatMap(fechaBusqueda => juegosPorFecha.get(fechaBusqueda) || []);
      const debeCompararEspn = juegosApiSportsApuesta.length > 0 ||
        apuestaNecesitaEspnFutbol(apuestaActualizada, juegosApiSportsApuesta, fecha);
      if (debeCompararEspn) {
        fechasBusqueda.forEach(fechaBusqueda => fechasEspn.add(fechaBusqueda));
      }
    });

    const juegosEspnPorFecha = new Map();
    for (const fecha of fechasEspn) {
      juegosEspnPorFecha.set(fecha, []);
    }
    let juegosEspnCargados = 0;
    let fechasEspnProcesadas = 0;
    for (const fecha of fechasEspn) {
      fechasEspnProcesadas++;
      if (!silencioso) {
        setFootballSyncStatus(`Sincronizando futbol... ESPN ${fechasEspnProcesadas}/${fechasEspn.size}`, "");
      }
      await cederControlNavegador();
      try {
        const juegosEspn = await cargarJuegosEspnFutbolPorFecha(fecha, {
          cacheMs: API_SPORTS_FOOTBALL_LIVE_CACHE_MS
        });
        juegosEspnCargados += juegosEspn.length;
        juegosEspnPorFecha.set(fecha, juegosEspn);
      } catch (e) {
        console.warn("No se pudo cargar ESPN futbol:", fecha, e);
        juegosEspnPorFecha.set(fecha, []);
      }
    }

    let actualizadasEspn = 0;
    let revisadasEspn = 0;
    for (const apuesta of candidatas) {
      const apuestaActualizada = getApuestaActualizada(apuesta);
      const fecha = getFechaApiSportsFutbolApuesta(apuestaActualizada);
      const fechasBusqueda = fechasBusquedaPorApuesta.get(apuesta) || [fecha].filter(Boolean);
      const juegosEspnApuesta = fechasBusqueda.flatMap(fechaBusqueda => juegosEspnPorFecha.get(fechaBusqueda) || []);
      if (juegosEspnApuesta.length === 0) continue;

      revisadasEspn++;
      if (!silencioso) {
        setFootballSyncStatus(`Sincronizando futbol... ESPN apuestas ${revisadasEspn}/${candidatas.length}`, "");
      }
      await cederControlNavegador();
      const juegosApuesta = fechasBusqueda.flatMap(fechaBusqueda => juegosPorFecha.get(fechaBusqueda) || []);
      const updateDataEspn = await aplicarResultadoFutbolApuesta(apuestaActualizada, juegosApuesta, juegosEspnApuesta);
      if (await aplicarUpdateFutbol(apuestaActualizada, updateDataEspn)) {
        actualizadasEspn++;
      }
    }

    const actualizadas = actualizadasApi + actualizadasEspn;
    const revisadas = revisadasApi + revisadasEspn;
    const horariosActualizados = idsHorariosActualizados.size;
    if (silencioso && actualizacionesVisibles > 0) {
      renderSnapshotProgramado();
    }

    if (!silencioso) {
      const detalleOmitidas = fechasOmitidasPorPlan > 0
        ? ` ${fechasOmitidasPorPlan} fecha(s) fuera del plan free fueron omitidas.`
        : "";
      const detalleErroresApi = erroresApiSports > 0
        ? ` API-Football errores: ${erroresApiSports}.`
        : "";
      const detalleFuentes = ` API-Football: ${fechas.size} fecha(s), ${juegosApiSportsCargados} juego(s), TZ ${getSportsTimezone()}. ESPN apoyo: ${fechasEspn.size} fecha(s), ${juegosEspnCargados} juego(s).`;
      setFootballSyncStatus(
        `Fútbol sincronizado: ${actualizadas} de ${revisadas} apuestas revisadas.${horariosActualizados ? ` Horarios: ${horariosActualizados}.` : ""}${detalleFuentes}${detalleErroresApi}${detalleOmitidas}`,
        actualizadas > 0 ? "success" : ""
      );
    }
  } catch (e) {
    console.error("Error sincronizando fútbol:", e);
    if (!silencioso) {
      setFootballSyncStatus(`No se pudo sincronizar fútbol: ${e.message}`, "error");
    }
  } finally {
    if (!silencioso && btn) btn.disabled = false;
    if (!silencioso) {
      render();
      if (_syncFutbolActivado) programarSyncSilenciosa("futbol", 1500, true);
    }
  }
}



let _autoSyncFutbolIntervalId = null;
let _autoSyncFutbolEnCurso = false;
let _ultimoAutoSyncFutbol = 0;
let _syncFutbolActivado = false; // Solo inicia cuando el usuario presiona el botón manualmente

async function ejecutarAutoSyncFutbol(force = false) {
  if (!paginaEstaVisible()) return;
  if (usuarioEstaEditandoFormulario()) {
    const syncStatsRapida = getApuestasSyncScope(true).some(apuestaFutbolNecesitaSyncEstadisticasRapida);
    programarSyncSilenciosa("futbol", syncStatsRapida ? 15000 : AUTO_SYNC_RESUME_GRACE_MS);
    return;
  }
  if (!_syncFutbolActivado) return; // No sincronizar si el usuario no lo activó
  const syncStatsRapida = getApuestasSyncScope(true).some(apuestaFutbolNecesitaSyncEstadisticasRapida);
  if (!force && paginaRecienReactivada()) {
    programarSyncSilenciosa("futbol", syncStatsRapida ? 1200 : AUTO_SYNC_RESUME_GRACE_MS, syncStatsRapida);
    return;
  }
  if (_autoSyncFutbolEnCurso) return;
  const intervaloMinimo = syncStatsRapida ? FOOTBALL_LIVE_STATS_SYNC_INTERVAL_MS : AUTO_SYNC_INTERVAL_MS;
  if (!force && Date.now() - _ultimoAutoSyncFutbol < intervaloMinimo) return;

  _autoSyncFutbolEnCurso = true;
  _ultimoAutoSyncFutbol = Date.now();
  try {
    await sincronizarResultadosFutbol(true);
  } catch (e) {
    console.warn("Auto-sync futbol - error general:", e.message);
  } finally {
    _autoSyncFutbolEnCurso = false;
    if (syncStatsRapida && paginaEstaVisible()) {
      programarSyncSilenciosa("futbol", FOOTBALL_LIVE_STATS_SYNC_INTERVAL_MS);
    }
  }
}

function startAutoSyncFutbol() {
  if (_autoSyncFutbolIntervalId !== null) return; // Ya activo, no duplicar
  _syncFutbolActivado = true;
  _autoSyncFutbolIntervalId = setInterval(() => {
    if (_syncFutbolActivado) programarSyncSilenciosa("futbol", 0);
  }, AUTO_SYNC_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (paginaEstaVisible() && _syncFutbolActivado) {
      registrarReactivacionPagina();
      programarSyncSilenciosa("futbol", 1000);
    } else if (!paginaEstaVisible()) {
      cancelarSyncSilenciosaPendiente();
    }
  });
  window.addEventListener("focus", () => {
    if (_syncFutbolActivado) {
      registrarReactivacionPagina();
      programarSyncSilenciosa("futbol", 1000);
    }
  });
}



let _autoSyncMlbIntervalId = null;
let _autoSyncMlbEnCurso = false;
let _ultimoAutoSyncMlb = 0;
let _syncMlbActivado = false; // Solo inicia cuando el usuario presiona el botón manualmente

async function ejecutarAutoSyncMlb(force = false) {
  if (!paginaEstaVisible()) return;
  if (usuarioEstaEditandoFormulario()) {
    const syncLiveRapida = getApuestasSyncScope(true).some(apuestaMlbNecesitaSyncLiveRapida);
    programarSyncSilenciosa("mlb", syncLiveRapida ? 15000 : AUTO_SYNC_RESUME_GRACE_MS);
    return;
  }
  if (!_syncMlbActivado) return; // No sincronizar si el usuario no activo la sincronizacion manualmente
  const syncLiveRapida = getApuestasSyncScope(true).some(apuestaMlbNecesitaSyncLiveRapida);
  if (!force && paginaRecienReactivada()) {
    programarSyncSilenciosa("mlb", syncLiveRapida ? 1200 : AUTO_SYNC_RESUME_GRACE_MS, syncLiveRapida);
    return;
  }
  if (_autoSyncMlbEnCurso) return;
  const intervaloMinimo = syncLiveRapida ? MLB_LIVE_SYNC_INTERVAL_MS : MLB_AUTO_SYNC_INTERVAL_MS;
  if (!force && Date.now() - _ultimoAutoSyncMlb < intervaloMinimo) return;

  _autoSyncMlbEnCurso = true;
  _ultimoAutoSyncMlb = Date.now();
  try {
    await sincronizarResultadosMlb(true);
  } catch (e) {
    console.warn("Auto-sync MLB - error general:", e.message);
  } finally {
    _autoSyncMlbEnCurso = false;
    if (syncLiveRapida && paginaEstaVisible()) {
      programarSyncSilenciosa("mlb", MLB_LIVE_SYNC_INTERVAL_MS);
    }
  }
}

function startAutoSyncMlb() {
  if (_autoSyncMlbIntervalId !== null) return; // Ya activo, no duplicar
  _syncMlbActivado = true;
  _autoSyncMlbIntervalId = setInterval(() => {
    if (_syncMlbActivado) programarSyncSilenciosa("mlb", 0);
  }, MLB_AUTO_SYNC_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (paginaEstaVisible() && _syncMlbActivado) {
      registrarReactivacionPagina();
      programarSyncSilenciosa("mlb", 1000, true);
    } else if (!paginaEstaVisible()) {
      cancelarSyncSilenciosaPendiente();
    }
  });
  window.addEventListener("focus", () => {
    if (_syncMlbActivado) {
      registrarReactivacionPagina();
      programarSyncSilenciosa("mlb", 1000, true);
    }
  });
}

function getAjusteManualFutbolHtml(autoFutbol = {}, options = {}) {
  if (!options.apuestaId && options.apuestaId !== 0) return "";
  if (!Number.isInteger(options.matchIndex) || !Number.isInteger(options.selIndex)) return "";
  if (!["total_corners", "total_tarjetas"].includes(autoFutbol?.mercado)) return "";

  const key = `${options.apuestaId}-${options.matchIndex}-${options.selIndex}`;
  const esCorners = autoFutbol.mercado === "total_corners";
  const equipoStats = esCorners ? autoFutbol.cornersEquipo : autoFutbol.tarjetasEquipo;
  const homeActual = esCorners ? equipoStats?.home?.corners : equipoStats?.home?.tarjetas;
  const awayActual = esCorners ? equipoStats?.away?.corners : equipoStats?.away?.tarjetas;

  return `
    <span data-stat-view="${key}" class="auto-stat-adjust-inline">
      <button type="button" class="auto-stat-adjust-btn" title="Ajustar dato manual" onclick="window.mostrarAjusteEstadisticaFutbol('${escapeHtml(options.apuestaId)}', ${options.matchIndex}, ${options.selIndex})">Ajustar</button>
    </span>
    <span data-stat-editor="${key}" class="auto-stat-adjust-editor" hidden>
      <input type="number" min="0" step="1" value="${escapeHtml(homeActual ?? 0)}" data-stat-home="${key}" aria-label="Local">
      <span>-</span>
      <input type="number" min="0" step="1" value="${escapeHtml(awayActual ?? 0)}" data-stat-away="${key}" aria-label="Visitante">
      <button type="button" title="Guardar ajuste" onclick="window.ajustarEstadisticaFutbol('${escapeHtml(options.apuestaId)}', ${options.matchIndex}, ${options.selIndex})">OK</button>
      <button type="button" title="Cancelar" onclick="window.ocultarAjusteEstadisticaFutbol('${escapeHtml(options.apuestaId)}', ${options.matchIndex}, ${options.selIndex})">x</button>
    </span>`;
}

function getAutoFutbolMarcadorHtml(selection = {}, options = {}) {
  return footballAutoPresenter.getAutoFutbolMarcadorHtml(selection, options, {
    escapeHtml,
    reordenarMarcadorTextoFutbol,
    getEstadoEspecialApuestaHtml,
    getEstadoFinalizadoHtml,
    getCornersEquipoFallbackFutbol,
    getTotalCornersDesdeEquiposFutbol,
    getTotalCornersObjetivoFutbol,
    obtenerCornersDetalleEnOrden,
    getAjusteManualFutbolHtml,
    getTarjetasEquipoFallbackFutbol,
    getTotalTarjetasDesdeEquiposFutbol,
    getTotalTarjetasObjetivoFutbol,
    obtenerTarjetasDetalleEnOrden,
    debeMostrarHorarioJuego,
    formatFechaJuego,
    getEstadoJuegoLegacyHtml
  });
}

/* =========================
   ELIMINAR
 ========================= */
async function eliminar(id) {
  const scrollPosition = window.scrollY;
  apuestas = apuestas.filter(a => a.id !== id);
  render();
  window.scrollTo(0, scrollPosition);

  try {
    await deleteDoc(doc(db, "apuestas", id));
  } catch (e) {
    console.error("Error al eliminar:", e);
  }
}

/* =========================
   EDITAR INLINE
 ========================= */
function habilitarEdicion(id) {
  const scroll = window.scrollY;
  editandoId = id;
  render();
  window.scrollTo(0, scroll);
  requestAnimationFrame(() => {
    const card = document.getElementById(`edit-tarjeta-${id}`);
    if (card) {
      card.querySelectorAll(".edit-jugada-ev-input, [id^='edit-evento-']").forEach(input => {
        verificarDobleJornadaEnSlot(input);
      });
    }
  });
}

function cancelarEdicion() {
  const scroll = window.scrollY;
  editandoId = null;
  render();
  window.scrollTo(0, scroll);
}

async function guardarEdicion(id) {
  try {
    const nuevoTipo = document.getElementById(`edit-tipo-${id}`).value;
    const nuevoEvento = autocorregirTextoApuesta(document.getElementById(`edit-evento-${id}`).value);
    const nuevoImporteVal = document.getElementById(`edit-importe-${id}`).value.trim();
    const nuevoImporte = parseFloat(nuevoImporteVal);
    const nuevaCasa = getCasaPorId(document.getElementById(`edit-casa-${id}`)?.value || CASA_DEFAULT_ID);
    const nuevoFecha = document.getElementById(`edit-fecha-${id}`).value;
    const nuevoHora = document.getElementById(`edit-hora-${id}`)?.value || "";

    let errores = [];
    if (!nuevoFecha) {
      errores.push("Rellena la fecha.");
    }

    if (!nuevoImporteVal || isNaN(nuevoImporte) || nuevoImporte <= 0) {
      errores.push("Rellena el importe (debe ser mayor a 0).");
    }

    const isCombinada = nuevoTipo === "combinada";
    const isPatente = nuevoTipo === "patente";
    const isSimpleOption = nuevoTipo === "simple_option_bet";
    let nuevasJugadas = [];
    const slots = document.querySelectorAll(`.edit-jugada-slot-${id}`);

    if (isPatente && (slots.length < PATENTE_MIN_SELECTIONS || slots.length > PATENTE_MAX_SELECTIONS)) {
      errores.push(`La patente necesita entre ${PATENTE_MIN_SELECTIONS} y ${PATENTE_MAX_SELECTIONS} selecciones.`);
    }

    slots.forEach((slot, index) => {
      const ev = autocorregirTextoApuesta(slot.querySelector(".edit-jugada-ev-input")?.value.trim() || "");
      const cuotaVal = slot.querySelector(".edit-jugada-cuota-input")?.value.trim() || "";
      const c = parseFloat(cuotaVal);
      const originalBetForSlot = apuestas.find(a => a.id === id);
      const originalResultadoTotal = originalBetForSlot?.jugadas?.[index]?.resultadoTotal;
      const resultadoTotalInput = slot.querySelector(".edit-simple-option-total-input");
      const resultadoTotalVal = resultadoTotalInput?.value.trim() || "";
      const resultadoTotal = resultadoTotalInput
        ? (resultadoTotalVal ? parseFloat(resultadoTotalVal) : null)
        : (originalResultadoTotal ?? null);
      const optiOddsVal = slot.querySelector(".edit-simple-option-opti-input")?.value.trim() || "";
      const maxOddsVal = slot.querySelector(".edit-simple-option-max-input")?.value.trim() || "";
      const optiOdds = parseFloat(optiOddsVal);
      const maxOdds = parseFloat(maxOddsVal);

      const selections = [];
      const selectionRows = slot.querySelectorAll(".edit-selection-row");
      selectionRows.forEach((row, selIndex) => {
        const jug = autocorregirTextoApuesta(row.querySelector(".edit-jugada-jug-input")?.value.trim() || "", ev);

        let estado = "pendiente";
        let tituloOriginal = "";
        const originalBet = apuestas.find(a => a.id === id);
        if (originalBet && originalBet.jugadas && originalBet.jugadas[index]) {
          const originalMatch = originalBet.jugadas[index];
          if (typeof originalMatch === "object") {
            const originalSelections = originalMatch.selections || [
              { titulo: "", jugada: originalMatch.jug || "", estado: originalMatch.estado || "pendiente" }
            ];
            if (originalSelections[selIndex]) {
              estado = originalSelections[selIndex].estado || "pendiente";
              tituloOriginal = originalSelections[selIndex].titulo || "";
            }
          }
        }

        const isCrearTipo = nuevoTipo === "crear_apuesta" || nuevoTipo === "crear_apuesta_simple";
        selections.push(isCrearTipo
          ? crearSeleccionDetectada(jug, estado, tituloOriginal, ev)
          : { titulo: "", jugada: jug, estado });
      });

      // Always push at least one selection even if empty
      if (selections.length === 0) {
        selections.push({ titulo: "", jugada: "", estado: "pendiente" });
      }
      if (isPatente) {
        const n = index + 1;
        if (!ev) errores.push(`Rellena el partido/evento de la seleccion #${n}.`);
        if (!cuotaVal || isNaN(c) || c <= 0) errores.push(`Rellena la cuota de la seleccion #${n} (debe ser mayor a 0).`);
        if (!selections[0]?.jugada) errores.push(`Rellena la jugada de la seleccion #${n}.`);
        if (selections.length > 1) {
          selections.splice(1);
        }
      }
      if (isSimpleOption) {
        const n = index + 1;
        if (!ev) errores.push(`Rellena el partido/evento #${n}.`);
        if (!selections[0]?.jugada) errores.push(`Rellena la jugada del partido #${n}.`);
        if (selections[0]?.jugada && !/\d+(?:[.,]\d+)?/.test(selections[0].jugada)) errores.push(`La jugada del partido #${n} debe tener un numero como 4.5.`);
        if (resultadoTotalVal && isNaN(resultadoTotal)) errores.push(`Rellena un resultado total valido en el partido #${n}.`);
        if (!optiOddsVal || isNaN(optiOdds) || optiOdds <= 0) errores.push(`Rellena Opti odds del partido #${n} (debe ser mayor a 0).`);
        if (!maxOddsVal || isNaN(maxOdds) || maxOdds <= 0) errores.push(`Rellena Max odds del partido #${n} (debe ser mayor a 0).`);
        if (selections.length > 1) {
          selections.splice(1);
        }
      }

      const isMulti = nuevoTipo === "combinada" || nuevoTipo === "patente" || nuevoTipo === "crear_apuesta" || nuevoTipo === "crear_apuesta_simple";
      let jugada = isSimpleOption
        ? { ev, c: optiOdds || 0, optiOdds: optiOdds || 0, maxOdds: maxOdds || 0, resultadoTotal, selections }
        : { ev, c: isMulti ? (c || 0) : 0, selections };

      const editCard = document.getElementById(`edit-tarjeta-${id}`);
      const gameDataStr = slot.dataset.selectedGame || editCard?.dataset?.selectedGame;
      if (gameDataStr) {
        try {
          const juegoElegido = JSON.parse(gameDataStr);
          const res = aplicarDobleJornadaAJugadas([jugada], juegoElegido);
          jugada = res[0];
          if (juegoElegido.hora) nuevoHora = juegoElegido.hora;
        } catch (e) {}
      }

      nuevasJugadas.push({
        ...jugada,
        estado: determinarEstadoJugada(jugada)
      });
    });

    // If no slots found (legacy simple bet), keep the original jugadas
    if (nuevasJugadas.length === 0) {
      const apuesta = apuestas.find(a => a.id === id);
      if (apuesta) nuevasJugadas = apuesta.jugadas || [];
    }

    // Calculate cuota (no mandatory validation — save whatever is there)
    let nuevaCuota = 0;
    if (nuevoTipo === "patente") {
      nuevaCuota = calcularCuotaMaximaPatente(nuevasJugadas);
    } else if (nuevoTipo === "simple_option_bet") {
      nuevaCuota = calcularCuotaSimpleOptionBet({
        tipoApuesta: nuevoTipo,
        jugadas: nuevasJugadas,
        cuota: nuevasJugadas[0]?.optiOdds || 0
      });
      if (!nuevaCuota) nuevaCuota = nuevasJugadas[0]?.optiOdds || 0;
      if (nuevasJugadas.length > 0) {
        nuevasJugadas[0].c = nuevaCuota;
      }
    } else if (debeRecalcularCuotaCombinada(nuevoTipo)) {
      nuevaCuota = recalcularCuotaCombinada(nuevasJugadas);
    } else {
      const cuotaEl = document.getElementById(`edit-cuota-${id}`);
      if (cuotaEl) {
        nuevaCuota = parseFloat(cuotaEl.value) || 0;
      }
      if (nuevasJugadas.length > 0) {
        nuevasJugadas[0].c = nuevaCuota;
      }
    }

    // Only block save if importe is completely missing
    if (errores.length > 0) {
      mostrarModalValidacion(errores);
      return;
    }

    nuevasJugadas = normalizarJugadasConEstado(nuevasJugadas);

    const scrollPosition = window.scrollY;
    editandoId = null;
    const index = apuestas.findIndex(a => a.id === id);
    const resultadoActual = index > -1 ? apuestas[index].resultado : "pendiente";
    const nuevoResultado = nuevoTipo === "simple"
      ? (resultadoActual || "pendiente")
      : recalcularResultadoApuesta({
        tipoApuesta: nuevoTipo,
        jugadas: nuevasJugadas,
        importe: nuevoImporte,
        resultado: resultadoActual
      });
    if (nuevoTipo === "simple_option_bet") {
      nuevasJugadas = nuevasJugadas.map(j => ({
        ...j,
        estado: nuevoResultado,
        selections: (j.selections || []).map(sel => ({ ...sel, estado: nuevoResultado }))
      }));
      nuevaCuota = calcularCuotaSimpleOptionBet({
        tipoApuesta: nuevoTipo,
        jugadas: nuevasJugadas,
        cuota: nuevaCuota,
        resultado: nuevoResultado
      }) || nuevaCuota;
      if (nuevasJugadas[0]) nuevasJugadas[0].c = nuevaCuota;
    }

    let nuevoAutoSync = crearAutoSyncPayload(index > -1 ? apuestas[index] : {}, nuevoResultado);
    if (index > -1) {
      apuestas[index].tipoApuesta = nuevoTipo;
      apuestas[index].evento = nuevoEvento;
      apuestas[index].cuota = nuevaCuota;
      apuestas[index].importe = nuevoImporte;
      apuestas[index].jugadas = nuevasJugadas;
      apuestas[index].resultado = nuevoResultado;
      apuestas[index].casaId = nuevaCasa.id;
      apuestas[index].casaNombre = nuevaCasa.nombre;
      apuestas[index].fecha = nuevoFecha;
      apuestas[index].dia = nuevoFecha;
      apuestas[index].hora = nuevoHora;
      nuevoAutoSync = crearAutoSyncPayload(apuestas[index], nuevoResultado);
      apuestas[index].autoSync = nuevoAutoSync;
    }

    render();
    window.scrollTo(0, scrollPosition);

    const apuestaOriginalEditada = apuestas.find(a => a.id === id);
    const nuevoDeporte = apuestaOriginalEditada?.deporte || "";
    nuevasJugadas = enriquecerJugadasAuto(nuevasJugadas, nuevoDeporte);

    const updateData = {
      tipoApuesta: nuevoTipo,
      evento: nuevoEvento,
      cuota: nuevaCuota,
      importe: nuevoImporte,
      jugadas: nuevasJugadas,
      deporte: nuevoDeporte,
      casaId: nuevaCasa.id,
      casaNombre: nuevaCasa.nombre,
      fecha: nuevoFecha,
      dia: nuevoFecha,
      hora: nuevoHora,
      autoSync: nuevoAutoSync
    };
    updateData.resultado = nuevoResultado;

    await updateDoc(doc(db, "apuestas", id), limpiarUndefinedFirestore(updateData));

    // Sincronizar hora automáticamente desde la API solo si la apuesta es de hoy
    if (nuevoFecha === obtenerFechaActualLocal()) {
      if (nuevoDeporte === "mlb" && _syncMlbActivado) {
        programarSyncSilenciosa("mlb", 1200, true);
      } else if (nuevoDeporte === "futbol" && _syncFutbolActivado) {
        programarSyncSilenciosa("futbol", 1200, true);
      }
    }

  } catch (e) {
    console.error(e);
    mostrarModalValidacion(["Error al guardar: " + e.message]);
  }
}

async function eliminarDia(dia) {
  const elemento = document.querySelector(`[data-dia="${dia}"]`);
  if (!elemento) return;

  elemento.style.transition = "all 0.3s ease";
  elemento.style.opacity = "0";
  elemento.style.transform = "translateY(-10px)";
  elemento.style.height = elemento.offsetHeight + "px";

  setTimeout(async () => {
    const lista = getApuestasFiltradas().filter(a => a.dia === dia);
    await Promise.all(lista.map(a => deleteDoc(doc(db, "apuestas", a.id))));
  }, 250);
}

async function eliminarTodo() {
  const lista = filtroCasaId === CASA_TODAS_ID
    ? [...apuestas]
    : apuestas.filter(a => getCasaIdApuesta(a) === filtroCasaId);

  if (lista.length === 0) {
    mostrarModalValidacion(["No hay apuestas para eliminar."]);
    return;
  }

  await Promise.all(lista.map(a => deleteDoc(doc(db, "apuestas", a.id))));
  const eliminadas = new Set(lista.map(a => a.id));
  apuestas = apuestas.filter(a => !eliminadas.has(a.id));
  render();
}

/* =========================
   RENDER HELPERS
 ========================= */
function formatTextWithCorners(texto, forceGoalIcon = false, forceCornerIcon = false, forceCardIcon = false) {
  if (!texto) return "";
  const displayText = String(texto).replace(/(\p{L})([+-]\d+(?:[.,]\d+)?)/gu, "$1 $2");
  const formattedText = formatTextWithMlbTeams(displayText);
  const normalized = displayText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (forceCornerIcon || normalized.includes("corner") || normalized.includes("esquina")) {
    const svgIcon = `<svg viewBox="0 0 100 100" width="30" height="30" class="corner-kick-icon" fill="none" stroke="#c0c0c0" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="60" y1="80" x2="18" y2="52" />
      <line x1="60" y1="80" x2="82" y2="38" />
      <path d="M 38,65 A 22,22 0 0,1 72,57" fill="none" />
      <line x1="60" y1="80" x2="60" y2="10" />
      <polygon points="60,13 30,20 30,36 60,30" fill="#c0c0c0" stroke="none" />
    </svg>`;
    return `<span class="corner-kick-text">${svgIcon}<span class="corner-kick-label">${formattedText}</span></span>`;
  }
  if (forceGoalIcon || /\bgol(?:es)?\b/.test(normalized)) {
    const svgIcon = `<img src="images/Soccerball.svg" class="corner-kick-icon goal-ball-icon" alt="">`;
    return `<span class="corner-kick-text">${svgIcon}<span class="corner-kick-label">${formattedText}</span></span>`;
  }
  if (forceCardIcon || /\btarjetas?\b/.test(normalized)) {
    const svgIcon = `<img src="images/Yellow_Red_Card.svg" class="corner-kick-icon card-icon" alt="">`;
    return `<span class="corner-kick-text">${svgIcon}<span class="corner-kick-label">${formattedText}</span></span>`;
  }
  return formattedText;
}

function prepararSeleccionAutoFutbolRender(selection = {}, jugada = {}, evento = "") {
  const contextoFutbolSinMlb = extraerEquiposEventoFutbol(evento).length >= 2 && detectarEquiposMlb(evento).length < 2;
  const selectionBase = contextoFutbolSinMlb
    ? (() => {
      const { autoMlb, ...sinAutoMlb } = selection;
      return sinAutoMlb;
    })()
    : selection;
  const selectionSinChoqueMlb = quitarAutoFutbolSiEsMlb(selectionBase, jugada, evento, detectarEquiposMlb);
  if (selectionSinChoqueMlb !== selectionBase) return selectionSinChoqueMlb;

  const autoDetectado = crearAutoFutbolSeleccion({
    evento,
    titulo: selectionBase.titulo || "",
    jugada: selectionBase.jugada || selectionBase.jug || ""
  });
  const autoFutbol = combinarAutoFutbolConDetectado(selectionBase.autoFutbol || jugada.autoFutbol || null, autoDetectado);
  return autoFutbol ? { ...selectionBase, autoFutbol } : selectionBase;
}

function getEstadoSeleccionRender(selection = {}, jugada = {}, evento = "") {
  const selectionRender = prepararSeleccionAutoFutbolRender(selection, jugada, evento);
  const autoFutbol = selectionRender.autoFutbol;
  const gameGuardado = crearJuegoFutbolDesdeAutoFutbol(autoFutbol);
  const evaluacion = gameGuardado ? evaluarAutoFutbol(autoFutbol, gameGuardado, null) : null;
  return evaluacion?.estado || selection.estado || "pendiente";
}

function getSimpleOptionDetalle(apuesta) {
  const jugada = apuesta?.jugadas?.[0] || {};
  return {
    resultadoTotal: jugada.resultadoTotal ?? apuesta?.resultadoTotal,
    optiOdds: parseFloat(jugada.optiOdds ?? apuesta?.optiOdds ?? jugada.c) || 0,
    maxOdds: parseFloat(jugada.maxOdds ?? apuesta?.maxOdds) || 0,
    cuotaAplicada: calcularCuotaSimpleOptionBet(apuesta)
  };
}

function formatEstadoOptionBet(estado) {
  const value = estado || "pendiente";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function detectarTipoTotalOptionBet(jugada = "") {
  const texto = String(jugada)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const numeroConSigno = String(jugada).replace(",", ".").match(/-?\d+(?:\.\d+)?/);

  if (numeroConSigno && parseFloat(numeroConSigno[0]) < 0) return "under";
  if (/\b(under|menos|menor|baja)\b/.test(texto)) return "under";
  return "over";
}

function getSimpleOptionWinInfo(apuesta) {
  const jugada = apuesta?.jugadas?.[0] || {};
  const selection = Array.isArray(jugada.selections) ? jugada.selections[0] : null;
  const textoJugada = selection?.jugada || jugada.jug || jugada.jugada || "";
  const linea = extraerNumeroJugada(textoJugada);
  const total = parseFloat(jugada.resultadoTotal ?? apuesta?.resultadoTotal);

  if (apuesta?.resultado === "perdida") {
    return {
      type: "lost",
      label: "OptionBet",
      message: "No se ha cumplido la Condición Minima"
    };
  }

  if (apuesta?.resultado !== "ganada" || linea === null || isNaN(total)) {
    return {
      type: "option",
      label: "OptionBet",
      message: ""
    };
  }

  const tipoTotal = detectarTipoTotalOptionBet(textoJugada);
  const optiTotal = tipoTotal === "under" ? Math.floor(linea) : Math.ceil(linea);
  const isOptiWin = total === optiTotal;
  const isMaxWin = tipoTotal === "under" ? total < optiTotal : total > optiTotal;

  if (isOptiWin) {
    return {
      type: "opti",
      label: "Opti-Odds",
      message: "Se ha cumplido la Condición Minima de la OptionBet"
    };
  }

  if (isMaxWin) {
    return {
      type: "max",
      label: "Max-Odds",
      message: "Se ha cumplido la Condición Maxima de la OptionBet"
    };
  }

  return {
    type: "option",
    label: "OptionBet",
    message: ""
  };
}

function getJugadaEvento(apuesta, jugada) {
  if (typeof jugada === "object" && jugada) {
    return limpiarEventoDuplicado(jugada.ev || jugada.evento || apuesta?.evento || "");
  }

  return limpiarEventoDuplicado(apuesta?.evento || "");
}

function getCasaBadgeHtml(apuesta) {
  return `<span class="casa-badge">${escapeHtml(getCasaNombre(getCasaIdApuesta(apuesta)))}</span>`;
}

function esCrearApuestaTipo(tipo) {
  return tipo === "crear_apuesta" || tipo === "crear_apuesta_simple";
}

function getReglaTiempoFutbolHtml(apuesta = {}) {
  const tieneFutbol = apuestaTieneAutoFutbol(apuesta) ||
    apuesta?.deporte === "futbol" ||
    (!apuestaPareceMlb(apuesta) && apuestaPareceFutbol(apuesta));
  if (!tieneFutbol) return "";
  return `<div class="football-time-rule">En Tiempo Reglamentario</div>`;
}

function getResultadoColor(resultado = "pendiente") {
  if (resultado === "ganada") return "#00ff88";
  if (resultado === "perdida") return "#ff4444";
  if (resultado === "nula") return "#888888";
  return "white";
}

function getEstadoSeleccionIconHtml(estado = "pendiente") {
  if ((estado || "pendiente") === "pendiente") return "";
  const config = {
    ganada: { bg: "#22c55e", color: "white", title: "Ganada", symbol: "&#10003;" },
    perdida: { bg: "#ef4444", color: "white", title: "Perdida", symbol: "&#10005;" },
    nula: { bg: "#64748b", color: "white", title: "Nula", symbol: "&#8722;" },
    pendiente: { bg: "#334155", color: "#cbd5e1", title: "Pendiente", symbol: "&#9203;" }
  };
  const item = config[estado] || config.pendiente;
  return `<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:${item.bg}; color:${item.color}; font-size:12px; cursor:pointer; transform:translateY(-2px); transition:background-color 160ms ease, color 160ms ease, transform 160ms ease;" title="${item.title}">${item.symbol}</span>`;
}

function getEstadoEspecialApuestaHtml(auto = {}) {
  const estadoEspecial = auto?.estadoEspecial;
  if (!estadoEspecial) return "";

  if (estadoEspecial.reembolso) {
    const razon = estadoEspecial.motivo || "Partido cancelado";
    return `
      <div class="bet-status-message bet-status-message--refund">
        <div class="bet-status-line bet-status-line--refund">
          <span class="bet-status-check" aria-hidden="true">&#10003;</span>
          <span>Estado: <strong>Reembolso con cuota de 1.00</strong></span>
        </div>
        <div class="bet-status-line bet-status-line--reason">
          <span>Razon: <strong>${escapeHtml(razon)}</strong></span>
        </div>
      </div>
    `;
  }

  const estado = estadoEspecial.estado || estadoEspecial.tipo || "Estado";
  const razon = estadoEspecial.motivo || "";

  return `
    <div class="bet-status-message">
      <div class="bet-status-line"><span>Estado: <strong>${escapeHtml(estado)}</strong></span></div>
      ${razon ? `<span>Razon: <strong>${escapeHtml(razon)}</strong></span>` : ""}
    </div>
  `;
}

function getEstadoJuegoLegacyHtml(estadoJuego = "") {
  if (!estadoJuego) return "";
  if (esEstadoJuegoReembolso(estadoJuego)) {
    return getEstadoEspecialApuestaHtml({
      estadoEspecial: {
        reembolso: true,
        estado: "Reembolso",
        motivo: getRazonReembolsoLegacy(estadoJuego)
      }
    });
  }

  return `<div class="auto-mlb-score auto-mlb-score--status">${escapeHtml(getEstadoJuegoTraducido(estadoJuego))}</div>`;
}

function actualizarSeleccionEstadoDom(apuesta, matchIndex, selIndex) {
  const selection = apuesta?.jugadas?.[matchIndex]?.selections?.[selIndex];
  if (!selection) return;

  const key = `${apuesta.id}-${matchIndex}-${selIndex}`;
  const wrapper = document.querySelector(`[data-selection-wrap="${key}"]`);
  const icon = document.querySelector(`[data-state-icon="${key}"]`);
  const estado = selection.estado || "pendiente";

  if (wrapper) {
    const tieneEstadoEspecial = tieneEstadoJuegoEspecial(selection.autoMlb) || tieneEstadoJuegoEspecial(selection.autoFutbol);
    wrapper.style.textDecoration = estado === "nula" && !tieneEstadoEspecial ? "line-through" : "";
    wrapper.style.opacity = estado === "nula" && !tieneEstadoEspecial ? "0.6" : "";
  }
  if (icon) {
    const iconHtml = getEstadoSeleccionIconHtml(estado);
    icon.innerHTML = iconHtml;
    icon.style.display = iconHtml ? "inline-flex" : "none";
    icon.animate?.([
      { transform: "scale(0.92)" },
      { transform: "scale(1)" }
    ], { duration: 140, easing: "ease-out" });
  }
}

function actualizarFilaCrearApuestaDom(apuesta, actualizarSelecciones = false) {
  if (!apuesta || !esCrearApuestaTipo(apuesta.tipoApuesta)) return false;

  if (actualizarSelecciones) {
    (apuesta.jugadas || []).forEach((jugada, matchIndex) => {
      (jugada.selections || []).forEach((_, selIndex) => {
        actualizarSeleccionEstadoDom(apuesta, matchIndex, selIndex);
      });
    });
  }

  const cuotaCell = document.querySelector(`[data-cuota-cell="${apuesta.id}"]`);
  const resultadoCell = document.querySelector(`[data-resultado-cell="${apuesta.id}"]`);
  const retornoCell = document.querySelector(`[data-retorno-cell="${apuesta.id}"]`);

  if (cuotaCell) cuotaCell.textContent = formatDecimal(apuesta.cuota);
  if (retornoCell) retornoCell.textContent = `$${calcularRetornoApuesta(apuesta).toFixed(2)}`;
  if (resultadoCell) {
    resultadoCell.className = apuesta.resultado || "pendiente";
    const select = resultadoCell.querySelector("select");
    if (select) {
      select.value = apuesta.resultado || "pendiente";
      select.style.color = getResultadoColor(apuesta.resultado);
    }
  }

  actualizarResumenDiaDom(apuesta.dia);
  actualizarResumenBankrollDom();
  return true;
}

function actualizarCeldasResultadoApuestaDom(apuesta) {
  if (!apuesta) return false;

  const cuotaCell = document.querySelector(`[data-cuota-cell="${apuesta.id}"]`);
  const resultadoCell = document.querySelector(`[data-resultado-cell="${apuesta.id}"]`);
  const retornoCell = document.querySelector(`[data-retorno-cell="${apuesta.id}"]`);
  if (!cuotaCell && !resultadoCell && !retornoCell) return false;

  if (cuotaCell) cuotaCell.textContent = formatDecimal(apuesta.cuota);
  if (retornoCell) retornoCell.textContent = `$${calcularRetornoApuesta(apuesta).toFixed(2)}`;
  if (resultadoCell) {
    resultadoCell.className = apuesta.resultado || "pendiente";
    const select = resultadoCell.querySelector("select");
    if (select) {
      select.value = apuesta.resultado || "pendiente";
      select.style.color = getResultadoColor(apuesta.resultado);
    }
  }

  actualizarResumenDiaDom(apuesta.dia);
  actualizarResumenBankrollDom();
  return true;
}

function actualizarApuestaParcialDom(apuesta, options = {}) {
  if (!apuesta) return false;
  if (esCrearApuestaTipo(apuesta.tipoApuesta)) {
    return actualizarFilaCrearApuestaDom(apuesta, options.actualizarSelecciones === true);
  }

  if (apuesta.tipoApuesta !== "simple") return false;
  return actualizarCeldasResultadoApuestaDom(apuesta);
}

function actualizarResumenDiaDom(dia) {
  if (!dia) return;

  let inv = 0;
  let ret = 0;
  getApuestasFiltradas().forEach(apuesta => {
    if (apuesta.dia !== dia || apuesta.resultado === "pendiente") return;
    inv += apuesta.importe || 0;
    ret += calcularRetornoApuesta(apuesta);
  });

  const balance = ret - inv;
  const invEl = document.querySelector(`[data-dia-inv="${dia}"]`);
  const retEl = document.querySelector(`[data-dia-ret="${dia}"]`);
  const balanceEl = document.querySelector(`[data-dia-balance="${dia}"]`);

  if (invEl) invEl.textContent = `$${inv.toFixed(2)}`;
  if (retEl) retEl.textContent = `$${ret.toFixed(2)}`;
  if (balanceEl) {
    balanceEl.textContent = `$${balance.toFixed(2)}`;
    balanceEl.className = balance >= 0 ? "ganada" : "perdida";
  }
}

/* =========================
   RENDER
 ========================= */
function render() {
  try {
    _render();
  } catch (error) {
    console.error("Error in render:", error);
    const contenido = document.getElementById("contenido");
    if (contenido) {
      contenido.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; color: #f87171; padding: 15px; border-radius: 8px; margin: 15px 0; font-family: monospace;">
          <h3>⚠️ Error en la visualización</h3>
          <p>${error.message}</p>
          <pre style="white-space: pre-wrap; font-size: 12px; margin-top: 10px;">${error.stack}</pre>
        </div>
      `;
    }
  }
}

let renderSnapshotPendiente = false;
function renderSnapshotProgramado() {
  if (usuarioEstaEditandoFormulario()) return;
  if (renderSnapshotPendiente) return;
  renderSnapshotPendiente = true;

  requestAnimationFrame(() => {
    const delay = paginaRecienReactivada(4000) ? 300 : 0;
    setTimeout(() => {
      renderSnapshotPendiente = false;
      if (!paginaEstaVisible()) {
        renderSnapshotProgramado();
        return;
      }
      render();
    }, delay);
  });
}

function getDiasKeysRender(apuestasRender) {
  const diasKeys = [...new Set(apuestasRender.map(a => a.fecha || a.dia || "").filter(Boolean))].sort(
    (a, b) => new Date(a) - new Date(b)
  );
  if (ultimoDiaAgregado && !diasKeys.includes(ultimoDiaAgregado)) {
    diasKeys.push(ultimoDiaAgregado);
    diasKeys.sort((a, b) => new Date(a) - new Date(b));
  }
  return diasKeys;
}

function getApuestasPorDiaPagina(apuestasRender, diasPagina) {
  const diasPaginaSet = new Set(diasPagina);
  const dias = {};
  diasPagina.forEach(dia => {
    dias[dia] = [];
  });
  apuestasRender.forEach(a => {
    const diaKey = a.fecha || a.dia || "";
    if (diasPaginaSet.has(diaKey)) {
      dias[diaKey].push(a);
    }
  });
  Object.values(dias).forEach(apuestasDia => apuestasDia.sort(compararApuestasOrdenTabla));
  return dias;
}

function renderPaginacionHtml(totalPaginas, scrollAlTop = false) {
  const total = Math.max(totalPaginas || 1, 1);
  if (paginaActual < 1) paginaActual = 1;
  if (paginaActual > total) paginaActual = total;

  if (totalPaginas > 1) {
    return `
      <div class="paginacion">
        <button onclick="cambiarPagina(-1, ${scrollAlTop})" ${paginaActual === 1 && !hayMasApuestas ? 'disabled' : ''}>⬅</button>
        <span> Página ${paginaActual} / ${total} </span>
        <button onclick="cambiarPagina(1, ${scrollAlTop})" ${paginaActual === totalPaginas ? 'disabled' : ''}>➡</button>
      </div>
    `;
  }

  if (hayMasApuestas) {
    return `
      <div class="paginacion">
        <button onclick="cambiarPagina(-1, ${scrollAlTop})">Cargar más historial</button>
      </div>
    `;
  }

  return "";
}

function renderResumenBankrollHtml(resumenYStats) {
  const total = resumenYStats.resumen;
  const roi = total.invertido ? (total.balance / total.invertido) * 100 : 0;
  const resumenCasaTitulo = filtroCasaId === CASA_TODAS_ID ? "Todas las casas" : getCasaNombre(filtroCasaId);
  const puedeEditarFinal = filtroCasaId !== CASA_TODAS_ID;

  return `
    <div class="page" id="bankrollResumen">
      <h2>Bankroll - ${escapeHtml(resumenCasaTitulo)}</h2>

      <p>Inicial:
        <strong data-bankroll-inicial>$${total.bankrollInicial.toFixed(2)}</strong>
      </p>

      <p>Invertido:
        <strong data-bankroll-invertido>$${total.invertido.toFixed(2)}</strong>
      </p>

      <p>Pendiente:
        <strong data-bankroll-pendiente style="color: white;">$${total.pendiente.toFixed(2)}</strong>
      </p>

      <p>Retornado:
        <strong data-bankroll-retornado>$${total.retornado.toFixed(2)}</strong>
      </p>

      <p>
        Balance:
        <strong data-bankroll-balance class="${total.balance >= 0 ? 'ganada' : 'perdida'}">
          $${total.balance.toFixed(2)}
        </strong>
      </p>

      ${isEditingFinal && puedeEditarFinal ? `
        <p style="display: flex; align-items: center; gap: 8px; margin: 0 0 8px 0; padding: 0;">
          <span style="font-size: 16px; font-weight: 600; color: #cbd5e1; margin: 0; line-height: 1;">Final:</span>
          <input type="number" step="0.01" id="editBankrollFinalInput" value="${total.bankrollFinal.toFixed(2)}" style="width: 100px; height: 34px; background: #1e293b; color: white; border: 1px solid #475569; padding: 0 10px; border-radius: 6px; font-weight: bold; font-family: inherit; font-size: 14px; box-sizing: border-box; outline: none; margin: 0;">
          <button onclick="window.guardarAjusteFinal()" style="display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 6px; color: #4ade80; cursor: pointer; font-size: 14px; box-sizing: border-box; transition: background 0.2s; margin: 0;" title="Guardar">💾</button>
          <button onclick="window.setEditingFinal(false)" style="display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; color: #f87171; cursor: pointer; font-size: 14px; box-sizing: border-box; transition: background 0.2s; margin: 0;" title="Cancelar">❌</button>
        </p>
      ` : `
        <p style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          Final:
          <strong data-bankroll-final class="${total.bankrollFinal >= total.bankrollInicial ? 'ganada' : 'perdida'}">
            $${total.bankrollFinal.toFixed(2)}
          </strong>
          ${puedeEditarFinal ? `<button onclick="window.setEditingFinal(true)" style="background: none; border: none; cursor: pointer; font-size: 14px; opacity: 0.6; padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; margin: 0;" title="Ajustar saldo final">✏️</button>` : ""}
        </p>
        ${!puedeEditarFinal ? `
          <p style="font-size: 12px; color: #94a3b8; margin-top: -4px; margin-bottom: 12px;">
            Filtra una casa especifica para ajustar el saldo final.
          </p>
        ` : ""}
        ${total.bankrollAjuste !== 0 ? `
          <p style="font-size: 12px; color: #94a3b8; margin-top: -4px; margin-bottom: 12px; font-style: italic;">
            (Ajuste manual: ${total.bankrollAjuste >= 0 ? '+' : ''}$${total.bankrollAjuste.toFixed(2)})
          </p>
        ` : ''}
      `}

      <p>
        ROI:
        <strong data-bankroll-roi class="${roi >= 0 ? 'ganada' : 'perdida'}">
          ${roi.toFixed(2)}%
        </strong>
      </p>
    </div>
  `;
}

function renderEstadisticasHtml(stats) {
  return `
    <div class="page stats-box">
      <h2>📊 Estadísticas</h2>

      <div class="stat">
        <div class="stat-label">
          Ganadas ${stats.pGanadas.toFixed(1)}%
        </div>
        <div class="stat-bar">
          <div class="stat-fill ganada"
               style="width:${stats.pGanadas}%"></div>
        </div>
      </div>

      <div class="stat">
        <div class="stat-label">
          Perdidas ${stats.pPerdidas.toFixed(1)}%
        </div>
        <div class="stat-bar">
          <div class="stat-fill perdida"
               style="width:${stats.pPerdidas}%"></div>
        </div>
      </div>

      <div class="stat">
        <div class="stat-label">
          Nulas ${stats.pNulas.toFixed(1)}%
        </div>
        <div class="stat-bar">
          <div class="stat-fill nula"
               style="width:${stats.pNulas}%"></div>
        </div>
      </div>

      <div class="stat">
        <div class="stat-label">
          Pendientes ${stats.pPendientes.toFixed(1)}%
        </div>
        <div class="stat-bar">
          <div class="stat-fill pendiente"
               style="width:${stats.pPendientes}%"></div>
        </div>
      </div>
    </div>
  `;
}

function renderBotonNuevaApuesta() {
  let old = document.getElementById("btnNuevaApuestaBottom");
  if (old) old.remove();

  const btn = document.createElement("button");
  btn.id = "btnNuevaApuestaBottom";
  btn.innerText = "+";

  Object.assign(btn.style, {
    position: "fixed",
    right: "20px",
    bottom: "90px",
    width: "55px",
    height: "55px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "28px",
    fontWeight: "bold",
    color: "black",
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    background: "linear-gradient(135deg,#00ff88,#00c6ff)",
    boxShadow: "0 0 15px rgba(0,255,136,0.6)",
    zIndex: 9999
  });

  btn.onclick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      document.getElementById("fecha")?.focus();
    }, 300);
  };

  document.body.appendChild(btn);
}

function programarScrollUltimoDiaAgregado() {
  if (!ultimoDiaAgregado) return;

  const intentarScroll = () => {
    const elemento = document.querySelector(`[data-dia="${ultimoDiaAgregado}"]`);
    if (elemento) {
      const tabla = elemento.querySelector("table");
      elemento.scrollIntoView({ block: "start" });
      if (tabla) {
        tabla.scrollIntoView({ block: "center" });
      }
      ultimoDiaAgregado = null;
      ultimoDiaAgregadoIntentos = 0;
      return;
    }

    ultimoDiaAgregadoIntentos++;
    if (ultimoDiaAgregadoIntentos < 10) {
      setTimeout(intentarScroll, 300);
    } else {
      ultimoDiaAgregado = null;
      ultimoDiaAgregadoIntentos = 0;
    }
  };
  setTimeout(intentarScroll, 300);
}

function postRenderCompleto() {
  if (editandoId) {
    const editCard = document.getElementById(`edit-tarjeta-${editandoId}`);
    if (editCard) habilitarAutocompleteMlb(editCard);
  }

  renderBotonNuevaApuesta();
  programarScrollUltimoDiaAgregado();
}

function _render() {
  const contenido = document.getElementById("contenido");
  if (!contenido) return;

  const apuestasRender = getApuestasFiltradas();
  const diasKeys = getDiasKeysRender(apuestasRender);

  const totalPaginas = Math.ceil(diasKeys.length / porPagina);

  if (paginaActual > totalPaginas) {
    paginaActual = totalPaginas || 1;
  }

  const inicio = (paginaActual - 1) * porPagina;
  const fin = inicio + porPagina;

  const diasPagina = diasKeys.slice(inicio, fin);
  const dias = getApuestasPorDiaPagina(apuestasRender, diasPagina);

  let html = renderPaginacionHtml(totalPaginas, false);

  if (false) {
  if (totalPaginas > 1) {
    html += `
      <div class="paginacion">
        <button onclick="cambiarPagina(-1, false)" ${paginaActual === 1 && !hayMasApuestas ? 'disabled' : ''}>⬅</button>
        <span> Página ${paginaActual} / ${totalPaginas} </span>
        <button onclick="cambiarPagina(1, false)" ${paginaActual === totalPaginas ? 'disabled' : ''}>➡</button>
      </div>
    `;
  } else if (hayMasApuestas) {
    html += `
      <div class="paginacion">
        <button onclick="cambiarPagina(-1, false)">Cargar más historial</button>
      </div>
    `;
  }
  }

  diasPagina.forEach(dia => {
    let inv = 0;
    let ret = 0;
    let filas = "";
    const apuestasDia = dias[dia] || [];
    const editIndex = editandoId ? apuestasDia.findIndex(apuesta => apuesta.id === editandoId) : -1;
    const limiteVisible = Math.max(
      apuestasVisiblesPorDia[dia] || APUESTAS_VISIBLES_POR_DIA,
      editIndex >= 0 ? editIndex + 1 : 0
    );

    apuestasDia.forEach((a, index) => {
      const r = calcularRetornoApuesta(a);

      if (a.resultado !== "pendiente") {
        inv += a.importe;
        ret += r;
      }

      if (index >= limiteVisible) return;

      const fechaBase = a.fecha || a.dia || "";
      const [year, month, day] = fechaBase ? fechaBase.split("-") : ["", "", ""];
      let fechaFormateada = (day && month && year) ? `${day}/${month}/${year}` : (fechaBase || "—");

      const reglaTiempoFutbolHtml = getReglaTiempoFutbolHtml(a);
      let celdaEvento = "";
      if (a.jugadas && a.jugadas.length > 0) {
        const fallbackFechaJuegoApuesta = getFechaJuegoFallbackApuesta(a);

        if (a.tipoApuesta === "crear_apuesta" || a.tipoApuesta === "crear_apuesta_simple") {
          // ── CREAR APUESTA: título sin punto, cada selección con su propio punto ──
          const allTimelineItems = [];
          const hasMultipleSlots = a.jugadas.length > 1;
          const isCrearSimple = a.tipoApuesta === "crear_apuesta_simple";
          const themeColor = isCrearSimple ? "#34d399" : "#818cf8";
          const glowColor = isCrearSimple ? "rgba(52,211,153,0.6)" : "rgba(129,140,248,0.6)";
          const isSimpleOptionBet = false;

          a.jugadas.forEach((j, matchIndex) => {
            const evText = getJugadaEvento(a, j);
            const matchCuotaText = (typeof j === "object" && j.c) ? `<span style="color:${themeColor}; font-weight:bold; margin-left:6px;">(${j.c})</span>` : "";

            let selections = [];
            if (typeof j === "object") {
              if (j.selections) {
                selections = j.selections;
              } else {
                selections = [{ titulo: "", jugada: j.jug || j.jugada || "", estado: j.estado || "pendiente" }];
              }
            } else {
              selections = [{ titulo: "", jugada: j || "", estado: "pendiente" }];
            }
            const jugadaRender = (typeof j === "object" && j) ? { ...j, selections } : { selections };
            const suppressScheduleForMatch = jugadaTieneResultadoAutoVisible(jugadaRender);

            selections.forEach((sel, selIndex) => {
              const jEstado = getEstadoSeleccionRender(sel, j, evText);
              const iconHtml = getEstadoSeleccionIconHtml(jEstado);
              const estadoIcon = iconHtml
                ? `<span data-state-icon="${a.id}-${matchIndex}-${selIndex}" onclick="window.toggleEstadoSeleccion('${a.id}', ${matchIndex}, ${selIndex}, this)" style="margin-left:8px; display:inline-flex; vertical-align:middle;">${iconHtml}</span>`
                : "";

              const tieneEstadoEspecial = tieneEstadoJuegoEspecial(sel.autoMlb) || tieneEstadoJuegoEspecial(sel.autoFutbol);
              let styleMod = "";
              if (jEstado === "nula" && !tieneEstadoEspecial) styleMod = "text-decoration: line-through; opacity: 0.6;";

              // En multi-slot, la primera selección de cada slot muestra el nombre del partido
              const formattedEvText = formatTextWithCorners(evText);
              const slotHeaderHtml = (hasMultipleSlots && selIndex === 0 && evText)
                ? `<div style="font-size:14px; color:#ffffff; font-weight:600; margin-bottom:2px;">${formattedEvText}${matchCuotaText}</div>`
                : "";

              const selAutoRender = prepararSeleccionAutoFutbolRender(sel, j, evText);
              const detalleSeleccion = detectarDetalleSeleccionCrear({ ...selAutoRender, evento: evText });
              const tituloNormalizado = normalizarTextoMercado(detalleSeleccion.titulo);
              const tieneContextoMlbRender = esContextoMlb(evText, selAutoRender, j, detectarEquiposMlb);
              const forceGoalIcon = debeForzarIconoGol({ isSimpleOptionBet, tituloNormalizado, contextoMlb: tieneContextoMlbRender });
              const forceCornerIcon = /\b(corner|esquina)\b/.test(tituloNormalizado);
              const forceCardIcon = /\btarjetas?\b/.test(tituloNormalizado);
              const formattedTitulo = formatTextWithMlbTeams(detalleSeleccion.titulo);
              const formattedJugada = tituloNormalizado === "handicap"
                ? formatHandicapJugada(detalleSeleccion.jugada)
                : formatTextWithCorners(detalleSeleccion.jugada, forceGoalIcon, forceCornerIcon, forceCardIcon);
              const autoMlbMarcadorHtml = getAutoMarcadorSeleccionHtml(selAutoRender, j, {
                apuestaId: a.id,
                matchIndex,
                selIndex,
                showAutoMeta: selIndex === selections.length - 1,
                showFinalStatus: selIndex === selections.length - 1,
                suppressSchedule: suppressScheduleForMatch,
                evento: evText,
                fallbackFechaJuego: fallbackFechaJuegoApuesta
              });
              allTimelineItems.push({
                html: `
                  <div data-selection-wrap="${a.id}-${matchIndex}-${selIndex}" style="display:flex; flex-direction:column; gap:1px; ${styleMod}">
                    ${slotHeaderHtml}
                    ${detalleSeleccion.titulo ? `<div style="font-size:12px; color:#a3a3a3; font-weight:600;">${formattedTitulo}</div>` : ""}
                    <div class="bet-selection-line" style="font-size:13px; color:#ffffff; font-weight:600;">
                      <span class="bet-selection-value">${formattedJugada}</span>${estadoIcon}
                    </div>
                    ${autoMlbMarcadorHtml}
                  </div>
                `
              });
            });
          });

          const itemsHtml = allTimelineItems.map((item, idx) => {
            const isLast = idx === allTimelineItems.length - 1;
            const dotHtml = `<div style="width:6px; height:6px; background-color:${themeColor}; border-radius:50%; margin-top:6px; z-index:1; box-shadow:0 0 5px ${glowColor};"></div>`;
            return `
              <div style="display:flex; position:relative; margin-bottom:${isLast ? '0' : '12px'}; align-items: flex-start;">
                <div style="width:20px; display:flex; flex-direction:column; align-items:center; flex-shrink:0; align-self: stretch;">
                  ${dotHtml}
                  ${!isLast ? `<div style="width:2px; background-color:${themeColor}; flex-grow:1; margin-top:2px; margin-bottom:-14px; opacity:0.7;"></div>` : ''}
                </div>
                <div style="flex-grow: 1; padding-left: 4px;">
                  ${item.html}
                </div>
              </div>
            `;
          }).join('');

          // Título del evento principal SIN punto amarillo
          const eventoMostrado = limpiarEventoDuplicado(a.evento);
          const formattedEvento = formatTextWithCorners(eventoMostrado);
          const tituloCrearHtml = eventoMostrado
            ? `<div style="color:#fff; font-size:15px; font-weight:700; margin-bottom:8px;">${formattedEvento}</div>`
            : '';

          celdaEvento = `<div style="text-align: left; min-width: 150px;">
            ${tituloCrearHtml}
            <div style="padding-left:4px;">${itemsHtml}</div>
            ${reglaTiempoFutbolHtml}
          </div>`;

        } else {
          // ── COMBINADA / SIMPLE: lógica original (un punto por partido) ──
          const timelineItems = [];
          const isSimpleBet = a.tipoApuesta === "simple";
          const isSimpleOptionBet = a.tipoApuesta === "simple_option_bet";
          const isPatente = a.tipoApuesta === "patente";
          const themeColor = isSimpleBet ? "#00c6ff" : (isSimpleOptionBet ? "#22d3ee" : (isPatente ? "#fb7185" : "#fbbf24"));
          const glowColor = isSimpleBet ? "rgba(0,198,255,0.6)" : (isSimpleOptionBet ? "rgba(34,211,238,0.6)" : (isPatente ? "rgba(251,113,133,0.6)" : "rgba(251,191,36,0.6)"));

          a.jugadas.forEach((j, matchIndex) => {
            const evText = getJugadaEvento(a, j);
            const matchCuotaText = (!isSimpleBet && !isSimpleOptionBet && typeof j === "object" && j.c) ? `<span style="color:${themeColor}; font-weight:bold; margin-left:6px;">(${j.c})</span>` : "";
            const optionDetalleHtml = isSimpleOptionBet && typeof j === "object"
              ? `<div style="font-size:12px; color:#cbd5e1; margin-top:4px; display:flex; gap:10px; flex-wrap:wrap;">
                  <span>Opti odds: <strong style="color:${themeColor};">${formatCuotaTabla(j.optiOdds)}</strong></span>
                  <span>Max odds: <strong style="color:${themeColor};">${formatCuotaTabla(j.maxOdds)}</strong></span>
                </div>`
              : "";

            let selections = [];
            if (typeof j === "object") {
              if (j.selections) {
                selections = j.selections;
              } else {
                selections = [{ titulo: "", jugada: j.jug || j.jugada || "", estado: j.estado || "pendiente" }];
              }
            } else {
              selections = [{ titulo: "", jugada: j || "", estado: "pendiente" }];
            }
            const jugadaRender = (typeof j === "object" && j) ? { ...j, selections } : { selections };
            const suppressScheduleForMatch = jugadaTieneResultadoAutoVisible(jugadaRender);

            const selectionsHtml = selections.map((sel, selIndex) => {
              const jEstado = getEstadoSeleccionRender(sel, j, evText);
              const iconHtml = getEstadoSeleccionIconHtml(jEstado);
              const estadoIcon = (!iconHtml || isSimpleBet || isSimpleOptionBet) ? "" : `<span onclick="window.toggleEstadoSeleccion('${a.id}', ${matchIndex}, ${selIndex})" style="margin-left:8px; display:inline-flex; vertical-align:middle;">${iconHtml}</span>`;

              const tieneEstadoEspecial = tieneEstadoJuegoEspecial(sel.autoMlb) || tieneEstadoJuegoEspecial(sel.autoFutbol);
              let styleMod = "";
              if (jEstado === "nula" && !tieneEstadoEspecial) styleMod = "text-decoration: line-through; opacity: 0.6;";

              const selAutoRender = prepararSeleccionAutoFutbolRender(sel, j, evText);
              const detalleSeleccion = detectarDetalleSeleccionCrear({ ...selAutoRender, evento: evText });
              const tituloNormalizado = normalizarTextoMercado(detalleSeleccion.titulo);
              const tieneContextoMlbRender = esContextoMlb(evText, selAutoRender, j, detectarEquiposMlb);
              const forceGoalIcon = debeForzarIconoGol({ isSimpleOptionBet, tituloNormalizado, contextoMlb: tieneContextoMlbRender });
              const forceCornerIcon = /\b(corner|esquina)\b/.test(tituloNormalizado);
              const forceCardIcon = /\btarjetas?\b/.test(tituloNormalizado);
              const tituloVisible = detalleSeleccion.titulo || sel.titulo || "";
              const formattedJugada = formatTextWithCorners(detalleSeleccion.jugada || sel.jugada, forceGoalIcon, forceCornerIcon, forceCardIcon);
              const selectionLineClass = isPatente ? 'patente-selection-line' : '';
              const selectionTextClass = isPatente ? 'patente-selection-text' : '';
              const autoMlbMarcadorHtml = getAutoMarcadorSeleccionHtml(selAutoRender, j, {
                apuestaId: a.id,
                matchIndex,
                selIndex,
                showAutoMeta: selIndex === selections.length - 1,
                showFinalStatus: selIndex === selections.length - 1,
                suppressSchedule: suppressScheduleForMatch,
                evento: evText,
                fallbackFechaJuego: fallbackFechaJuegoApuesta
              });
              return `
                <div style="display:flex; flex-direction:column; gap:1px; ${styleMod} margin-top:4px;">
                  ${tituloVisible ? `<div style="font-size:11px; color:${themeColor}; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">${formatTextWithMlbTeams(tituloVisible)}</div>` : ""}
                  <div class="bet-selection-line ${selectionLineClass}" style="font-size:13px; color:#ffffff; font-weight:600;">
                    <span class="bet-selection-value ${selectionTextClass}">${formattedJugada}</span>${estadoIcon}
                  </div>
                  ${autoMlbMarcadorHtml}
                </div>
              `;
            }).join('');

            const formattedEvText = formatTextWithCorners(evText);
            timelineItems.push({
              html: `
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <div style="font-size:14px; color:#ffffff; font-weight:700; display:flex; align-items:center;">
                    ${formattedEvText} ${matchCuotaText}
                  </div>
                  <div style="padding-left:12px; border-left:1px dashed ${
                    themeColor === '#00c6ff' ? 'rgba(0,198,255,0.25)' : 
                    themeColor === '#22d3ee' ? 'rgba(34,211,238,0.25)' :
                    themeColor === '#fb7185' ? 'rgba(251,113,133,0.25)' : 
                    themeColor === '#fbbf24' ? 'rgba(251,191,36,0.25)' : 
                    themeColor === '#818cf8' ? 'rgba(129,140,248,0.25)' : 
                    themeColor === '#34d399' ? 'rgba(52,211,153,0.25)' : 
                    'rgba(251,191,36,0.25)'
                  }; margin-left:2px; margin-top:2px; padding-bottom:4px;">
                    ${selectionsHtml}
                    ${optionDetalleHtml}
                  </div>
                </div>
              `
            });
          });

          const itemsHtml = timelineItems.map((item, idx) => {
            const isLast = idx === timelineItems.length - 1;
            const dotHtml = `<div style="width:6px; height:6px; background-color:${themeColor}; border-radius:50%; margin-top:6px; z-index:1; box-shadow:0 0 5px ${glowColor};"></div>`;
            return `
              <div style="display:flex; position:relative; margin-bottom:${isLast ? '0' : '12px'}; align-items: flex-start;">
                <div style="width:20px; display:flex; flex-direction:column; align-items:center; flex-shrink:0; align-self: stretch;">
                  ${dotHtml}
                  ${!isLast ? `<div style="width:2px; background-color:${themeColor}; flex-grow:1; margin-top:2px; margin-bottom:-14px; opacity:0.7;"></div>` : ''}
                </div>
                <div style="flex-grow: 1; padding-left: 4px;">
                  ${item.html}
                </div>
              </div>
            `;
          }).join('');

          const eventoMostrado = limpiarEventoDuplicado(a.evento);
          const formattedEvento = formatTextWithCorners(eventoMostrado);
          let tituloHtml = (!isSimpleBet && !isSimpleOptionBet && eventoMostrado) ? `<div style="color: #fff; font-size: 16px; font-weight: 600; margin-bottom: 8px;">${formattedEvento}</div>` : '';
          const resumenPatente = isPatente
            ? (() => {
              const detalle = calcularDetallePatente(a);
              const retornoMaximo = detalle.cuotaMaxima * (parseFloat(a.importe) || 0);
              return `<div style="font-size:12px; color:#cbd5e1; margin:-2px 0 8px 0;">
                Patente: ${a.jugadas.length} selecciones &middot; ${detalle.totalCombinaciones} comb. &middot; $${detalle.importePorCombinacion.toFixed(2)} c/u &middot; Ganadoras: ${detalle.combinacionesGanadas} &middot; Max: $${retornoMaximo.toFixed(2)}
              </div>`;
            })()
            : "";
          celdaEvento = `<div style="text-align: left; min-width: 150px;">
            ${tituloHtml}
            ${resumenPatente}
            <div style="padding-left:4px;">${itemsHtml}</div>
            ${reglaTiempoFutbolHtml}
          </div>`;
        }

      } else {
        const formattedEvento = formatTextWithCorners(limpiarEventoDuplicado(a.evento));
        celdaEvento = `<div style="text-align: left; min-width: 150px;"><strong>${formattedEvento}</strong>${reglaTiempoFutbolHtml}</div>`;
      }


      if (editandoId === a.id) {
        const eventoEscapado = limpiarEventoDuplicado(a.evento || "").replace(/"/g, '&quot;');

        const isCrearSimple = a.tipoApuesta === "crear_apuesta_simple";
        const isCrear = a.tipoApuesta === "crear_apuesta";
        const isSimple = a.tipoApuesta === "simple";
        const isSimpleOption = a.tipoApuesta === "simple_option_bet";
        const isCombinada = a.tipoApuesta === "combinada";
        const isPatente = a.tipoApuesta === "patente";
        const isMulti = isCombinada || isPatente || isCrear || isCrearSimple || (a.tipoApuesta !== "simple" && a.tipoApuesta !== "simple_option_bet" && a.jugadas && a.jugadas.length > 1);

        let badgeColor = '#fbbf24';
        let borderColor = '#fbbf24';
        let boxShadow = '0 0 12px rgba(251,191,36,0.15)';
        let subThemeColor = '#fbbf24';

        if (isPatente) {
          badgeColor = '#fb7185';
          borderColor = '#fb7185';
          boxShadow = '0 0 12px rgba(251,113,133,0.15)';
          subThemeColor = '#fb7185';
        } else if (isCrear) {
          badgeColor = '#818cf8';
          borderColor = '#818cf8';
          boxShadow = '0 0 12px rgba(129,140,248,0.15)';
          subThemeColor = '#818cf8';
        } else if (isCrearSimple) {
          badgeColor = '#34d399';
          borderColor = '#34d399';
          boxShadow = '0 0 12px rgba(52,211,153,0.15)';
          subThemeColor = '#34d399';
        } else if (isSimple) {
          badgeColor = '#00c6ff';
          borderColor = '#334155';
          boxShadow = 'none';
          subThemeColor = '#00c6ff';
        } else if (isSimpleOption) {
          badgeColor = '#22d3ee';
          borderColor = '#22d3ee';
          boxShadow = '0 0 12px rgba(34,211,238,0.15)';
          subThemeColor = '#22d3ee';
        }

        const tipoApuestaEdit = `
          <select id="edit-tipo-${a.id}" onchange="window.cambiarTipoEdicion('${a.id}', this.value)"
            class="edit-tipo-select ${a.tipoApuesta}">
            <option value="simple" ${isSimple ? 'selected' : ''}>Simple</option>
            <option value="combinada" ${isCombinada ? 'selected' : ''}>Combinada</option>
            <option value="patente" ${isPatente ? 'selected' : ''}>Patente</option>
            <option value="crear_apuesta" ${isCrear ? 'selected' : ''}>Crear Apuesta Combinada</option>
            <option value="crear_apuesta_simple" ${isCrearSimple ? 'selected' : ''}>Crear Apuesta Simple</option>
            <option value="simple_option_bet" ${isSimpleOption ? 'selected' : ''}>Simple Option Bet</option>
          </select>
        `;
        const casaApuestaEdit = `
          <select id="edit-casa-${a.id}">
            ${getCasasParaEdicion(a).map(c => `<option value="${escapeHtml(c.id)}" ${getCasaIdApuesta(a) === c.id ? 'selected' : ''}>${escapeHtml(c.nombre)}${c.activa === false ? " (inactiva)" : ""}</option>`).join("")}
          </select>
        `;

        let jugadasEditHtml = `<div id="edit-jugadas-container-${a.id}" style="display:flex; flex-direction:column; gap:10px;">`;
        if (a.jugadas && a.jugadas.length > 0) {
          a.jugadas.forEach((j, matchIndex) => {
            const evVal = getJugadaEvento(a, j);
            const cVal = (typeof j === "object" && j.c !== undefined ? j.c : 0);
            const evEsc = evVal.replace(/"/g, '&quot;');

            let selections = [];
            if (typeof j === "object") {
              if (j.selections) {
                selections = j.selections;
              } else {
                selections = [{ titulo: "", jugada: j.jug || j.jugada || "", estado: j.estado || "pendiente" }];
              }
            } else {
              selections = [{ titulo: "", jugada: j || "", estado: "pendiente" }];
            }

            let selectionsHtml = `<div class="edit-selections-container" style="display:flex; flex-direction:column; gap:4px;">`;
            selections.forEach((sel, selIndex) => {
              selectionsHtml += window.crearFilaSeleccionEditHTML(a.id, selIndex, sel.titulo || "", sel.jugada || "", selections.length > 1);
            });
            selectionsHtml += `</div>`;
            const resultadoTotalVal = (typeof j === "object" && j.resultadoTotal !== undefined && j.resultadoTotal !== null) ? j.resultadoTotal : "";
            const optiOddsVal = (typeof j === "object" && j.optiOdds !== undefined) ? j.optiOdds : cVal;
            const maxOddsVal = (typeof j === "object" && j.maxOdds !== undefined) ? j.maxOdds : "";
            const simpleOptionHtml = isSimpleOption ? `
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:4px;">
                  <span style="font-size:11px; color:#94a3b8; font-weight:600;">Max odds:</span>
                  <input type="number" class="edit-simple-option-max-input" value="${maxOddsVal}" placeholder="2.483" step="0.001" min="0" oninput="window.calcularCuotaEditSimpleOption('${a.id}')" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')"
                    style="width:100px; background:#1e293b; color:${subThemeColor}; border:1px dashed ${subThemeColor}; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
                  <span style="font-size:11px; color:#94a3b8; font-weight:600;">Opti odds:</span>
                  <input type="number" class="edit-simple-option-opti-input" value="${optiOddsVal}" placeholder="1.546" step="0.001" min="0" oninput="window.calcularCuotaEditSimpleOption('${a.id}')" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')"
                    style="width:100px; background:#1e293b; color:${subThemeColor}; border:1px dashed ${subThemeColor}; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
                </div>
              ` : "";

            jugadasEditHtml += `
              <div class="edit-jugada-slot-${a.id}" style="display:flex; flex-direction:column; gap:6px; border:1px solid #475569; border-radius:8px; padding:10px; background:#111827;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                  <span style="font-size:11px; font-weight:700; color:${subThemeColor};">${isPatente ? 'Seleccion' : 'Partido'} #${matchIndex + 1}</span>
                  <button type="button" class="btn-eliminar-slot" onclick="window.eliminarSlotEdit(this, '${a.id}')" title="Eliminar partido" style="display:${isMulti ? 'inline-block' : 'none'}; padding:2px 7px; margin-top:0;">&#10005;</button>
                </div>
                
                <input type="text" class="edit-jugada-ev-input" value="${evEsc}" placeholder="Partido/Evento"
                  style="background:#1e293b; color:#f1f5f9; border:1px solid #334155; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:600; width:100%; box-sizing:border-box;">
                
                ${selectionsHtml}
                
                <button type="button" onclick="window.agregarSeleccionEdit(this, '${a.id}')"
                  style="display:${isSimpleOption ? 'none' : 'inline-block'}; align-self:flex-start; font-size:11px; padding:3px 10px; background:${subThemeColor}; color:black; font-weight:bold; border-radius:4px; border:none; cursor:pointer; margin-top:6px;">➕ Agregar selección</button>

                ${simpleOptionHtml}

                <div style="display:${isMulti && !isSimpleOption ? 'flex' : 'none'}; align-items:center; gap:8px; margin-top:4px;">
                  <span style="font-size:11px; color:#94a3b8; font-weight:600;">Cuota:</span>
                  <input type="number" class="edit-jugada-cuota-input" value="${cVal}" placeholder="1.80" step="0.01" oninput="window.calcularCuotaEditCombinada('${a.id}')" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')"
                    style="width:100px; background:#1e293b; color:${subThemeColor}; border:1px dashed ${subThemeColor}; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
                </div>
              </div>`;
          });
        }
        jugadasEditHtml += `</div>`;

        const btnAddJugada = `<button type="button" id="edit-btn-agregar-${a.id}" onclick="window.agregarJugadaEdit('${a.id}')"
          style="margin-top:6px; padding:5px 10px; font-size:13px; background:${subThemeColor}; color:black; border:none; border-radius:6px; cursor:pointer; font-weight:bold; display:${isMulti ? 'inline-block' : 'none'};">➕ Agregar partido</button>`;

        filas += `
          <tr>
            <td>${fechaFormateada}<br>${getCasaBadgeHtml(a)}</td>
            <td colspan="5" class="apuesta-edit-cell">
              <div class="apuesta-edit-card ${a.tipoApuesta}" id="edit-tarjeta-${a.id}">
                <div class="apuesta-edit-header">
                  ${tipoApuestaEdit}
                  <span style="font-size:13px; color:#64748b;">Detalle de la apuesta</span>
                </div>
                <input type="text" id="edit-evento-${a.id}" value="${eventoEscapado}"
                  placeholder="Evento Principal (Ej: Combinada MLB)"
                  style="background:#1e293b; color:white; border:1px solid #334155; border-radius:8px; padding:9px 12px; font-size:16px; font-weight:600; width:100%; box-sizing:border-box; display:${isMulti ? 'block' : 'none'};">
                ${jugadasEditHtml}
                <div class="apuesta-edit-meta">
                  <label class="apuesta-edit-field">
                    <span>Fecha</span>
                    <input type="date" id="edit-fecha-${a.id}" value="${a.fecha || a.dia || ''}">
                  </label>
                  <label class="apuesta-edit-field">
                    <span>Hora</span>
                    <input type="time" id="edit-hora-${a.id}" value="${a.hora || ''}">
                  </label>
                  <label class="apuesta-edit-field">
                    <span>Casa</span>
                    ${casaApuestaEdit}
                  </label>
                  <label class="apuesta-edit-field">
                    <span>Cuota</span>
                    <input type="number" step="0.01" id="edit-cuota-${a.id}" value="${formatDecimal(a.cuota)}" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')">
                  </label>
                  <label class="apuesta-edit-field">
                    <span>Importe</span>
                    <span class="apuesta-edit-money">
                      <span>$</span>
                      <input type="number" step="0.01" id="edit-importe-${a.id}" value="${formatDecimal(a.importe)}" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')">
                    </span>
                  </label>
                  <label class="apuesta-edit-field">
                    <span>Estado</span>
                    <select onchange="window.cambiarEstado('${a.id}', this.value)" 
                            style="color: ${a.resultado === 'ganada' ? '#00ff88' :
            a.resultado === 'perdida' ? '#ff4444' :
              a.resultado === 'nula' ? '#888888' :
                'white'
          }; background: #1a1a1a; border: none; font-weight: bold; cursor: pointer; padding: 4px 8px; border-radius: 4px;">
                      <option value="pendiente" ${a.resultado === 'pendiente' ? 'selected' : ''}>pendiente</option>
                      <option value="ganada" ${a.resultado === 'ganada' ? 'selected' : ''}>ganada</option>
                      <option value="perdida" ${a.resultado === 'perdida' ? 'selected' : ''}>perdida</option>
                      <option value="nula" ${a.resultado === 'nula' ? 'selected' : ''}>nula</option>
                    </select>
                  </label>
                </div>
                ${btnAddJugada}
              </div>
            </td>
            <td class="acciones-tabla">
              <button onclick="window.guardarEdicion('${a.id}')" title="Guardar">💾</button>
              <button onclick="window.cancelarEdicion()" title="Cancelar">❌</button>
            </td>
          </tr>
        `;
      } else {
        if (a.tipoApuesta === "patente") {
          filas += `
          <tr class="patente-table-row">
            <td colspan="7" class="patente-table-cell">
              <div class="patente-card">
                <div class="patente-date">${fechaFormateada}<br>${getCasaBadgeHtml(a)}</div>
                <div class="patente-detail">
                  ${celdaEvento}
                  <div class="patente-row-numbers">
                    <span title="${formatDecimal(a.cuota)}">Cuota <strong>${formatCuotaTabla(a.cuota)}</strong></span>
                    <span>Importe <strong>$${formatDecimal(a.importe)}</strong></span>
                    <span>Retorno <strong>$${r.toFixed(2)}</strong></span>
                  </div>
                </div>
                <div class="${a.resultado} patente-state">
                  <select onchange="window.cambiarEstado('${a.id}', this.value)"
                          style="color: ${a.resultado === 'ganada' ? '#00ff88' :
              a.resultado === 'perdida' ? '#ff4444' :
                a.resultado === 'nula' ? '#888888' :
                  'white'
            }; background: #1a1a1a; border: none; font-weight: bold; cursor: pointer; padding: 4px 8px; border-radius: 4px;">
                    <option value="pendiente" ${a.resultado === 'pendiente' ? 'selected' : ''}>pendiente</option>
                    <option value="ganada" ${a.resultado === 'ganada' ? 'selected' : ''}>ganada</option>
                    <option value="perdida" ${a.resultado === 'perdida' ? 'selected' : ''}>perdida</option>
                    <option value="nula" ${a.resultado === 'nula' ? 'selected' : ''}>nula</option>
                  </select>
                </div>
                <div class="acciones-tabla patente-actions">
                  <button onclick="window.habilitarEdicion('${a.id}')" title="Editar">&#9999;&#65039;</button>
                  <button onclick="window.eliminar('${a.id}')" title="Eliminar">&#128465;&#65039;</button>
                </div>
              </div>
            </td>
          </tr>
        `;
        } else {
          const resultadoCellHtml = a.tipoApuesta === "simple_option_bet"
            ? (() => {
              const totalVal = a.jugadas?.[0]?.resultadoTotal;
              const hasTotal = totalVal !== undefined && totalVal !== null && totalVal !== "";
              const estadoTexto = hasTotal ? a.resultado : "pendiente";
              const winInfo = getSimpleOptionWinInfo(a);
              const estadoIconHtml = estadoTexto === "ganada"
                ? `<span class="simple-option-status-icon" aria-hidden="true">&#10003;</span>`
                : estadoTexto === "perdida"
                  ? `<span class="simple-option-status-icon simple-option-status-icon--lost" aria-hidden="true">&#10005;</span>`
                  : "";
              return `
                <div class="simple-option-result">
                  <input type="number" value="${hasTotal ? totalVal : ""}" placeholder="Total" step="1" min="0"
                    onchange="window.actualizarResultadoTotalSimpleOption('${a.id}', this.value)"
                    onkeydown="if(event.key === 'Enter') this.blur()"
                    class="simple-option-total-input">
                  <span class="simple-option-status simple-option-status--${estadoTexto} simple-option-status--${winInfo.type}">
                    ${estadoIconHtml}
                    <span class="simple-option-status-copy">
                      <span>${winInfo.label}</span>
                      <strong>${formatEstadoOptionBet(estadoTexto)}</strong>
                    </span>
                  </span>
                </div>
              `;
            })()
            : `
              <select onchange="window.cambiarEstado('${a.id}', this.value)" 
                      style="color: ${a.resultado === 'ganada' ? '#00ff88' :
              a.resultado === 'perdida' ? '#ff4444' :
                a.resultado === 'nula' ? '#888888' :
                  'white'
            }; background: #1a1a1a; border: none; font-weight: bold; cursor: pointer; padding: 4px 8px; border-radius: 4px;">
                <option value="pendiente" ${a.resultado === 'pendiente' ? 'selected' : ''}>pendiente</option>
                <option value="ganada" ${a.resultado === 'ganada' ? 'selected' : ''}>ganada</option>
                <option value="perdida" ${a.resultado === 'perdida' ? 'selected' : ''}>perdida</option>
                <option value="nula" ${a.resultado === 'nula' ? 'selected' : ''}>nula</option>
              </select>
            `;
          const simpleOptionWinInfo = a.tipoApuesta === "simple_option_bet"
            ? getSimpleOptionWinInfo(a)
            : null;
          const simpleOptionNoticeRow = simpleOptionWinInfo?.message
            ? `
              <tr class="simple-option-notice-row">
                <td class="simple-option-notice-spacer"></td>
                <td colspan="6">
                  <div class="simple-option-notice simple-option-notice--${simpleOptionWinInfo.type}">
                    <span class="simple-option-notice-icon ${simpleOptionWinInfo.type === "lost" ? "simple-option-notice-icon--lost" : ""}" aria-hidden="true">${simpleOptionWinInfo.type === "lost" ? "&#10005;" : "&#10003;"}</span>
                    <span>${simpleOptionWinInfo.message}</span>
                  </div>
                </td>
              </tr>
            `
            : "";
          filas += `
          <tr data-apuesta-row="${a.id}" class="${simpleOptionNoticeRow ? "simple-option-main-row" : ""}">
            <td>${fechaFormateada}<br>${getCasaBadgeHtml(a)}</td>
            <td>${celdaEvento}</td>
            <td data-cuota-cell="${a.id}">${formatDecimal(a.cuota)}</td>
            <td>$${formatDecimal(a.importe)}</td>
            <td class="${a.resultado}" data-resultado-cell="${a.id}">
              ${resultadoCellHtml}
            </td>
            <td data-retorno-cell="${a.id}">$${r.toFixed(2)}</td>
            <td class="acciones-tabla">
              <button onclick="window.habilitarEdicion('${a.id}')" title="Editar">✏️</button>
              <button onclick="window.eliminar('${a.id}')" title="Eliminar">🗑️</button>
            </td>
          </tr>
          ${simpleOptionNoticeRow}
        `;
        }
      }
    });

    const balance = ret - inv;
    const hayMasEnDia = apuestasDia.length > limiteVisible;
    const verMasDiaHtml = hayMasEnDia
      ? `<button class="btn" type="button" onclick="window.mostrarMasDia('${dia}')" style="margin-top:10px;">Ver más apuestas del día (${apuestasDia.length - limiteVisible})</button>`
      : "";

    html += `
      <div class="page" data-dia="${dia}">
        <h2>${(dias[dia][0].fecha || dias[dia][0].dia || "").split("-").reverse().join("-")}</h2>

        <p>Invertido: <span data-dia-inv="${dia}">$${inv.toFixed(2)}</span></p>
        <p>Retornado: <span data-dia-ret="${dia}">$${ret.toFixed(2)}</span></p>

        <p>
          Balance:
          <strong data-dia-balance="${dia}" class="${balance >= 0 ? 'ganada' : 'perdida'}">
            $${balance.toFixed(2)}
          </strong>
        </p>

        <div class="table-container">
          <table>
            <tbody>${filas}</tbody>
          </table>
        </div>
        ${verMasDiaHtml}

        <button class="btn btn-danger btn-eliminar-dia" onclick="window.eliminarDia('${dia}')">
          🗑 Eliminar día
        </button>
      </div>
    `;
  });

  html += renderPaginacionHtml(totalPaginas, true);

  const resumenYStatsRender = calcularResumenYEstadisticas();
  html += renderResumenBankrollHtml(resumenYStatsRender);
  html += renderEstadisticasHtml(resumenYStatsRender.stats);


  contenido.innerHTML = html;
  postRenderCompleto();
}

function obtenerFechaActualLocal() {
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd = String(hoy.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/* =========================
   INIT
 ========================= */
let appInicializada = false;

function iniciarApp() {
  if (appInicializada) return;
  appInicializada = true;

  const inputFecha = document.getElementById("fecha");
  if (inputFecha) {
    inputFecha.value = obtenerFechaActualLocal();
  }
  crearMlbTeamsDatalist();
  crearMlbPlaysDatalist();
  limpiarCacheLocalObsoleto();
  iniciarMonitorVersionDeploy();
  escucharCasas();
  escucharApuestas();
  document.getElementById("btnAgregar").onclick = agregarApuesta;
  document.getElementById("btnBankroll").onclick = guardarBankroll;
  document.getElementById("btnEliminarCasa").onclick = eliminarCasaSeleccionada;
  document.getElementById("btnCrearCasa").onclick = crearCasa;
  document.getElementById("btnEliminarTodo").onclick = eliminarTodo;
  const btnSincronizarMlb = document.getElementById("btnSincronizarMlb");
  if (btnSincronizarMlb) {
    btnSincronizarMlb.onclick = () => {
      startAutoSyncMlb();
      sincronizarResultadosMlb();
    };
  }
  const btnSincronizarFutbol = document.getElementById("btnSincronizarFutbol");
  if (btnSincronizarFutbol) {
    btnSincronizarFutbol.onclick = () => {
      startAutoSyncFutbol();
      sincronizarResultadosFutbol();
    };
  }
  document.addEventListener("input", (e) => {
    if (!e.target?.matches?.(".jugada-ev-input, .evento-principal-input")) return;
    const deporteSelect = document.getElementById("deporte");
    if (deporteSelect && !deporteSelect.value) {
      if (detectarEquiposMlb(e.target.value).length > 0) {
        deporteSelect.value = "mlb";
      } else if (extraerEquiposEventoFutbol(e.target.value).length >= 2) {
        deporteSelect.value = "futbol";
      }
    }
  });

  const checkDhInputs = (target) => {
    if (target?.matches?.(".jugada-ev-input, .evento-principal-input")) {
      verificarDobleJornadaEnSlot(target);
    } else if (target?.id === "fecha") {
      document.querySelectorAll(".jugada-ev-input, .evento-principal-input").forEach(verificarDobleJornadaEnSlot);
    }
  };

  document.addEventListener("blur", (e) => checkDhInputs(e.target), true);
  document.addEventListener("change", (e) => checkDhInputs(e.target));

  // Initialize Simple container with first slot
  const simpleCont = document.getElementById("eventosSimpleContainer");
  if (simpleCont && simpleCont.querySelectorAll(".simple-slot").length === 0) {
    simpleCont.appendChild(crearSlotSimple(1));
  }

  const patenteCont = document.getElementById("eventosPatenteContainer");
  if (patenteCont && patenteCont.querySelectorAll(".patente-slot").length === 0) {
    inicializarPatenteSlots();
  }

  // Initialize Crear Apuesta Simple container with first slot
  const crearSimpleCont = document.getElementById("eventosCrearSimpleContainer");
  if (crearSimpleCont && crearSimpleCont.querySelectorAll(".crear-simple-slot").length === 0) {
    crearSimpleCont.appendChild(crearSlotCrearApuestaSimple(1));
  }

  const simpleOptionCont = document.getElementById("eventosSimpleOptionContainer");
  if (simpleOptionCont && simpleOptionCont.querySelectorAll(".simple-option-slot").length === 0) {
    simpleOptionCont.appendChild(crearSlotSimpleOption(1));
  }

  // Wire up the "Agregar partido" button for Simple
  const btnAgregarPartidoSimple = document.getElementById("btnAgregarPartidoSimple");
  if (btnAgregarPartidoSimple) {
    btnAgregarPartidoSimple.addEventListener("click", () => {
      const cont = document.getElementById("eventosSimpleContainer");
      const slots = cont.querySelectorAll(".simple-slot");
      const num = slots.length + 1;
      // Show delete button on existing slots
      slots.forEach(s => {
        const del = s.querySelector(".btn-eliminar-slot-simple");
        if (del) del.style.display = "inline-block";
      });
      const newSlot = crearSlotSimple(num);
      cont.appendChild(newSlot);
      newSlot.querySelector(".jugada-ev-input").focus();
    });
  }

  // Wire up the "Agregar partido" button for Crear Apuesta Simple
  const btnAgregarPartidoCrearSimple = document.getElementById("btnAgregarPartidoCrearSimple");
  if (btnAgregarPartidoCrearSimple) {
    btnAgregarPartidoCrearSimple.addEventListener("click", () => {
      const cont = document.getElementById("eventosCrearSimpleContainer");
      const slots = cont.querySelectorAll(".crear-simple-slot");
      const num = slots.length + 1;
      // Show delete button on existing slots
      slots.forEach(s => {
        const del = s.querySelector(".btn-eliminar-slot-crear-simple");
        if (del) del.style.display = "inline-block";
      });
      const newSlot = crearSlotCrearApuestaSimple(num);
      cont.appendChild(newSlot);
      newSlot.querySelector(".jugada-ev-input").focus();
    });
  }

  const btnAgregarPartidoSimpleOption = document.getElementById("btnAgregarPartidoSimpleOption");
  if (btnAgregarPartidoSimpleOption) {
    btnAgregarPartidoSimpleOption.addEventListener("click", () => {
      const cont = document.getElementById("eventosSimpleOptionContainer");
      const slots = cont.querySelectorAll(".simple-option-slot");
      const num = slots.length + 1;
      slots.forEach(s => {
        const del = s.querySelector(".btn-eliminar-slot-simple-option");
        if (del) del.style.display = "inline-block";
      });
      const newSlot = crearSlotSimpleOption(num);
      cont.appendChild(newSlot);
      newSlot.querySelector(".jugada-ev-input").focus();
    });
  }

  const btnAgregarSeleccionPatente = document.getElementById("btnAgregarSeleccionPatente");
  if (btnAgregarSeleccionPatente) {
    btnAgregarSeleccionPatente.addEventListener("click", () => {
      const cont = document.getElementById("eventosPatenteContainer");
      const slots = cont.querySelectorAll(".patente-slot");
      if (slots.length >= PATENTE_MAX_SELECTIONS) return;

      const newSlot = crearSlotPatente(slots.length + 1);
      cont.appendChild(newSlot);
      actualizarSlotsPatente();
      newSlot.querySelector(".jugada-ev-input").focus();
    });
  }

  const tipoApuesta = document.getElementById("tipoApuesta");
  const btnAgregarCampo = document.getElementById("btnAgregarCampo");
  const eventosContainer = document.getElementById("eventosContainer");
  const tarjeta = document.getElementById("tarjetaApuesta");

  tipoApuesta.addEventListener("change", (e) => {
    const valor = e.target.value;
    const esCombinada = valor === "combinada";
    const esPatente = valor === "patente";
    const esCrear = valor === "crear_apuesta";
    const esCrearSimple = valor === "crear_apuesta_simple";
    const esSimpleOption = valor === "simple_option_bet";
    const esSimple = valor === "simple";

    // Update badge class
    tipoApuesta.className = `tipo-select-badge ${valor}`;

    // Border/shadow styling
    tarjeta.className = `tarjeta-apuesta ${valor}`;
    tarjeta.style.borderColor = "";
    tarjeta.style.boxShadow = "";

    // Show/hide field panels
    document.getElementById("camposSimple").style.display = esSimple ? "flex" : "none";
    document.getElementById("camposCombinada").style.display = esCombinada ? "flex" : "none";
    document.getElementById("camposPatente").style.display = esPatente ? "flex" : "none";
    document.getElementById("camposCrearApuesta").style.display = esCrear ? "flex" : "none";
    document.getElementById("camposCrearApuestaSimple").style.display = esCrearSimple ? "flex" : "none";
    document.getElementById("camposSimpleOptionBet").style.display = esSimpleOption ? "flex" : "none";

    // When switching to COMBINADA, create one slot if container is empty
    if (esCombinada) {
      const cont = document.getElementById("eventosContainer");
      if (cont.querySelectorAll(".jugada-slot").length === 0) {
        cont.appendChild(crearSlotCombinada(1));
      }
    }

    if (esPatente) {
      inicializarPatenteSlots();
    }

    // When switching to CREAR APUESTA, create one slot if container is empty
    if (esCrear) {
      const cont = document.getElementById("eventosCrearContainer");
      if (cont.querySelectorAll(".crear-slot").length === 0) {
        cont.appendChild(crearSlotCrearApuesta(1));
      }
    }

    // When switching to CREAR APUESTA SIMPLE, create one slot if container is empty
    if (esCrearSimple) {
      const cont = document.getElementById("eventosCrearSimpleContainer");
      if (cont.querySelectorAll(".crear-simple-slot").length === 0) {
        cont.appendChild(crearSlotCrearApuestaSimple(1));
      }
    }

    if (esSimpleOption) {
      const cont = document.getElementById("eventosSimpleOptionContainer");
      if (cont.querySelectorAll(".simple-option-slot").length === 0) {
        cont.appendChild(crearSlotSimpleOption(1));
      }
    }

    // When switching to SIMPLE, create one slot if container is empty
    if (esSimple) {
      const cont = document.getElementById("eventosSimpleContainer");
      if (cont.querySelectorAll(".simple-slot").length === 0) {
        cont.appendChild(crearSlotSimple(1));
      }
    }
  });

  // Wire up the "Agregar partido" button for Crear Apuesta
  const btnAgregarPartidoCrear = document.getElementById("btnAgregarPartidoCrear");
  if (btnAgregarPartidoCrear) {
    btnAgregarPartidoCrear.addEventListener("click", () => {
      const cont = document.getElementById("eventosCrearContainer");
      const slots = cont.querySelectorAll(".crear-slot");
      const num = slots.length + 1;
      // Show delete button on existing slots
      slots.forEach(s => {
        const del = s.querySelector(".btn-eliminar-slot-crear");
        if (del) del.style.display = "inline-block";
      });
      const newSlot = crearSlotCrearApuesta(num);
      cont.appendChild(newSlot);
      newSlot.querySelector(".jugada-ev-input").focus();
    });
  }

  btnAgregarCampo.addEventListener("click", () => {
    const cont = document.getElementById("eventosContainer");
    const slots = cont.querySelectorAll(".jugada-slot");
    const num = slots.length + 1;
    // Show delete button on existing slots
    slots.forEach(s => {
      const del = s.querySelector(".btn-eliminar-slot");
      if (del) del.style.display = "inline-block";
    });
    const newSlot = crearSlotCombinada(num);
    cont.appendChild(newSlot);
    newSlot.querySelector(".jugada-ev-input").focus();
  });

  const valModalClose = document.getElementById("val-modal-close");
  if (valModalClose) {
    valModalClose.onclick = cerrarModalValidacion;
  }
  const valModalBackdrop = document.getElementById("val-modal");
  if (valModalBackdrop) {
    valModalBackdrop.onclick = (e) => {
      if (e.target === valModalBackdrop) {
        cerrarModalValidacion();
      }
    };
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      cerrarModalValidacion();
    }
  });

}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", iniciarApp, { once: true });
} else {
  iniciarApp();
}

window.crearFilaSeleccionEditHTML = function (id, selIndex, marketVal = "", jugVal = "", showDelete = true) {
  const jEsc = jugVal.replace(/"/g, '&quot;');
  const num = selIndex + 1;
  return `
    <div class="edit-selection-row" style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
      <input type="text" class="edit-jugada-jug-input" value="${jEsc}" placeholder="Jugada ${num}" style="background:#1e293b; color:white; border:1px dashed #475569; border-radius:6px; padding:5px 8px; font-size:12px; box-sizing:border-box; width:75%; min-width:120px;">
      ${showDelete ? `<button type="button" onclick="window.eliminarFilaSeleccionEdit(this, '${id}')" style="padding:2px 7px; font-size:11px; font-weight:bold; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer; flex-shrink:0;">✕</button>` : ''}
    </div>
  `;
};

window.agregarSeleccionEdit = function (btn, id) {
  if (document.getElementById(`edit-tipo-${id}`)?.value === "patente") return;

  const slot = btn.closest(`[class^="edit-jugada-slot-"]`);
  const container = slot.querySelector(".edit-selections-container");
  if (container) {
    const rows = container.querySelectorAll(".edit-selection-row");
    const num = rows.length;

    // Number existing rows
    rows.forEach((r, i) => {
      const inp = r.querySelector(".edit-jugada-jug-input");
      if (inp) inp.placeholder = `Jugada ${i + 1}`;
      const delBtn = r.querySelector("button");
      if (delBtn) delBtn.style.display = "inline-block";
    });

    const div = document.createElement("div");
    div.innerHTML = window.crearFilaSeleccionEditHTML(id, num, "", "", true);
    const newRow = div.firstElementChild;
    container.appendChild(newRow);
    habilitarAutocompleteMlb(newRow);
    newRow.querySelector(".edit-jugada-jug-input").focus();
  }
};

window.eliminarFilaSeleccionEdit = function (btn, id) {
  const row = btn.closest(".edit-selection-row");
  const container = row.closest(".edit-selections-container");
  row.remove();

  const remainingRows = container.querySelectorAll(".edit-selection-row");
  remainingRows.forEach((r, i) => {
    const inp = r.querySelector(".edit-jugada-jug-input");
    if (inp) inp.placeholder = `Jugada ${i + 1}`;
  });

  if (remainingRows.length === 1) {
    const delBtn = remainingRows[0].querySelector("button");
    if (delBtn) delBtn.style.display = "none";
    const inp = remainingRows[0].querySelector(".edit-jugada-jug-input");
    if (inp) inp.placeholder = "Jugada";
  }
};

window.eliminarSlotEdit = function (btn, id) {
  const tipoActual = document.getElementById(`edit-tipo-${id}`)?.value;
  const container = document.getElementById(`edit-jugadas-container-${id}`);
  if (tipoActual === "patente" && container?.querySelectorAll(`.edit-jugada-slot-${id}`).length <= PATENTE_MIN_SELECTIONS) {
    mostrarModalValidacion([`La patente necesita al menos ${PATENTE_MIN_SELECTIONS} selecciones.`]);
    return;
  }

  const slot = btn.closest(`.edit-jugada-slot-${id}`);
  slot.remove();

  const slots = container.querySelectorAll(`.edit-jugada-slot-${id}`);
  slots.forEach((s, i) => {
    const numSpan = s.querySelector("span");
    if (numSpan) numSpan.textContent = `${tipoActual === "patente" ? "Seleccion" : "Partido"} #${i + 1}`;
  });

  window.calcularCuotaEditCombinada(id);
};

window.agregarJugadaEdit = function (id) {
  const container = document.getElementById(`edit-jugadas-container-${id}`);
  if (container) {
    const slots = container.querySelectorAll(`.edit-jugada-slot-${id}`);
    const tipoActual = document.getElementById(`edit-tipo-${id}`)?.value;
    if (tipoActual === "patente" && slots.length >= PATENTE_MAX_SELECTIONS) return;

    const matchIndex = slots.length;
    const themeColor = tipoActual === "patente" ? "#fb7185" : "#fbbf24";
    const slotLabel = tipoActual === "patente" ? "Seleccion" : "Partido";
    const slot = document.createElement("div");
    slot.className = `edit-jugada-slot-${id}`;
    slot.style.cssText = "display:flex; flex-direction:column; gap:6px; border:1px solid #475569; border-radius:8px; padding:10px; background:#111827; margin-top:8px;";

    let selectionsHtml = `<div class="edit-selections-container" style="display:flex; flex-direction:column; gap:4px;">`;
    selectionsHtml += window.crearFilaSeleccionEditHTML(id, 0, "", "", false);
    selectionsHtml += `</div>`;

    slot.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
        <span style="font-size:11px; font-weight:700; color:${themeColor};">${slotLabel} #${matchIndex + 1}</span>
        <button type="button" class="btn-eliminar-slot" onclick="window.eliminarSlotEdit(this, '${id}')" title="Eliminar partido" style="display:inline-block; padding:2px 7px; margin-top:0;">&#10005;</button>
      </div>
      
      <input type="text" class="edit-jugada-ev-input" placeholder="Partido/Evento"
        style="background:#1e293b; color:#f1f5f9; border:1px solid #334155; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:600; width:100%; box-sizing:border-box;">
      
      ${selectionsHtml}
      
      <button type="button" onclick="window.agregarSeleccionEdit(this, '${id}')"
        style="align-self:flex-start; font-size:11px; padding:3px 10px; background:#fbbf24; color:black; font-weight:bold; border-radius:4px; border:none; cursor:pointer; margin-top:6px;">➕ Agregar selección</button>

      <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
        <span style="font-size:11px; color:#94a3b8; font-weight:600;">Cuota:</span>
        <input type="number" class="edit-jugada-cuota-input" placeholder="1.80" step="0.01" oninput="window.calcularCuotaEditCombinada('${id}')" readonly onfocus="this.removeAttribute('readonly')" onblur="this.setAttribute('readonly', '')" onmousedown="this.removeAttribute('readonly')" ontouchstart="this.removeAttribute('readonly')"
          style="width:100px; background:#1e293b; color:${themeColor}; border:1px dashed ${themeColor}; border-radius:6px; padding:5px 8px; font-size:13px; font-weight:700; box-sizing:border-box;">
      </div>
    `;
    container.appendChild(slot);
    habilitarAutocompleteMlb(slot);
    slot.querySelector(".edit-jugada-ev-input").focus();
  }
};

window.cambiarTipoEdicion = function (id, valor) {
  const container = document.getElementById(`edit-jugadas-container-${id}`);
  const btn = document.getElementById(`edit-btn-agregar-${id}`);
  const tarjeta = document.getElementById(`edit-tarjeta-${id}`);
  const select = document.getElementById(`edit-tipo-${id}`);

  const esCombinada = valor === "combinada";
  const esPatente = valor === "patente";
  const esCrear = valor === "crear_apuesta";
  const esCrearSimple = valor === "crear_apuesta_simple";
  const esSimpleOption = valor === "simple_option_bet";
  const esSimple = valor === "simple";

  if (tarjeta) {
    tarjeta.className = "apuesta-edit-card " + valor;
    tarjeta.style.borderColor = "";
    tarjeta.style.boxShadow = "";
  }

  if (select) {
    select.className = "edit-tipo-select " + valor;
    select.style.color = "";
  }

  container.style.display = "flex";

  const inputEvento = document.getElementById(`edit-evento-${id}`);
  if (inputEvento) {
    inputEvento.style.display = (esCombinada || esPatente || esCrear || esCrearSimple) ? 'block' : 'none';
  }

  // Show/hide cuota wrapper divs (each cuota is wrapped in a flex div)
  const cuotaInputs = container.querySelectorAll(".edit-jugada-cuota-input");
  cuotaInputs.forEach(input => {
    const wrapper = input.parentElement;
    if (wrapper && wrapper.tagName === 'DIV') {
      wrapper.style.display = (esCombinada || esPatente || esCrear || esCrearSimple) ? 'flex' : 'none';
    } else {
      input.style.display = (esCombinada || esPatente || esCrear || esCrearSimple) ? 'block' : 'none';
    }
  });

  const deleteSlotBtns = container.querySelectorAll(".btn-eliminar-slot");
  deleteSlotBtns.forEach(b => b.style.display = (esCombinada || esPatente || esCrear || esCrearSimple) ? 'inline-block' : 'none');

  if (esSimpleOption) {
    btn.style.display = "none";
    const slots = container.querySelectorAll(`.edit-jugada-slot-${id}`);
    for (let i = 1; i < slots.length; i++) {
      slots[i].remove();
    }
    window.calcularCuotaEditSimpleOption(id);
  } else if (esCombinada || esPatente || esCrear || esCrearSimple) {
    btn.style.display = "inline-block";
    if (container.children.length === 0) {
      window.agregarJugadaEdit(id);
    }
    if (esPatente) {
      while (container.querySelectorAll(`.edit-jugada-slot-${id}`).length < PATENTE_MIN_SELECTIONS) {
        window.agregarJugadaEdit(id);
      }
    }
    window.calcularCuotaEditCombinada(id);
  } else {
    btn.style.display = "none";
    const slots = container.querySelectorAll(`.edit-jugada-slot-${id}`);
    for (let i = 1; i < slots.length; i++) {
      slots[i].remove();
    }
    if (container.querySelectorAll(`.edit-jugada-slot-${id}`).length === 0) {
      window.agregarJugadaEdit(id);
    }
  }
};

window.calcularCuotaEditCombinada = function (id) {
  const tipoApuesta = document.getElementById(`edit-tipo-${id}`)?.value;
  if (tipoApuesta !== "combinada" && tipoApuesta !== "patente" && tipoApuesta !== "crear_apuesta" && tipoApuesta !== "crear_apuesta_simple") return;

  if (tipoApuesta === "patente") {
    const jugadas = [];
    const apuestaOriginal = apuestas.find(a => a.id === id);
    document.querySelectorAll(`.edit-jugada-slot-${id}`).forEach((slot, index) => {
      const c = parseFloat(slot.querySelector(".edit-jugada-cuota-input")?.value);
      const estado = apuestaOriginal?.jugadas?.[index]
        ? determinarEstadoJugada(apuestaOriginal.jugadas[index])
        : "ganada";
      jugadas.push({ c: c || 0, selections: [{ estado }] });
    });

    const cuotaMain = document.getElementById(`edit-cuota-${id}`);
    if (cuotaMain) {
      cuotaMain.value = calcularCuotaMaximaPatente(jugadas).toFixed(2);
    }
    return;
  }

  let total = 1;
  let hasVal = false;
  const apuestaOriginal = apuestas.find(a => a.id === id);
  document.querySelectorAll(`.edit-jugada-slot-${id}`).forEach((slot, index) => {
    const input = slot.querySelector(".edit-jugada-cuota-input");
    const estado = apuestaOriginal?.jugadas?.[index]
      ? determinarEstadoJugada(apuestaOriginal.jugadas[index])
      : "ganada";
    const val = estado === "nula" ? 1 : parseFloat(input?.value);
    if (!isNaN(val) && val > 0) {
      total *= val;
      hasVal = true;
    }
  });

  if (hasVal) {
    const cuotaMain = document.getElementById(`edit-cuota-${id}`);
    if (cuotaMain) {
      cuotaMain.value = total.toFixed(2);
    }
  }
};

window.calcularCuotaEditSimpleOption = function (id) {
  const slot = document.querySelector(`.edit-jugada-slot-${id}`);
  if (!slot) return;

  const optiOdds = parseFloat(slot.querySelector(".edit-simple-option-opti-input")?.value);

  const cuotaMain = document.getElementById(`edit-cuota-${id}`);
  if (cuotaMain) {
    cuotaMain.value = (optiOdds || 0).toFixed(3);
  }
};

function getKeyAjusteEstadisticaFutbol(apuestaId, matchIndex, selIndex) {
  return `${apuestaId}-${matchIndex}-${selIndex}`;
}

function escaparSelectorCss(value = "") {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

window.mostrarAjusteEstadisticaFutbol = function (apuestaId, matchIndex, selIndex) {
  const key = getKeyAjusteEstadisticaFutbol(apuestaId, matchIndex, selIndex);
  const selectorKey = escaparSelectorCss(key);
  const view = document.querySelector(`[data-stat-view="${selectorKey}"]`);
  const editor = document.querySelector(`[data-stat-editor="${selectorKey}"]`);
  if (view) view.hidden = true;
  if (editor) {
    editor.hidden = false;
    editor.querySelector("input")?.focus();
  }
};

window.ocultarAjusteEstadisticaFutbol = function (apuestaId, matchIndex, selIndex) {
  const key = getKeyAjusteEstadisticaFutbol(apuestaId, matchIndex, selIndex);
  const selectorKey = escaparSelectorCss(key);
  const view = document.querySelector(`[data-stat-view="${selectorKey}"]`);
  const editor = document.querySelector(`[data-stat-editor="${selectorKey}"]`);
  if (view) view.hidden = false;
  if (editor) editor.hidden = true;
};

window.ajustarEstadisticaFutbol = async function (apuestaId, matchIndex, selIndex) {
  const apuesta = apuestas.find(a => a.id === apuestaId);
  const match = apuesta?.jugadas?.[matchIndex];
  const selection = match?.selections?.[selIndex];
  const autoFutbol = selection?.autoFutbol;
  if (!apuesta || !match || !selection || !autoFutbol) return;
  if (!["total_corners", "total_tarjetas"].includes(autoFutbol.mercado)) return;

  const esCorners = autoFutbol.mercado === "total_corners";
  const equipoStats = esCorners ? autoFutbol.cornersEquipo : autoFutbol.tarjetasEquipo;
  const homeName = equipoStats?.home?.name || autoFutbol.equipos?.[0] || "Local";
  const awayName = equipoStats?.away?.name || autoFutbol.equipos?.[1] || "Visitante";

  const key = getKeyAjusteEstadisticaFutbol(apuestaId, matchIndex, selIndex);
  const selectorKey = escaparSelectorCss(key);
  const home = Number(document.querySelector(`[data-stat-home="${selectorKey}"]`)?.value);
  const away = Number(document.querySelector(`[data-stat-away="${selectorKey}"]`)?.value);
  if (Number.isNaN(home) || Number.isNaN(away) || home < 0 || away < 0) {
    mostrarModalValidacion(["Ingresa dos valores validos. Ejemplo: 4-3"]);
    return;
  }
  window.ocultarAjusteEstadisticaFutbol(apuestaId, matchIndex, selIndex);

  const homeFinal = Math.round(home);
  const awayFinal = Math.round(away);
  const total = homeFinal + awayFinal;
  const ajusteManual = {
    mercado: autoFutbol.mercado,
    home: homeFinal,
    away: awayFinal,
    homeName,
    awayName,
    total,
    actualizadoEn: Date.now()
  };
  const estadisticaEquipo = esCorners
    ? {
      total,
      home: { name: homeName, corners: homeFinal },
      away: { name: awayName, corners: awayFinal }
    }
    : {
      total,
      home: { name: homeName, tarjetas: homeFinal },
      away: { name: awayName, tarjetas: awayFinal }
    };

  selection.autoFutbol = {
    ...autoFutbol,
    ajusteManual,
    ...(esCorners
      ? { totalCorners: total, cornersEquipo: estadisticaEquipo }
      : { totalTarjetas: total, tarjetasEquipo: estadisticaEquipo }),
    estadisticasTiempo: getMarcadorTiempoReglamentarioMeta(),
    sincronizadoEn: Date.now()
  };

  const linea = Number(autoFutbol.linea);
  if (!Number.isNaN(linea)) {
    if (total === linea) {
      selection.estado = "nula";
    } else {
      const ganaOver = total > linea;
      selection.estado = (autoFutbol.tipoTotal === "over" ? ganaOver : !ganaOver) ? "ganada" : "perdida";
    }
  }

  match.estado = determinarEstadoJugada(match);
  apuesta.jugadas = normalizarJugadasConEstado(apuesta.jugadas);
  const overallResultado = recalcularResultadoApuesta(apuesta);
  apuesta.resultado = overallResultado;
  if (apuesta.tipoApuesta === "patente") {
    apuesta.cuota = calcularCuotaMaximaPatente(apuesta.jugadas);
  } else if (debeRecalcularCuotaCombinada(apuesta.tipoApuesta)) {
    const cuota = recalcularCuotaCombinada(apuesta.jugadas);
    if (cuota > 0) apuesta.cuota = cuota;
  }
  apuesta.autoSync = crearAutoSyncPayload(apuesta, overallResultado, {
    proveedor: "ajuste_manual_futbol",
    ultimaRevision: Date.now()
  });

  const scrollPosition = window.scrollY;
  render();
  window.scrollTo(0, scrollPosition);

  try {
    await updateDoc(doc(db, "apuestas", apuesta.id), {
      jugadas: apuesta.jugadas,
      resultado: apuesta.resultado,
      cuota: apuesta.cuota,
      autoSync: apuesta.autoSync
    });
  } catch (e) {
    console.error("No se pudo guardar el ajuste manual:", e);
    mostrarModalValidacion([`No se pudo guardar el ajuste manual: ${e.message}`]);
  }
};

window.toggleEstadoSeleccion = async function (apuestaId, matchIndex, selIndex) {
  const apuesta = apuestas.find(a => a.id === apuestaId);
  if (!apuesta) return;

  const match = apuesta.jugadas[matchIndex];
  if (!match) return;

  // Safe convert legacy match string or legacy match flat object
  let normalizedMatch = match;
  if (typeof normalizedMatch !== 'object') {
    normalizedMatch = {
      ev: "",
      jug: normalizedMatch,
      c: 0,
      estado: "pendiente"
    };
    apuesta.jugadas[matchIndex] = normalizedMatch;
  }

  if (!normalizedMatch.selections) {
    normalizedMatch.selections = [
      {
        titulo: "",
        jugada: normalizedMatch.jug || "",
        estado: normalizedMatch.estado || "pendiente"
      }
    ];
  }

  const sel = normalizedMatch.selections[selIndex];
  if (!sel) return;

  let currentState = sel.estado || 'pendiente';
  let nextState = 'pendiente';

  if (currentState === 'pendiente') nextState = 'ganada';
  else if (currentState === 'ganada') nextState = 'perdida';
  else if (currentState === 'perdida') nextState = 'nula';
  else if (currentState === 'nula') nextState = 'pendiente';

  sel.estado = nextState;
  normalizedMatch.selections = getSelectionsFromJugada(normalizedMatch);
  normalizedMatch.estado = determinarEstadoJugada(normalizedMatch);
  apuesta.jugadas = normalizarJugadasConEstado(apuesta.jugadas);

  if (apuesta.tipoApuesta === 'patente') {
    apuesta.cuota = calcularCuotaMaximaPatente(apuesta.jugadas);
    const overallResultado = determinarResultadoPatente(apuesta);
    apuesta.resultado = overallResultado;
    apuesta.autoSync = crearAutoSyncPayload(apuesta, overallResultado);

    const scrollPosition = window.scrollY;
    render();
    window.scrollTo(0, scrollPosition);

    try {
      await updateDoc(doc(db, "apuestas", apuesta.id), {
        jugadas: apuesta.jugadas,
        resultado: overallResultado,
        cuota: apuesta.cuota,
        autoSync: apuesta.autoSync
      });
    } catch (e) {
      console.error(e);
    }
    return;
  }

  const overallResultado = recalcularResultadoApuesta(apuesta);
  const nuevaCuotaTotal = recalcularCuotaCombinada(apuesta.jugadas);
  apuesta.resultado = overallResultado;
  if (debeRecalcularCuotaCombinada(apuesta.tipoApuesta) && nuevaCuotaTotal > 0) {
    apuesta.cuota = nuevaCuotaTotal;
  }
  apuesta.autoSync = crearAutoSyncPayload(apuesta, overallResultado);

  const scrollPosition = window.scrollY;
  if (esCrearApuestaTipo(apuesta.tipoApuesta)) {
    actualizarSeleccionEstadoDom(apuesta, matchIndex, selIndex);
    actualizarFilaCrearApuestaDom(apuesta);
    renderSilenciosoApuestas.add(apuesta.id);
    setTimeout(() => renderSilenciosoApuestas.delete(apuesta.id), 2000);
  } else {
    render();
    window.scrollTo(0, scrollPosition);
  }

  try {
    await updateDoc(doc(db, "apuestas", apuesta.id), {
      jugadas: apuesta.jugadas,
      resultado: overallResultado,
      cuota: apuesta.cuota,
      autoSync: apuesta.autoSync
    });
  } catch (e) {
    console.error(e);
    renderSilenciosoApuestas.delete(apuesta.id);
    render();
    window.scrollTo(0, scrollPosition);
  }
};

window.cambiarPagina = async function (direccion, scrollAlTop = false) {
  const totalPaginas = Math.ceil(Object.keys(
    getApuestasFiltradas().reduce((acc, a) => {
      acc[a.dia] = true;
      return acc;
    }, {})
  ).length / porPagina);

  if (direccion < 0 && paginaActual <= 1 && hayMasApuestas) {
    await cargarMasApuestas();
    if (scrollAlTop) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    return;
  }

  paginaActual += direccion;

  if (paginaActual < 1) paginaActual = 1;
  if (paginaActual > totalPaginas) paginaActual = totalPaginas;

  render();
  if (scrollAlTop) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
};

window.mostrarMasDia = function (dia) {
  apuestasVisiblesPorDia[dia] = (apuestasVisiblesPorDia[dia] || APUESTAS_VISIBLES_POR_DIA) + APUESTAS_VISIBLES_POR_DIA;
  render();
};

window.habilitarEdicion = habilitarEdicion;
window.cancelarEdicion = cancelarEdicion;
window.guardarEdicion = guardarEdicion;
window.eliminar = eliminar;
window.cambiarEstado = cambiarEstado;
window.actualizarResultadoTotalSimpleOption = actualizarResultadoTotalSimpleOption;
window.eliminarDia = eliminarDia;
window.guardarAjusteFinal = guardarAjusteFinal;
window.setEditingFinal = setEditingFinal;

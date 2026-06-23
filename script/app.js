import {
  db,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  getDocs,
  getDoc,
  setDoc,
  updateDoc
} from "./firebase-store.js";
import {
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
} from "./calculations.js";
import {
  MLB_TEAMS,
  autocorregirTextoConLogos,
  crearMlbTeamsDatalist,
  formatTextWithMlbTeams,
  habilitarAutocompleteMlb
} from "./mlb.js?v=2.0";
import {
  cerrarModalValidacion,
  mostrarModalValidacion,
  registrarModalValidacionGlobal
} from "./validation-modal.js";

let paginaActual = 1;
const porPagina = 7;

/* =========================
   ESTADO
 ========================= */
let apuestas = [];
let ultimoDiaAgregado = null;
let ultimoDiaAgregadoTime = 0;
let ultimoDiaAgregadoIntentos = 0;
let editandoId = null;
let isEditingFinal = false;
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
  onSnapshot(collection(db, "casas"), { includeMetadataChanges: true }, (snapshot) => {
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

    casas = [...casas.filter(c => c.id !== id), nuevaCasa];
    casaFormularioId = id;
    filtroCasaId = id;
    if (input) input.value = "";
    renderCasasControls();
    render();
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
  render();
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
  filtroCasaId = id || CASA_TODAS_ID;
  if (filtroCasaId !== CASA_TODAS_ID) casaFormularioId = filtroCasaId;
  paginaActual = 1;
  isEditingFinal = false;
  renderCasasControls();
  render();
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

/* =========================
   FIREBASE LIVE
 ========================= */
let inicializado = false;
let ultimoScrollGuardado = 0;
const renderSilenciosoApuestas = new Set();

function escucharApuestas() {
  onSnapshot(collection(db, "apuestas"), { includeMetadataChanges: true }, (snapshot) => {
    const isRecentAdd = (ultimoDiaAgregadoTime && (Date.now() - ultimoDiaAgregadoTime < 2500));
    if (inicializado && !isRecentAdd) {
      ultimoScrollGuardado = window.scrollY;
    }

    if (!apuestasSnapshotRecibido) {
      apuestas = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
      apuestasSnapshotRecibido = true;
    } else {
      snapshot.docChanges().forEach(change => {
        const id = change.doc.id;
        if (change.type === "removed") {
          apuestas = apuestas.filter(apuesta => apuesta.id !== id);
          return;
        }

        const apuesta = { ...change.doc.data(), id };
        const index = apuestas.findIndex(item => item.id === id);
        if (index >= 0) apuestas[index] = apuesta;
        else apuestas.push(apuesta);
      });
    }

    apuestas.sort((a, b) => (a.creadoEn || 0) - (b.creadoEn || 0));

    // Auto-corrección de importes con errores de precisión o autocompletado en la base de datos existente
    apuestas.forEach(a => {
      if (!a.casaId) {
        updateDoc(doc(db, "apuestas", a.id), {
          casaId: CASA_DEFAULT_ID,
          casaNombre: getCasaNombre(CASA_DEFAULT_ID)
        }).catch(err => console.error("Error al asignar casa por defecto:", err));
      }

      if (a.tipoApuesta === "patente") {
        const resultadoPatente = determinarResultadoPatente(a);
        const cuotaPatente = calcularCuotaMaximaPatente(a.jugadas || []);
        const updateData = {};

        if (a.resultado !== resultadoPatente) {
          a.resultado = resultadoPatente;
          updateData.resultado = resultadoPatente;
        }

        if (formatDecimal(a.cuota) !== formatDecimal(cuotaPatente)) {
          a.cuota = cuotaPatente;
          updateData.cuota = cuotaPatente;
        }

        if (Object.keys(updateData).length > 0) {
          updateDoc(doc(db, "apuestas", a.id), updateData)
            .catch(err => console.error("Error al auto-corregir patente:", err));
        }
      }

      const val = a.importe;
      if (typeof val === 'number') {
        const rounded = Math.round(val);
        const distance = Math.abs(val - rounded);
        // Si el importe está muy cerca de un entero (ej: 9.98, 2.99, 10.01) lo corregimos en Firestore
        if (distance > 0 && distance <= 0.035) {
          updateDoc(doc(db, "apuestas", a.id), { importe: rounded })
            .catch(err => console.error("Error al auto-corregir importe:", err));
        }
      }
    });

    if (!inicializado) {
      inicializado = true;
      // Al cargar por primera vez, ir a la última página (fechas más recientes)
      const diasUnicos = [...new Set(apuestas.map(a => a.dia))];
      const totalPags = Math.ceil(diasUnicos.length / porPagina);
      paginaActual = totalPags || 1;
    }

    const omitirRenderSnapshot = renderSilenciosoApuestas.size > 0;

    requestAnimationFrame(() => {
      if (omitirRenderSnapshot) {
        renderSilenciosoApuestas.clear();
        ultimoScrollGuardado = 0;
        return;
      }

      render();

      const isRecentAddNow = (ultimoDiaAgregadoTime && (Date.now() - ultimoDiaAgregadoTime < 2500));
      if (ultimoScrollGuardado > 0 && !ultimoDiaAgregado && !isRecentAddNow) {
        window.scrollTo(0, ultimoScrollGuardado);
      }
      ultimoScrollGuardado = 0;
    });
  }, (error) => {
    console.error("Error escuchando apuestas en tiempo real:", error);
    mostrarModalValidacion(["No se pudo sincronizar las apuestas en tiempo real: " + error.message]);
  });
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

  const partes = limpio.split(/(\s+(?:vs?\.?|versus|contra)\s+)/i);
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

function extraerSiNo(texto = "") {
  const normalizado = normalizarTextoMercado(texto);
  if (/\b(no|ninguno)\b/.test(normalizado)) return "No";
  if (/\b(si|ambos|marcan|anotan)\b/.test(normalizado)) return "Sí";
  return capitalizarMercado(texto);
}

function limpiarEquipoGanador(texto = "", evento = "") {
  let equipo = String(texto)
    .replace(/\b(equipo\s+)?ganador\b/ig, "")
    .replace(/\b(gana|ganan|ganara|ganaran|winner|moneyline|ml)\b/ig, "")
    .replace(/\b1x2\b/ig, "");

  equipo = limpiarEspaciosMercado(equipo);
  return corregirEquipoDesdeEvento(equipo || texto, evento);
}

function limpiarHandicap(texto = "", evento = "") {
  let linea = String(texto)
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

function detectarDetalleSeleccionCrear(seleccion = {}) {
  const tituloActual = limpiarEspaciosMercado(seleccion.titulo || "");
  const jugadaActual = limpiarEspaciosMercado(seleccion.jugada || seleccion.jug || "");
  const evento = limpiarEspaciosMercado(seleccion.evento || seleccion.ev || "");
  const textoCompleto = limpiarEspaciosMercado(`${tituloActual} ${jugadaActual}`);
  const normalizado = normalizarTextoMercado(textoCompleto);

  if (tienePalabraMercado(normalizado, ["corner", "corners", "corne", "esquina", "esquinas"])) {
    return {
      titulo: "Total tiros de esquina",
      jugada: extraerLineaTotal(jugadaActual || textoCompleto, ["corner", "corners", "tiro", "tiros", "esquina", "esquinas"])
    };
  }

  if (tienePalabraMercado(normalizado, ["carrera", "carreras", "run", "runs"])) {
    return {
      titulo: "Total carreras",
      jugada: extraerLineaTotal(jugadaActual || textoCompleto, ["carrera", "carreras", "run", "runs"])
    };
  }

  if (tienePalabraMercado(normalizado, ["ambos", "marcan", "anotan"]) && !/\b(mas|menos|over|under)\b/.test(normalizado)) {
    return {
      titulo: "Ambos equipos marcan",
      jugada: extraerSiNo(jugadaActual || textoCompleto)
    };
  }

  if (tienePalabraMercado(normalizado, ["gol", "goles"])) {
    return {
      titulo: "Total de goles",
      jugada: extraerLineaTotal(jugadaActual || textoCompleto, ["gol", "goles"])
    };
  }

  if (tienePalabraMercado(normalizado, ["handicap", "handi", "hcap"])) {
    return {
      titulo: "Hándicap",
      jugada: limpiarHandicap(jugadaActual || textoCompleto, evento)
    };
  }

  if (/\bempate\b/.test(normalizado) && (/\bo\b/.test(normalizado) || /\//.test(textoCompleto))) {
    return {
      titulo: "Doble oportunidad",
      jugada: limpiarDobleOportunidad(jugadaActual || textoCompleto, evento)
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
  const detalle = detectarDetalleSeleccionCrear({ titulo: tituloActual, jugada: jugadaCorregida, evento: eventoCorregido });
  return {
    titulo: detalle.titulo,
    jugada: detalle.jugada || limpiarEspaciosMercado(jugadaCorregida),
    estado
  };
}

function getDeporteFormulario() {
  return document.getElementById("deporte")?.value || "";
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

  if (equiposTexto.length < 2) return null;

  if (tienePalabraMercado(normalizado, ["carrera", "carreras", "run", "runs"])) {
    const linea = extraerNumeroJugada(textoCompleto);
    const tipoTotal = detectarLadoTotal(textoCompleto);
    if (linea !== null && tipoTotal) {
      return {
        deporte: "mlb",
        mercado: "total_carreras",
        equipos: equiposEvento.length >= 2 ? equiposEvento.slice(0, 2) : equiposTexto.slice(0, 2),
        tipoTotal,
        linea
      };
    }
  }

  if (/\b(over|under|mas|menos|mayor|menor|alta|baja)\b/.test(normalizado)) {
    const linea = extraerNumeroJugada(textoCompleto);
    const tipoTotal = detectarLadoTotal(textoCompleto);
    if (linea !== null && tipoTotal) {
      return {
        deporte: "mlb",
        mercado: "total_carreras",
        equipos: equiposEvento.length >= 2 ? equiposEvento.slice(0, 2) : equiposTexto.slice(0, 2),
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

  return jugadas.map(jugada => {
    if (typeof jugada !== "object" || !jugada) return jugada;

    const ev = jugada.ev || jugada.evento || "";
    const equipos = detectarEquiposMlb(ev);
    const selections = getSelectionsFromJugada(jugada).map(sel => {
      const autoMlb = crearAutoMlbSeleccion({
        evento: ev,
        titulo: sel.titulo || "",
        jugada: sel.jugada || ""
      });

      return autoMlb ? { ...sel, autoMlb } : sel;
    });

    return {
      ...jugada,
      autoMlb: equipos.length >= 2 ? { deporte: "mlb", equipos: equipos.slice(0, 2) } : jugada.autoMlb,
      selections
    };
  });
}

function normalizarClaveFutbol(value = "") {
  const normalizado = String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|club|deportivo|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return aplicarAliasFutbol(normalizado);
}

function extraerEquiposEventoFutbol(evento = "") {
  const partes = limpiarEventoDuplicado(evento)
    .split(/\s+(?:vs?\.?|versus|contra|v)\s+/i)
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

  if (tienePalabraMercado(normalizado, ["corner", "corners", "esquina", "esquinas"])) {
    const linea = extraerNumeroJugada(textoCompleto);
    const tipoTotal = detectarLadoTotal(textoCompleto);
    if (linea !== null && tipoTotal) {
      return {
        deporte: "futbol",
        mercado: "total_corners",
        equipos,
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

  if (/\bempate\b/.test(normalizado) && (/\bo\b/.test(normalizado) || /\//.test(textoCompleto))) {
    const seleccionEquipo = equipos.find(equipo => textoContieneEquipoFutbol(textoCompleto, equipo));
    return {
      deporte: "futbol",
      mercado: "doble_oportunidad",
      equipos,
      seleccionEquipo,
      incluyeEmpate: true
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

function enriquecerJugadasAutoFutbol(jugadas = [], deporte = "") {
  if (deporte !== "futbol") return jugadas;

  return jugadas.map(jugada => {
    if (typeof jugada !== "object" || !jugada) return jugada;

    const ev = jugada.ev || jugada.evento || "";
    const equipos = extraerEquiposEventoFutbol(ev);
    const selections = getSelectionsFromJugada(jugada).map(sel => {
      const autoFutbol = crearAutoFutbolSeleccion({
        evento: ev,
        titulo: sel.titulo || "",
        jugada: sel.jugada || ""
      });

      return autoFutbol ? { ...sel, autoFutbol } : sel;
    });

    return {
      ...jugada,
      autoFutbol: equipos.length >= 2 ? { deporte: "futbol", equipos } : jugada.autoFutbol,
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
      <button type="button" class="btn-eliminar-slot" onclick="window.eliminarSlot(this)" style="display:${num > 1 ? 'inline-block' : 'none'}; padding:2px 7px; font-size:11px; font-weight:700; background:rgba(239, 68, 68, 0.15); color:#f87171; border:1px solid rgba(239, 68, 68, 0.3); border-radius:4px; cursor:pointer;">✕</button>
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
      <button type="button" class="btn-eliminar-slot-simple" onclick="window.eliminarSlotSimple(this)" style="display:${num > 1 ? 'inline-block' : 'none'}; padding:2px 7px; font-size:11px; font-weight:700; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;">✕</button>
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
  const tipoApuesta = document.getElementById("tipoApuesta").value;
  const deporte = getDeporteFormulario();
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
  const casa = getCasaPorId(casaFormularioId);
  const datosCasa = {
    casaId: casa.id,
    casaNombre: casa.nombre
  };
  if (jugadas.length > 0) {
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

  try {
    if (tipoApuesta === "simple") {
      // ── Guardar cada partido simple como apuesta independiente ──
      const slots = document.querySelectorAll("#eventosSimpleContainer .simple-slot");
      const saves = [];
      slots.forEach((slot, idx) => {
        const ev = autocorregirTextoApuesta(slot.querySelector(".jugada-ev-input").value.trim());
        const jug = autocorregirTextoApuesta(slot.querySelector(".jugada-jug-input").value.trim(), ev);

        const importeInput = slot.querySelector(".jugada-importe-input");
        const importeSlotVal = importeInput.value.trim();

        const hasCustom = (importeInput.dataset.touched === '1' && importeSlotVal && parseFloat(importeSlotVal) > 0);
        const importeSlot = hasCustom
          ? parseFloat(importeSlotVal)
          : importe;

        const c = parseFloat(slot.querySelector(".jugada-cuota-input").value.trim());
        const jugadasSlot = enriquecerJugadasAuto(
          [{ ev, c, estado: resultado, selections: [{ titulo: "", jugada: jug, estado: resultado }] }],
          deporte
        );
        saves.push(addDoc(collection(db, "apuestas"), {
          ...datosCasa,
          deporte,
          fecha, dia,
          evento: ev,
          jugadas: jugadasSlot,
          tipoApuesta: "simple",
          cuota: c,
          importe: importeSlot,
          resultado,
          creadoEn: Date.now() + idx
        }));
      });
      await Promise.all(saves);
    } else if (tipoApuesta === "simple_option_bet") {
      const slots = document.querySelectorAll("#eventosSimpleOptionContainer .simple-option-slot");
      const saves = [];
      slots.forEach((slot, idx) => {
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
        const jugadasSlot = enriquecerJugadasAuto([jugada], deporte);

        saves.push(addDoc(collection(db, "apuestas"), {
          ...datosCasa,
          deporte,
          fecha, dia,
          evento: ev,
          jugadas: jugadasSlot,
          tipoApuesta: "simple_option_bet",
          cuota: optiOdds,
          importe: importeSlot,
          resultado: "pendiente",
          creadoEn: Date.now() + idx
        }));
      });
      await Promise.all(saves);
    } else if (tipoApuesta === "crear_apuesta_simple") {
      // ── Guardar cada partido de crear apuesta simple como apuesta independiente ──
      const slots = document.querySelectorAll("#eventosCrearSimpleContainer .crear-simple-slot");
      const saves = [];
      slots.forEach((slot, idx) => {
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
        const jugadasSlot = enriquecerJugadasAuto(
          [{ ev, c, estado: resultado, selections: selections.map(sel => ({ ...sel, estado: resultado })) }],
          deporte
        );

        saves.push(addDoc(collection(db, "apuestas"), {
          ...datosCasa,
          deporte,
          fecha, dia,
          evento: ev,
          jugadas: jugadasSlot,
          tipoApuesta: "crear_apuesta_simple",
          cuota: c,
          importe: importeSlot,
          resultado,
          creadoEn: Date.now() + idx
        }));
      });
      await Promise.all(saves);
    } else {
      await addDoc(collection(db, "apuestas"), {
        ...datosCasa,
        deporte,
        fecha, evento, jugadas, tipoApuesta, cuota, importe,
        resultado,
        dia,
        creadoEn: Date.now()
      });
    }
  } catch (e) {
    console.error("Error al agregar la apuesta:", e);
    mostrarModalValidacion(["Error al guardar la apuesta en la base de datos: " + e.message]);
    return;
  }

  // Siempre apunta el filtro a la casa de la apuesta recién guardada
  // para que el usuario vea la nueva apuesta de inmediato en el historial.
  filtroCasaId = casaFormularioId;
  // Calcular la página después de actualizar filtroCasaId para usar el filtro correcto
  const diasUnicosPost = [...new Set([...getApuestasFiltradas().map(a => a.dia), dia])].sort((a, b) => new Date(a) - new Date(b));
  paginaActual = Math.ceil((diasUnicosPost.indexOf(dia) + 1) / porPagina) || 1;
  renderCasasControls();

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

  // Forzar renderizado para sincronizar la interfaz
  render();
}

/* =========================
   CAMBIAR ESTADO
 ========================= */
async function cambiarEstado(id, nuevoEstado) {
  const scrollPosition = window.scrollY;

  const index = apuestas.findIndex(a => a.id === id);
  let updatedJugadas = null;
  let updatedCuota = null;
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
      }
    }
  }

  const apuestaActualizada = index > -1 ? apuestas[index] : null;
  const renderFluido = actualizarFilaCrearApuestaDom(apuestaActualizada, true);
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

  render();
  window.scrollTo(0, scrollPosition);

  try {
    await updateDoc(doc(db, "apuestas", id), {
      jugadas,
      resultado: nuevoResultado,
      cuota: nuevaCuota
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

async function cargarJuegosMlbPorFecha(fecha) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${encodeURIComponent(fecha)}&hydrate=linescore`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MLB API respondio ${response.status}`);
  }

  const data = await response.json();
  return (data.dates || []).flatMap(d => d.games || []);
}

function buscarJuegoMlb(juegos = [], equipos = []) {
  if (!Array.isArray(equipos) || equipos.length < 2) return null;
  const buscados = equipos.map(normalizarClaveMlb);

  return juegos.find(game => {
    const nombres = [
      game?.teams?.home?.team?.name,
      game?.teams?.away?.team?.name
    ].map(normalizarClaveMlb);
    return buscados.every(equipo => nombres.includes(equipo));
  }) || null;
}

function getMarcadorMlb(game) {
  const home = Number(game?.teams?.home?.score ?? game?.linescore?.teams?.home?.runs);
  const away = Number(game?.teams?.away?.score ?? game?.linescore?.teams?.away?.runs);
  if (Number.isNaN(home) || Number.isNaN(away)) return null;

  return {
    home,
    away,
    total: home + away,
    homeTeam: game?.teams?.home?.team?.name || "",
    awayTeam: game?.teams?.away?.team?.name || ""
  };
}

function juegoMlbFinalizado(game) {
  const state = game?.status?.abstractGameState || "";
  const detail = game?.status?.detailedState || "";
  return state === "Final" || /\b(final|game over)\b/i.test(detail);
}

function evaluarAutoMlb(autoMlb, game) {
  if (!autoMlb) return null;
  const marcador = getMarcadorMlb(game);
  if (!marcador) return null;
  const finalizado = juegoMlbFinalizado(game);

  if (autoMlb.mercado === "ganador_partido") {
    if (!finalizado) return null;
    const homeWon = marcador.home > marcador.away;
    const awayWon = marcador.away > marcador.home;
    if (!homeWon && !awayWon) return { estado: "nula", marcador };

    const ganador = homeWon ? marcador.homeTeam : marcador.awayTeam;
    return {
      estado: normalizarClaveMlb(ganador) === normalizarClaveMlb(autoMlb.seleccionEquipo) ? "ganada" : "perdida",
      marcador
    };
  }

  if (autoMlb.mercado === "total_carreras") {
    const linea = Number(autoMlb.linea);
    if (Number.isNaN(linea)) return null;
    if (!finalizado) {
      if (autoMlb.tipoTotal === "over" && marcador.total > linea) return { estado: "ganada", marcador };
      if (autoMlb.tipoTotal === "under" && marcador.total > linea) return { estado: "perdida", marcador };
      return null;
    }
    if (marcador.total === linea) return { estado: "nula", marcador };
    const ganaOver = marcador.total > linea;
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

function aplicarResultadoMlbApuesta(apuesta, juegosFecha = []) {
  const jugadas = normalizarJugadasConEstado(apuesta.jugadas || []);
  let huboCambio = false;
  let huboCambioMetadata = false;

  const nuevasJugadas = jugadas.map(jugada => {
    if (typeof jugada !== "object" || !jugada) return jugada;

    const ev = jugada.ev || jugada.evento || apuesta.evento || "";
    const selections = getSelectionsFromJugada(jugada).map(sel => {
      const autoMlbOriginal = sel.autoMlb || null;
      const autoMlb = autoMlbOriginal || crearAutoMlbSeleccion({
        evento: ev,
        titulo: sel.titulo || "",
        jugada: sel.jugada || ""
      });
      if (!autoMlb) return sel;

      if (!autoMlbOriginal) huboCambioMetadata = true;
      const game = buscarJuegoMlb(juegosFecha, autoMlb.equipos);
      if (!game) return { ...sel, autoMlb };

      const evaluacion = evaluarAutoMlb(autoMlb, game);
      if (!evaluacion) {
        const marcador = getMarcadorMlb(game);
        const estadoJuego = game?.status?.detailedState || game?.status?.abstractGameState || "";
        const marcadorTexto = marcador
          ? `${marcador.awayTeam} ${marcador.away} - ${marcador.home} ${marcador.homeTeam}`
          : autoMlb.marcador;
        if (autoMlb.gamePk !== game.gamePk || autoMlb.estadoJuego !== estadoJuego || autoMlb.marcador !== marcadorTexto) {
          huboCambioMetadata = true;
        }
        return {
          ...sel,
          autoMlb: {
            ...autoMlb,
            gamePk: game.gamePk,
            estadoJuego,
            marcador: marcadorTexto,
            totalCarreras: marcador?.total
          }
        };
      }

      const siguiente = {
        ...sel,
        estado: evaluacion.estado,
        autoMlb: {
          ...autoMlb,
          gamePk: game.gamePk,
          estadoJuego: game?.status?.detailedState || game?.status?.abstractGameState || "Final",
          marcador: `${evaluacion.marcador.awayTeam} ${evaluacion.marcador.away} - ${evaluacion.marcador.home} ${evaluacion.marcador.homeTeam}`,
          totalCarreras: evaluacion.marcador.total,
          sincronizadoEn: Date.now()
        }
      };

      if ((sel.estado || "pendiente") !== evaluacion.estado) huboCambio = true;
      if (autoMlb.sincronizadoEn === undefined) huboCambioMetadata = true;
      return siguiente;
    });

    const equiposMlb = detectarEquiposMlb(ev);
    const jugadaActualizada = {
      ...jugada,
      selections
    };

    if (jugada.autoMlb) {
      jugadaActualizada.autoMlb = jugada.autoMlb;
    } else if (equiposMlb.length >= 2) {
      jugadaActualizada.autoMlb = { deporte: "mlb", equipos: equiposMlb.slice(0, 2) };
    }

    if (apuesta.tipoApuesta === "simple_option_bet") {
      const totalAuto = selections.find(sel => sel.autoMlb?.mercado === "total_carreras")?.autoMlb;
      const game = totalAuto ? buscarJuegoMlb(juegosFecha, totalAuto.equipos) : null;
      const marcador = game ? getMarcadorMlb(game) : null;
      const finalizado = game ? juegoMlbFinalizado(game) : false;
      const totalIrreversible = marcador && totalAuto && (
        finalizado ||
        (totalAuto.tipoTotal === "over" && marcador.total > Number(totalAuto.linea)) ||
        (totalAuto.tipoTotal === "under" && marcador.total > Number(totalAuto.linea))
      );
      if (totalIrreversible && jugadaActualizada.resultadoTotal !== marcador.total) {
        jugadaActualizada.resultadoTotal = marcador.total;
        huboCambio = true;
      }
    }

    jugadaActualizada.estado = determinarEstadoJugada(jugadaActualizada);
    return jugadaActualizada;
  });

  if (!huboCambio && !huboCambioMetadata) return null;

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
  } else if (apuesta.tipoApuesta !== "simple") {
    const cuotaRecalculada = recalcularCuotaCombinada(nuevasJugadas);
    if (cuotaRecalculada > 0) cuota = cuotaRecalculada;
  }

  return {
    jugadas: nuevasJugadas,
    resultado,
    cuota,
    deporte: "mlb",
    autoSync: {
      proveedor: "mlb_stats_api",
      ultimaRevision: Date.now()
    }
  };
}

async function sincronizarResultadosMlb() {
  const candidatas = apuestas.filter(a =>
    apuestaPareceMlb(a) &&
    ((a.resultado || "pendiente") === "pendiente" || !apuestaTieneMarcadorMlb(a)) &&
    Array.isArray(a.jugadas) &&
    a.jugadas.length > 0
  );

  if (candidatas.length === 0) {
    setMlbSyncStatus("No hay apuestas MLB para sincronizar.", "");
    return;
  }

  const btn = document.getElementById("btnSincronizarMlb");
  if (btn) btn.disabled = true;
  setMlbSyncStatus("Sincronizando resultados MLB...", "");

  try {
    const fechas = [...new Set(candidatas.map(a => a.fecha || a.dia).filter(Boolean))];
    const juegosPorFecha = new Map();
    for (const fecha of fechas) {
      const fechasBusqueda = getFechasCercanas(fecha);
      const juegos = [];
      for (const fechaBusqueda of fechasBusqueda) {
        juegos.push(...await cargarJuegosMlbPorFecha(fechaBusqueda));
      }
      juegosPorFecha.set(fecha, juegos);
    }

    let actualizadas = 0;
    let revisadas = 0;

    for (const apuesta of candidatas) {
      revisadas++;
      const fecha = apuesta.fecha || apuesta.dia;
      const updateData = aplicarResultadoMlbApuesta(apuesta, juegosPorFecha.get(fecha) || []);
      if (!updateData) continue;

      await updateDoc(doc(db, "apuestas", apuesta.id), limpiarUndefinedFirestore(updateData));
      actualizadas++;
    }

    setMlbSyncStatus(
      `MLB sincronizado: ${actualizadas} de ${revisadas} apuestas revisadas.`,
      actualizadas > 0 ? "success" : ""
    );
  } catch (e) {
    console.error("Error sincronizando MLB:", e);
    setMlbSyncStatus(`No se pudo sincronizar MLB: ${e.message}`, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function getAutoMlbMarcadorHtml(selection = {}) {
  const autoMlb = selection?.autoMlb || {};
  const marcador = autoMlb.marcador;
  if (!marcador) return "";
  const totalCarreras = Number(autoMlb.totalCarreras);
  const carrerasHtml = Number.isNaN(totalCarreras) ? "" : ` · Carreras: ${escapeHtml(totalCarreras)}`;
  return `<div class="auto-mlb-score">${escapeHtml(marcador)}${carrerasHtml}</div>`;
}

const FOOTBALL_LEAGUES = [
  { slug: "fifa.world", label: "FIFA" },
  { slug: "fifa.friendly", label: "Amistosos internacionales" },
  { slug: "fifa.worldq", label: "Eliminatorias mundialistas" },
  { slug: "uefa.euro", label: "Eurocopa" },
  { slug: "uefa.nations", label: "UEFA Nations League" },
  { slug: "uefa.champions", label: "Champions League" },
  { slug: "uefa.europa", label: "Europa League" },
  { slug: "eng.1", label: "Premier League" },
  { slug: "esp.1", label: "LaLiga" },
  { slug: "ita.1", label: "Serie A" },
  { slug: "ger.1", label: "Bundesliga" },
  { slug: "fra.1", label: "Ligue 1" },
  { slug: "conmebol.libertadores", label: "Libertadores" },
  { slug: "conmebol.sudamericana", label: "Sudamericana" }
];

const FOOTBALL_TEAM_ALIASES = [
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
  ["marruecos", "morocco"],
  ["japon", "japan"],
  ["corea del sur", "south korea"],
  ["estados unidos", "united states"],
  ["eeuu", "united states"],
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

function aplicarAliasFutbol(normalizado = "") {
  let texto = normalizado;
  FOOTBALL_TEAM_ALIASES
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([alias, oficial]) => {
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

function apuestaTieneAutoFutbol(apuesta) {
  if (apuesta?.deporte === "futbol") return true;
  return (apuesta?.jugadas || []).some(j =>
    j?.autoFutbol?.deporte === "futbol" ||
    (j?.selections || []).some(sel => sel?.autoFutbol?.deporte === "futbol")
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

function fechaEspn(fecha = "") {
  return String(fecha).replace(/-/g, "");
}

function getFechasCercanas(fecha = "") {
  const base = new Date(`${fecha}T12:00:00`);
  if (Number.isNaN(base.getTime())) return [fecha].filter(Boolean);

  return [-1, 0, 1].map(offset => {
    const date = new Date(base);
    date.setDate(base.getDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}

async function cargarJuegosFutbolPorFecha(fecha) {
  const date = fechaEspn(fecha);
  const resultados = [];

  for (const liga of FOOTBALL_LEAGUES) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga.slug}/scoreboard?dates=${encodeURIComponent(date)}&lang=es&region=mx`;
      const response = await fetch(url);
      if (!response.ok) continue;

      const data = await response.json();
      (data.events || []).forEach(event => resultados.push({ ...event, leagueSlug: liga.slug, leagueLabel: liga.label }));
    } catch (e) {
      console.warn("No se pudo cargar liga de futbol:", liga.slug, e);
    }
  }

  return resultados;
}

const footballSummaryCache = new Map();

async function cargarResumenFutbol(game) {
  if (!game?.id || !game?.leagueSlug) return null;
  const cacheKey = `${game.leagueSlug}:${game.id}`;
  if (footballSummaryCache.has(cacheKey)) return footballSummaryCache.get(cacheKey);

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${game.leagueSlug}/summary?event=${encodeURIComponent(game.id)}&lang=es&region=mx`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    footballSummaryCache.set(cacheKey, data);
    return data;
  } catch (e) {
    console.warn("No se pudo cargar resumen de futbol:", game.leagueSlug, game.id, e);
    return null;
  }
}

function getCompetidoresFutbol(event) {
  const competitors = event?.competitions?.[0]?.competitors || [];
  return competitors.map(item => ({
    homeAway: item.homeAway,
    score: Number(item.score),
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
  const matches = objetivoTokens.filter(token => opcionesTokens.includes(token)).length;
  return matches / Math.max(objetivoTokens.length, 1);
}

function buscarJuegoFutbol(juegos = [], equipos = []) {
  if (!Array.isArray(equipos) || equipos.length < 2) return null;

  let mejor = { game: null, score: 0 };
  juegos.forEach(game => {
    const competitors = getCompetidoresFutbol(game);
    if (competitors.length < 2) return;

    const scoreA = Math.max(...competitors.map(c => scoreEquipoFutbol(equipos[0], c)));
    const scoreB = Math.max(...competitors.map(c => scoreEquipoFutbol(equipos[1], c)));
    const total = scoreA + scoreB;
    if (total > mejor.score && scoreA >= 0.45 && scoreB >= 0.45) {
      mejor = { game, score: total };
    }
  });

  return mejor.game;
}

function juegoFutbolFinalizado(game) {
  const status = game?.status?.type || game?.competitions?.[0]?.status?.type || {};
  return status.completed === true || status.state === "post" || /\bfinal\b/i.test(status.description || status.detail || "");
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

function getTotalCornersFutbol(summary) {
  const teams = summary?.boxscore?.teams || [];
  if (!Array.isArray(teams) || teams.length === 0) return null;

  let total = 0;
  let encontrados = 0;
  teams.forEach(teamInfo => {
    const stat = (teamInfo.statistics || []).find(item => item.name === "wonCorners");
    if (!stat) return;
    const value = Number(stat.value ?? stat.displayValue);
    if (Number.isNaN(value)) return;
    total += value;
    encontrados++;
  });

  return encontrados > 0 ? total : null;
}

function evaluarAutoFutbol(autoFutbol, game, summary = null) {
  if (!autoFutbol) return null;
  const marcador = getMarcadorFutbol(game);
  if (!marcador) return null;
  const finalizado = juegoFutbolFinalizado(game);

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
    if (marcador.home === marcador.away) return { estado: "ganada", marcador };

    const ganador = marcador.home > marcador.away ? marcador.homeTeam : marcador.awayTeam;
    return {
      estado: normalizarClaveFutbol(ganador).includes(normalizarClaveFutbol(autoFutbol.seleccionEquipo)) ||
        normalizarClaveFutbol(autoFutbol.seleccionEquipo).includes(normalizarClaveFutbol(ganador))
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
    if (!finalizado) {
      if (autoFutbol.tipoTotal === "over" && marcador.total > linea) return { estado: "ganada", marcador };
      if (autoFutbol.tipoTotal === "under" && marcador.total > linea) return { estado: "perdida", marcador };
      return null;
    }
    if (marcador.total === linea) return { estado: "nula", marcador };
    const ganaOver = marcador.total > linea;
    return {
      estado: (autoFutbol.tipoTotal === "over" ? ganaOver : !ganaOver) ? "ganada" : "perdida",
      marcador
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
    const totalCorners = getTotalCornersFutbol(summary);
    const linea = Number(autoFutbol.linea);
    if (totalCorners === null || Number.isNaN(linea)) return null;
    if (!finalizado) {
      if (autoFutbol.tipoTotal === "over" && totalCorners > linea) return { estado: "ganada", marcador, totalCorners };
      if (autoFutbol.tipoTotal === "under" && totalCorners > linea) return { estado: "perdida", marcador, totalCorners };
      return null;
    }
    if (totalCorners === linea) return { estado: "nula", marcador, totalCorners };
    const ganaOver = totalCorners > linea;
    return {
      estado: (autoFutbol.tipoTotal === "over" ? ganaOver : !ganaOver) ? "ganada" : "perdida",
      marcador,
      totalCorners
    };
  }

  return null;
}

async function aplicarResultadoFutbolApuesta(apuesta, juegosFecha = []) {
  const jugadas = normalizarJugadasConEstado(apuesta.jugadas || []);
  let huboCambio = false;
  let huboCambioMetadata = false;

  const nuevasJugadas = [];

  for (const jugada of jugadas) {
    if (typeof jugada !== "object" || !jugada) {
      nuevasJugadas.push(jugada);
      continue;
    }

    const ev = jugada.ev || jugada.evento || apuesta.evento || "";
    const selections = [];

    for (const sel of getSelectionsFromJugada(jugada)) {
      const autoOriginal = sel.autoFutbol || null;
      const autoFutbol = autoOriginal || crearAutoFutbolSeleccion({
        evento: ev,
        titulo: sel.titulo || "",
        jugada: sel.jugada || ""
      });
      if (!autoFutbol) {
        selections.push(sel);
        continue;
      }

      if (!autoOriginal) huboCambioMetadata = true;
      const game = buscarJuegoFutbol(juegosFecha, autoFutbol.equipos);
      if (!game) {
        selections.push({ ...sel, autoFutbol });
        continue;
      }

      const summary = autoFutbol.mercado === "total_corners" ? await cargarResumenFutbol(game) : null;
      const evaluacion = evaluarAutoFutbol(autoFutbol, game, summary);
      if (!evaluacion) {
        const estadoJuego = game?.status?.type?.detail || game?.status?.type?.description || "";
        const marcador = getMarcadorFutbol(game);
        const marcadorTexto = marcador
          ? `${marcador.awayTeam} ${marcador.away} - ${marcador.home} ${marcador.homeTeam}`
          : autoFutbol.marcador;
        if (autoFutbol.id !== game.id || autoFutbol.estadoJuego !== estadoJuego || autoFutbol.marcador !== marcadorTexto) {
          huboCambioMetadata = true;
        }
        selections.push({
          ...sel,
          autoFutbol: {
            ...autoFutbol,
            id: game.id,
            liga: game.leagueLabel,
            estadoJuego,
            marcador: marcadorTexto
          }
        });
        continue;
      }

      const siguiente = {
        ...sel,
        estado: evaluacion.estado,
        autoFutbol: {
          ...autoFutbol,
          id: game.id,
          liga: game.leagueLabel,
          estadoJuego: game?.status?.type?.detail || game?.status?.type?.description || "Final",
          marcador: `${evaluacion.marcador.awayTeam} ${evaluacion.marcador.away} - ${evaluacion.marcador.home} ${evaluacion.marcador.homeTeam}`,
          totalCorners: evaluacion.totalCorners ?? autoFutbol.totalCorners,
          sincronizadoEn: Date.now()
        }
      };

      if ((sel.estado || "pendiente") !== evaluacion.estado) huboCambio = true;
      if (autoFutbol.sincronizadoEn === undefined) huboCambioMetadata = true;
      selections.push(siguiente);
    }

    const equipos = extraerEquiposEventoFutbol(ev);
    const jugadaActualizada = {
      ...jugada,
      selections
    };

    if (jugada.autoFutbol) {
      jugadaActualizada.autoFutbol = jugada.autoFutbol;
    } else if (equipos.length >= 2) {
      jugadaActualizada.autoFutbol = { deporte: "futbol", equipos };
    }

    if (apuesta.tipoApuesta === "simple_option_bet") {
      const totalAuto = selections.find(sel => sel.autoFutbol?.mercado === "total_goles")?.autoFutbol;
      const game = totalAuto ? buscarJuegoFutbol(juegosFecha, totalAuto.equipos) : null;
      const marcador = game ? getMarcadorFutbol(game) : null;
      const finalizado = game ? juegoFutbolFinalizado(game) : false;
      const totalIrreversible = marcador && totalAuto && (
        finalizado ||
        (totalAuto.tipoTotal === "over" && marcador.total > Number(totalAuto.linea)) ||
        (totalAuto.tipoTotal === "under" && marcador.total > Number(totalAuto.linea))
      );
      if (totalIrreversible && jugadaActualizada.resultadoTotal !== marcador.total) {
        jugadaActualizada.resultadoTotal = marcador.total;
        huboCambio = true;
      }
    }

    jugadaActualizada.estado = determinarEstadoJugada(jugadaActualizada);
    nuevasJugadas.push(jugadaActualizada);
  }

  if (!huboCambio && !huboCambioMetadata) return null;

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
  } else if (apuesta.tipoApuesta !== "simple" && apuesta.tipoApuesta !== "simple_option_bet") {
    const cuotaRecalculada = recalcularCuotaCombinada(nuevasJugadas);
    if (cuotaRecalculada > 0) cuota = cuotaRecalculada;
  }

  return {
    jugadas: nuevasJugadas,
    resultado,
    cuota,
    deporte: "futbol",
    autoSync: {
      proveedor: "espn_soccer_scoreboard",
      ultimaRevision: Date.now()
    }
  };
}

async function sincronizarResultadosFutbol() {
  const candidatas = apuestas.filter(a =>
    apuestaPareceFutbol(a) &&
    ((a.resultado || "pendiente") === "pendiente" || !apuestaTieneMarcadorFutbol(a)) &&
    Array.isArray(a.jugadas) &&
    a.jugadas.length > 0
  );

  if (candidatas.length === 0) {
    setFootballSyncStatus("No hay apuestas de fútbol para sincronizar.", "");
    return;
  }

  const btn = document.getElementById("btnSincronizarFutbol");
  if (btn) btn.disabled = true;
  setFootballSyncStatus("Sincronizando resultados de fútbol...", "");

  try {
    const fechas = [...new Set(candidatas.map(a => a.fecha || a.dia).filter(Boolean))];
    const juegosPorFecha = new Map();
    for (const fecha of fechas) {
      const fechasBusqueda = getFechasCercanas(fecha);
      const juegos = [];
      for (const fechaBusqueda of fechasBusqueda) {
        juegos.push(...await cargarJuegosFutbolPorFecha(fechaBusqueda));
      }
      juegosPorFecha.set(fecha, juegos);
    }

    let actualizadas = 0;
    let revisadas = 0;

    for (const apuesta of candidatas) {
      revisadas++;
      const fecha = apuesta.fecha || apuesta.dia;
      const updateData = await aplicarResultadoFutbolApuesta(apuesta, juegosPorFecha.get(fecha) || []);
      if (!updateData) continue;

      await updateDoc(doc(db, "apuestas", apuesta.id), limpiarUndefinedFirestore(updateData));
      actualizadas++;
    }

    setFootballSyncStatus(
      `Fútbol sincronizado: ${actualizadas} de ${revisadas} apuestas revisadas.`,
      actualizadas > 0 ? "success" : ""
    );
  } catch (e) {
    console.error("Error sincronizando fútbol:", e);
    setFootballSyncStatus(`No se pudo sincronizar fútbol: ${e.message}`, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function getAutoFutbolMarcadorHtml(selection = {}) {
  const marcador = selection?.autoFutbol?.marcador;
  if (!marcador) return "";
  const estadoJuego = selection.autoFutbol.estadoJuego || "Final";
  const liga = selection.autoFutbol.liga ? ` · ${escapeHtml(selection.autoFutbol.liga)}` : "";
  const totalCorners = selection.autoFutbol.totalCorners;
  if (totalCorners !== undefined && totalCorners !== null) {
    return `<div class="auto-mlb-score">Corners: ${escapeHtml(totalCorners)}${liga}</div>`;
  }
  const corners = totalCorners !== undefined && totalCorners !== null
    ? ` · Corners: ${escapeHtml(selection.autoFutbol.totalCorners)}`
    : "";
  return `<div class="auto-mlb-score">${escapeHtml(estadoJuego)} · ${escapeHtml(marcador)}${corners}${liga}</div>`;
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

    let errores = [];

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
      const jugada = isSimpleOption
        ? { ev, c: optiOdds || 0, optiOdds: optiOdds || 0, maxOdds: maxOdds || 0, resultadoTotal, selections }
        : { ev, c: isMulti ? (c || 0) : 0, selections };
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
    } else if (nuevoTipo === "combinada" || nuevoTipo === "crear_apuesta" || nuevoTipo === "crear_apuesta_simple") {
      let cuotaCalculada = 1;
      let tieneCuotas = false;
      nuevasJugadas.forEach(j => {
        if (j.c > 0) {
          cuotaCalculada *= j.c;
          tieneCuotas = true;
        }
      });
      nuevaCuota = tieneCuotas ? parseFloat(cuotaCalculada.toFixed(2)) : 0;
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

    if (index > -1) {
      apuestas[index].tipoApuesta = nuevoTipo;
      apuestas[index].evento = nuevoEvento;
      apuestas[index].cuota = nuevaCuota;
      apuestas[index].importe = nuevoImporte;
      apuestas[index].jugadas = nuevasJugadas;
      apuestas[index].resultado = nuevoResultado;
      apuestas[index].casaId = nuevaCasa.id;
      apuestas[index].casaNombre = nuevaCasa.nombre;
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
      casaNombre: nuevaCasa.nombre
    };
    updateData.resultado = nuevoResultado;

    await updateDoc(doc(db, "apuestas", id), updateData);

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
function formatTextWithCorners(texto, forceGoalIcon = false, forceCornerIcon = false) {
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
  if (/\btarjetas?\b/.test(normalized)) {
    const svgIcon = `<img src="images/Yellow_Red_Card.svg" class="corner-kick-icon card-icon" alt="">`;
    return `<span class="corner-kick-text">${svgIcon}<span class="corner-kick-label">${formattedText}</span></span>`;
  }
  return formattedText;
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

function getResultadoColor(resultado = "pendiente") {
  if (resultado === "ganada") return "#00ff88";
  if (resultado === "perdida") return "#ff4444";
  if (resultado === "nula") return "#888888";
  return "white";
}

function getEstadoSeleccionIconHtml(estado = "pendiente") {
  const config = {
    ganada: { bg: "#22c55e", color: "white", title: "Ganada", symbol: "&#10003;" },
    perdida: { bg: "#ef4444", color: "white", title: "Perdida", symbol: "&#10005;" },
    nula: { bg: "#64748b", color: "white", title: "Nula", symbol: "&#8722;" },
    pendiente: { bg: "#334155", color: "#cbd5e1", title: "Pendiente", symbol: "&#9203;" }
  };
  const item = config[estado] || config.pendiente;
  return `<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:${item.bg}; color:${item.color}; font-size:12px; cursor:pointer; transition:background-color 160ms ease, color 160ms ease, transform 160ms ease;" title="${item.title}">${item.symbol}</span>`;
}

function actualizarSeleccionEstadoDom(apuesta, matchIndex, selIndex) {
  const selection = apuesta?.jugadas?.[matchIndex]?.selections?.[selIndex];
  if (!selection) return;

  const key = `${apuesta.id}-${matchIndex}-${selIndex}`;
  const wrapper = document.querySelector(`[data-selection-wrap="${key}"]`);
  const icon = document.querySelector(`[data-state-icon="${key}"]`);
  const estado = selection.estado || "pendiente";

  if (wrapper) {
    wrapper.style.textDecoration = estado === "nula" ? "line-through" : "";
    wrapper.style.opacity = estado === "nula" ? "0.6" : "";
  }
  if (icon) {
    icon.innerHTML = getEstadoSeleccionIconHtml(estado);
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
  if (renderSnapshotPendiente) return;
  renderSnapshotPendiente = true;

  requestAnimationFrame(() => {
    renderSnapshotPendiente = false;
    render();
  });
}

function _render() {
  const contenido = document.getElementById("contenido");
  if (!contenido) return;

  const apuestasRender = getApuestasFiltradas();
  const dias = {};
  apuestasRender.forEach(a => {
    if (!dias[a.dia]) dias[a.dia] = [];
    dias[a.dia].push(a);
  });

  const diasKeys = Object.keys(dias).sort(
    (a, b) => new Date(a) - new Date(b)
  );

  const totalPaginas = Math.ceil(diasKeys.length / porPagina);

  if (paginaActual > totalPaginas) {
    paginaActual = totalPaginas || 1;
  }

  const inicio = (paginaActual - 1) * porPagina;
  const fin = inicio + porPagina;

  const diasPagina = diasKeys.slice(inicio, fin);

  let html = "";

  if (totalPaginas > 1) {
    html += `
      <div class="paginacion">
        <button onclick="cambiarPagina(-1, false)" ${paginaActual === 1 ? 'disabled' : ''}>⬅</button>
        <span> Página ${paginaActual} / ${totalPaginas} </span>
        <button onclick="cambiarPagina(1, false)" ${paginaActual === totalPaginas ? 'disabled' : ''}>➡</button>
      </div>
    `;
  }

  diasPagina.forEach(dia => {
    let inv = 0;
    let ret = 0;
    let filas = "";

    dias[dia].forEach(a => {
      const r = calcularRetornoApuesta(a);

      if (a.resultado !== "pendiente") {
        inv += a.importe;
        ret += r;
      }

      const [year, month, day] = a.fecha.split("-");
      const fechaFormateada = `${day}/${month}/${year}`;

      let celdaEvento = "";
      if (a.jugadas && a.jugadas.length > 0) {

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

            selections.forEach((sel, selIndex) => {
              const jEstado = sel.estado || "pendiente";

              let iconHtml = "";
              if (jEstado === "ganada") {
                iconHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:#22c55e; color:white; font-size:12px; cursor:pointer;" title="Ganada">✔</span>`;
              } else if (jEstado === "perdida") {
                iconHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:#ef4444; color:white; font-size:12px; cursor:pointer;" title="Perdida">✖</span>`;
              } else if (jEstado === "nula") {
                iconHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:#64748b; color:white; font-size:12px; cursor:pointer;" title="Nula">➖</span>`;
              } else {
                iconHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:#334155; color:#cbd5e1; font-size:12px; cursor:pointer;" title="Pendiente">⏳</span>`;
              }

              iconHtml = getEstadoSeleccionIconHtml(jEstado);
              const estadoIcon = `<span data-state-icon="${a.id}-${matchIndex}-${selIndex}" onclick="window.toggleEstadoSeleccion('${a.id}', ${matchIndex}, ${selIndex}, this)" style="margin-left:8px; display:inline-flex; vertical-align:middle;">${iconHtml}</span>`;

              let styleMod = "";
              if (jEstado === "nula") styleMod = "text-decoration: line-through; opacity: 0.6;";

              // En multi-slot, la primera selección de cada slot muestra el nombre del partido
              const formattedEvText = formatTextWithCorners(evText);
              const slotHeaderHtml = (hasMultipleSlots && selIndex === 0 && evText)
                ? `<div style="font-size:14px; color:#ffffff; font-weight:600; margin-bottom:2px;">${formattedEvText}${matchCuotaText}</div>`
                : "";

              const detalleSeleccion = detectarDetalleSeleccionCrear({ ...sel, evento: evText });
              const tituloNormalizado = normalizarTextoMercado(detalleSeleccion.titulo);
              const forceGoalIcon = isSimpleOptionBet || tituloNormalizado === "total de goles";
              const forceCornerIcon = tituloNormalizado === "total tiros de esquina";
              const formattedTitulo = formatTextWithMlbTeams(detalleSeleccion.titulo);
              const formattedJugada = tituloNormalizado === "handicap"
                ? formatHandicapJugada(detalleSeleccion.jugada)
                : formatTextWithCorners(detalleSeleccion.jugada, forceGoalIcon, forceCornerIcon);
              const autoMlbMarcadorHtml = getAutoMlbMarcadorHtml(sel) || getAutoFutbolMarcadorHtml(sel);
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

            const selectionsHtml = selections.map((sel, selIndex) => {
              const jEstado = sel.estado || "pendiente";

              let iconHtml = "";
              if (jEstado === "ganada") {
                iconHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:#22c55e; color:white; font-size:12px; cursor:pointer;" title="Ganada">✔</span>`;
              } else if (jEstado === "perdida") {
                iconHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:#ef4444; color:white; font-size:12px; cursor:pointer;" title="Perdida">✖</span>`;
              } else if (jEstado === "nula") {
                iconHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:#64748b; color:white; font-size:12px; cursor:pointer;" title="Nula">➖</span>`;
              } else {
                iconHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:#334155; color:#cbd5e1; font-size:12px; cursor:pointer;" title="Pendiente">⏳</span>`;
              }

              const estadoIcon = (isSimpleBet || isSimpleOptionBet) ? "" : `<span onclick="window.toggleEstadoSeleccion('${a.id}', ${matchIndex}, ${selIndex})" style="margin-left:8px; display:inline-flex; vertical-align:middle;">${iconHtml}</span>`;

              let styleMod = "";
              if (jEstado === "nula") styleMod = "text-decoration: line-through; opacity: 0.6;";

              const formattedJugada = formatTextWithCorners(sel.jugada, isSimpleOptionBet);
              const selectionLineClass = isPatente ? 'patente-selection-line' : '';
              const selectionTextClass = isPatente ? 'patente-selection-text' : '';
              const autoMlbMarcadorHtml = getAutoMlbMarcadorHtml(sel) || getAutoFutbolMarcadorHtml(sel);
              return `
                <div style="display:flex; flex-direction:column; gap:1px; ${styleMod} margin-top:4px;">
                  ${sel.titulo ? `<div style="font-size:11px; color:${themeColor}; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">${sel.titulo}</div>` : ""}
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
          </div>`;
        }

      } else {
        const formattedEvento = formatTextWithCorners(limpiarEventoDuplicado(a.evento));
        celdaEvento = `<div style="text-align: left; min-width: 150px;"><strong>${formattedEvento}</strong></div>`;
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

    html += `
      <div class="page" data-dia="${dia}">
        <h2>${dias[dia][0].fecha.split("-").reverse().join("-")}</h2>

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

        <button class="btn btn-danger btn-eliminar-dia" onclick="window.eliminarDia('${dia}')">
          🗑 Eliminar día
        </button>
      </div>
    `;
  });

  if (totalPaginas > 1) {
    html += `
      <div class="paginacion">
        <button onclick="cambiarPagina(-1, true)" ${paginaActual === 1 ? 'disabled' : ''}>⬅</button>
        <span> Página ${paginaActual} / ${totalPaginas} </span>
        <button onclick="cambiarPagina(1, true)" ${paginaActual === totalPaginas ? 'disabled' : ''}>➡</button>
      </div>
    `;
  }

  const total = calcularResumenGeneral();
  const roi = total.invertido ? (total.balance / total.invertido) * 100 : 0;
  const resumenCasaTitulo = filtroCasaId === CASA_TODAS_ID ? "Todas las casas" : getCasaNombre(filtroCasaId);
  const puedeEditarFinal = filtroCasaId !== CASA_TODAS_ID;

  html += `
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

  const stats = calcularEstadisticas();

  html += `
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

  contenido.innerHTML = html;
  habilitarAutocompleteMlb(contenido);

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

  if (ultimoDiaAgregado) {
    setTimeout(() => {
      const elemento = document.querySelector(`[data-dia="${ultimoDiaAgregado}"]`);
      if (elemento) {
        const tabla = elemento.querySelector("table");
        if (tabla) {
          tabla.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          elemento.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        ultimoDiaAgregado = null;
        ultimoDiaAgregadoIntentos = 0;
        return;
      }

      ultimoDiaAgregadoIntentos++;
      if (ultimoDiaAgregadoIntentos >= 10) {
        ultimoDiaAgregado = null;
        ultimoDiaAgregadoIntentos = 0;
      }
    }, 300);
  }
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
window.addEventListener("DOMContentLoaded", () => {
  const inputFecha = document.getElementById("fecha");
  if (inputFecha) {
    inputFecha.value = obtenerFechaActualLocal();
  }
  crearMlbTeamsDatalist();
  limpiarCacheLocalObsoleto();
  escucharCasas();
  escucharApuestas();
  document.getElementById("btnAgregar").onclick = agregarApuesta;
  document.getElementById("btnBankroll").onclick = guardarBankroll;
  document.getElementById("btnEliminarCasa").onclick = eliminarCasaSeleccionada;
  document.getElementById("btnCrearCasa").onclick = crearCasa;
  document.getElementById("btnEliminarTodo").onclick = eliminarTodo;
  const btnSincronizarMlb = document.getElementById("btnSincronizarMlb");
  if (btnSincronizarMlb) {
    btnSincronizarMlb.onclick = sincronizarResultadosMlb;
  }
  const btnSincronizarFutbol = document.getElementById("btnSincronizarFutbol");
  if (btnSincronizarFutbol) {
    btnSincronizarFutbol.onclick = sincronizarResultadosFutbol;
  }
  document.addEventListener("input", (e) => {
    if (!e.target?.matches?.(".jugada-ev-input, .evento-principal-input")) return;
    const deporteSelect = document.getElementById("deporte");
    if (!deporteSelect || deporteSelect.value) return;
    if (detectarEquiposMlb(e.target.value).length > 0) {
      deporteSelect.value = "mlb";
      return;
    }
    if (extraerEquiposEventoFutbol(e.target.value).length >= 2) {
      deporteSelect.value = "futbol";
    }
  });

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

});

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
    document.querySelectorAll(`.edit-jugada-slot-${id}`).forEach(slot => {
      const c = parseFloat(slot.querySelector(".edit-jugada-cuota-input")?.value);
      jugadas.push({ c: c || 0, selections: [{ estado: "ganada" }] });
    });

    const cuotaMain = document.getElementById(`edit-cuota-${id}`);
    if (cuotaMain) {
      cuotaMain.value = calcularCuotaMaximaPatente(jugadas).toFixed(2);
    }
    return;
  }

  let total = 1;
  let hasVal = false;
  document.querySelectorAll(`.edit-jugada-slot-${id} .edit-jugada-cuota-input`).forEach(input => {
    const val = parseFloat(input.value);
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

    const scrollPosition = window.scrollY;
    render();
    window.scrollTo(0, scrollPosition);

    try {
      await updateDoc(doc(db, "apuestas", apuesta.id), {
        jugadas: apuesta.jugadas,
        resultado: overallResultado,
        cuota: apuesta.cuota
      });
    } catch (e) {
      console.error(e);
    }
    return;
  }

  const overallResultado = recalcularResultadoApuesta(apuesta);
  const nuevaCuotaTotal = recalcularCuotaCombinada(apuesta.jugadas);
  apuesta.resultado = overallResultado;
  if (apuesta.tipoApuesta !== 'simple' && nuevaCuotaTotal > 0) {
    apuesta.cuota = nuevaCuotaTotal;
  }

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
      cuota: apuesta.cuota
    });
  } catch (e) {
    console.error(e);
    renderSilenciosoApuestas.delete(apuesta.id);
    render();
    window.scrollTo(0, scrollPosition);
  }
};

window.cambiarPagina = function (direccion, scrollAlTop = false) {
  const totalPaginas = Math.ceil(Object.keys(
    getApuestasFiltradas().reduce((acc, a) => {
      acc[a.dia] = true;
      return acc;
    }, {})
  ).length / porPagina);

  paginaActual += direccion;

  if (paginaActual < 1) paginaActual = 1;
  if (paginaActual > totalPaginas) paginaActual = totalPaginas;

  render();
  if (scrollAlTop) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
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

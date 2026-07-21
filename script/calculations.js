export const PATENTE_MIN_SELECTIONS = 3;
export const PATENTE_MAX_SELECTIONS = 8;

export const DOBLES_MIN_SELECTIONS = 2;
export const DOBLES_MAX_SELECTIONS = 15;

export const SISTEMA_MIN_SELECTIONS = 2;
export const SISTEMA_MAX_SELECTIONS = 20;

export function contarCombinacionesDobles(n) {
  if (n < 2) return 0;
  return (n * (n - 1)) / 2;
}

export function calcularRetorno(c, i, r) {
  if (r === "ganada") return c * i;
  if (r === "nula") return i;
  if (r === "pendiente") return 0;
  return 0;
}

export function extraerNumeroJugada(jugada = "") {
  const match = String(jugada).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Math.abs(parseFloat(match[0])) : null;
}

function detectarTipoTotalJugada(jugada = "") {
  const texto = String(jugada)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const numeroConSigno = String(jugada).replace(",", ".").match(/-?\d+(?:\.\d+)?/);

  if (numeroConSigno && parseFloat(numeroConSigno[0]) < 0) return "under";
  if (/\b(under|menos|menor|baja)\b/.test(texto)) return "under";
  return "over";
}

function getSimpleOptionData(apuesta) {
  const jugada = Array.isArray(apuesta?.jugadas) ? apuesta.jugadas[0] : null;
  const selection = Array.isArray(jugada?.selections) ? jugada.selections[0] : null;
  const textoJugada = selection?.jugada || jugada?.jug || jugada?.jugada || "";
  const linea = extraerNumeroJugada(textoJugada);
  const tipoTotal = detectarTipoTotalJugada(textoJugada);
  const resultadoTotal = parseFloat(jugada?.resultadoTotal ?? apuesta?.resultadoTotal);
  const optiOdds = parseFloat(jugada?.optiOdds ?? apuesta?.optiOdds ?? jugada?.c);
  const maxOdds = parseFloat(jugada?.maxOdds ?? apuesta?.maxOdds);

  return {
    linea,
    tipoTotal,
    resultadoTotal,
    optiOdds,
    maxOdds
  };
}

export function calcularCuotaSimpleOptionBet(apuesta) {
  const { linea, tipoTotal, resultadoTotal, optiOdds, maxOdds } = getSimpleOptionData(apuesta);
  if (linea === null || isNaN(resultadoTotal)) return parseFloat(apuesta?.cuota) || 0;

  if (tipoTotal === "under") {
    if (resultadoTotal >= linea) return 0;

    const maximoGanadorCercano = Math.floor(linea);
    if (resultadoTotal === maximoGanadorCercano) return formatDecimal(optiOdds || 0);
    if (resultadoTotal < maximoGanadorCercano) return formatDecimal(maxOdds || 0);
    return 0;
  }

  if (resultadoTotal <= linea) return 0;

  const minimoGanador = Math.ceil(linea);
  if (resultadoTotal === minimoGanador) return formatDecimal(optiOdds || 0);
  if (resultadoTotal > minimoGanador) return formatDecimal(maxOdds || 0);
  return 0;
}

export function determinarResultadoSimpleOptionBet(apuesta) {
  const { linea, tipoTotal, resultadoTotal } = getSimpleOptionData(apuesta);
  if (linea === null || isNaN(resultadoTotal)) return apuesta?.resultado || "pendiente";
  if (tipoTotal === "under") return resultadoTotal < linea ? "ganada" : "perdida";
  return resultadoTotal > linea ? "ganada" : "perdida";
}

function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;

  let result = 1;
  const limit = Math.min(k, n - k);
  for (let i = 1; i <= limit; i++) {
    result = (result * (n - limit + i)) / i;
  }
  return result;
}

function contarCombinacionesPatente(cantidadSelecciones) {
  let total = 0;
  for (let size = 2; size <= cantidadSelecciones; size++) {
    total += binomial(cantidadSelecciones, size);
  }
  return total;
}

function getPatenteSelections(jugadas = []) {
  return jugadas.map(j => {
    if (typeof j !== "object" || !j) {
      return { cuota: 0, estado: "pendiente" };
    }

    const selections = j.selections && j.selections.length
      ? j.selections
      : [{ estado: j.estado || "pendiente" }];

    const hasPerdida = selections.some(sel => (sel.estado || "pendiente") === "perdida");
    const hasPendiente = selections.some(sel => (sel.estado || "pendiente") === "pendiente");
    const hasGanada = selections.some(sel => (sel.estado || "pendiente") === "ganada");
    const allNula = selections.length > 0 && selections.every(sel => (sel.estado || "pendiente") === "nula");

    let estado = "pendiente";
    if (hasPerdida) estado = "perdida";
    else if (hasPendiente) estado = "pendiente";
    else if (hasGanada) estado = "ganada";
    else if (allNula) estado = "nula";

    return {
      cuota: parseFloat(j.c) || 0,
      estado
    };
  });
}

function getCuotaAplicablePatente(item) {
  if (item.estado === "nula") return 1;
  return item.cuota > 0 ? item.cuota : 0;
}

function forEachPatenteCombination(items, callback) {
  const combo = [];

  function walk(start, targetSize) {
    if (combo.length === targetSize) {
      callback(combo.slice());
      return;
    }

    for (let i = start; i <= items.length - (targetSize - combo.length); i++) {
      combo.push(items[i]);
      walk(i + 1, targetSize);
      combo.pop();
    }
  }

  for (let size = 2; size <= items.length; size++) {
    walk(0, size);
  }
}

export function calcularCuotaMaximaPatente(jugadas = []) {
  const selecciones = getPatenteSelections(jugadas);
  const totalCombinaciones = contarCombinacionesPatente(selecciones.length);
  if (!totalCombinaciones) return 0;
  if (selecciones.some(item => getCuotaAplicablePatente(item) <= 0)) return 0;

  let sumaProductos = 0;
  forEachPatenteCombination(selecciones, combo => {
    const producto = combo.reduce((acc, item) => acc * getCuotaAplicablePatente(item), 1);
    sumaProductos += producto;
  });

  return formatDecimal(sumaProductos / totalCombinaciones);
}

export function calcularDetallePatente(apuesta) {
  const selecciones = getPatenteSelections(apuesta?.jugadas || []);
  const totalCombinaciones = contarCombinacionesPatente(selecciones.length);
  const importe = parseFloat(apuesta?.importe) || 0;
  const importePorCombinacion = totalCombinaciones ? importe / totalCombinaciones : 0;

  let retorno = 0;
  let combinacionesGanadas = 0;
  let combinacionesPendientes = 0;

  if (!totalCombinaciones) {
    return {
      retorno: 0,
      totalCombinaciones: 0,
      importePorCombinacion: 0,
      combinacionesGanadas: 0,
      combinacionesPendientes: 0,
      cuotaMaxima: 0
    };
  }

  forEachPatenteCombination(selecciones, combo => {
    const hasPerdida = combo.some(item => item.estado === "perdida");
    const hasPendiente = combo.some(item => item.estado === "pendiente");
    const ganadas = combo.filter(item => item.estado === "ganada").length;

    if (hasPerdida) return;
    if (hasPendiente) {
      combinacionesPendientes++;
      return;
    }
    if (combo.every(item => item.estado === "nula")) {
      retorno += importePorCombinacion;
      return;
    }
    if (ganadas < 1) return;

    const producto = combo.reduce((acc, item) => {
      return acc * getCuotaAplicablePatente(item);
    }, 1);

    retorno += importePorCombinacion * producto;
    combinacionesGanadas++;
  });

  return {
    retorno: formatDecimal(retorno),
    totalCombinaciones,
    importePorCombinacion: formatDecimal(importePorCombinacion),
    combinacionesGanadas,
    combinacionesPendientes,
    cuotaMaxima: calcularCuotaMaximaPatente(apuesta?.jugadas || [])
  };
}

export function determinarResultadoPatente(apuesta) {
  const selecciones = getPatenteSelections(apuesta?.jugadas || []);
  const tienePendientes = selecciones.some(sel => sel.estado === "pendiente");

  if (tienePendientes) {
    const seleccionesQueAunPuedenAportar = selecciones.filter(sel =>
      sel.estado === "ganada" || sel.estado === "pendiente"
    ).length;

    if (seleccionesQueAunPuedenAportar < 2) return "perdida";
    return "pendiente";
  }

  const detalle = calcularDetallePatente(apuesta);
  if (detalle.combinacionesGanadas > 0) return "ganada";
  if (selecciones.length > 0 && selecciones.every(sel => sel.estado === "nula")) return "nula";
  return "perdida";
}

function getDoblesSelections(jugadas = []) {
  return jugadas.map(j => {
    if (typeof j !== "object" || !j) {
      return { cuota: 0, estado: "pendiente" };
    }

    const selections = j.selections && j.selections.length
      ? j.selections
      : [{ estado: j.estado || "pendiente" }];

    const hasPerdida = selections.some(sel => (sel.estado || "pendiente") === "perdida");
    const hasPendiente = selections.some(sel => (sel.estado || "pendiente") === "pendiente");
    const hasGanada = selections.some(sel => (sel.estado || "pendiente") === "ganada");
    const allNula = selections.length > 0 && selections.every(sel => (sel.estado || "pendiente") === "nula");

    let estado = "pendiente";
    if (hasPerdida) estado = "perdida";
    else if (hasPendiente) estado = "pendiente";
    else if (hasGanada) estado = "ganada";
    else if (allNula) estado = "nula";

    return {
      cuota: parseFloat(j.c) || 0,
      estado
    };
  });
}

function getCuotaAplicableDobles(item) {
  if (item.estado === "nula") return 1;
  return item.cuota > 0 ? item.cuota : 0;
}

function forEachDobleCombination(items, callback) {
  const n = items.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      callback([items[i], items[j]]);
    }
  }
}

export function calcularCuotaMaximaDobles(jugadas = []) {
  const selecciones = getDoblesSelections(jugadas);
  const totalCombinaciones = contarCombinacionesDobles(selecciones.length);
  if (!totalCombinaciones) return 0;
  if (selecciones.some(item => getCuotaAplicableDobles(item) <= 0)) return 0;

  let sumaProductos = 0;
  forEachDobleCombination(selecciones, combo => {
    const producto = combo.reduce((acc, item) => acc * getCuotaAplicableDobles(item), 1);
    sumaProductos += producto;
  });

  return formatDecimal(sumaProductos / totalCombinaciones);
}

export function calcularDetalleDobles(apuesta) {
  const selecciones = getDoblesSelections(apuesta?.jugadas || []);
  const totalCombinaciones = contarCombinacionesDobles(selecciones.length);
  const importe = parseFloat(apuesta?.importe) || 0;
  const importePorCombinacion = totalCombinaciones ? importe / totalCombinaciones : 0;

  let retorno = 0;
  let combinacionesGanadas = 0;
  let combinacionesPendientes = 0;
  let sumaCuotasCombinadas = 0;

  if (!totalCombinaciones) {
    return {
      retorno: 0,
      totalCombinaciones: 0,
      importePorCombinacion: 0,
      combinacionesGanadas: 0,
      combinacionesPendientes: 0,
      cuotaMaxima: 0,
      sumaCuotasCombinadas: 0,
      gananciaMaxima: 0
    };
  }

  forEachDobleCombination(selecciones, combo => {
    const producto = combo.reduce((acc, item) => acc * getCuotaAplicableDobles(item), 1);
    sumaCuotasCombinadas += producto;

    const hasPerdida = combo.some(item => item.estado === "perdida");
    const hasPendiente = combo.some(item => item.estado === "pendiente");
    const ganadas = combo.filter(item => item.estado === "ganada").length;

    if (hasPerdida) return;
    if (hasPendiente) {
      combinacionesPendientes++;
      return;
    }
    if (combo.every(item => item.estado === "nula")) {
      retorno += importePorCombinacion;
      return;
    }
    if (ganadas < 1) return;

    retorno += importePorCombinacion * producto;
    combinacionesGanadas++;
  });

  const gananciaMaxima = sumaCuotasCombinadas * importePorCombinacion;

  return {
    retorno: formatDecimal(retorno),
    totalCombinaciones,
    importePorCombinacion: formatDecimal(importePorCombinacion),
    combinacionesGanadas,
    combinacionesPendientes,
    cuotaMaxima: calcularCuotaMaximaDobles(apuesta?.jugadas || []),
    sumaCuotasCombinadas: formatDecimal(sumaCuotasCombinadas),
    gananciaMaxima: formatDecimal(gananciaMaxima)
  };
}

export function determinarResultadoDobles(apuesta) {
  const selecciones = getDoblesSelections(apuesta?.jugadas || []);
  const tienePendientes = selecciones.some(sel => sel.estado === "pendiente");

  if (tienePendientes) {
    const seleccionesQueAunPuedenAportar = selecciones.filter(sel =>
      sel.estado === "ganada" || sel.estado === "pendiente"
    ).length;

    if (seleccionesQueAunPuedenAportar < 2) return "perdida";
    return "pendiente";
  }

  const detalle = calcularDetalleDobles(apuesta);
  if (detalle.combinacionesGanadas > 0) return "ganada";
  if (selecciones.length > 0 && selecciones.every(sel => sel.estado === "nula")) return "nula";
  return "perdida";
}

export function getNombreSistema(k, n) {
  if (k === 1) return "Individuales";
  if (k === 2) return "Dobles";
  if (k === 3) return "Trebles";
  if (k === 4) return "Cuátruples";
  if (k === 5) return "Quíntuples";
  if (k === 6) return "Séxtuples";
  if (k === 7) return "Séptuples";
  if (k === 8) return "Óctuples";
  if (k === 9) return "Nónuples";
  if (k === 10) return "Décuples";
  return `Combinaciones de ${k}`;
}

export function contarCombinacionesSistema(n, k) {
  return binomial(n, k);
}

export function forEachCombination(items, k, callback) {
  const combo = [];
  function walk(start) {
    if (combo.length === k) {
      callback(combo.slice());
      return;
    }
    for (let i = start; i <= items.length - (k - combo.length); i++) {
      combo.push(items[i]);
      walk(i + 1);
      combo.pop();
    }
  }
  walk(0);
}

export function getSistemaSelections(jugadas = []) {
  return jugadas.map(j => {
    if (typeof j !== "object" || !j) {
      return { cuota: 0, estado: "pendiente" };
    }

    const selections = j.selections && j.selections.length
      ? j.selections
      : [{ estado: j.estado || "pendiente" }];

    const hasPerdida = selections.some(sel => (sel.estado || "pendiente") === "perdida");
    const hasPendiente = selections.some(sel => (sel.estado || "pendiente") === "pendiente");
    const hasGanada = selections.some(sel => (sel.estado || "pendiente") === "ganada");
    const allNula = selections.length > 0 && selections.every(sel => (sel.estado || "pendiente") === "nula");

    let estado = "pendiente";
    if (hasPerdida) estado = "perdida";
    else if (hasPendiente) estado = "pendiente";
    else if (hasGanada) estado = "ganada";
    else if (allNula) estado = "nula";

    return {
      cuota: parseFloat(j.c) || 0,
      estado
    };
  });
}

function getCuotaAplicableSistema(item) {
  if (item.estado === "nula") return 1;
  return item.cuota > 0 ? item.cuota : 0;
}

export function calcularCuotaMaximaSistema(jugadas = [], sistemaStakes = {}) {
  const selecciones = getSistemaSelections(jugadas);
  const n = selecciones.length;
  if (n < 2) return 0;

  let totalImporte = 0;
  let totalGananciaMaxima = 0;

  for (let k = 1; k <= n; k++) {
    const stake = parseFloat(sistemaStakes[k] || sistemaStakes[String(k)]) || 0;
    if (stake <= 0) continue;

    const numCombos = binomial(n, k);
    if (!numCombos) continue;

    totalImporte += numCombos * stake;

    let sumaProductos = 0;
    forEachCombination(selecciones, k, combo => {
      const producto = combo.reduce((acc, item) => acc * getCuotaAplicableSistema(item), 1);
      sumaProductos += producto;
    });

    totalGananciaMaxima += sumaProductos * stake;
  }

  if (totalImporte <= 0) return 0;
  return formatDecimal(totalGananciaMaxima / totalImporte);
}

export function calcularDetalleSistema(apuesta) {
  const selecciones = getSistemaSelections(apuesta?.jugadas || []);
  const n = selecciones.length;
  const sistemaStakes = apuesta?.sistemaStakes || (apuesta?.tipoApuesta === "dobles" ? { 2: (parseFloat(apuesta?.importe) || 0) / (contarCombinacionesDobles(n) || 1) } : {});

  let totalImporte = 0;
  let totalGananciaMaxima = 0;
  let retornoTotal = 0;
  let combinacionesGanadas = 0;
  let combinacionesPendientes = 0;
  let totalCombinaciones = 0;

  const tiersBreakdown = {};

  for (let k = 1; k <= n; k++) {
    const stake = parseFloat(sistemaStakes[k] || sistemaStakes[String(k)]) || 0;
    const numCombos = binomial(n, k);

    if (stake > 0 && numCombos > 0) {
      totalCombinaciones += numCombos;
      const importeTier = numCombos * stake;
      totalImporte += importeTier;

      let sumaProductos = 0;
      let retornoTier = 0;
      let ganadasTier = 0;
      let pendientesTier = 0;

      forEachCombination(selecciones, k, combo => {
        const producto = combo.reduce((acc, item) => acc * getCuotaAplicableSistema(item), 1);
        sumaProductos += producto;

        const hasPerdida = combo.some(item => item.estado === "perdida");
        const hasPendiente = combo.some(item => item.estado === "pendiente");
        const ganadasCount = combo.filter(item => item.estado === "ganada").length;

        if (hasPerdida) return;
        if (hasPendiente) {
          pendientesTier++;
          combinacionesPendientes++;
          return;
        }
        if (combo.every(item => item.estado === "nula")) {
          retornoTier += stake;
          return;
        }
        if (ganadasCount < 1) return;

        retornoTier += stake * producto;
        ganadasTier++;
        combinacionesGanadas++;
      });

      const gananciaMaxTier = sumaProductos * stake;
      totalGananciaMaxima += gananciaMaxTier;
      retornoTotal += retornoTier;

      tiersBreakdown[k] = {
        nombre: getNombreSistema(k, n),
        numCombos,
        stake,
        importeTier: formatDecimal(importeTier),
        gananciaMaxTier: formatDecimal(gananciaMaxTier),
        retornoTier: formatDecimal(retornoTier),
        ganadasTier,
        pendientesTier
      };
    }
  }

  if (totalImporte <= 0 && parseFloat(apuesta?.importe) > 0 && n >= 2) {
    totalImporte = parseFloat(apuesta.importe) || 0;
  }

  const cuotaMaximaEquivalente = totalImporte > 0 ? totalGananciaMaxima / totalImporte : 0;

  return {
    retorno: formatDecimal(retornoTotal),
    totalImporte: formatDecimal(totalImporte),
    gananciaMaxima: formatDecimal(totalGananciaMaxima),
    cuotaMaximaEquivalente: formatDecimal(cuotaMaximaEquivalente),
    totalCombinaciones,
    combinacionesGanadas,
    combinacionesPendientes,
    tiersBreakdown
  };
}

export function determinarResultadoSistema(apuesta) {
  const selecciones = getSistemaSelections(apuesta?.jugadas || []);
  const tienePendientes = selecciones.some(sel => sel.estado === "pendiente");

  if (tienePendientes) {
    const seleccionesQueAunPuedenAportar = selecciones.filter(sel =>
      sel.estado === "ganada" || sel.estado === "pendiente"
    ).length;

    if (seleccionesQueAunPuedenAportar < 2) return "perdida";
    return "pendiente";
  }

  const detalle = calcularDetalleSistema(apuesta);
  if (detalle.combinacionesGanadas > 0 || detalle.retorno > 0) return "ganada";
  if (selecciones.length > 0 && selecciones.every(sel => sel.estado === "nula")) return "nula";
  return "perdida";
}

export function calcularRetornoApuesta(apuesta) {
  if (apuesta?.tipoApuesta === "sistema") {
    return calcularDetalleSistema(apuesta).retorno;
  }
  if (apuesta?.tipoApuesta === "patente") {
    return calcularDetallePatente(apuesta).retorno;
  }
  if (apuesta?.tipoApuesta === "dobles") {
    return calcularDetalleDobles(apuesta).retorno;
  }
  if (apuesta?.tipoApuesta === "simple_option_bet") {
    const resultado = determinarResultadoSimpleOptionBet(apuesta);
    if (resultado === "nula") return apuesta?.importe || 0;
    if (resultado !== "ganada") return 0;
    return calcularCuotaSimpleOptionBet(apuesta) * (apuesta?.importe || 0);
  }
  return calcularRetorno(apuesta?.cuota || 0, apuesta?.importe || 0, apuesta?.resultado || "pendiente");
}

export function formatDecimal(val) {
  if (val === undefined || val === null || isNaN(val)) return 0;
  return Number(parseFloat(val).toFixed(10));
}

export function formatCuotaTabla(val) {
  if (val === undefined || val === null || val === "" || isNaN(val)) return "0.00";
  const num = parseFloat(val);
  if (isNaN(num)) return "0.00";
  return num.toFixed(2);
}

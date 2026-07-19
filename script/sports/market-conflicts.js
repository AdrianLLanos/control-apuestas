function getMlbTeams(evento = "", detectarEquiposMlb = null) {
  if (typeof detectarEquiposMlb !== "function") return [];
  try {
    return detectarEquiposMlb(evento) || [];
  } catch (error) {
    console.warn("No se pudo detectar contexto MLB:", error);
    return [];
  }
}

export function esContextoMlb(evento = "", selection = {}, jugada = {}, detectarEquiposMlb = null) {
  return Boolean(
    selection?.autoMlb ||
    jugada?.autoMlb ||
    getMlbTeams(evento, detectarEquiposMlb).length >= 2
  );
}

export function combinarAutoMlbConDetectado(autoOriginal = null, autoDetectado = null) {
  if (!autoOriginal) return autoDetectado;
  if (!autoDetectado) return autoOriginal;

  const equiposDetectados = Array.isArray(autoDetectado.equipos) && autoDetectado.equipos.length >= 2
    ? autoDetectado.equipos
    : null;
  const equiposOriginales = Array.isArray(autoOriginal.equipos) && autoOriginal.equipos.length >= 2
    ? autoOriginal.equipos
    : null;

  const mercadoDetectado = autoDetectado.mercado || "";
  const mercadoOriginal = autoOriginal.mercado || "";
  const mantenerMercadoOriginal = Boolean(mercadoOriginal) && (
    mercadoDetectado === "total_carreras" &&
    ["total_hits", "handicap", "ganador_partido", "ambos_equipos_anotan"].includes(mercadoOriginal)
  );

  return {
    ...autoOriginal,
    mercado: mantenerMercadoOriginal ? mercadoOriginal : (mercadoDetectado || mercadoOriginal),
    equipos: equiposDetectados || equiposOriginales || autoOriginal.equipos || autoDetectado.equipos,
    seleccionEquipo: autoDetectado.seleccionEquipo || autoOriginal.seleccionEquipo,
    tipoTotal: autoDetectado.tipoTotal || autoOriginal.tipoTotal,
    linea: autoDetectado.linea ?? autoOriginal.linea,
    pagoAnticipado: autoOriginal.pagoAnticipado ?? autoDetectado.pagoAnticipado
  };
}

export function quitarAutoFutbolSiEsMlb(selection = {}, jugada = {}, evento = "", detectarEquiposMlb = null) {
  if (!esContextoMlb(evento, selection, jugada, detectarEquiposMlb)) return selection;

  const { autoFutbol, ...selectionSinFutbol } = selection;
  return selectionSinFutbol;
}

export function debeMostrarReglaTiempoFutbol(apuesta = {}, { apuestaPareceMlb, apuestaTieneAutoFutbol } = {}) {
  if (typeof apuestaPareceMlb === "function" && apuestaPareceMlb(apuesta)) return false;
  if (typeof apuestaTieneAutoFutbol !== "function") return false;
  return apuestaTieneAutoFutbol(apuesta);
}

export function debeForzarIconoGol({ isSimpleOptionBet = false, tituloNormalizado = "", contextoMlb = false } = {}) {
  return !contextoMlb && (isSimpleOptionBet || tituloNormalizado === "total de goles");
}

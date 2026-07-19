export function autoFutbolTieneMetaVisible(autoFutbol = {}) {
  return Boolean(
    autoFutbol?.marcador ||
    autoFutbol?.fechaJuego ||
    autoFutbol?.estadoJuego ||
    autoFutbol?.estadoEspecial ||
    autoFutbol?.totalGoles !== undefined ||
    autoFutbol?.totalCorners !== undefined ||
    autoFutbol?.totalTarjetas !== undefined
  );
}

function autosFutbolCompatibles(autoActual = null, candidato = null, equiposFutbolCoinciden = null) {
  if (!autoActual?.equipos || !candidato?.equipos) return true;
  if (typeof equiposFutbolCoinciden !== "function") return true;
  return autoActual.equipos.every(eq =>
    candidato.equipos.some(candidatoEquipo => equiposFutbolCoinciden(eq, candidatoEquipo))
  );
}

function scoreMetaAutoFutbol(autoFutbol = {}) {
  let score = 0;
  if (autoFutbol?.marcador) score += 100;
  if (autoFutbol?.totalGoles !== undefined) score += 30;
  if (autoFutbol?.totalCorners !== undefined || autoFutbol?.cornersEquipo) score += 30;
  if (autoFutbol?.totalTarjetas !== undefined || autoFutbol?.tarjetasEquipo) score += 30;
  if (autoFutbol?.estadoEspecial) score += 20;
  if (autoFutbol?.estadoJuego) score += 10;
  if (autoFutbol?.fechaJuego) score += 5;
  return score;
}

export function completarAutoFutbolRenderDesdeJugada(selection = {}, jugada = {}, deps = {}) {
  const autoActual = selection?.autoFutbol || null;
  const candidatos = [
    ...(Array.isArray(jugada?.selections) ? jugada.selections.map(sel => sel?.autoFutbol).filter(Boolean) : []),
    jugada?.autoFutbol
  ]
    .filter(autoFutbolTieneMetaVisible)
    .filter(auto => autosFutbolCompatibles(autoActual, auto, deps.equiposFutbolCoinciden))
    .sort((a, b) => scoreMetaAutoFutbol(b) - scoreMetaAutoFutbol(a));

  if (candidatos.length === 0) return selection;
  const base = candidatos[0];

  return {
    ...selection,
    autoFutbol: {
      ...(autoActual || {}),
      id: autoActual?.id ?? base.id,
      espnId: autoActual?.espnId ?? base.espnId,
      liga: autoActual?.liga || base.liga,
      estadoJuego: autoActual?.estadoJuego || base.estadoJuego,
      estadoEspecial: autoActual?.estadoEspecial || base.estadoEspecial,
      marcador: autoActual?.marcador || base.marcador,
      marcadorTiempo: autoActual?.marcadorTiempo || base.marcadorTiempo,
      fechaJuego: autoActual?.fechaJuego || base.fechaJuego,
      totalGoles: autoActual?.totalGoles ?? base.totalGoles,
      totalCorners: autoActual?.totalCorners ?? base.totalCorners,
      cornersEquipo: autoActual?.cornersEquipo || base.cornersEquipo,
      totalTarjetas: autoActual?.totalTarjetas ?? base.totalTarjetas,
      tarjetasEquipo: autoActual?.tarjetasEquipo || base.tarjetasEquipo
    }
  };
}

function getAutoFutbolResultadoHtml(contenido = "", extraHtml = "") {
  if (!contenido) return "";
  return `<div class="auto-mlb-score auto-football-score">${contenido}${extraHtml}</div>`;
}

function esNumeroAutoValido(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

export function getAutoFutbolMarcadorHtml(selection = {}, options = {}, deps = {}) {
  const futbolAuto = selection?.autoFutbol || {};
  const escapeHtml = deps.escapeHtml || (value => String(value ?? ""));
  const estadoEspecialHtml = deps.getEstadoEspecialApuestaHtml?.(futbolAuto) || "";
  const showAutoMeta = options.showAutoMeta !== false;
  const suppressSchedule = options.suppressSchedule === true;
  const showFinalStatus = options.showFinalStatus !== false;
  const estadoFinalizadoHtml = showFinalStatus ? (deps.getEstadoFinalizadoHtml?.(futbolAuto) || "") : "";

  if (!futbolAuto.marcador && estadoEspecialHtml) return estadoEspecialHtml;

  if (futbolAuto.mercado === "total_corners") {
    let marcador = futbolAuto.marcador;
    if (marcador) {
      marcador = deps.reordenarMarcadorTextoFutbol?.(marcador, futbolAuto.equipos) || marcador;
    }
    if (marcador && estadoEspecialHtml) {
      return `${getAutoFutbolResultadoHtml(escapeHtml(marcador))}${estadoEspecialHtml}`;
    }

    const cornersEquipo = futbolAuto.cornersEquipo || deps.getCornersEquipoFallbackFutbol?.(futbolAuto);
    const totalCorners = futbolAuto.seleccionEquipo && deps.getTotalCornersObjetivoFutbol
      ? (deps.getTotalCornersObjetivoFutbol(futbolAuto, cornersEquipo) ?? futbolAuto.totalCorners)
      : (deps.getTotalCornersDesdeEquiposFutbol?.(cornersEquipo) ?? futbolAuto.totalCorners);
    const liga = futbolAuto.liga ? ` &middot; ${escapeHtml(futbolAuto.liga)}` : "";
    const estadoPrevio = deps.debeMostrarHorarioJuego?.(futbolAuto.fechaJuego, futbolAuto.estadoJuego);
    if (estadoPrevio) marcador = "";

    let horaHtml = "";
    if (deps.isSyncFutbolActivado?.() !== false && !suppressSchedule && showAutoMeta && futbolAuto.fechaJuego && estadoPrevio) {
      const formattedTime = deps.formatFechaJuego?.(futbolAuto.fechaJuego);
      if (formattedTime) {
        horaHtml = `<div class="auto-mlb-score auto-mlb-score--status">${escapeHtml(formattedTime)}</div>`;
      }
    }
    if (horaHtml && estadoPrevio) return horaHtml;

    if (cornersEquipo?.home && cornersEquipo?.away) {
      const totalLabel = futbolAuto.seleccionEquipo ? `Corners de ${escapeHtml(futbolAuto.seleccionEquipo)}` : "Total";
      const totalHtml = esNumeroAutoValido(totalCorners) ? ` &middot; ${totalLabel}: ${escapeHtml(totalCorners)}` : "";
      const detalle = deps.obtenerCornersDetalleEnOrden?.(cornersEquipo, futbolAuto.equipos) || "";
      const ajusteHtml = options.showFootballAdjust === true
        ? (deps.getAjusteManualFutbolHtml?.(futbolAuto, options) || "")
        : "";
      return `${getAutoFutbolResultadoHtml(`${detalle}${totalHtml}${liga}`, ajusteHtml)}${estadoFinalizadoHtml}`;
    }

    if (esNumeroAutoValido(totalCorners)) {
      const ajusteHtml = options.showFootballAdjust === true
        ? (deps.getAjusteManualFutbolHtml?.(futbolAuto, options) || "")
        : "";
      const etiquetaTotal = futbolAuto.seleccionEquipo
        ? `Corners de ${escapeHtml(futbolAuto.seleccionEquipo)}: ${escapeHtml(totalCorners)}`
        : `Total corners: ${escapeHtml(totalCorners)}`;
      return `${getAutoFutbolResultadoHtml(`${etiquetaTotal}${liga}`, ajusteHtml)}${estadoFinalizadoHtml}`;
    }

    return horaHtml || "";
  }

  if (futbolAuto.mercado === "total_tarjetas") {
    let marcador = futbolAuto.marcador;
    if (marcador) {
      marcador = deps.reordenarMarcadorTextoFutbol?.(marcador, futbolAuto.equipos) || marcador;
    }
    if (marcador && estadoEspecialHtml) {
      return `${getAutoFutbolResultadoHtml(escapeHtml(marcador))}${estadoEspecialHtml}`;
    }

    const tarjetasEquipo = futbolAuto.tarjetasEquipo || deps.getTarjetasEquipoFallbackFutbol?.(futbolAuto);
    const totalTarjetas = futbolAuto.seleccionEquipo && deps.getTotalTarjetasObjetivoFutbol
      ? (deps.getTotalTarjetasObjetivoFutbol(futbolAuto, tarjetasEquipo) ?? futbolAuto.totalTarjetas)
      : (deps.getTotalTarjetasDesdeEquiposFutbol?.(tarjetasEquipo) ?? futbolAuto.totalTarjetas);
    const liga = futbolAuto.liga ? ` &middot; ${escapeHtml(futbolAuto.liga)}` : "";
    const estadoPrevio = deps.debeMostrarHorarioJuego?.(futbolAuto.fechaJuego, futbolAuto.estadoJuego);
    if (estadoPrevio) marcador = "";

    let horaHtml = "";
    if (deps.isSyncFutbolActivado?.() !== false && !suppressSchedule && showAutoMeta && futbolAuto.fechaJuego && estadoPrevio) {
      const formattedTime = deps.formatFechaJuego?.(futbolAuto.fechaJuego);
      if (formattedTime) {
        horaHtml = `<div class="auto-mlb-score auto-mlb-score--status">${escapeHtml(formattedTime)}</div>`;
      }
    }
    if (horaHtml && estadoPrevio) return horaHtml;

    if (tarjetasEquipo?.home && tarjetasEquipo?.away) {
      const totalPartido = deps.getTotalTarjetasDesdeEquiposFutbol?.(tarjetasEquipo) ?? totalTarjetas;
      const totalHtml = esNumeroAutoValido(totalPartido) ? ` &middot; Total: ${escapeHtml(totalPartido)}` : "";
      const detalle = deps.obtenerTarjetasDetalleEnOrden?.(tarjetasEquipo, futbolAuto.equipos) || "";
      const ajusteHtml = options.showFootballAdjust === true
        ? (deps.getAjusteManualFutbolHtml?.(futbolAuto, options) || "")
        : "";
      return `${getAutoFutbolResultadoHtml(`Tarjetas: ${detalle}${totalHtml}${liga}`, ajusteHtml)}${estadoFinalizadoHtml}`;
    }

    if (esNumeroAutoValido(totalTarjetas)) {
      const ajusteHtml = options.showFootballAdjust === true
        ? (deps.getAjusteManualFutbolHtml?.(futbolAuto, options) || "")
        : "";
      const etiquetaTotal = futbolAuto.seleccionEquipo
        ? `Tarjetas de ${escapeHtml(futbolAuto.seleccionEquipo)}: ${escapeHtml(totalTarjetas)}`
        : `Total tarjetas: ${escapeHtml(totalTarjetas)}`;
      return `${getAutoFutbolResultadoHtml(`${etiquetaTotal}${liga}`, ajusteHtml)}${estadoFinalizadoHtml}`;
    }

    return horaHtml || "";
  }

  let marcadorActual = futbolAuto.marcador;
  if (marcadorActual) {
    marcadorActual = deps.reordenarMarcadorTextoFutbol?.(marcadorActual, futbolAuto.equipos) || marcadorActual;
  }
  if (estadoEspecialHtml) {
    const marcadorHtml = marcadorActual ? getAutoFutbolResultadoHtml(escapeHtml(marcadorActual)) : "";
    return `${marcadorHtml}${estadoEspecialHtml}`;
  }

  let horaHtml = "";
  const estadoPrevio = deps.debeMostrarHorarioJuego?.(futbolAuto.fechaJuego, futbolAuto.estadoJuego);
  if (estadoPrevio) marcadorActual = "";
  if (deps.isSyncFutbolActivado?.() !== false && !suppressSchedule && showAutoMeta && futbolAuto.fechaJuego && estadoPrevio) {
    const formattedTime = deps.formatFechaJuego?.(futbolAuto.fechaJuego);
    if (formattedTime) {
      horaHtml = `<div class="auto-mlb-score auto-mlb-score--status">${escapeHtml(formattedTime)}</div>`;
    }
  }

  if (!marcadorActual && futbolAuto.estadoJuego && /postpon|pospuest|cancel|retras|delay|suspend/i.test(futbolAuto.estadoJuego)) {
    return deps.getEstadoJuegoLegacyHtml?.(futbolAuto.estadoJuego) || "";
  }
  if (horaHtml && !marcadorActual) return horaHtml;

  const totalGoles = Number(futbolAuto.totalGoles);
  const totalGolesHtml = futbolAuto.mercado === "total_goles" &&
    futbolAuto.seleccionEquipo &&
    Number.isFinite(totalGoles)
    ? ` &middot; Goles de ${escapeHtml(futbolAuto.seleccionEquipo)}: ${escapeHtml(totalGoles)}`
    : "";

  if (!marcadorActual && futbolAuto.mercado === "total_goles" && Number.isFinite(totalGoles)) {
    const etiquetaTotal = futbolAuto.seleccionEquipo
      ? `Goles de ${escapeHtml(futbolAuto.seleccionEquipo)}: ${escapeHtml(totalGoles)}`
      : `Total goles: ${escapeHtml(totalGoles)}`;
    return getAutoFutbolResultadoHtml(etiquetaTotal);
  }

  return marcadorActual
    ? `${getAutoFutbolResultadoHtml(`${escapeHtml(marcadorActual)}${totalGolesHtml}`)}${estadoFinalizadoHtml}`
    : horaHtml;
}

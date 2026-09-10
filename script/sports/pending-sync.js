// Política común para sincronización manual y automática de todos los deportes.
export function apuestaResultadoPendiente(apuesta = {}) {
  return (apuesta.resultado || "pendiente") === "pendiente";
}

export function seleccionPendiente(seleccion = {}) {
  return (seleccion.estado || "pendiente") === "pendiente";
}

export function jugadaTienePendientes(jugada) {
  if (!jugada || typeof jugada !== "object") return true;
  return jugada.selections?.length
    ? jugada.selections.some(seleccionPendiente)
    : seleccionPendiente(jugada);
}

export async function cargarTodasLasPaginas(cargarPagina, pageSize) {
  const items = [];
  let cursor;
  while (true) {
    const docs = await cargarPagina(cursor);
    items.push(...docs);
    if (docs.length < pageSize) return items;
    cursor = docs.at(-1);
  }
}

export function preservarSeleccionesResueltas(originales = [], nuevas = []) {
  return nuevas.map((jugada, index) => {
    const original = originales[index];
    if (!original || typeof original !== "object") return jugada;
    if (!jugadaTienePendientes(original)) return original;
    if (!Array.isArray(jugada?.selections)) return jugada;
    return {
      ...jugada,
      selections: jugada.selections.map((seleccion, i) => {
        const previa = original.selections?.[i];
        return previa && !seleccionPendiente(previa) ? previa : seleccion;
      })
    };
  });
}

function firma(value) {
  return JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

// La lectura y escritura son atómicas. Si hubo una edición durante la consulta
// deportiva, se descarta el cálculo antiguo y se revisará en el siguiente ciclo.
export async function guardarSiSiguePendiente({ runTransaction, db, ref, apuesta, updateData, normalizar = value => value }) {
  if (!updateData || !apuestaResultadoPendiente(apuesta)) return false;
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return false;
    const actual = normalizar({ ...snapshot.data(), id: apuesta.id });
    if (!apuestaResultadoPendiente(actual) || firma(actual) !== firma(apuesta)) return false;
    transaction.update(ref, updateData);
    return true;
  });
}

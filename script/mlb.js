const deployModuleToken = new URL(import.meta.url).searchParams.get("deploy") ||
  new URL(import.meta.url).searchParams.get("v") ||
  Date.now().toString(36);
const withDeployToken = (path) =>
  `${path}${path.includes("?") ? "&" : "?"}deploy=${encodeURIComponent(deployModuleToken)}`;

const {
  MLB_TEAMS, NFL_TEAMS, LALIGA_TEAMS, CHAMPIONS_TEAMS,
  autocorregirTextoConLogos, precargarLogosDesdeTexto, formatTextWithTeams,
  EVENT_AUTOCOMPLETE_SEARCH, LOGO_ALIAS_LOOKUP, normalizeLookupKey, escapeHtml
} = await import(withDeployToken("./sports-assets.js"));
// Compatibilidad para consumidores existentes; los recursos pertenecen al módulo neutral.
const formatTextWithMlbTeams = formatTextWithTeams;
export { MLB_TEAMS, NFL_TEAMS, LALIGA_TEAMS, CHAMPIONS_TEAMS,
  autocorregirTextoConLogos, precargarLogosDesdeTexto, formatTextWithMlbTeams };

export function crearMlbTeamsDatalist() {
  if (document.getElementById("mlbTeamsList")) return;

  const datalist = document.createElement("datalist");
  datalist.id = "mlbTeamsList";
  actualizarOpcionesEventoDatalist(datalist, "");
  document.body.appendChild(datalist);
}

export function crearMlbPlaysDatalist() {
  if (document.getElementById("mlbPlaysList")) return;

  const datalist = document.createElement("datalist");
  datalist.id = "mlbPlaysList";
  document.body.appendChild(datalist);
}

function getEventoAutocompleteParts(value = "") {
  const match = String(value).match(/^(.*(?:^|\s)(?:vs\.?|versus|contra|v)\s+)(.*)$/i);
  if (!match) return { prefix: "", query: value };
  return {
    prefix: match[1],
    query: match[2] || ""
  };
}

function actualizarOpcionesEventoDatalist(datalist, value = "") {
  if (!datalist) return;

  const { prefix, query } = getEventoAutocompleteParts(value);
  const queryKey = normalizeLookupKey(query);
  const opciones = EVENT_AUTOCOMPLETE_SEARCH
    .filter(option => !queryKey || option.key.startsWith(queryKey) || option.key.includes(queryKey))
    .slice(0, 120)
    .map(option => `${prefix}${option.value}`);

  datalist.innerHTML = opciones
    .map(option => `<option value="${escapeHtml(option)}"></option>`)
    .join("");
}

function prepararAutocompleteEvento(input) {
  const datalist = document.getElementById("mlbTeamsList");
  if (!datalist) return;
  actualizarOpcionesEventoDatalist(datalist, input.value);
}

function extraerCompetidoresDesdeEvento(evento = "") {
  if (!evento) return [];
  const partes = evento
    .split(/\s+(?:vs?\.?|versus|contra|v|@|[-–—/])\s+/i)
    .map(p => p.trim())
    .filter(Boolean);
  if (partes.length >= 2) {
    return [partes[0], partes[1]];
  }
  return partes;
}

function findEventInputForPlayInput(playInput) {
  const slot = playInput.closest(".jugada-slot, [class*='edit-jugada-slot-'], .edit-card, .card");
  if (slot) {
    const evInput = slot.querySelector(".jugada-ev-input, .edit-jugada-ev-input, .evento-principal-input, [id^='edit-evento-']");
    if (evInput) return evInput;
  }
  return document.querySelector(".evento-principal-input") || document.querySelector(".jugada-ev-input") || document.querySelector(".edit-jugada-ev-input");
}

function detectarDeporteDesdeSlot(playInput, eventText) {
  const deporteSelect = document.getElementById("deporte");
  if (deporteSelect && deporteSelect.value) {
    return deporteSelect.value;
  }
  
  const competitors = extraerCompetidoresDesdeEvento(eventText);
  if (competitors.length > 0) {
    const esMlb = competitors.some(c => {
      const normC = normalizeLookupKey(c);
      return MLB_TEAMS.some(team => 
        team.aliases.some(alias => normalizeLookupKey(alias) === normC)
      );
    });
    if (esMlb) return "mlb";
  }
  
  return "futbol";
}

function generarOpcionesJugada(eventText, sport) {
  const competitors = extraerCompetidoresDesdeEvento(eventText);
  const options = [];

  if (competitors.length >= 2) {
    const [teamA, teamB] = competitors;

    // Encontrar las entradas de logo para obtener alias
    const entryA = LOGO_ALIAS_LOOKUP.get(normalizeLookupKey(teamA));
    const entryB = LOGO_ALIAS_LOOKUP.get(normalizeLookupKey(teamB));

    // Nombres a usar para teamA
    const namesA = new Set([teamA]);
    if (entryA) {
      namesA.add(entryA.name);
      entryA.aliases.forEach(a => namesA.add(a));
      const parts = entryA.name.split(" ");
      if (parts.length > 2) namesA.add(parts.slice(-2).join(" "));
      namesA.add(parts[parts.length - 1]);
    } else {
      const parts = teamA.split(" ");
      if (parts.length > 1) namesA.add(parts[parts.length - 1]);
    }

    // Nombres a usar para teamB
    const namesB = new Set([teamB]);
    if (entryB) {
      namesB.add(entryB.name);
      entryB.aliases.forEach(a => namesB.add(a));
      const parts = entryB.name.split(" ");
      if (parts.length > 2) namesB.add(parts.slice(-2).join(" "));
      namesB.add(parts[parts.length - 1]);
    } else {
      const parts = teamB.split(" ");
      if (parts.length > 1) namesB.add(parts[parts.length - 1]);
    }

    const arrA = [...namesA].filter(n => n.length >= 2);
    const arrB = [...namesB].filter(n => n.length >= 2);

    arrA.forEach(nA => {
      options.push(nA);
      options.push(`gana ${nA}`);
      options.push(`${nA} gana`);
      if (sport === "mlb") {
        options.push(`${nA} (RL)`);
        options.push(`gana (RL) ${nA}`);
        options.push(`${nA} -1.5`);
        options.push(`${nA} +1.5`);
        options.push(`Hándicap ${nA} -1.5`);
        options.push(`Hándicap ${nA} +1.5`);
      } else {
        options.push(`Ganador con pago anticipado: Gana ${nA}`);
        options.push(`Hándicap ${nA} -1.5`);
        options.push(`Hándicap ${nA} +1.5`);
        options.push(`${nA} o Empate`);
        options.push(`${nA} a cero`);
        options.push(`gana a cero ${nA}`);
      }
    });

    arrB.forEach(nB => {
      options.push(nB);
      options.push(`gana ${nB}`);
      options.push(`${nB} gana`);
      if (sport === "mlb") {
        options.push(`${nB} (RL)`);
        options.push(`gana (RL) ${nB}`);
        options.push(`${nB} -1.5`);
        options.push(`${nB} +1.5`);
        options.push(`Hándicap ${nB} -1.5`);
        options.push(`Hándicap ${nB} +1.5`);
      } else {
        options.push(`Ganador con pago anticipado: Gana ${nB}`);
        options.push(`Hándicap ${nB} -1.5`);
        options.push(`Hándicap ${nB} +1.5`);
        options.push(`${nB} o Empate`);
        options.push(`${nB} a cero`);
        options.push(`gana a cero ${nB}`);
      }
    });

    if (sport !== "mlb") {
      options.push("Empate");
    }
  } else if (competitors.length === 1) {
    const [team] = competitors;
    const entry = LOGO_ALIAS_LOOKUP.get(normalizeLookupKey(team));
    const names = new Set([team]);
    if (entry) {
      names.add(entry.name);
      entry.aliases.forEach(a => names.add(a));
      const parts = entry.name.split(" ");
      if (parts.length > 2) names.add(parts.slice(-2).join(" "));
      names.add(parts[parts.length - 1]);
    }

    const arrNames = [...names].filter(n => n.length >= 2);
    arrNames.forEach(n => {
      options.push(n);
      options.push(`gana ${n}`);
      options.push(`${n} gana`);
      if (sport === "mlb") {
        options.push(`${n} (RL)`);
        options.push(`gana (RL) ${n}`);
        options.push(`${n} -1.5`);
        options.push(`${n} +1.5`);
        options.push(`Hándicap ${n} -1.5`);
        options.push(`Hándicap ${n} +1.5`);
      } else {
        options.push(`Ganador con pago anticipado: Gana ${n}`);
        options.push(`Hándicap ${n} -1.5`);
        options.push(`Hándicap ${n} +1.5`);
        options.push(`${n} o Empate`);
        options.push(`${n} a cero`);
        options.push(`gana a cero ${n}`);
      }
    });
  }

  // Add general goals / runs totals
  if (sport === "mlb") {
    options.push(
      "Mas de 7.5 carreras",
      "Menos de 7.5 carreras",
      "Mas de 8.5 carreras",
      "Menos de 8.5 carreras",
      "Mas de 9.5 carreras",
      "Menos de 9.5 carreras",
      "Mas de 7.5",
      "Menos de 7.5",
      "Mas de 8.5",
      "Menos de 8.5",
      "Mas de 9.5",
      "Menos de 9.5",
      "Strikeouts del jugador",
      "Mas de 3.5 strikeouts",
      "Mas de 4.5 strikeouts",
      "Mas de 5.5 strikeouts",
      "Mas de 6.5 strikeouts",
      "4+ strikeouts",
      "5+ strikeouts",
      "6+ strikeouts",
      "Hándicap -1.5",
      "Hándicap +1.5",
      "Hándicap -2.5",
      "Hándicap +2.5"
    );
    if (competitors.length >= 2) {
      const [teamA, teamB] = competitors;
      options.push(
        `${teamA} Mas de 3.5 carreras`,
        `${teamA} Menos de 3.5 carreras`,
        `${teamB} Mas de 3.5 carreras`,
        `${teamB} Menos de 3.5 carreras`,
        `${teamA} Mas de 4.5 carreras`,
        `${teamA} Menos de 4.5 carreras`,
        `${teamB} Mas de 4.5 carreras`,
        `${teamB} Menos de 4.5 carreras`,
        `Hándicap ${teamA} -1.5`,
        `Hándicap ${teamA} +1.5`,
        `Hándicap ${teamB} -1.5`,
        `Hándicap ${teamB} +1.5`
      );
    }
  } else {
    options.push(
      "Ambos marcan",
      "Ambos marcan: Si",
      "Ambos marcan: No",
      "Mas de 1.5 goles",
      "Menos de 1.5 goles",
      "Mas de 2.5 goles",
      "Menos de 2.5 goles",
      "Mas de 3.5 goles",
      "Menos de 3.5 goles",
      "Mas de 1.5",
      "Menos de 1.5",
      "Mas de 2.5",
      "Menos de 2.5",
      "Mas de 3.5",
      "Menos de 3.5",
      "Hándicap -1.5",
      "Hándicap +1.5",
      "Hándicap -2.5",
      "Hándicap +2.5"
    );
    if (competitors.length >= 2) {
      const [teamA, teamB] = competitors;
      options.push(
        `${teamA} Mas de 1.5 goles`,
        `${teamA} Menos de 1.5 goles`,
        `${teamB} Mas de 1.5 goles`,
        `${teamB} Menos de 1.5 goles`
      );
    }
    options.push(
      "Mas de 8.5 corners",
      "Menos de 8.5 corners",
      "Mas de 9.5 corners",
      "Menos de 9.5 corners",
      "Mas de 10.5 corners",
      "Menos de 10.5 corners",
      "Mas de 3.5 tarjetas",
      "Menos de 3.5 tarjetas",
      "Mas de 4.5 tarjetas",
      "Menos de 4.5 tarjetas"
    );
  }

  // Fallback: general options
  if (options.length === 0) {
    options.push(
      "Gana",
      "Empate",
      "Mas de 2.5 goles",
      "Menos de 2.5 goles",
      "Ambos marcan",
      "Mas de 8.5 carreras",
      "Menos de 8.5 carreras",
      "Hándicap -1.5",
      "Hándicap +1.5"
    );
  }

  return [...new Set(options)];
}

// Verifica si cada palabra del query se encuentra en la opción, sin importar el orden
function matchOpcionConPalabras(opcion, query) {
  const queryLower = query.trim().toLowerCase();
  if (!queryLower) return true;
  const words = queryLower.split(/\s+/).filter(Boolean);
  const opcionLower = opcion.toLowerCase();

  return words.every(word => {
    if (opcionLower.includes(word)) return true;

    // Coincidencia flexible de palabras clave para ponches / strikeouts / strikes
    if (/^(strike|strikes|strikeout|strikeouts|ponche|ponches|so)$/i.test(word)) {
      return /(strike|strikes|strikeout|strikeouts|ponche|ponches|\bso\b)/i.test(opcionLower);
    }

    // Coincidencia flexible de palabras clave para hándicap
    if (/^(handicap|hándicap|handi|hcap|runline|spread)$/i.test(word)) {
      return /(handicap|hándicap|handi|hcap|runline|spread|h[aá]ndicap)/i.test(opcionLower);
    }

    // Coincidencia flexible para carreras / runs
    if (/^(carrera|carreras|run|runs)$/i.test(word)) {
      return /(carrera|carreras|run|runs)/i.test(opcionLower);
    }

    return false;
  });
}

export const MLB_TOP_PITCHERS = [
  "Slade Cecconi",
  "Shohei Ohtani",
  "Paul Skenes",
  "Tarik Skubal",
  "Zack Wheeler",
  "Gerrit Cole",
  "Corbin Burnes",
  "Chris Sale",
  "Dylan Cease",
  "Tyler Glasnow",
  "Shota Imanaga",
  "Logan Gilbert",
  "George Kirby",
  "Framber Valdez",
  "Blake Snell",
  "Yoshinobu Yamamoto",
  "Spencer Strider",
  "Luis Castillo",
  "Freddy Peralta",
  "Sonny Gray",
  "Aaron Nola",
  "Kevin Gausman",
  "Seth Lugo",
  "Hunter Greene",
  "Max Fried",
  "Zach Eflin",
  "Tanner Houck",
  "Ranger Suárez",
  "MacKenzie Gore",
  "Bryan Woo",
  "Cole Ragans",
  "Reynaldo López",
  "Jack Flaherty",
  "Nathan Eovaldi",
  "Michael King",
  "Pablo López",
  "Joe Ryan",
  "Cristopher Sánchez",
  "Bryce Miller",
  "Justin Verlander",
  "Max Scherzer",
  "Clayton Kershaw",
  "Carlos Rodón",
  "Marcus Stroman",
  "Logan Webb",
  "Merrill Kelly",
  "Zac Gallen"
];

const pitcherSearchCache = new Map();
const pitcherSearchTimers = new WeakMap();

async function buscarPitchersEnMlb(query = "") {
  const texto = String(query).trim();
  if (texto.length < 3) return [];
  const key = normalizeLookupKey(texto);
  if (pitcherSearchCache.has(key)) return pitcherSearchCache.get(key);

  const pending = fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(texto)}`)
    .then(res => res.ok ? res.json() : { people: [] })
    .then(async data => {
      const pitchers = (data.people || []).filter(person =>
        person?.active && person?.primaryPosition?.code === "1"
      ).slice(0, 6);
      if (!pitchers.length) return [];

      const ids = pitchers.map(person => person.id).filter(Boolean).join(",");
      const detail = await fetch(`https://statsapi.mlb.com/api/v1/people/${ids}?hydrate=currentTeam`)
        .then(res => res.ok ? res.json() : { people: [] })
        .catch(() => ({ people: [] }));
      const teamsById = new Map((detail.people || []).map(person => [person.id, person.currentTeam?.name || ""]));
      return pitchers.map(person => ({
        nombre: person.fullName,
        equipo: teamsById.get(person.id) || ""
      })).filter(person => person.equipo);
    })
    .catch(() => []);
  pitcherSearchCache.set(key, pending);
  return pending;
}

function buscarPitchersParaAutocomplete(input) {
  const typed = input.value || "";
  const nombre = extraerBusquedaNombreJugador(typed);
  if (nombre.length < 3) return;
  clearTimeout(pitcherSearchTimers.get(input));
  pitcherSearchTimers.set(input, setTimeout(async () => {
    const pitchers = await buscarPitchersEnMlb(nombre);
    if (!pitchers.length || input.value !== typed) return;
    const datalist = document.getElementById("mlbPlaysList");
    if (!datalist) return;
    const linea = String(typed).replace(",", ".").match(/\b(\d+(?:\.\d+)?)\s*\+?/);
    const etiqueta = linea ? (Number.isInteger(Number(linea[1])) ? `${linea[1]}+` : `Mas de ${linea[1]}`) : "4+";
    const opciones = pitchers.flatMap(({ nombre: pitcher, equipo }) => [
      `Strikeouts del jugador (${pitcher}) ${etiqueta} · ${equipo}`,
      `${pitcher} ${etiqueta} strikes · ${equipo}`
    ]);
    datalist.innerHTML = opciones.map(option => `<option value="${escapeHtml(option)}"></option>`).join("");
  }, 280));
}

function actualizarAvisoStrikeouts(input) {
  const texto = String(input.value || "");
  const normalizado = normalizeLookupKey(texto);
  let aviso = input.parentElement?.querySelector(".mlb-strikeouts-hint");
  if (!/\b(strike|strikes|strikeout|strikeouts|ponche|ponches)\b/i.test(texto)) {
    aviso?.remove();
    return;
  }

  const linea = texto.replace(",", ".").match(/\b(\d+(?:\.\d+)?)/);
  const esTotalExplicito = /\b(lanzador|lanzadores|total|totales)\b/.test(normalizado);
  const pareceJugador = /\b(jugador|pitcher)\b/i.test(texto) ||
    /\b[A-Za-zÁÉÍÓÚÑáéíóúñ]+\s+\d+(?:\.\d+)?\s*\+?\s*(?:strikes?|strikeouts?|ponches?)\b/i.test(texto);
  const esTotal = esTotalExplicito || (Number(linea?.[1]) >= 12 && !pareceJugador);

  if (!aviso) {
    aviso = document.createElement("div");
    aviso.className = "mlb-strikeouts-hint";
    input.insertAdjacentElement("afterend", aviso);
  }
  aviso.classList.toggle("mlb-strikeouts-hint--total", esTotal);
  aviso.innerHTML = esTotal
    ? `<span aria-hidden="true">Σ</span> Total de lanzadores: suma ambos equipos`
    : `<span aria-hidden="true">⚾</span> Por jugador: usa el nombre y una línea como 4+`;
}

// Extrae posibles nombres de jugador del texto escrito al buscar ponches
function extraerBusquedaNombreJugador(typed = "") {
  const limpio = String(typed)
    .replace(/\b(strike|strikes|strikeout|strikeouts|ponche|ponches|so)\b/gi, "")
    .replace(/\b(mas|más|menos|over|under)\s*(?:de)?\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\+?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return limpio.length >= 2 ? limpio : "";
}

// Genera opciones dinámicas para ponches / strikeouts según la búsqueda del usuario
function generarOpcionesStrikeoutsDinamicas(typed = "", competitors = []) {
  const nombreDetectado = extraerBusquedaNombreJugador(typed);
  const lineaEscrita = String(typed).replace(",", ".").match(/\b(\d+(?:\.\d+)?)\s*\+?/);
  const valorLinea = lineaEscrita ? Number(lineaEscrita[1]) : null;
  const etiquetaLineaEscrita = Number.isFinite(valorLinea)
    ? (Number.isInteger(valorLinea) ? `${valorLinea}+` : `Mas de ${valorLinea}`)
    : "";
  const pitchersDelPartido = new Set();
  const otrosPitchers = new Set();

  if (nombreDetectado) {
    otrosPitchers.add(nombreDetectado);
  }

  // 1. Extraer los pitchers de los equipos participantes en este partido
  if (Array.isArray(competitors) && competitors.length > 0) {
    competitors.forEach(comp => {
      if (!comp) return;
      const compKey = normalizeLookupKey(comp);
      const teamMatch = MLB_TEAMS.find(team =>
        team.aliases.some(alias => {
          const aliasKey = normalizeLookupKey(alias);
          return aliasKey === compKey || aliasKey.includes(compKey) || compKey.includes(aliasKey);
        })
      );

      if (teamMatch && Array.isArray(teamMatch.pitchers)) {
        teamMatch.pitchers.forEach(pitcher => {
          if (!nombreDetectado || matchOpcionConPalabras(pitcher, nombreDetectado)) {
            pitchersDelPartido.add(pitcher);
          }
        });
      }
    });
  }

  // 2. Agregar el resto de pitchers estrella
  MLB_TOP_PITCHERS.forEach(pitcher => {
    if (!pitchersDelPartido.has(pitcher)) {
      if (!nombreDetectado || matchOpcionConPalabras(pitcher, nombreDetectado)) {
        otrosPitchers.add(pitcher);
      }
    }
  });

  const arrNombres = [...pitchersDelPartido, ...otrosPitchers];
  const options = [];

  arrNombres.forEach(nombre => {
    // La línea que el usuario escribe tiene prioridad: “Yamamoto 7 strikes”
    // se completa como 7+, mientras que 7.5 se conserva como Más de 7.5.
    if (etiquetaLineaEscrita) {
      options.push(
        `Strikeouts del jugador (${nombre}) ${etiquetaLineaEscrita}`,
        `${nombre} ${etiquetaLineaEscrita} strikes`
      );
    }
    options.push(
      `Strikeouts del jugador (${nombre}) 4+`,
      `Strikeouts del jugador (${nombre}) 5+`,
      `Strikeouts del jugador (${nombre}) 6+`,
      `${nombre} 4+ strikes`,
      `${nombre} 5+ strikes`,
      `${nombre} 6+ strikes`,
      `${nombre} Mas de 3.5 strikes`,
      `${nombre} Mas de 4.5 strikes`
    );
  });

  options.push(
    "Strikeouts del jugador 4+",
    "Strikeouts del jugador 5+",
    "Strikeouts del jugador 6+",
    "Strikeouts del jugador 7+",
    "Strikeouts del jugador al menos 4+",
    "Strikeouts del jugador al menos 5+",
    "4+ strikes",
    "5+ strikes",
    "6+ strikes",
    "7+ strikes",
    "Mas de 3.5 strikes",
    "Mas de 4.5 strikes",
    "Mas de 5.5 strikes",
    "Mas de 6.5 strikes"
  );

  return [...new Set(options)];
}

function extraerBusquedaNombreHandicap(typed = "") {
  const limpio = String(typed)
    .replace(/\bh(?:a|á)?ndicap\b/gi, "")
    .replace(/\b(handi|hcap|runline|spread)\b/gi, "")
    .replace(/[+-]?\d+(?:\.\d+)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return limpio.length >= 2 ? limpio : "";
}

function generarOpcionesHandicapDinamicas(typed = "", competitors = []) {
  const textoDetectado = extraerBusquedaNombreHandicap(typed);
  const options = [];

  if (Array.isArray(competitors) && competitors.length > 0) {
    competitors.forEach(comp => {
      if (!comp) return;
      options.push(
        `Hándicap ${comp} -1.5`,
        `Hándicap ${comp} +1.5`,
        `Hándicap ${comp} -0.5`,
        `Hándicap ${comp} +0.5`,
        `Hándicap ${comp} -2.5`,
        `Hándicap ${comp} +2.5`,
        `${comp} -1.5`,
        `${comp} +1.5`
      );
    });
  }

  if (textoDetectado) {
    const queryNorm = normalizeLookupKey(textoDetectado);
    MLB_TEAMS.forEach(team => {
      const coincide = [team.name, ...team.aliases].some(alias =>
        normalizeLookupKey(alias).includes(queryNorm) || queryNorm.includes(normalizeLookupKey(alias))
      );
      if (coincide) {
        options.push(
          `Hándicap ${team.name} -1.5`,
          `Hándicap ${team.name} +1.5`,
          `Hándicap ${team.name} -0.5`,
          `Hándicap ${team.name} +0.5`,
          `${team.name} -1.5`,
          `${team.name} +1.5`
        );
      }
    });
  }

  options.push(
    "Hándicap -1.5",
    "Hándicap +1.5",
    "Hándicap -2.5",
    "Hándicap +2.5",
    "Hándicap -0.5",
    "Hándicap +0.5"
  );

  return [...new Set(options)];
}

function generarOpcionesCarrerasDinamicas(typed = "", competitors = []) {
  const options = [];

  if (Array.isArray(competitors) && competitors.length > 0) {
    competitors.forEach(comp => {
      if (!comp) return;
      options.push(
        `${comp} Mas de 3.5 carreras`,
        `${comp} Menos de 3.5 carreras`,
        `${comp} Mas de 4.5 carreras`,
        `${comp} Menos de 4.5 carreras`,
        `${comp} Mas de 5.5 carreras`,
        `${comp} Menos de 5.5 carreras`
      );
    });
  }

  options.push(
    "Mas de 7.5 carreras",
    "Menos de 7.5 carreras",
    "Mas de 8.5 carreras",
    "Menos de 8.5 carreras",
    "Mas de 9.5 carreras",
    "Menos de 9.5 carreras",
    "Mas de 10.5 carreras",
    "Menos de 10.5 carreras"
  );

  return [...new Set(options)];
}

// Genera opciones para todos los equipos que coincidan con el texto libre
function generarOpcionesDesdeTextoLibre(typed, sport) {
  const typedLower = typed.toLowerCase();
  const options = [];
  const typedWords = typedLower.split(/\s+/).filter(w => w.length >= 2); // solo palabras significativas

  MLB_TEAMS.forEach(team => {
    // Verificar si alguna palabra del input coincide con algún alias del equipo
    const coincide = typedWords.length > 0
      ? typedWords.some(word => 
          team.aliases.some(alias => normalizeLookupKey(alias).includes(normalizeLookupKey(word)))
        )
      : false;
    if (!coincide) return;

    // Generar opciones para todos los nombres/alias conocidos de este equipo
    const names = new Set([team.name, ...team.aliases]);
    const parts = team.name.split(" ");
    if (parts.length > 2) names.add(parts.slice(-2).join(" "));
    names.add(parts[parts.length - 1]);

    const arrNames = [...names].filter(n => n.length >= 2);

    arrNames.forEach(name => {
      options.push(name);
      options.push(`gana ${name}`);
      options.push(`${name} gana`);
      if (sport === "mlb") {
        options.push(`${name} (RL)`);
        options.push(`gana (RL) ${name}`);
        options.push(`${name} -1.5`);
        options.push(`${name} +1.5`);
        options.push(`Hándicap ${name} -1.5`);
        options.push(`Hándicap ${name} +1.5`);
      } else {
        options.push(`${name} o Empate`);
        options.push(`${name} a cero`);
        options.push(`gana a cero ${name}`);
      }
    });
  });

  return [...new Set(options)];
}

// Historial personal de mercados escritos por el usuario. Se guarda en el
// navegador para que no dependa de la disponibilidad de Firebase ni mezcle
// sugerencias entre usuarios.
const HISTORIAL_JUGADAS_STORAGE_KEY = "apuestas.autocomplete.jugadas.v1";
const HISTORIAL_JUGADAS_MAXIMO = 150;

function obtenerHistorialJugadas() {
  try {
    const guardadas = JSON.parse(localStorage.getItem(HISTORIAL_JUGADAS_STORAGE_KEY) || "[]");
    return Array.isArray(guardadas)
      ? guardadas.filter(jugada => typeof jugada === "string" && jugada.trim()).slice(0, HISTORIAL_JUGADAS_MAXIMO)
      : [];
  } catch (error) {
    console.warn("No se pudo leer el historial de autocompletado:", error);
    return [];
  }
}

function guardarJugadaEnHistorial(jugada = "") {
  const limpia = String(jugada).replace(/\s+/g, " ").trim();
  if (limpia.length < 2) return;

  try {
    const clave = normalizeLookupKey(limpia);
    const anteriores = obtenerHistorialJugadas().filter(item => normalizeLookupKey(item) !== clave);
    localStorage.setItem(
      HISTORIAL_JUGADAS_STORAGE_KEY,
      JSON.stringify([limpia, ...anteriores].slice(0, HISTORIAL_JUGADAS_MAXIMO))
    );
  } catch (error) {
    console.warn("No se pudo guardar el historial de autocompletado:", error);
  }
}

function combinarOpcionesConHistorial(opciones = [], typed = "") {
  const consulta = String(typed).trim().toLowerCase();
  const historialCoincidente = obtenerHistorialJugadas().filter(opcion =>
    !consulta || matchOpcionConPalabras(opcion, consulta)
  );
  const vistas = new Set();
  return [...historialCoincidente, ...opciones].filter(opcion => {
    const clave = normalizeLookupKey(opcion);
    if (!clave || vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
}

function prepararAutocompleteJugada(input) {
  const datalist = document.getElementById("mlbPlaysList");
  if (!datalist) return;

  const eventInput = findEventInputForPlayInput(input);
  const eventText = eventInput ? eventInput.value.trim() : "";
  const typed = (input.value || "").trim();
  const typedLower = typed.toLowerCase();
  const sport = detectarDeporteDesdeSlot(input, eventText || typed);

  let opciones = [];

  const esBusquedaStrikeouts = /\b(strike|strikes|strikeout|strikeouts|ponche|ponches|so)\b/i.test(typedLower);
  const lineaStrikeouts = String(typed).replace(",", ".").match(/\b(\d+(?:\.\d+)?)/);
  const esLineaAltaSinPitcher = Number(lineaStrikeouts?.[1]) >= 12 &&
    !/\b(jugador|pitcher)\b/i.test(typed) &&
    !/\b[A-Za-zÁÉÍÓÚÑáéíóúñ]+\s+\d+(?:\.\d+)?\s*\+?\s*(?:strikes?|strikeouts?|ponches?)\b/i.test(typed);
  const esBusquedaStrikeoutsTotales = esBusquedaStrikeouts &&
    (/\b(lanzador(?:es)?|total(?:es)?)\b/i.test(typedLower) || esLineaAltaSinPitcher);
  const esBusquedaHandicap = /\b(handicap|hándicap|handi|hcap|runline|spread)\b/i.test(typedLower);
  const esBusquedaCarreras = /\b(carrera|carreras|run|runs)\b/i.test(typedLower);

  if (esBusquedaStrikeoutsTotales) {
    const linea = String(typed).replace(",", ".").match(/\b(\d+(?:\.\d+)?)/);
    const valor = linea ? linea[1] : "14.5";
    opciones = [
      `Strikeouts por lanzadores Mas de ${valor} (incl. extra innings)`,
      `Strikeouts por lanzadores Menos de ${valor} (incl. extra innings)`
    ];
  } else if (esBusquedaStrikeouts) {
    const competitors = extraerCompetidoresDesdeEvento(eventText);
    const opcionesStrikeouts = generarOpcionesStrikeoutsDinamicas(typed, competitors);
    opciones = opcionesStrikeouts.filter(o => matchOpcionConPalabras(o, typedLower));
    if (opciones.length === 0) opciones = opcionesStrikeouts;
  } else if (esBusquedaHandicap) {
    const competitors = extraerCompetidoresDesdeEvento(eventText);
    const opcionesHandicap = generarOpcionesHandicapDinamicas(typed, competitors);
    opciones = opcionesHandicap.filter(o => matchOpcionConPalabras(o, typedLower));
    if (opciones.length === 0) opciones = opcionesHandicap;
  } else if (esBusquedaCarreras) {
    const competitors = extraerCompetidoresDesdeEvento(eventText);
    const opcionesCarreras = generarOpcionesCarrerasDinamicas(typed, competitors);
    opciones = opcionesCarreras.filter(o => matchOpcionConPalabras(o, typedLower));
    if (opciones.length === 0) opciones = opcionesCarreras;
  } else if (eventText) {
    // Partido definido: generar opciones basadas en los equipos del partido
    const todasLasOpciones = generarOpcionesJugada(eventText, sport);
    opciones = typedLower
      ? todasLasOpciones.filter(o => matchOpcionConPalabras(o, typedLower))
      : todasLasOpciones;
  } else if (typedLower) {
    // Sin partido: buscar coincidencias en todos los equipos MLB
    const opcionesPorEquipo = generarOpcionesDesdeTextoLibre(typedLower, sport);
    if (opcionesPorEquipo.length > 0) {
      // Encontramos equipos que coinciden: mostrar sus opciones filtradas por palabra
      opciones = opcionesPorEquipo.filter(o => matchOpcionConPalabras(o, typedLower));
      if (opciones.length === 0) opciones = opcionesPorEquipo;
    } else {
      // No se encontró equipo: mostrar opciones genéricas filtradas
      const genéricas = generarOpcionesJugada("", sport);
      opciones = genéricas.filter(o => matchOpcionConPalabras(o, typedLower));
      if (opciones.length === 0) opciones = genéricas;
    }
  } else {
    // Sin partido y sin texto: mostrar opciones genéricas
    opciones = generarOpcionesJugada("", sport);
  }

  datalist.innerHTML = combinarOpcionesConHistorial(opciones, typed)
    .map(option => `<option value="${escapeHtml(option)}"></option>`)
    .join("");
}

export function habilitarAutocompleteMlb(root = document) {
  crearMlbTeamsDatalist();
  crearMlbPlaysDatalist();

  root.querySelectorAll(".jugada-ev-input, .edit-jugada-ev-input, .evento-principal-input, .quick-mlb-team-input, [id^='edit-evento-']")
    .forEach(input => {
      input.setAttribute("list", "mlbTeamsList");
      if (input.dataset.eventAutocompleteReady !== "1") {
        const actualizar = () => prepararAutocompleteEvento(input);
        input.addEventListener("focus", actualizar);
        input.addEventListener("input", actualizar);
        input.addEventListener("input", () => buscarPitchersParaAutocomplete(input));
        input.addEventListener("input", () => actualizarAvisoStrikeouts(input));
        input.addEventListener("change", () => actualizarAvisoStrikeouts(input));
        input.addEventListener("keydown", actualizar);
        input.dataset.eventAutocompleteReady = "1";
      }
    });

  root.querySelectorAll(".jugada-jug-input, .edit-jugada-jug-input")
    .forEach(input => {
      input.setAttribute("list", "mlbPlaysList");
      if (input.dataset.playAutocompleteReady !== "1") {
        const actualizar = () => prepararAutocompleteJugada(input);
        input.addEventListener("focus", actualizar);
        input.addEventListener("click", actualizar);
        input.addEventListener("input", actualizar);
        input.addEventListener("keydown", actualizar);
        input.addEventListener("change", () => guardarJugadaEnHistorial(input.value));
        input.addEventListener("blur", () => guardarJugadaEnHistorial(input.value));
        input.dataset.playAutocompleteReady = "1";
      }
    });

  root.querySelectorAll(".jugada-ev-input, .jugada-jug-input, .edit-jugada-ev-input, .edit-jugada-jug-input, .evento-principal-input, [id^='edit-evento-']")
    .forEach(input => {
      if (input.dataset.logoPreloadReady === "1") return;

      const precargarDesdeInput = () => precargarLogosDesdeTexto(input.value);
      input.addEventListener("input", precargarDesdeInput);
      input.addEventListener("change", precargarDesdeInput);
      input.addEventListener("blur", precargarDesdeInput);
      input.dataset.logoPreloadReady = "1";
      precargarDesdeInput();
    });
}

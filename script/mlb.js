const deployModuleToken = new URL(import.meta.url).searchParams.get("deploy") ||
  new URL(import.meta.url).searchParams.get("v") ||
  Date.now().toString(36);
const withDeployToken = (path) =>
  `${path}${path.includes("?") ? "&" : "?"}deploy=${encodeURIComponent(deployModuleToken)}`;

const { COUNTRY_FLAG_ENTRIES } = await import(withDeployToken("./countries.js?v=1.1"));

export const MLB_TEAMS = [
  { name: "Arizona Diamondbacks", logo: "arizona-diamondbacks.svg", aliases: ["Arizona Diamondbacks", "Arizona", "Diamondbacks", "D-backs", "Dbacks", "ARI"], pitchers: ["Slade Cecconi", "Zac Gallen", "Merrill Kelly", "Brandon Pfaadt", "Eduardo Rodríguez"] },
  { name: "Oakland Athletics", logo: "athletics.svg", aliases: ["Athletics", "Atletics", "A's", "Oakland", "Oaklands", "Oukland", "Ouklans", "Oakland Athletics", "Oakland Atletics", "Oakland A's", "Oaklands Athletics", "Oaklands Atletics", "Oukland Athletics", "Oukland Atletics", "Ouklans Athletics", "Ouklans Atletics"], pitchers: ["JP Sears", "Mitch Spence", "Joey Estes", "Osvaldo Bido", "Luis Medina"] },
  { name: "Atlanta Braves", logo: "atlanta-braves.svg", aliases: ["Atlanta Braves", "Braves", "ATL"], pitchers: ["Chris Sale", "Spencer Strider", "Reynaldo López", "Charlie Morton", "Max Fried"] },
  { name: "Baltimore Orioles", logo: "baltimore-orioles.svg", aliases: ["Baltimore Orioles", "Orioles", "BAL"], pitchers: ["Corbin Burnes", "Grayson Rodriguez", "Zach Eflin", "Dean Kremer", "Albert Suárez"] },
  { name: "Boston Red Sox", logo: "boston-red-sox.svg", aliases: ["Boston Red Sox", "Red Sox", "BOS"], pitchers: ["Tanner Houck", "Brayan Bello", "Kutter Crawford", "Lucas Giolito", "Nick Pivetta"] },
  { name: "Chicago Cubs", logo: "chicago-cubs.svg", aliases: ["Chicago Cubs", "Cubs", "CHC"], pitchers: ["Shota Imanaga", "Justin Steele", "Jameson Taillon", "Javier Assad", "Kyle Hendricks"] },
  { name: "Chicago White Sox", logo: "chicago-white-sox.svg", aliases: ["Chicago White Sox", "White Sox", "Chi White Sox", "CHW", "CWS"], pitchers: ["Garrett Crochet", "Erick Fedde", "Jonathan Cannon", "Chris Flexen", "Chad Kuhl"] },
  { name: "Cincinnati Reds", logo: "cincinnati-reds.svg", aliases: ["Cincinnati Reds", "Reds", "CIN"], pitchers: ["Hunter Greene", "Nick Lodolo", "Andrew Abbott", "Nick Martinez", "Frankie Montas"] },
  { name: "Cleveland Guardians", logo: "cleveland-guardians.svg", aliases: ["Cleveland Guardians", "Guardians", "Cleveland Indians", "Indians", "CLE"], pitchers: ["Slade Cecconi", "Tanner Bibee", "Gavin Williams", "Ben Lively", "Logan Allen"] },
  { name: "Colorado Rockies", logo: "colorado-rockies.svg", aliases: ["Colorado Rockies", "Rockies", "COL"], pitchers: ["Kyle Freeland", "Cal Quantrill", "Ryan Feltner", "Austin Gomber", "Dakota Hudson"] },
  { name: "Detroit Tigers", logo: "detroit-tigers.svg", aliases: ["Detroit Tigers", "Tigers", "DET"], pitchers: ["Tarik Skubal", "Jack Flaherty", "Reese Olson", "Keider Montero", "Matt Manning"] },
  { name: "Houston Astros", logo: "houston-astros.svg", aliases: ["Houston Astros", "Astros", "HOU"], pitchers: ["Framber Valdez", "Justin Verlander", "Hunter Brown", "Ronel Blanco", "Spencer Arrighetti"] },
  { name: "Kansas City Royals", logo: "kansas-city-royals.svg", aliases: ["Kansas City Royals", "Royals", "KC"], pitchers: ["Cole Ragans", "Seth Lugo", "Michael Wacha", "Brady Singer", "Alec Marsh"] },
  { name: "Los Angeles Angels", logo: "los-angeles-angels.svg", aliases: ["Los Angeles Angels", "LA Angels", "Angels", "LAA"], pitchers: ["Tyler Anderson", "Griffin Canning", "Patrick Sandoval", "Reid Detmers", "José Soriano"] },
  { name: "Los Angeles Dodgers", logo: "los-angeles-dodgers.svg", aliases: ["Los Angeles Dodgers", "LA Dodgers", "Dodgers", "LAD"], pitchers: ["Shohei Ohtani", "Tyler Glasnow", "Yoshinobu Yamamoto", "Clayton Kershaw", "Bobby Miller", "Gavin Stone"] },
  { name: "Miami Marlins", logo: "miami-marlins.svg", aliases: ["Miami Marlins", "Marlins", "MIA"], pitchers: ["Sandy Alcántara", "Eury Pérez", "Jesús Luzardo", "Braxton Garrett", "Edward Cabrera"] },
  { name: "Milwaukee Brewers", logo: "milwaukee-brewers.svg", aliases: ["Milwaukee Brewers", "Brewers", "MIL"], pitchers: ["Freddy Peralta", "Colin Rea", "Tobias Myers", "Aaron Civale", "DL Hall"] },
  { name: "Minnesota Twins", logo: "minnesota-twins.svg", aliases: ["Minnesota Twins", "Twins", "MIN"], pitchers: ["Pablo López", "Joe Ryan", "Bailey Ober", "Simeon Woods Richardson", "Chris Paddack"] },
  { name: "New York Mets", logo: "new-york-mets.svg", aliases: ["New York Mets", "NY Mets", "Mets", "NYM"], pitchers: ["Sean Manaea", "Luis Severino", "David Peterson", "Kodai Senga", "Jose Quintana"] },
  { name: "New York Yankees", logo: "new-york-yankees.svg", aliases: ["New York Yankees", "NY Yankees", "Yankees", "NYY"], pitchers: ["Gerrit Cole", "Carlos Rodón", "Marcus Stroman", "Luis Gil", "Nestor Cortes"] },
  { name: "Philadelphia Phillies", logo: "philadelphia-phillies.svg", aliases: ["Philadelphia Phillies", "Phillies", "PHI"], pitchers: ["Zack Wheeler", "Aaron Nola", "Ranger Suárez", "Cristopher Sánchez", "Taijuan Walker"] },
  { name: "Pittsburgh Pirates", logo: "pittsburgh-pirates.svg", aliases: ["Pittsburgh Pirates", "Pirates", "PIT"], pitchers: ["Paul Skenes", "Mitch Keller", "Jared Jones", "Bailey Falter", "Quinn Priester"] },
  { name: "San Diego Padres", logo: "san-diego-padres.svg", aliases: ["San Diego Padres", "Padres", "SD"], pitchers: ["Dylan Cease", "Michael King", "Yu Darvish", "Joe Musgrove", "Matt Waldron"] },
  { name: "San Francisco Giants", logo: "san-francisco-giants.svg", aliases: ["San Francisco Giants", "SF Giants", "Giants", "SF"], pitchers: ["Logan Webb", "Blake Snell", "Kyle Harrison", "Jordan Hicks", "Robbie Ray"] },
  { name: "Seattle Mariners", logo: "seattle-mariners.svg", aliases: ["Seattle Mariners", "Mariners", "SEA"], pitchers: ["Logan Gilbert", "George Kirby", "Luis Castillo", "Bryan Woo", "Bryce Miller"] },
  { name: "St. Louis Cardinals", logo: "st-louis-cardinals.svg", aliases: ["St. Louis Cardinals", "St Louis Cardinals", "Cardinals", "STL"], pitchers: ["Sonny Gray", "Erick Fedde", "Kyle Gibson", "Miles Mikolas", "Lance Lynn"] },
  { name: "Tampa Bay Rays", logo: "tampa-bay-rays.svg", aliases: ["Tampa Bay Rays", "Rays", "TB"], pitchers: ["Shane Baz", "Ryan Pepiot", "Taj Bradley", "Jeffrey Springs", "Zack Littell"] },
  { name: "Texas Rangers", logo: "texas-rangers.svg", aliases: ["Texas Rangers", "Rangers", "TEX"], pitchers: ["Nathan Eovaldi", "Jacob deGrom", "Jon Gray", "Andrew Heaney", "Cody Bradford"] },
  { name: "Toronto Blue Jays", logo: "toronto-blue-jays.svg", aliases: ["Toronto Blue Jays", "Blue Jays", "TOR"], pitchers: ["Kevin Gausman", "José Berríos", "Chris Bassitt", "Yariel Rodríguez", "Bowden Francis"] },
  { name: "Washington Nationals", logo: "washington-nationals.svg", aliases: ["Washington Nationals", "Nationals", "WSH", "WAS"], pitchers: ["MacKenzie Gore", "Jake Irvin", "Mitchell Parker", "DJ Herz", "Trevor Williams"] }
];

// Equipos NFL: los logos se guardan localmente para que sigan disponibles aunque ESPN no cargue.
export const NFL_TEAMS = [
  { name: "Arizona Cardinals", logo: "nfl-ari.png", aliases: ["Arizona Cardinals", "Cardinals", "ARI"] },
  { name: "Atlanta Falcons", logo: "nfl-atl.png", aliases: ["Atlanta Falcons", "Falcons", "ATL"] },
  { name: "Baltimore Ravens", logo: "nfl-bal.png", aliases: ["Baltimore Ravens", "Ravens", "BAL"] },
  { name: "Buffalo Bills", logo: "nfl-buf.png", aliases: ["Buffalo Bills", "Bills", "BUF"] },
  { name: "Carolina Panthers", logo: "nfl-car.png", aliases: ["Carolina Panthers", "Panthers", "CAR"] },
  { name: "Chicago Bears", logo: "nfl-chi.png", aliases: ["Chicago Bears", "Bears", "CHI"] },
  { name: "Cincinnati Bengals", logo: "nfl-cin.png", aliases: ["Cincinnati Bengals", "Bengals", "CIN"] },
  { name: "Cleveland Browns", logo: "nfl-cle.png", aliases: ["Cleveland Browns", "Browns", "CLE"] },
  { name: "Dallas Cowboys", logo: "nfl-dal.png", aliases: ["Dallas Cowboys", "Cowboys", "DAL"] },
  { name: "Denver Broncos", logo: "nfl-den.png", aliases: ["Denver Broncos", "Broncos", "DEN"] },
  { name: "Detroit Lions", logo: "nfl-det.png", aliases: ["Detroit Lions", "Lions", "DET"] },
  { name: "Green Bay Packers", logo: "nfl-gb.png", aliases: ["Green Bay Packers", "Packers", "GB"] },
  { name: "Houston Texans", logo: "nfl-hou.png", aliases: ["Houston Texans", "Texans", "HOU"] },
  { name: "Indianapolis Colts", logo: "nfl-ind.png", aliases: ["Indianapolis Colts", "Colts", "IND"] },
  { name: "Jacksonville Jaguars", logo: "nfl-jax.png", aliases: ["Jacksonville Jaguars", "Jaguars", "Jacksonville", "JAX"] },
  { name: "Kansas City Chiefs", logo: "nfl-kc.png", aliases: ["Kansas City Chiefs", "Chiefs", "KC"] },
  { name: "Las Vegas Raiders", logo: "nfl-lv.png", aliases: ["Las Vegas Raiders", "Raiders", "LV"] },
  { name: "Los Angeles Chargers", logo: "nfl-lac.png", aliases: ["Los Angeles Chargers", "LA Chargers", "Chargers", "LAC"] },
  { name: "Los Angeles Rams", logo: "nfl-lar.png", aliases: ["Los Angeles Rams", "LA Rams", "Rams", "LAR"] },
  { name: "Miami Dolphins", logo: "nfl-mia.png", aliases: ["Miami Dolphins", "Dolphins", "MIA"] },
  { name: "Minnesota Vikings", logo: "nfl-min.png", aliases: ["Minnesota Vikings", "Vikings", "MIN"] },
  { name: "New England Patriots", logo: "nfl-ne.png", aliases: ["New England Patriots", "Patriots", "NE"] },
  { name: "New Orleans Saints", logo: "nfl-no.png", aliases: ["New Orleans Saints", "Saints", "NO"] },
  { name: "New York Giants", logo: "nfl-nyg.png", aliases: ["New York Giants", "NY Giants", "Giants", "NYG"] },
  { name: "New York Jets", logo: "nfl-nyj.png", aliases: ["New York Jets", "NY Jets", "Jets", "NYJ"] },
  { name: "Philadelphia Eagles", logo: "nfl-phi.png", aliases: ["Philadelphia Eagles", "Eagles", "PHI"] },
  { name: "Pittsburgh Steelers", logo: "nfl-pit.png", aliases: ["Pittsburgh Steelers", "Steelers", "PIT"] },
  { name: "San Francisco 49ers", logo: "nfl-sf.png", aliases: ["San Francisco 49ers", "San Francisco Forty Niners", "49ers", "Niners", "SF"] },
  { name: "Seattle Seahawks", logo: "nfl-sea.png", aliases: ["Seattle Seahawks", "Seahawks", "SEA"] },
  { name: "Tampa Bay Buccaneers", logo: "nfl-tb.png", aliases: ["Tampa Bay Buccaneers", "Buccaneers", "Bucs", "TB"] },
  { name: "Tennessee Titans", logo: "nfl-ten.png", aliases: ["Tennessee Titans", "Titans", "TEN"] },
  { name: "Washington Commanders", logo: "nfl-wsh.png", aliases: ["Washington Commanders", "Commanders", "WSH", "WAS"] }
];

const MLB_LEAGUE_LOGO = { name: "MLB", logo: "mlb.svg", aliases: ["MLB", "MLN"] };
const MLB_LOGO_ENTRIES = [MLB_LEAGUE_LOGO, ...MLB_TEAMS];
const NFL_LEAGUE_LOGO = { name: "NFL", logo: "nfl.png", aliases: ["NFL"] };
const NFL_LOGO_ENTRIES = [NFL_LEAGUE_LOGO, ...NFL_TEAMS];
const COUNTRY_LOGO_ENTRIES = COUNTRY_FLAG_ENTRIES.map(country => ({
  type: "country",
  name: country.name,
  logo: country.flag,
  code: country.flag.replace(/^flag-/, "").replace(/\.png$/i, ""),
  aliases: country.aliases || []
}));
const LOGO_ENTRIES = [
  ...MLB_LOGO_ENTRIES.map(entry => ({ ...entry, type: "mlb" })),
  ...NFL_LOGO_ENTRIES.map(entry => ({ ...entry, type: "nfl" })),
  ...COUNTRY_LOGO_ENTRIES
];

const LOGO_ALIAS_LOOKUP = new Map();
LOGO_ENTRIES.forEach(entry => {
  entry.aliases.forEach(alias => {
    const key = normalizeLookupKey(alias);
    if (!LOGO_ALIAS_LOOKUP.has(key)) {
      LOGO_ALIAS_LOOKUP.set(key, entry);
    }
  });
});

const LOGO_ALIAS_PATTERN = new RegExp(
  `(^|[^\\p{L}\\p{N}])(${LOGO_ENTRIES.flatMap(entry => entry.aliases).sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})(?=$|[^\\p{L}\\p{N}])`,
  "giu"
);

const PRELOADED_LOGOS = new Set();
const FORMAT_TEXT_CACHE = new Map();
const AUTOCORRECT_TEXT_CACHE = new Map();
const EVENT_AUTOCOMPLETE_OPTIONS = [...new Set(LOGO_ENTRIES.flatMap(entry => [entry.name, ...entry.aliases]))]
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b));
const EVENT_AUTOCOMPLETE_SEARCH = EVENT_AUTOCOMPLETE_OPTIONS.map(option => ({
  value: option,
  key: normalizeLookupKey(option)
}));
const FUZZY_LOGO_STOPWORDS = new Set([
  "gana", "gano", "ganar", "ganador", "ganadora", "ganan", "empate",
  "handicap", "handi", "hcap", "mas", "menos", "over", "under", "total",
  "carreras", "carrera", "goles", "gol", "corners", "corner", "esquinas",
  "ambos", "marcan", "anotan", "equipo", "partido", "seleccion", "si", "no"
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function guardarCacheLimitado(cache, key, value, maxItems = 500) {
  if (cache.size >= maxItems) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, value);
  return value;
}

function normalizeLookupKey(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeFuzzyKey(value) {
  return normalizeLookupKey(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function getNombreCortoLogo(entry) {
  if (!entry) return "";
  if (["mlb", "nfl"].includes(entry.type) && !["MLB", "NFL"].includes(entry.name)) {
    const corto = [...entry.aliases]
      .filter(alias => alias.length > 2 && !/^[A-Z]{2,3}$/.test(alias))
      .sort((a, b) => a.length - b.length)[0];
    return corto || entry.name;
  }
  return entry.name;
}

function buscarEntradaSimilarLogo(texto = "") {
  const candidato = normalizeFuzzyKey(texto);
  if (!candidato || candidato.length < 4) return null;
  if (FUZZY_LOGO_STOPWORDS.has(candidato)) return null;

  let mejor = { entry: null, score: Infinity, aliasLength: 0 };

  LOGO_ENTRIES.forEach(entry => {
    if (entry.type === "country") return;

    entry.aliases.forEach(alias => {
      const aliasNorm = normalizeFuzzyKey(alias);
      if (!aliasNorm || aliasNorm.length < 4) return;

      const empiezaParecido = aliasNorm.startsWith(candidato) || candidato.startsWith(aliasNorm);
      const contieneParecido = candidato.length >= 5 && aliasNorm.includes(candidato);
      const distancia = distanciaEdicion(candidato, aliasNorm);
      const limite = aliasNorm.length <= 6 ? 1 : aliasNorm.length <= 10 ? 2 : 3;

      if ((empiezaParecido || contieneParecido || distancia <= limite) && distancia < mejor.score) {
        mejor = { entry, score: distancia, aliasLength: aliasNorm.length };
      }
    });
  });

  return mejor.entry;
}

export function autocorregirTextoConLogos(texto = "") {
  const cacheKey = String(texto);
  if (AUTOCORRECT_TEXT_CACHE.has(cacheKey)) return AUTOCORRECT_TEXT_CACHE.get(cacheKey);

  if (!cacheKey.trim()) return cacheKey;

  const corregirPalabrasSueltas = value => value.replace(/\p{L}[\p{L}'-]*/gu, palabra => {
    const entry = buscarEntradaSimilarLogo(palabra);
    return entry ? getNombreCortoLogo(entry) : palabra;
  });

  LOGO_ALIAS_PATTERN.lastIndex = 0;
  let corregido = "";
  let lastIndex = 0;
  let match;

  while ((match = LOGO_ALIAS_PATTERN.exec(cacheKey)) !== null) {
    const prefix = match[1] || "";
    const alias = match[2];
    const aliasStart = match.index + prefix.length;
    const aliasEnd = aliasStart + alias.length;
    const entry = LOGO_ALIAS_LOOKUP.get(normalizeLookupKey(alias));

    corregido += corregirPalabrasSueltas(cacheKey.slice(lastIndex, aliasStart));
    corregido += getNombreCortoLogo(entry) || alias;
    lastIndex = aliasEnd;
  }

  corregido += corregirPalabrasSueltas(cacheKey.slice(lastIndex));

  return guardarCacheLimitado(AUTOCORRECT_TEXT_CACHE, cacheKey, corregido);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getFlagEmoji(code = "") {
  const normalized = String(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "";
  return normalized
    .split("")
    .map(char => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

function crearLogoHtml(entry) {
  precargarLogoEntry(entry);
  const safeName = escapeHtml(entry.name);
  const chipClass = entry.type === "country" ? "mlb-team-chip country-flag-chip" : "mlb-team-chip";
  const logoSrc = `./images/${entry.logo}`;

  if (entry.type === "country") {
    const fallback = getFlagEmoji(entry.code);
    return `<span class="${chipClass}"><span class="country-flag-mark"><span class="country-flag-fallback" aria-hidden="true">${fallback}</span><img src="${logoSrc}" class="mlb-team-logo country-flag-logo" alt="${safeName}" width="26" height="26" loading="lazy" decoding="async" onload="this.classList.add('is-loaded');" onerror="this.style.display='none';"></span><span>${safeName}</span></span>`;
  }

  return `<span class="${chipClass}"><img src="${logoSrc}" class="mlb-team-logo" alt="" width="26" height="26" loading="lazy" decoding="async" onerror="this.style.display='none';"><span>${safeName}</span></span>`;
}

function formatPlainTextWithMlbSeparators(value) {
  return escapeHtml(value).replace(/\b(vs|versus)\b/gi, '<span class="mlb-versus">$1</span>');
}

function precargarLogoEntry(entry) {
  if (!entry?.logo || PRELOADED_LOGOS.has(entry.logo)) return;

  PRELOADED_LOGOS.add(entry.logo);
  const cargar = () => {
    const img = new Image();
    img.decoding = "async";
    img.src = `./images/${entry.logo}`;
  };

  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(cargar, { timeout: 1200 });
  } else {
    setTimeout(cargar, 0);
  }
}

export function precargarLogosDesdeTexto(texto) {
  if (!texto) return;

  LOGO_ALIAS_PATTERN.lastIndex = 0;
  let match;
  while ((match = LOGO_ALIAS_PATTERN.exec(texto)) !== null) {
    const alias = match[2];
    const entry = LOGO_ALIAS_LOOKUP.get(normalizeLookupKey(alias));
    if (entry) precargarLogoEntry(entry);
  }
}

export function formatTextWithMlbTeams(texto) {
  if (!texto) return "";
  if (FORMAT_TEXT_CACHE.has(texto)) return FORMAT_TEXT_CACHE.get(texto);

  LOGO_ALIAS_PATTERN.lastIndex = 0;
  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = LOGO_ALIAS_PATTERN.exec(texto)) !== null) {
    const prefix = match[1] || "";
    const alias = match[2];
    const aliasStart = match.index + prefix.length;
    const aliasEnd = aliasStart + alias.length;
    const entry = LOGO_ALIAS_LOOKUP.get(normalizeLookupKey(alias));
    // Los códigos de países de tres letras solo se tratan como tales cuando
    // se escriben en mayúsculas. Así "Por" en "Por Jugador" no se convierte
    // erróneamente en la bandera de Portugal (POR).
    const esCodigoPaisEnTexto = entry?.type === "country" && alias.length <= 3 && alias !== alias.toUpperCase();

    html += formatPlainTextWithMlbSeparators(texto.slice(lastIndex, aliasStart));
    html += entry && !esCodigoPaisEnTexto ? crearLogoHtml(entry) : escapeHtml(alias);
    lastIndex = aliasEnd;
  }

  html += formatPlainTextWithMlbSeparators(texto.slice(lastIndex));
  return guardarCacheLimitado(FORMAT_TEXT_CACHE, texto, html);
}

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
      "Menos de 3.5"
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
  const esBusquedaHandicap = /\b(handicap|hándicap|handi|hcap|runline|spread)\b/i.test(typedLower);
  const esBusquedaCarreras = /\b(carrera|carreras|run|runs)\b/i.test(typedLower);

  if (esBusquedaStrikeouts) {
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

  root.querySelectorAll(".jugada-ev-input, .edit-jugada-ev-input, .evento-principal-input, [id^='edit-evento-']")
    .forEach(input => {
      input.setAttribute("list", "mlbTeamsList");
      if (input.dataset.eventAutocompleteReady !== "1") {
        const actualizar = () => prepararAutocompleteEvento(input);
        input.addEventListener("focus", actualizar);
        input.addEventListener("input", actualizar);
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

const deployModuleToken = new URL(import.meta.url).searchParams.get("deploy") ||
  new URL(import.meta.url).searchParams.get("v") ||
  Date.now().toString(36);
const withDeployToken = (path) =>
  `${path}${path.includes("?") ? "&" : "?"}deploy=${encodeURIComponent(deployModuleToken)}`;

const { COUNTRY_FLAG_ENTRIES } = await import(withDeployToken("./countries.js?v=1.1"));
const { CHAMPIONS_TEAMS } = await import(withDeployToken("./champions-teams.js"));
export { CHAMPIONS_TEAMS };

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

// Equipos oficiales de LALIGA EA SPORTS 2026/27. Se priorizan los SVG locales;
// los PNG 500×500 mantienen el respaldo de alta calidad para los demás escudos.
export const LALIGA_TEAMS = [
  { name: "Athletic Club", logo: "la liga/athletic-club.svg", aliases: ["Athletic Club", "Athletic Bilbao", "Athletic"] },
  { name: "Atlético de Madrid", logo: "la liga/atletico-de-madrid.png", aliases: ["Atlético de Madrid", "Atletico de Madrid", "Atlético Madrid", "Atletico Madrid"] },
  { name: "CA Osasuna", logo: "la liga/osasuna.png", aliases: ["CA Osasuna", "Osasuna"] },
  { name: "Celta", logo: "la liga/celta-de-vigo.svg", aliases: ["Celta", "Celta de Vigo", "RC Celta"] },
  { name: "Deportivo Alavés", logo: "la liga/deportivo-alaves.png", aliases: ["Deportivo Alavés", "Deportivo Alaves", "Alavés", "Alaves"] },
  { name: "Elche CF", logo: "la liga/elche.png", aliases: ["Elche CF", "Elche"] },
  { name: "FC Barcelona", logo: "la liga/barcelona.svg", aliases: ["FC Barcelona", "Barcelona", "Barça", "Barca"] },
  { name: "Getafe CF", logo: "la liga/getafe.svg", aliases: ["Getafe CF", "Getafe"] },
  { name: "Levante UD", logo: "la liga/levante.png", aliases: ["Levante UD", "Levante"] },
  { name: "Málaga CF", logo: "la liga/malaga.png", aliases: ["Málaga CF", "Malaga CF", "Málaga", "Malaga"] },
  { name: "R. Racing Club", logo: "la liga/racing-santander.png", aliases: ["R. Racing Club", "Racing Club", "Racing de Santander", "Racing Santander"] },
  { name: "Rayo Vallecano", logo: "la liga/rayo-vallecano.png", aliases: ["Rayo Vallecano", "Rayo"] },
  { name: "RC Deportivo", logo: "la liga/deportivo-la-coruna.png", aliases: ["RC Deportivo", "Deportivo de La Coruña", "Deportivo La Coruña", "Deportivo"] },
  { name: "RCD Espanyol", logo: "la liga/espanyol.png", aliases: ["RCD Espanyol", "Espanyol", "Espanyol de Barcelona"] },
  { name: "Real Betis", logo: "la liga/real-betis.png", aliases: ["Real Betis", "Betis"] },
  { name: "Real Madrid", logo: "la liga/real-madrid.svg", aliases: ["Real Madrid"] },
  { name: "Real Sociedad", logo: "la liga/real-sociedad.png", aliases: ["Real Sociedad"] },
  { name: "Sevilla FC", logo: "la liga/sevilla.png", aliases: ["Sevilla FC", "Sevilla"] },
  { name: "Valencia CF", logo: "la liga/valencia.png", aliases: ["Valencia CF", "Valencia"] },
  { name: "Villarreal CF", logo: "la liga/villarreal.png", aliases: ["Villarreal CF", "Villarreal"] }
];

const MLB_LEAGUE_LOGO = { name: "MLB", logo: "mlb.svg", aliases: ["MLB", "MLN"] };
const MLB_LOGO_ENTRIES = [MLB_LEAGUE_LOGO, ...MLB_TEAMS];
const NFL_LEAGUE_LOGO = { name: "NFL", logo: "nfl.png", aliases: ["NFL"] };
const NFL_LOGO_ENTRIES = [NFL_LEAGUE_LOGO, ...NFL_TEAMS];
const LALIGA_LOGO_ENTRIES = LALIGA_TEAMS;
const COUNTRY_LOGO_ENTRIES = COUNTRY_FLAG_ENTRIES.map(country => ({
  type: "country",
  name: country.name,
  logo: country.flag,
  code: country.flag.replace(/^flag-/, "").replace(/\.png$/i, ""),
  aliases: country.aliases || []
}));
const LOGO_ENTRIES = [
  ...CHAMPIONS_TEAMS.map(entry => ({ ...entry, type: "football" })),
  ...MLB_LOGO_ENTRIES.map(entry => ({ ...entry, type: "mlb" })),
  ...NFL_LOGO_ENTRIES.map(entry => ({ ...entry, type: "nfl" })),
  ...LALIGA_LOGO_ENTRIES.map(entry => ({ ...entry, type: "laliga" })),
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

export function formatTextWithTeams(texto) {
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


// Utilidades compartidas por el autocompletado de apuestas.
export { EVENT_AUTOCOMPLETE_SEARCH, LOGO_ALIAS_LOOKUP, normalizeLookupKey, escapeHtml };

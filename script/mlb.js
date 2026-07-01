import { COUNTRY_FLAG_ENTRIES } from "./countries.js?v=1.1";

export const MLB_TEAMS = [
  { name: "Arizona Diamondbacks", logo: "arizona-diamondbacks.svg", aliases: ["Arizona Diamondbacks", "Arizona", "Diamondbacks", "D-backs", "Dbacks", "ARI"] },
  { name: "Oakland Athletics", logo: "athletics.svg", aliases: ["Athletics", "Atletics", "A's", "Oakland", "Oaklands", "Oukland", "Ouklans", "Oakland Athletics", "Oakland Atletics", "Oakland A's", "Oaklands Athletics", "Oaklands Atletics", "Oukland Athletics", "Oukland Atletics", "Ouklans Athletics", "Ouklans Atletics"] },
  { name: "Atlanta Braves", logo: "atlanta-braves.svg", aliases: ["Atlanta Braves", "Braves", "ATL"] },
  { name: "Baltimore Orioles", logo: "baltimore-orioles.svg", aliases: ["Baltimore Orioles", "Orioles", "BAL"] },
  { name: "Boston Red Sox", logo: "boston-red-sox.svg", aliases: ["Boston Red Sox", "Red Sox", "BOS"] },
  { name: "Chicago Cubs", logo: "chicago-cubs.svg", aliases: ["Chicago Cubs", "Cubs", "CHC"] },
  { name: "Chicago White Sox", logo: "chicago-white-sox.svg", aliases: ["Chicago White Sox", "White Sox", "Chi White Sox", "CHW", "CWS"] },
  { name: "Cincinnati Reds", logo: "cincinnati-reds.svg", aliases: ["Cincinnati Reds", "Reds", "CIN"] },
  { name: "Cleveland Guardians", logo: "cleveland-guardians.svg", aliases: ["Cleveland Guardians", "Guardians", "Cleveland Indians", "Indians", "CLE"] },
  { name: "Colorado Rockies", logo: "colorado-rockies.svg", aliases: ["Colorado Rockies", "Rockies", "COL"] },
  { name: "Detroit Tigers", logo: "detroit-tigers.svg", aliases: ["Detroit Tigers", "Tigers", "DET"] },
  { name: "Houston Astros", logo: "houston-astros.svg", aliases: ["Houston Astros", "Astros", "HOU"] },
  { name: "Kansas City Royals", logo: "kansas-city-royals.svg", aliases: ["Kansas City Royals", "Royals", "KC"] },
  { name: "Los Angeles Angels", logo: "los-angeles-angels.svg", aliases: ["Los Angeles Angels", "LA Angels", "Angels", "LAA"] },
  { name: "Los Angeles Dodgers", logo: "los-angeles-dodgers.svg", aliases: ["Los Angeles Dodgers", "LA Dodgers", "Dodgers", "LAD"] },
  { name: "Miami Marlins", logo: "miami-marlins.svg", aliases: ["Miami Marlins", "Marlins", "MIA"] },
  { name: "Milwaukee Brewers", logo: "milwaukee-brewers.svg", aliases: ["Milwaukee Brewers", "Brewers", "MIL"] },
  { name: "Minnesota Twins", logo: "minnesota-twins.svg", aliases: ["Minnesota Twins", "Twins", "MIN"] },
  { name: "New York Mets", logo: "new-york-mets.svg", aliases: ["New York Mets", "NY Mets", "Mets", "NYM"] },
  { name: "New York Yankees", logo: "new-york-yankees.svg", aliases: ["New York Yankees", "NY Yankees", "Yankees", "NYY"] },
  { name: "Philadelphia Phillies", logo: "philadelphia-phillies.svg", aliases: ["Philadelphia Phillies", "Phillies", "PHI"] },
  { name: "Pittsburgh Pirates", logo: "pittsburgh-pirates.svg", aliases: ["Pittsburgh Pirates", "Pirates", "PIT"] },
  { name: "San Diego Padres", logo: "san-diego-padres.svg", aliases: ["San Diego Padres", "Padres", "SD"] },
  { name: "San Francisco Giants", logo: "san-francisco-giants.svg", aliases: ["San Francisco Giants", "SF Giants", "Giants", "SF"] },
  { name: "Seattle Mariners", logo: "seattle-mariners.svg", aliases: ["Seattle Mariners", "Mariners", "SEA"] },
  { name: "St. Louis Cardinals", logo: "st-louis-cardinals.svg", aliases: ["St. Louis Cardinals", "St Louis Cardinals", "Cardinals", "STL"] },
  { name: "Tampa Bay Rays", logo: "tampa-bay-rays.svg", aliases: ["Tampa Bay Rays", "Rays", "TB"] },
  { name: "Texas Rangers", logo: "texas-rangers.svg", aliases: ["Texas Rangers", "Rangers", "TEX"] },
  { name: "Toronto Blue Jays", logo: "toronto-blue-jays.svg", aliases: ["Toronto Blue Jays", "Blue Jays", "TOR"] },
  { name: "Washington Nationals", logo: "washington-nationals.svg", aliases: ["Washington Nationals", "Nationals", "WSH", "WAS"] }
];

const MLB_LEAGUE_LOGO = { name: "MLB", logo: "mlb.svg", aliases: ["MLB", "MLN"] };
const MLB_LOGO_ENTRIES = [MLB_LEAGUE_LOGO, ...MLB_TEAMS];
const COUNTRY_LOGO_ENTRIES = COUNTRY_FLAG_ENTRIES.map(country => ({
  type: "country",
  name: country.name,
  logo: country.flag,
  code: country.flag.replace(/^flag-/, "").replace(/\.png$/i, ""),
  aliases: country.aliases || []
}));
const LOGO_ENTRIES = [
  ...MLB_LOGO_ENTRIES.map(entry => ({ ...entry, type: "mlb" })),
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
  if (entry.type === "mlb" && entry.name !== "MLB") {
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

    html += formatPlainTextWithMlbSeparators(texto.slice(lastIndex, aliasStart));
    html += entry ? crearLogoHtml(entry) : escapeHtml(alias);
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

export function habilitarAutocompleteMlb(root = document) {
  crearMlbTeamsDatalist();

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
      input.removeAttribute("list");
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

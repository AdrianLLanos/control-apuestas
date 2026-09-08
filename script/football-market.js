const token = new URL(import.meta.url).searchParams.get("deploy") || Date.now().toString(36);
const { CHAMPIONS_TEAMS, LALIGA_TEAMS, formatTextWithTeams } = await import(`./sports-assets.js?deploy=${encodeURIComponent(token)}`);

(() => {
  const getTeams = () => byId("quickFootballCompetition")?.value === "laliga" ? LALIGA_TEAMS : CHAMPIONS_TEAMS;

  const byId = id => document.getElementById(id);
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const isMiCasino = () => normalize(byId("casaApuesta")?.selectedOptions?.[0]?.textContent).includes("mi casino");

  function addButton(container, label, selection) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = formatTextWithTeams(label);
    button.addEventListener("click", () => {
      if (byId("deporte")?.value !== "futbol" || byId("tipoApuesta")?.value === "simple_option_bet") return;
      const local = byId("quickFootballEquipoA")?.value.trim();
      const visitante = byId("quickFootballEquipoB")?.value.trim();
      if (!local || !visitante) {
        alert("Indica el equipo local y visitante antes de elegir un mercado.");
        return;
      }
      const resolve = value => getTeams().find(team => team.aliases.some(alias => normalize(alias) === normalize(value)))?.name || value;
      if (normalize(resolve(local)) === normalize(resolve(visitante))) {
        alert("Elige dos equipos diferentes.");
        return;
      }
      document.dispatchEvent(new CustomEvent("football-market:select", {
        detail: { evento: `${resolve(local)} vs ${resolve(visitante)}`, jugada: selection(resolve(local), resolve(visitante)) }
      }));
      button.classList.add("is-selected");
      setTimeout(() => button.classList.remove("is-selected"), 450);
    });
    container.appendChild(button);
  }

  function renderMarkets() {
    const local = byId("quickFootballEquipoA")?.value.trim() || "Local";
    const visitante = byId("quickFootballEquipoB")?.value.trim() || "Visitante";
    const winner = byId("quickFootballWinnerLines");
    const doubleChance = byId("quickFootballDoubleChanceLines");
    const handicap = byId("quickFootballHandicapLines");
    const goals = byId("quickFootballGoalsLines");
    const corners = byId("quickFootballCornersLines");
    if (!winner || !handicap || !goals || !corners) return;
    [winner, handicap, goals, corners].forEach(node => node.replaceChildren());
    if (doubleChance) {
      doubleChance.replaceChildren();
      addButton(doubleChance, `${local} gana o empata`, team => `Doble oportunidad ${team} o Empate`);
      addButton(doubleChance, `${visitante} gana o empata`, (_, team) => `Doble oportunidad ${team} o Empate`);
    }

    const pagoAnticipado = isMiCasino();
    byId("quickFootballWinnerTitle").textContent = pagoAnticipado ? "Ganador con pago anticipado" : "Ganador";
    byId("quickFootballEarlyNote").hidden = !pagoAnticipado;
    addButton(winner, pagoAnticipado ? `Gana ${local} · pago anticipado` : `Gana ${local}`, team => pagoAnticipado ? `Ganador con pago anticipado: Gana ${team}` : `Gana ${team}`);
    addButton(winner, "Empate", () => "Empate");
    addButton(winner, pagoAnticipado ? `Gana ${visitante} · pago anticipado` : `Gana ${visitante}`, (_, team) => pagoAnticipado ? `Ganador con pago anticipado: Gana ${team}` : `Gana ${team}`);
    addButton(handicap, `${local} 0 (gana o empata)`, team => `Hándicap ${team} +0`);
    addButton(handicap, `${visitante} 0 (gana o empata)`, (_, team) => `Hándicap ${team} +0`);
    Array.from({ length: 14 }, (_, index) => (index + 1) / 2).forEach(line => {
      ["+", "-"].forEach(sign => {
        addButton(handicap, `${local} ${sign}${line}`, team => `Hándicap ${team} ${sign}${line}`);
        addButton(handicap, `${visitante} ${sign}${line}`, (_, team) => `Hándicap ${team} ${sign}${line}`);
      });
    });
    [1.5, 2.5, 3.5, 4.5].forEach(line => {
      addButton(goals, `Más ${line}`, () => `Más de ${line} goles`);
      addButton(goals, `Menos ${line}`, () => `Menos de ${line} goles`);
    });
    [7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15].forEach(line => {
      addButton(corners, `Más ${line}`, () => `Más de ${line} tiros de esquina`);
      addButton(corners, `Menos ${line}`, () => `Menos de ${line} tiros de esquina`);
    });
  }

  function updateTeams(input) {
    const list = byId("quickFootballTeamsList");
    if (!list) return;
    const query = normalize(input?.value);
    list.replaceChildren(...getTeams().filter(team => !query || team.aliases.some(alias => normalize(alias).includes(query))).map(team => {
      const option = document.createElement("option");
      option.value = team.name;
      return option;
    }));
  }

  function updateVisibility() {
    const isFootball = byId("deporte")?.value === "futbol";
    const isSimpleOption = byId("tipoApuesta")?.value === "simple_option_bet";
    const footballPanel = byId("selectorMercadosFutbol");
    if (footballPanel) {
      const show = isFootball && !isSimpleOption;
      footballPanel.hidden = !show;
      footballPanel.classList.toggle("is-open", show);
    }
  }

  function setup() {
    const local = byId("quickFootballEquipoA");
    const visitante = byId("quickFootballEquipoB");
    [local, visitante].forEach(input => {
      input?.addEventListener("focus", () => updateTeams(input));
      input?.addEventListener("input", () => { updateTeams(input); renderMarkets(); });
      input?.addEventListener("change", () => {
        const team = getTeams().find(team => team.aliases.some(alias => normalize(alias) === normalize(input.value.trim())));
        if (team) input.value = team.name;
        renderMarkets();
      });
    });
    byId("quickFootballCompetition")?.addEventListener("change", () => {
      local.value = "";
      visitante.value = "";
      byId("quickFootballHeading").textContent = byId("quickFootballCompetition").value === "champions"
        ? "⚽ Mercados UEFA Champions League" : "⚽ Mercados LaLiga";
      updateTeams();
      renderMarkets();
    });
    byId("deporte")?.addEventListener("change", updateVisibility);
    byId("casaApuesta")?.addEventListener("change", renderMarkets);
    byId("tipoApuesta")?.addEventListener("change", updateVisibility);
    updateTeams();
    renderMarkets();
    updateVisibility();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();

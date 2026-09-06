(() => {
  const teams = [
    "Athletic Club", "Atlético de Madrid", "CA Osasuna", "Celta", "Deportivo Alavés",
    "Elche CF", "FC Barcelona", "Getafe CF", "Levante UD", "Málaga CF", "R. Racing Club",
    "Rayo Vallecano", "RC Deportivo", "RCD Espanyol", "Real Betis", "Real Madrid",
    "Real Sociedad", "Sevilla FC", "Valencia CF", "Villarreal CF"
  ];

  const byId = id => document.getElementById(id);
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const isMiCasino = () => normalize(byId("casaApuesta")?.selectedOptions?.[0]?.textContent).includes("mi casino");

  function addButton(container, label, selection) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      const local = byId("quickFootballEquipoA")?.value.trim();
      const visitante = byId("quickFootballEquipoB")?.value.trim();
      if (!local || !visitante) {
        alert("Indica el equipo local y visitante antes de elegir un mercado.");
        return;
      }
      document.dispatchEvent(new CustomEvent("football-market:select", {
        detail: { evento: `${local} vs ${visitante}`, jugada: selection(local, visitante) }
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
    const handicap = byId("quickFootballHandicapLines");
    const goals = byId("quickFootballGoalsLines");
    const corners = byId("quickFootballCornersLines");
    if (!winner || !handicap || !goals || !corners) return;
    [winner, handicap, goals, corners].forEach(node => node.replaceChildren());

    const pagoAnticipado = isMiCasino();
    byId("quickFootballWinnerTitle").textContent = pagoAnticipado ? "Ganador con pago anticipado" : "Ganador";
    byId("quickFootballEarlyNote").hidden = !pagoAnticipado;
    addButton(winner, pagoAnticipado ? `Gana ${local} · pago anticipado` : `Gana ${local}`, team => pagoAnticipado ? `Ganador con pago anticipado: Gana ${team}` : `Gana ${team}`);
    addButton(winner, pagoAnticipado ? `Gana ${visitante} · pago anticipado` : `Gana ${visitante}`, (_, team) => pagoAnticipado ? `Ganador con pago anticipado: Gana ${team}` : `Gana ${team}`);
    [0, 0.5, 1, 1.5, 2, 2.5].forEach(line => {
      const home = `${line > 0 ? "+" : ""}${line}`;
      const away = `${line > 0 ? "-" : "+"}${Math.abs(line)}`;
      addButton(handicap, `${local} ${home}`, team => `Hándicap ${team} ${home}`);
      addButton(handicap, `${visitante} ${away}`, (_, team) => `Hándicap ${team} ${away}`);
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
    list.replaceChildren(...teams.filter(team => !query || normalize(team).includes(query)).map(team => {
      const option = document.createElement("option");
      option.value = team;
      return option;
    }));
  }

  function updateVisibility() {
    const isFootball = byId("deporte")?.value === "futbol";
    const isSimpleOption = byId("tipoApuesta")?.value === "simple_option_bet";
    const footballPanel = byId("selectorMercadosFutbol");
    const mlbPanel = byId("selectorStrikeoutsTotales");
    if (footballPanel) {
      const show = isFootball && !isSimpleOption;
      footballPanel.hidden = !show;
      footballPanel.classList.toggle("is-open", show);
    }
    if (mlbPanel && isFootball) mlbPanel.classList.remove("is-open");
  }

  function setup() {
    const local = byId("quickFootballEquipoA");
    const visitante = byId("quickFootballEquipoB");
    [local, visitante].forEach(input => {
      input?.addEventListener("focus", () => updateTeams(input));
      input?.addEventListener("input", () => { updateTeams(input); renderMarkets(); });
      input?.addEventListener("change", renderMarkets);
    });
    byId("deporte")?.addEventListener("change", updateVisibility);
    byId("casaApuesta")?.addEventListener("change", renderMarkets);
    byId("tipoApuesta")?.addEventListener("change", updateVisibility);
    renderMarkets();
    updateVisibility();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();

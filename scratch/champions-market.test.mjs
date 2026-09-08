import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

class Element {
  constructor() { this.value = ''; this.children = []; this.listeners = {}; this.hidden = false; this.classes = new Set(); this.classList = { add: x => this.classes.add(x), remove: x => this.classes.delete(x), toggle: (x, on) => on ? this.classes.add(x) : this.classes.delete(x) }; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] || []) fn({ currentTarget: this }); }
  appendChild(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
const elements = new Map();
const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
let selected, alertText;
const document = { readyState: 'complete', getElementById: get, createElement: () => new Element(), dispatchEvent: e => { selected = e.detail; } };
get('quickFootballCompetition').value = 'champions';
get('deporte').value = 'futbol';
get('tipoApuesta').value = 'simple';
get('casaApuesta').selectedOptions = [{ textContent: 'Otra casa' }];
const context = vm.createContext({ document, URL, console, setTimeout: () => 0, window: {}, Image: class {}, alert: text => { alertText = text; }, CustomEvent: class { constructor(type, options) { this.detail = options.detail; } } });
const modules = new Map();
async function load(filename) {
  filename = path.resolve(filename);
  if (modules.has(filename)) return modules.get(filename);
  const mod = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), {
    context, identifier: filename,
    initializeImportMeta(meta) { meta.url = `file:///${filename.replaceAll('\\', '/')}?deploy=test`; },
    async importModuleDynamically(specifier) { const child = await load(path.resolve(path.dirname(filename), specifier.split('?')[0])); if (child.status === 'linked') await child.evaluate(); return child; }
  });
  modules.set(filename, mod);
  await mod.link(specifier => load(path.resolve(path.dirname(filename), specifier.split('?')[0])));
  return mod;
}
await (await load('script/football-market.js')).evaluate();
assert.equal(modules.has(path.resolve('script/mlb.js')), false, 'Football must load without MLB');
const { CHAMPIONS_TEAMS, formatTextWithTeams: formatTextWithMlbTeams } = (await load('script/sports-assets.js')).namespace;
assert.equal(CHAMPIONS_TEAMS.length, 36);
assert.equal(new Set(CHAMPIONS_TEAMS.map(t => t.uefaId)).size, 36);
for (const team of CHAMPIONS_TEAMS) {
  const png = fs.readFileSync(`images/${team.logo}`);
  assert.equal(png.subarray(1, 4).toString(), 'PNG', team.name);
  assert.equal(png.readUInt32BE(16), 70);
  assert.equal(png.readUInt32BE(20), 70);
  assert.ok(formatTextWithMlbTeams(team.name).includes(team.logo), team.name);
  assert.ok(formatTextWithMlbTeams(team.name).includes('width="26" height="26"'));
}
assert.equal(get('quickFootballTeamsList').children.length, 36);
assert.equal(get('quickFootballWinnerLines').children.length, 3);
assert.equal(get('quickFootballHandicapLines').children.length, 76);
assert.equal(get('quickFootballGoalsLines').children.length, 8);
assert.equal(get('quickFootballCornersLines').children.length, 18);
get('quickFootballEquipoA').value = 'PSG';
get('quickFootballEquipoA').fire('change');
assert.equal(get('quickFootballEquipoA').value, 'Paris Saint-Germain');
get('quickFootballEquipoB').value = 'Arsenal';
get('quickFootballEquipoB').fire('change');
for (const button of get('quickFootballHandicapLines').children) button.fire('click');
assert.deepEqual(JSON.parse(JSON.stringify(selected)), { evento: 'Paris Saint-Germain vs Arsenal', jugada: 'Hándicap Arsenal -10' });
for (let n = 1; n <= 10; n += .5) for (const team of ['Paris Saint-Germain', 'Arsenal']) for (const sign of ['+', '-']) {
  assert.ok(get('quickFootballHandicapLines').children.some(button => { button.fire('click'); return selected.jugada === `Hándicap ${team} ${sign}${n}`; }));
}
get('quickFootballWinnerLines').children[1].fire('click');
assert.equal(selected.jugada, 'Empate');
get('quickFootballGoalsLines').children[0].fire('click');
assert.equal(selected.jugada, 'Más de 1.5 goles');
get('quickFootballCornersLines').children.at(-1).fire('click');
assert.equal(selected.jugada, 'Menos de 15 tiros de esquina');
get('quickFootballEquipoB').value = 'PSG';
get('quickFootballWinnerLines').children[0].fire('click');
assert.equal(alertText, 'Elige dos equipos diferentes.');
get('quickFootballCompetition').value = 'laliga';
get('quickFootballCompetition').fire('change');
assert.equal(get('quickFootballTeamsList').children.length, 20);
assert.equal(get('quickFootballEquipoA').value, '');
get('deporte').value = 'mlb';
get('deporte').fire('change');
assert.equal(get('selectorMercadosFutbol').hidden, true);
const previousSelection = selected;
get('quickFootballWinnerLines').children[0].fire('click');
assert.equal(selected, previousSelection, 'Hidden football market must not insert a selection');
// Exercise the real MLB market renderer with both panels in the same document.
const app = fs.readFileSync('script/app.js', 'utf8').replaceAll('\r\n', '\n');
const start = app.indexOf('(() => {\n  const add = (label, build) => {');
const end = app.indexOf('\n})();', start) + '\n})();'.length;
assert.ok(start >= 0 && end > start);
const footballButtons = [...get('quickFootballHandicapLines').children];
vm.runInContext(app.slice(start, end), context);
assert.equal(get('quickMoneylineLines').children.length, 2);
assert.equal(get('quickTotalRunsLines').children.length, 22);
assert.equal(get('quickHandicapLines').children.length, 76);
assert.deepEqual(get('quickFootballHandicapLines').children, footballButtons);
const mlbButtons = [...get('quickHandicapLines').children];
get('deporte').value = 'futbol';
get('deporte').fire('change');
assert.equal(get('selectorMercadosFutbol').hidden, false);
assert.deepEqual(get('quickHandicapLines').children, mlbButtons, 'Football must not rerender MLB');
// With the wrong sport active, this must return before touching any bet fields.
get('quickMoneylineLines').children[0].fire('click');
get('tipoApuesta').value = 'simple_option_bet';
get('tipoApuesta').fire('change');
assert.equal(get('selectorMercadosFutbol').hidden, true);
get('quickFootballWinnerLines').children[0].fire('click');
assert.equal(selected, previousSelection);
const legacy = await load('script/mlb.js');
await legacy.evaluate();
assert.equal(legacy.namespace.formatTextWithMlbTeams, formatTextWithMlbTeams, 'Compatibility uses the same shared formatter');
assert.ok(formatTextWithMlbTeams('New York Yankees').includes('new-york-yankees.svg'));
console.log('OK: 36 logos, autocomplete, 76 handicaps, winner/draw, totals, selection events, competition switch and MLB logos.');

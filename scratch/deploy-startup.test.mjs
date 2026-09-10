import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const loader = readFileSync(new URL('../script/loader.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../script/app.js', import.meta.url), 'utf8');
const version = {version: 'current-commit', deployId: 'new-deploy', deployedAt: '2026-09-10T20:34:29Z', assetToken: 'new-deploy'};
const storage = () => {
  const data = new Map();
  return {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
};

for (const search of ['', '?deploy=39nyu9&t=mtvzk7wk', '?v=old&house=principal']) {
  const calls = [];
  let replaced, reloads = 0;
  let current = version;
  const c = vm.createContext({URL, URLSearchParams, console, Date,
    sessionStorage: storage(), localStorage: storage(),
    window: {location: {search, href: `https://control-de-apuestas.netlify.app/${search}#historial`},
      history: {state: {keep: true}, replaceState: (state, title, url) => { replaced = {state, url}; }}},
    fetch: async (url, options) => {
      calls.push(url);
      assert.equal(options.cache, 'no-store');
      return {ok: true, text: async () => JSON.stringify(current)};
    },
    paginaEstaVisible: () => true, setTimeout: callback => callback(),
    recargarPorNuevoDeploy: () => { reloads++; },
    deployVersionReloading: false, deployVersionChecking: false,
    DEPLOY_VERSION_URL: '/version.json'
  });
  vm.runInContext(loader.slice(0, loader.indexOf('const token = await')), c);
  const token = await c.obtenerTokenDeploy();
  assert.equal(calls.length, 1, 'Even an old deploy link verifies the current server version');
  assert.notEqual(token, '39nyu9');
  assert.equal(c.window.__APUESTAS_DEPLOY_SIGNATURE__, Object.values(version).join('|'));
  if (search) {
    assert.equal(new URL(replaced.url).searchParams.has('deploy'), false);
    assert.equal(new URL(replaced.url).searchParams.has('v'), false);
    assert.equal(new URL(replaced.url).searchParams.has('t'), false);
    assert.equal(new URL(replaced.url).hash, '#historial');
    assert.equal(replaced.state.keep, true);
    if (search.includes('house')) assert.equal(new URL(replaced.url).searchParams.get('house'), 'principal');
  }
  c.deployVersionActual = c.window.__APUESTAS_DEPLOY_SIGNATURE__;
  for (const name of ['obtenerVersionDeployActual', 'obtenerFirmaDeployActual', 'revisarVersionDeploy']) {
    vm.runInContext(app.match(new RegExp(`^async function ${name}\\([\\s\\S]*?^}`, 'm'))[0], c);
  }
  await c.revisarVersionDeploy();
  assert.equal(reloads, 0, 'Same published version never reloads during startup');
  current = {...version, deployId: 'newer-deploy'};
  await c.revisarVersionDeploy();
  assert.equal(reloads, 1, 'A real deployment still triggers the update');
  c.fetch = async () => { throw Error('offline'); };
  assert.equal(await c.obtenerTokenDeploy(), new URLSearchParams(search).get('deploy') || new URLSearchParams(search).get('v') || token);
}
console.log('Startup: stale links verify the server, signatures agree, no spurious reload, real updates and offline fallback work.');

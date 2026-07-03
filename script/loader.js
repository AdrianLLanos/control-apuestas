const VERSION_URL = "/version.json";
const INDEX_URL = "/index.html";
const DEPLOY_TOKEN_KEY = "apuestas-deploy-token";
const DEPLOY_SIGNATURE_KEY = "apuestas-deploy-signature";

function crearTokenVersionDeploy(version = "") {
  let hash = 0;
  const texto = String(version);
  for (let i = 0; i < texto.length; i += 1) {
    hash = ((hash * 31) + texto.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36) || String(Date.now());
}

function guardarStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch (error) {
    console.warn("No se pudo guardar cache de version:", error.message);
  }
}

async function obtenerTokenDeploy() {
  const params = new URLSearchParams(window.location.search);
  const tokenUrl = params.get("deploy") || params.get("v");
  if (tokenUrl) {
    guardarStorage(sessionStorage, DEPLOY_TOKEN_KEY, tokenUrl);
    return tokenUrl;
  }

  try {
    const [versionResponse, indexResponse] = await Promise.all([
      fetch(`${VERSION_URL}?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
      }),
      fetch(`${INDEX_URL}?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
      })
    ]);

    if (versionResponse.ok) {
      const versionText = (await versionResponse.text()).trim();
      const indexText = indexResponse.ok ? await indexResponse.text() : "";
      const mainScript = indexText.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)?.[1] || "";
      const indexFirma = crearTokenVersionDeploy(`${mainScript}|${indexText}`);
      const firma = [versionText, indexFirma].filter(Boolean).join("::");
      const token = crearTokenVersionDeploy(firma);
      window.__APUESTAS_DEPLOY_SIGNATURE__ = firma;
      guardarStorage(sessionStorage, DEPLOY_TOKEN_KEY, token);
      guardarStorage(sessionStorage, DEPLOY_SIGNATURE_KEY, firma);
      guardarStorage(localStorage, DEPLOY_TOKEN_KEY, token);
      guardarStorage(localStorage, DEPLOY_SIGNATURE_KEY, firma);
      return token;
    }
  } catch (error) {
    console.warn("No se pudo obtener la version del deploy:", error.message);
  }

  window.__APUESTAS_DEPLOY_SIGNATURE__ = sessionStorage.getItem(DEPLOY_SIGNATURE_KEY) ||
    localStorage.getItem(DEPLOY_SIGNATURE_KEY) ||
    "";
  return sessionStorage.getItem(DEPLOY_TOKEN_KEY) ||
    localStorage.getItem(DEPLOY_TOKEN_KEY) ||
    "local";
}

const token = await obtenerTokenDeploy();
await import(`./main.js?deploy=${encodeURIComponent(token)}`);

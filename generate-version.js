const fs = require("fs");
const crypto = require("crypto");

function crearHashCorto(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function actualizarIndexHtml(assetToken) {
  const indexPath = "index.html";
  if (!fs.existsSync(indexPath)) return;

  const html = fs.readFileSync(indexPath, "utf8");
  const actualizado = html.replace(
    /(href|src)="((?:Style\.css|estilos\/[^"]+\.css|script\/loader\.js)(?:\?[^"]*)?)"/g,
    (_match, attr, assetPath) => {
      const cleanPath = assetPath.split("?")[0];
      return `${attr}="${cleanPath}?deploy=${assetToken}"`;
    }
  );

  if (actualizado !== html) {
    fs.writeFileSync(indexPath, actualizado);
  }
}

const versionInfo = {
  version: process.env.COMMIT_REF || process.env.COMMIT_SHA || "local",
  deployId: process.env.DEPLOY_ID || process.env.BUILD_ID || "local",
  deployedAt: new Date().toISOString()
};

versionInfo.assetToken = process.env.DEPLOY_ID ||
  process.env.BUILD_ID ||
  process.env.COMMIT_REF ||
  process.env.COMMIT_SHA ||
  crearHashCorto(versionInfo.deployedAt);

fs.writeFileSync("version.json", `${JSON.stringify(versionInfo)}\n`);
actualizarIndexHtml(versionInfo.assetToken);

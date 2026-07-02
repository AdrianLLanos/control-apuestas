const fs = require("fs");

const versionInfo = {
  version: process.env.COMMIT_REF || process.env.COMMIT_SHA || "local",
  deployId: process.env.DEPLOY_ID || process.env.BUILD_ID || "local",
  deployedAt: new Date().toISOString()
};

fs.writeFileSync("version.json", `${JSON.stringify(versionInfo)}\n`);

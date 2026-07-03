const params = new URL(import.meta.url).searchParams;
const deployToken = params.get("deploy") || params.get("v") || Date.now().toString(36);

await import(`./app.js?deploy=${encodeURIComponent(deployToken)}`);

'use strict';
// Entry point: node server/server.js
const { loadConfig } = require('./config');
const { buildApp } = require('./app');

async function main() {
  let cfg;
  try { cfg = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }
  const app = await buildApp(cfg);
  const stop = async sig => { app.log.info(`${sig} received, shutting down`); await app.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await app.listen({ host: cfg.host, port: cfg.port });
  console.log(`Aliran is running at http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`);
}

main().catch(e => { console.error(e); process.exit(1); });

require('dotenv').config();
const app = require('./app');
const env = require('./config/env');
const sequelize = require('./config/database');
const logger = require('./config/logger');

let server;

const start = async () => {
  await sequelize.authenticate();
  server = app.listen(env.port, env.host, () => logger.info({ port: env.port, service: env.serviceName }, 'Entitlements & Session Credits listening'));
  return server;
};

const shutdown = async (signal) => {
  logger.info({ signal }, 'Entitlements & Session Credits shutdown requested');
  if (server) await new Promise((resolve) => server.close(resolve));
  await sequelize.close();
  process.exit(0);
};

if (require.main === module) {
  start().catch((error) => { logger.error({ err: error }, 'Entitlements & Session Credits failed to start'); process.exit(1); });
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { start, shutdown };

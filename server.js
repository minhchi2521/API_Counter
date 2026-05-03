const path = require('path');
const { ConfigStore } = require('./config');
const { Counter } = require('./counter');
const { cleanupOldRequests, createDatabase } = require('./db');
const { createDashboardServer } = require('./dashboard');
const { createProxyServer } = require('./proxy');

function listen(server, port, label) {
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      const address = server.address();
      console.log(`[${label}] listening on http://0.0.0.0:${address.port}`);
      resolve(address.port);
    });
  });
}

async function main() {
  const dataDir = path.join(__dirname, 'data');
  const configStore = new ConfigStore({ dataDir });
  const config = configStore.init();
  configStore.on('error', (error) => {
    console.error('[config] reload failed:', error.message);
  });

  const db = createDatabase({ dbPath: path.join(dataDir, 'counter.db') });
  const counter = new Counter(db, configStore);
  const cleanup = () => {
    try {
      cleanupOldRequests(db, configStore.get());
    } catch (error) {
      console.error('[db] cleanup failed:', error.message);
    }
  };
  cleanup();
  const cleanupTimer = setInterval(cleanup, 6 * 60 * 60 * 1000);

  const proxy = createProxyServer({ configStore, counter });
  const dashboard = createDashboardServer({ configStore, counter });

  await listen(proxy, config.proxyPort, 'proxy');
  await listen(dashboard, config.dashboardPort, 'dashboard');

  const shutdown = () => {
    console.log('\n[server] shutting down');
    clearInterval(cleanupTimer);
    configStore.close();
    proxy.close();
    dashboard.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  main
};

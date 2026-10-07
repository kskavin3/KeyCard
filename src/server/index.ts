import 'dotenv/config';
import { app } from './app.js';
import { initializeDatabase, pool } from './db.js';
import { startReconciliationWorker } from './jobs/reconciliation.js';
import { bootstrapRegistryProvider } from './accounts.js';

const port = Number(process.env.API_PORT ?? 4020);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid TCP port.');

for (const name of ['KEYCARD_ENCRYPTION_KEY']) {
  if (!process.env[name]) throw new Error(`${name} must be set before starting KeyCard.`);
}

await initializeDatabase();
await bootstrapRegistryProvider();
const stopReconciliation = startReconciliationWorker();
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`KeyCard API listening at http://127.0.0.1:${port}`);
  console.log(`Provider dashboard: http://127.0.0.1:${port}/provider/`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => {
    stopReconciliation();
    void pool.end().finally(() => process.exit(0));
  }));
}

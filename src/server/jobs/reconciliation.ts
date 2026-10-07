import { pool } from '../db.js';
import { paymentGateway } from '../payments.js';
import { PgCallStore, reconcileCall } from '../paid-calls.js';

const store = new PgCallStore(pool);

export async function runReconciliationBatch(limit = 50) {
  const result = await pool.query(
    `SELECT call_id FROM paid_calls
     WHERE payment_payload IS NOT NULL AND payment_confirmed = FALSE
       AND state IN ('settling', 'result_ready', 'failed', 'review', 'executing')
     ORDER BY updated_at ASC LIMIT $1`,
    [limit],
  );
  let reconciled = 0;
  for (const row of result.rows) {
    await store.locked(String(row.call_id), async session => {
      const call = await session.load();
      if (!call || call.payment_confirmed) return;
      await reconcileCall(call, paymentGateway, session);
      if (call.payment_confirmed) reconciled++;
    });
  }
  return { scanned: result.rowCount ?? 0, reconciled };
}

export function startReconciliationWorker(intervalMs = 30_000) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runReconciliationBatch()
      .catch(error => console.error('Payment reconciliation failed:', error?.message ?? error))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

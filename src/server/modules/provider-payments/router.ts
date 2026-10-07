import { Router } from 'express';
import { pool } from '../../db.js';
import { paymentGateway, verifyRefund } from '../../payments.js';
import { PgCallStore, receipt, reconcileCall } from '../../paid-calls.js';

const router = Router();
const callStore = new PgCallStore(pool);
const invalid = (message: string) => Object.assign(new Error(message), { status: 400 });
const providerId = process.env.KEYCARD_PROVIDER_ID ?? 'provider-demo';

router.get('/earnings', async (_req, res, next) => {
  try {
    const summary = await pool.query(`SELECT
      COALESCE(sum((requirements->>'amount')::numeric) FILTER (WHERE payment_confirmed),0)::text AS received_lovelace,
      COALESCE(sum((requirements->>'amount')::numeric) FILTER (WHERE state='completed' AND payment_confirmed),0)::text AS earned_lovelace,
      COALESCE(sum((requirements->>'amount')::numeric) FILTER (WHERE refund_status='due'),0)::text AS refund_due_lovelace,
      COALESCE(sum((requirements->>'amount')::numeric) FILTER (WHERE refund_status='paid'),0)::text AS refunded_lovelace,
      count(*) FILTER (WHERE state='settling')::integer AS pending_calls,
      count(*) FILTER (WHERE state='review')::integer AS review_calls
      FROM paid_calls WHERE provider_id=$1`, [providerId]);
    res.json({ ...summary.rows[0], payoutModel: 'direct-to-provider', platformFeeLovelace: '0' });
  } catch (error) { next(error); }
});

router.get('/payments', async (_req, res, next) => {
  try {
    const calls = await pool.query('SELECT * FROM paid_calls WHERE provider_id=$1 ORDER BY created_at DESC LIMIT 100', [providerId]);
    res.json({ items: calls.rows.map(call => ({ ...receipt(call), listingId: call.listing_id,
      operationId: call.operation_id, payer: call.payer, createdAt: call.created_at })) });
  } catch (error) { next(error); }
});

router.post('/payments/:receiptId/reconcile', async (req, res, next) => {
  try {
    const result = await callStore.locked(String(req.params.receiptId), async session => {
      const call = await session.load();
      if (!call || call.provider_id !== providerId) throw Object.assign(new Error('Receipt not found.'), { status: 404 });
      await reconcileCall(call, paymentGateway, session);
      return receipt(call);
    });
    res.status(result ? 200 : 409).json(result ?? { error: 'Call is in progress.' });
  } catch (error) { next(error); }
});

router.post('/payments/:receiptId/refund', async (req, res, next) => {
  try {
    const txHash = req.body?.transaction;
    if (typeof txHash !== 'string' || !/^[a-f0-9]{64}$/.test(txHash)) throw invalid('Provide the confirmed refund transaction hash.');
    const result = await callStore.locked(String(req.params.receiptId), async session => {
      const call = await session.load();
      if (!call || call.provider_id !== providerId) throw Object.assign(new Error('Receipt not found.'), { status: 404 });
      if (call.refund_status === 'paid' && call.refund_tx_hash === txHash) return receipt(call);
      if (call.refund_status !== 'due' || !call.payer || txHash === call.tx_hash) throw Object.assign(new Error('This payment has no refundable balance or verified payer address.'), { status: 409 });
      if (!await verifyRefund(txHash, call.payer, call.requirements.amount, call.tx_hash!)) throw invalid('Refund must return the full service amount to the verified payer with one newer Preprod confirmation.');
      call.refund_status = 'paid'; call.refund_tx_hash = txHash;
      await session.save(call);
      return receipt(call);
    });
    res.status(result ? 200 : 409).json(result ?? { error: 'Call is in progress.' });
  } catch (error) { next(error); }
});

export { router as providerPaymentsRouter };

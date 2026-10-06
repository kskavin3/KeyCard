import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Request, Response, NextFunction } from 'express';
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from '@x402/core/types';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { jcs } from '@x402/cardano';

type State = 'quoted' | 'verified' | 'executing' | 'result_ready' | 'settling' | 'completed' | 'failed' | 'review';
export type PaidCall = {
  call_id: string; request_hash: string; provider_id: string; listing_id: string; operation_id: string;
  requirements: PaymentRequirements; expires_at: Date; created_at: Date; state: State;
  tx_hash?: string; payment_payload?: PaymentPayload; payer?: string;
  response_status?: number; response_body?: any; settlement?: SettleResponse;
  payment_confirmed: boolean; refund_status: 'none' | 'due' | 'paid'; refund_tx_hash?: string;
};
export interface CallSession { load(): Promise<PaidCall | undefined>; save(call: PaidCall): Promise<void> }
export interface CallStore { locked<T>(id: string, run: (session: CallSession) => Promise<T>): Promise<T | undefined> }

export class PgCallStore implements CallStore {
  constructor(private pool: Pool) {}
  async locked<T>(id: string, run: (session: CallSession) => Promise<T>): Promise<T | undefined> {
    const client = await this.pool.connect();
    let locked = false;
    let broken = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [id])).rows[0].locked;
      if (!locked) return undefined;
      return await run({
        load: async () => (await client.query('SELECT * FROM paid_calls WHERE call_id = $1', [id])).rows[0],
        save: call => saveCall(client, call),
      });
    } finally {
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [id]); }
        catch { broken = true; }
      }
      client.release(broken);
    }
  }
}
async function saveCall(client: PoolClient, call: PaidCall) {
  await client.query('BEGIN');
  try {
    for (const [tx, purpose] of [[call.tx_hash, 'payment'], [call.refund_tx_hash, 'refund']]) {
      if (!tx) continue;
      await client.query('INSERT INTO payment_transactions(tx_hash,call_id,purpose) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [tx,call.call_id,purpose]);
      const claim = (await client.query('SELECT call_id,purpose FROM payment_transactions WHERE tx_hash=$1', [tx])).rows[0];
      if (!claim || claim.call_id !== call.call_id || claim.purpose !== purpose) throw fail('This transaction is already bound to another payment or refund.');
    }
    await client.query(`INSERT INTO paid_calls
      (call_id,request_hash,provider_id,listing_id,operation_id,requirements,expires_at,created_at,state,
       tx_hash,payment_payload,payer,response_status,response_body,settlement,payment_confirmed,refund_status,refund_tx_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (call_id) DO UPDATE SET state=EXCLUDED.state,tx_hash=EXCLUDED.tx_hash,
       payment_payload=EXCLUDED.payment_payload,payer=EXCLUDED.payer,response_status=EXCLUDED.response_status,
       response_body=EXCLUDED.response_body,settlement=EXCLUDED.settlement,
       payment_confirmed=EXCLUDED.payment_confirmed,refund_status=EXCLUDED.refund_status,
       refund_tx_hash=EXCLUDED.refund_tx_hash,updated_at=now()`,
      [call.call_id,call.request_hash,call.provider_id,call.listing_id,call.operation_id,call.requirements,
        call.expires_at,call.created_at,call.state,call.tx_hash,call.payment_payload,call.payer,
        call.response_status,call.response_body,call.settlement,call.payment_confirmed,call.refund_status,call.refund_tx_hash]);
    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw Object.assign(new Error('This transaction is already bound to another call.'), { status: 409 });
    throw error;
  }
}

export type PaymentGateway = {
  transaction(payload: PaymentPayload): string;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
  confirmed(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse | undefined>;
};
type Dependencies = {
  store: CallStore; gateway: PaymentGateway; origin: string; now?: () => number;
  quote(path: string): Promise<{ requirements: PaymentRequirements; providerId: string; listingId: string; operationId: string }>;
  upstream(req: Request): Promise<unknown>;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });
export function receipt(call: PaidCall) {
  return { receiptId: call.call_id, requestHash: `sha256:${call.request_hash}`, state: call.state,
    transaction: call.tx_hash ?? null, network: call.requirements.network, amountLovelace: call.requirements.amount,
    payTo: call.requirements.payTo, paymentConfirmed: call.payment_confirmed,
    payoutStatus: call.payment_confirmed ? 'paid-directly' : 'pending', refundStatus: call.refund_status,
    refundTransaction: call.refund_tx_hash ?? null };
}

export function createPaidHandler(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  return async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const key = req.get('Idempotency-Key');
      if (!key || !/^[A-Za-z0-9_-]{32,128}$/.test(key)) throw fail('Provide a secret random Idempotency-Key (32–128 URL-safe characters) and reuse it on every retry.', 400);
      const id = hash(key);
      const fingerprint = hash(jcs({ method: req.method, path: req.path, query: req.query, body: req.body ?? null }));
      const handled = await deps.store.locked(id, async session => {
        let call = await session.load();
        if (call && call.request_hash !== fingerprint) throw fail('Idempotency-Key was already used for a different request.');
        if (!call) {
          if (req.get('PAYMENT-SIGNATURE')) throw fail('Request a quote with this Idempotency-Key before supplying payment.', 400);
          const quote = await deps.quote(req.path);
          call = { call_id: id, request_hash: fingerprint, provider_id: quote.providerId, listing_id: quote.listingId,
            operation_id: quote.operationId, requirements: quote.requirements,
            expires_at: new Date(now() + quote.requirements.maxTimeoutSeconds * 1000), created_at: new Date(now()),
            state: 'quoted', payment_confirmed: false, refund_status: 'none' };
          await session.save(call);
        }
        // The key is a bearer capability. No public unauthenticated receipt lookup.
        const raw = req.get('PAYMENT-SIGNATURE');
        let payload: PaymentPayload | undefined;
        if (raw) {
          try {
            if (raw.length > 65536) throw new Error('Payment header is too large.');
            payload = decodePaymentSignatureHeader(raw);
            if (payload.x402Version !== 2 || jcs(payload.accepted) !== jcs(call.requirements)) throw new Error('Payment does not match the issued quote.');
            const tx = deps.gateway.transaction(payload);
            if (call.tx_hash && tx !== call.tx_hash) throw fail('A different payment cannot replace this call’s transaction.');
          } catch (error: any) { throw fail(error.status === 409 ? error.message : 'Invalid payment evidence or changed quote.', error.status ?? 400); }
        }
        if (call.state === 'failed' || call.state === 'review') {
          await reconcileCall(call, deps.gateway, session);
        }
        if (call.state === 'completed' || call.state === 'failed' || call.state === 'review') {
          return sendStored(res, call);
        }
        if (call.state === 'quoted') {
          if (new Date(call.expires_at).getTime() <= now()) throw fail('Quote expired. Start a new unpaid call with a new Idempotency-Key.', 410);
          if (!payload) {
            const challenge = { x402Version: 2, resource: { url: new URL(req.originalUrl, deps.origin).href,
              description: 'KeyCard paid API call', mimeType: 'application/json' }, accepts: [call.requirements] };
            res.setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(challenge));
            res.status(402).json({ ...challenge, quote: { expiresAt: call.expires_at, requestHash: `sha256:${fingerprint}` } });
            return true;
          }
          let verified: VerifyResponse;
          try { verified = await deps.gateway.verify(payload, call.requirements); }
          catch { throw fail('Payment verification is temporarily unavailable. Retry this call with the same key and payment.', 503); }
          if (!verified.isValid) throw fail(`Payment rejected: ${verified.invalidReason ?? 'invalid evidence'}.`, 402);
          call.payment_payload = payload;
          call.tx_hash = deps.gateway.transaction(payload);
          call.payer = verified.payer;
          call.state = 'verified';
          await session.save(call); // UNIQUE tx_hash claims this payment across all keys.
        }
        if (call.state === 'executing') {
          // A crashed worker may have performed a mutating upstream call. Do not
          // run it twice. This is an explicit provider reconciliation obligation.
          call.state = 'review'; call.response_status = 503;
          call.response_body = { error: 'Upstream outcome needs provider review. Do not create a replacement payment.' };
          await session.save(call);
          return sendStored(res, call);
        }
        if (call.state === 'verified') {
          call.state = 'executing'; await session.save(call);
          try {
            call.response_body = { result: await deps.upstream(req) }; call.response_status = 200;
          } catch (error: any) {
            call.state = 'failed'; call.response_status = error.status ?? 502;
            call.response_body = { error: 'Upstream call failed. No settlement was requested.' };
            // A payer might independently have broadcast the transaction. Only
            // authenticated evidence can turn that into a refund obligation.
            try {
              const evidence = await deps.gateway.confirmed(call.payment_payload!, call.requirements);
              if (evidence) { call.payment_confirmed = true; call.settlement = evidence; call.refund_status = 'due'; }
            } catch { /* Provider reconciliation also scans failed calls. */ }
            await session.save(call);
            return sendStored(res, call);
          }
          call.state = 'result_ready'; await session.save(call);
        }
        // Persist intent before the network call: timeout/crash must resume
        // settlement, never re-verify spent inputs or execute the resource again.
        call.state = 'settling'; await session.save(call);
        let settlement: SettleResponse | undefined;
        try { settlement = await deps.gateway.confirmed(call.payment_payload!, call.requirements); } catch { /* resume facilitator */ }
        if (!settlement) {
          try { settlement = await deps.gateway.settle(call.payment_payload!, call.requirements); }
          catch { /* Ambiguous outcome: stay pending. */ }
        }
        if (settlement?.success && settlement.transaction === call.tx_hash && settlement.network === call.requirements.network) {
          call.settlement = settlement; call.payment_confirmed = true; call.state = 'completed';
          await session.save(call);
          return sendStored(res, call);
        }
        // Only an explicit pre-ledger definitive rejection is safe to fail.
        if (settlement?.errorReason === 'exact_cardano_settlement_definitively_rejected') {
          call.state = 'failed'; call.response_status = 402;
          call.response_body = { error: 'Payment was definitively rejected before ledger acceptance.' };
          await session.save(call);
          return sendStored(res, call);
        }
        res.setHeader('Retry-After', '5');
        res.status(202).json({ status: 'payment-pending', receipt: receipt(call),
          retry: 'Repeat the identical request with the same Idempotency-Key. Never sign a replacement transaction.' });
        return true;
      });
      if (handled === undefined) {
        res.setHeader('Retry-After', '2');
        res.status(202).json({ status: 'call-in-progress', retry: 'Retry the identical request with the same Idempotency-Key.' });
      }
    } catch (error) { next(error); }
  };
}
function sendStored(res: Response, call: PaidCall) {
  if (call.settlement?.success) res.setHeader('PAYMENT-RESPONSE', encodePaymentResponseHeader(call.settlement));
  res.status(call.response_status ?? 503).json({ ...call.response_body, receipt: receipt(call) });
  return true;
}

// Read-only chain reconciliation never initiates a payment or upstream retry.
export async function reconcileCall(call: PaidCall, gateway: PaymentGateway, session: CallSession) {
  if (!call.payment_payload || call.payment_confirmed) return;
  const evidence = await gateway.confirmed(call.payment_payload, call.requirements);
  if (!evidence?.success || evidence.transaction !== call.tx_hash || evidence.network !== call.requirements.network) return;
  call.settlement = evidence; call.payment_confirmed = true;
  if (call.state === 'settling' || call.state === 'result_ready') call.state = 'completed';
  else if (call.state === 'failed' || call.state === 'review' || call.state === 'executing') {
    call.refund_status = 'due';
    if (call.state === 'executing') {
      call.state = 'review'; call.response_status = 503;
      call.response_body = { error: 'Upstream outcome needs provider review.' };
    }
  }
  await session.save(call);
}

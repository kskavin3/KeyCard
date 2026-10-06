import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { Pool } from 'pg';
import { encodePaymentSignatureHeader, decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { createPaidHandler, PgCallStore } from './server/paid-calls.ts';

const database = process.env.KEYCARD_TEST_DATABASE_URL;
test('paid calls HTTP + PostgreSQL integration', { skip: !database && 'Set KEYCARD_TEST_DATABASE_URL to run PostgreSQL payment tests.' }, async t => {
  const schema = `keycard_test_${randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: database });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: database, options: `-c search_path=${schema}` });
  let server;
  try {
    await pool.query(await readFile(new URL('../src/server/schema.sql', import.meta.url), 'utf8'));
    await pool.query("INSERT INTO providers(provider_id,name) VALUES('p','Test')");
    const store = new PgCallStore(pool);
    const requirements = { scheme: 'exact', network: 'cardano:preprod', asset: 'lovelace', amount: '1500000',
      payTo: 'addr_test_fixture', maxTimeoutSeconds: 300, extra: { confirmationPolicy: { l1Confirmations: 1 } } };
    let time = Date.now(), executions = 0, settles = 0, verifies = 0, quoteCount = 0;
    let verifyResult = { isValid: true, payer: 'addr_test_payer' }, settlementMode = 'success', confirmed = false, upstreamMode = 'ok';
    let releaseUpstream, upstreamStarted;
    const gateway = {
      transaction: p => p.payload.transaction,
      verify: async () => { verifies++; if (verifyResult === 'timeout') throw Error('timeout'); return verifyResult; },
      settle: async p => { settles++; if (settlementMode === 'timeout') throw Error('timeout after broadcast');
        return { success: settlementMode === 'success', transaction: p.payload.transaction, network: requirements.network,
          errorReason: settlementMode === 'pending' ? 'exact_cardano_settlement_pending' : undefined }; },
      confirmed: async p => confirmed ? { success: true, transaction: p.payload.transaction, network: requirements.network } : undefined,
    };
    const dependencies = { store, gateway, origin: 'http://localhost', now: () => time,
      quote: async () => { quoteCount++; return { requirements, providerId: 'p', listingId: 'l', operationId: 'o' }; },
      upstream: async () => { executions++; if (upstreamMode === 'fail') throw Object.assign(Error('upstream'), { status: 502 });
        if (upstreamMode === 'wait') { upstreamStarted(); await new Promise(resolve => { releaseUpstream = resolve; }); }
        return { weather: 'sunny' }; },
    };
    const app = express(); app.use(express.json());
    app.all('/api/proxy/:listingId/:operationId', (req,res,next) => createPaidHandler(dependencies)(req,res,next));
    app.use((err,req,res,next) => res.status(err.status ?? 500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/proxy/l/o`;
    const key = () => randomBytes(24).toString('hex');
    const pay = tx => encodePaymentSignatureHeader({ x402Version: 2, accepted: requirements, payload: { transaction: tx, nonce: 'fixture#0' } });
    const request = (id, signature, body = { city: 'Singapore' }) => fetch(url, { method: 'POST', headers: { 'content-type':'application/json', 'Idempotency-Key': id,
      ...(signature ? { 'PAYMENT-SIGNATURE': signature } : {}) }, body: JSON.stringify(body) });
    await t.test('challenge → payment → result and receipt; retries never execute or charge twice', async () => {
      const id = key(); const challenge = await request(id);
      assert.equal(challenge.status,402); assert.deepEqual(decodePaymentRequiredHeader(challenge.headers.get('payment-required')).accepts,[requirements]);
      const result = await request(id,pay('tx1')); assert.equal(result.status,200);
      assert.equal(decodePaymentResponseHeader(result.headers.get('payment-response')).transaction,'tx1');
      const first = await result.json(); assert.deepEqual(first.result,{ weather:'sunny' }); assert.equal(first.receipt.paymentConfirmed,true);
      const retry = await request(id); assert.equal(retry.status,200); assert.deepEqual(await retry.json(),first);
      assert.equal(executions,1); assert.equal(settles,1); assert.equal(verifies,1); assert.equal(quoteCount,1);
      assert.equal((await request(id,pay('replacement'))).status,409);
      assert.equal((await request(id,undefined,{city:'Tokyo'})).status,409);
    });
    await t.test('timeout after simulated on-chain payment recovers cached result without re-verification',async () => {
      const id=key(); await request(id); settlementMode='timeout';
      const pending=await request(id,pay('tx2')); assert.equal(pending.status,202); assert.equal(pending.headers.get('payment-required'),null);
      const counts=[executions,verifies,settles]; confirmed=true;
      const recovered=await request(id,pay('tx2')); assert.equal(recovered.status,200);
      assert.deepEqual([executions,verifies,settles],counts); confirmed=false; settlementMode='success';
    });
    await t.test('pending survives quote expiry and resumes with identical transaction',async () => {
      const id=key(); await request(id); settlementMode='pending';
      assert.equal((await request(id,pay('tx3'))).status,202); const count=executions;
      time+=301000; settlementMode='success'; assert.equal((await request(id)).status,200); assert.equal(executions,count);
    });
    await t.test('one canonical transaction cannot pay for two keys',async () => {
      const id=key(); await request(id); const count=executions;
      assert.equal((await request(id,pay('tx1'))).status,409); assert.equal(executions,count);
    });
    await t.test('unpaid expired quote fails without charging',async () => {
      const id=key(); await request(id); time+=301000; const count=settles;
      assert.equal((await request(id,pay('expired'))).status,410); assert.equal(settles,count);
    });
    await t.test('invalid evidence, changed quote, and insufficient funds do not run upstream',async () => {
      const id=key(); await request(id); const count=executions;
      assert.equal((await request(id,'bad header')).status,400);
      const changed=encodePaymentSignatureHeader({x402Version:2,accepted:{...requirements,amount:'1'},payload:{transaction:'bad'}});
      assert.equal((await request(id,changed)).status,400);
      verifyResult={isValid:false,invalidReason:'insufficient_funds'};
      assert.equal((await request(id,pay('empty'))).status,402); assert.equal(executions,count);
      verifyResult={isValid:true,payer:'addr_test_payer'};
    });
    await t.test('verify timeout retains quote and permits same-payment retry',async () => {
      const id=key(); await request(id); verifyResult='timeout';
      assert.equal((await request(id,pay('tx4'))).status,503); verifyResult={isValid:true};
      assert.equal((await request(id,pay('tx4'))).status,200);
    });
    await t.test('concurrent duplicate returns in-progress; resource and settlement run once',async () => {
      const id=key(); await request(id); upstreamMode='wait'; const counts=[executions,settles];
      const started=new Promise(resolve=>{upstreamStarted=resolve;}); const first=request(id,pay('tx5')); await started;
      assert.equal((await request(id,pay('tx5'))).status,202); releaseUpstream(); assert.equal((await first).status,200);
      assert.deepEqual([executions,settles],[counts[0]+1,counts[1]+1]); upstreamMode='ok';
    });
    await t.test('upstream failure is retained without settlement; a confirmed transfer becomes refund due',async () => {
      const id=key(); await request(id); upstreamMode='fail'; const count=settles;
      const failure=await request(id,pay('tx6')); assert.equal(failure.status,502); assert.equal(settles,count);
      confirmed=true; const retry=await request(id); const body=await retry.json();
      assert.equal(body.receipt.refundStatus,'due'); assert.equal(body.receipt.paymentConfirmed,true); assert.equal(settles,count);
      confirmed=false; upstreamMode='ok';
    });
    await t.test('crash during a mutating upstream call enters review instead of re-executing',async () => {
      const count=executions;
      const id=key(); await request(id);
      const callId=createHash('sha256').update(id).digest('hex');
      await pool.query("UPDATE paid_calls SET state='executing' WHERE call_id=$1",[callId]);
      // Simulate recovery through the real route with the fixture's key.
      const response=await request(id); assert.equal(response.status,503); assert.equal(executions,count);
      assert.equal((await response.json()).receipt.state,'review');
    });
    await t.test('one transaction cannot be reused for refund and payment accounting',async () => {
      const original=(await pool.query("SELECT * FROM paid_calls WHERE tx_hash='tx6'")).rows[0];
      await assert.rejects(()=>store.locked(original.call_id,async session=>{
        const call=await session.load();call.refund_status='paid';call.refund_tx_hash='tx1';await session.save(call);
      }),/another payment or refund/);
      assert.equal((await pool.query("SELECT refund_status FROM paid_calls WHERE tx_hash='tx6'")).rows[0].refund_status,'due');
      await store.locked(original.call_id,async session=>{const call=await session.load();call.refund_status='paid';call.refund_tx_hash='refund1';await session.save(call);});
      await store.locked(original.call_id,async session=>{await session.save(await session.load());});
      const id=key();await request(id);assert.equal((await request(id,pay('refund1'))).status,409);
    });
    await t.test('provider accounting has exact integer amounts and paid failure obligation',async () => {
      const rows=await pool.query("SELECT sum((requirements->>'amount')::numeric)::text AS received FROM paid_calls WHERE payment_confirmed");
      assert.ok(BigInt(rows.rows[0].received)>=1500000n);
      assert.equal((await pool.query("SELECT refund_status FROM paid_calls WHERE tx_hash='tx6'")).rows[0].refund_status,'paid');
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});

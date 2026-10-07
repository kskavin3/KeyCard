import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const database=process.env.KEYCARD_TEST_DATABASE_URL;
test('open registry accounting, reconciliation and confirmed refund recording',{
  skip:!database && 'Set KEYCARD_TEST_DATABASE_URL for provider integration tests.',
},async()=>{
  const schema=`keycard_provider_test_${randomBytes(8).toString('hex')}`;
  const admin=new Pool({connectionString:database});await admin.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(database);url.searchParams.set('options',`-c search_path=${schema}`);
  process.env.DATABASE_URL=url.href;process.env.KEYCARD_PROVIDER_ID='provider-test';
  process.env.BLOCKFROST_PROJECT_ID='fixture';
  const actualFetch=globalThis.fetch;
  const refundHash='9'.repeat(64),paymentHash='2'.repeat(64);
  let refundAmount='1500000';
  // Only the chain transport is simulated; application routes and SQL are real.
  globalThis.fetch=async(input,options)=>{
    const address=String(input);
    if(!address.startsWith('https://cardano-preprod.blockfrost.io/')) return actualFetch(input,options);
    return new Response(JSON.stringify(address.endsWith('/blocks/latest')?{height:101}:
      address.endsWith('/utxos')?{outputs:[{address:'addr_test_payer',amount:[{unit:'lovelace',quantity:refundAmount}]}]}:
      {hash:address.includes(refundHash)?refundHash:paymentHash,valid_contract:true,block_height:100,block_time:address.includes(refundHash)?1001:1000}));
  };
  let server,pool;
  try {
    ({pool}=await import('./server/db.ts'));await pool.query(await readFile(new URL('../src/server/schema.sql',import.meta.url),'utf8'));
    await pool.query("INSERT INTO providers(provider_id,name) VALUES('provider-test','Test'),('other','Other')");
    const requirements={scheme:'exact',network:'cardano:preprod',asset:'lovelace',amount:'1500000',payTo:'addr_test_provider',maxTimeoutSeconds:300,extra:{}};
    for(const [id,provider,state,confirmed,refund,tx] of [
      ['completed','provider-test','completed',true,'none','1'.repeat(64)],
      ['failure','provider-test','failed',true,'due',paymentHash],
      ['pending','provider-test','settling',false,'none','3'.repeat(64)],
      ['other','other','completed',true,'none','4'.repeat(64)]]) {
      await pool.query(`INSERT INTO paid_calls(call_id,request_hash,provider_id,listing_id,operation_id,requirements,expires_at,state,payment_confirmed,refund_status,tx_hash,payer)
        VALUES($1,'request',$2,'l','o',$3,now()+interval '5 minutes',$4,$5,$6,$7,'addr_test_payer')`,[id,provider,requirements,state,confirmed,refund,tx]);
      await pool.query("INSERT INTO payment_transactions(tx_hash,call_id,purpose) VALUES($1,$2,'payment')",[tx,id]);
    }
    const {app}=await import('./server/app.ts');server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    const request=(path,body,extra={})=>actualFetch(origin+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
    const summary=await (await request('/api/provider/earnings')).json();
    assert.equal(summary.received_lovelace,'3000000');assert.equal(summary.earned_lovelace,'1500000');
    assert.equal(summary.refund_due_lovelace,'1500000');assert.equal(summary.pending_calls,1);
    const payments=await (await request('/api/provider/payments')).json();assert.equal(payments.items.length,3);
    assert.equal(payments.items.some(item=>item.receiptId==='other'),false);
    assert.equal(JSON.stringify(payments).includes('payment_payload'),false);
    assert.equal((await request('/api/provider/payments/other/reconcile',{})).status,404);
    refundAmount='1499999';assert.equal((await request('/api/provider/payments/failure/refund',{transaction:refundHash})).status,400);
    refundAmount='1500000';const recorded=await request('/api/provider/payments/failure/refund',{transaction:refundHash});
    assert.equal(recorded.status,200);assert.equal((await recorded.json()).refundStatus,'paid');
    assert.equal((await request('/api/provider/payments/failure/refund',{transaction:refundHash})).status,200);
    const updated=await (await request('/api/provider/earnings')).json();assert.equal(updated.refund_due_lovelace,'0');assert.equal(updated.refunded_lovelace,'1500000');
  } finally {
    globalThis.fetch=actualFetch;
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(pool)await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
